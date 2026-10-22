'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  isLlmConfigured,
  buildUserPrompt,
  parseJson,
  normalizeVerdict,
  normalizeTechnologies,
  evaluateJob,
} = require('../src/llm');

test('isLlmConfigured rejeita placeholders', () => {
  assert.equal(isLlmConfigured({ apiKey: '', baseUrl: 'x', model: 'y' }), false);
  assert.equal(isLlmConfigured({ apiKey: 'sua_chave_aqui', baseUrl: 'x', model: 'y' }), false);
  assert.equal(isLlmConfigured({ apiKey: 'your_api_key_here', baseUrl: 'x', model: 'y' }), false);
  assert.equal(isLlmConfigured({ apiKey: 'sk-real', baseUrl: 'https://x', model: 'y' }), true);
});

test('parseJson aceita code fences e texto ao redor', () => {
  assert.deepEqual(parseJson('```json\n{"nota": 80}\n```'), { nota: 80 });
  assert.deepEqual(parseJson('Resposta: {"nota": 80} fim'), { nota: 80 });
  assert.throws(() => parseJson('sem json'), /JSON válido/);
});

test('normaliza o veredito do LLM', () => {
  assert.deepEqual(
    normalizeVerdict(
      { aderente: 'sim', nota: '82', motivo: 'bom encaixe', salario: 'R$ 12.000/mês' },
      70
    ),
    {
      aderente: true,
      nota: 82,
      motivo: 'bom encaixe',
      salario: 'R$ 12.000/mês',
      tecnologias: [],
    }
  );
});

test('normaliza e deduplica as tecnologias pedidas', () => {
  assert.deepEqual(
    normalizeTechnologies(['Java', 'Spring Boot', 'java', '  Spring   Boot ', '', 'N/A']),
    ['Java', 'Spring Boot']
  );
  assert.deepEqual(normalizeTechnologies('Java; Spring Boot; Java'), ['Java', 'Spring Boot']);
  assert.deepEqual(normalizeTechnologies(undefined), []);
  assert.equal(normalizeTechnologies(['x'.repeat(80)])[0].length, 60);
});

test('inclui as tecnologias no veredito', () => {
  const verdict = normalizeVerdict(
    { nota: 90, tecnologias: ['Java', 'Spring Boot', 'Java'] },
    70
  );
  assert.deepEqual(verdict.tecnologias, ['Java', 'Spring Boot']);
});

test('aceita aliases e objetos no campo de tecnologias', () => {
  assert.deepEqual(
    normalizeVerdict(
      {
        nota: 90,
        tech_stack: [{ name: 'Java' }, { nome: 'Spring Boot' }, 'Java', 'N/A'],
      },
      70
    ).tecnologias,
    ['Java', 'Spring Boot']
  );
  assert.deepEqual(
    normalizeVerdict({ nota: 80, tecnologias_pedidas: 'C#, .NET' }, 70).tecnologias,
    ['C#', '.NET']
  );
  assert.deepEqual(
    normalizeVerdict({ nota: 80, requisitos_tecnicos: ['AWS', 'Docker'] }, 70).tecnologias,
    ['AWS', 'Docker']
  );
});

test('usa a nota quando aderente não vem no JSON', () => {
  assert.equal(normalizeVerdict({ nota: 65 }, 70).aderente, false);
  assert.equal(normalizeVerdict({ nota: 75 }, 70).aderente, true);
});

test('limpa salários vazios e notas fora da faixa', () => {
  assert.equal(normalizeVerdict({ nota: 80, salario: 'null' }, 70).salario, null);
  assert.equal(normalizeVerdict({ nota: 80, salario: 'Não informado' }, 70).salario, null);
  assert.equal(normalizeVerdict({ nota: 140 }, 70).nota, 100);
  assert.equal(normalizeVerdict({ nota: -10 }, 70).nota, 0);
});

test('prompt inclui nota mínima, perfil e descrição truncada', () => {
  const prompt = buildUserPrompt(
    {
      title: 'Dev',
      company: 'Acme',
      location: 'Remoto',
      salary: '',
      description: 'x'.repeat(7000),
    },
    'Cargos desejados: Dev',
    75
  );
  assert.match(prompt, /maior ou igual a 75/);
  assert.match(prompt, /Cargos desejados: Dev/);
  assert.match(prompt, /Java 17\+/);
  assert.match(prompt, /Spring Boot/);
  assert.match(prompt, /"tecnologias"/);
  assert.ok(prompt.length < 8000);
});

test('prompt inclui o currículo somente quando fornecido', () => {
  const job = {
    title: 'Dev',
    company: 'Acme',
    location: 'Remoto',
    salary: '',
    description: 'Node.js',
  };

  const withResume = buildUserPrompt(
    job,
    'Cargos desejados: Dev',
    70,
    'Curriculo Teste - Node.js TypeScript'
  );
  assert.match(withResume, /CURRÍCULO DO CANDIDATO/);
  assert.match(withResume, /Curriculo Teste - Node\.js TypeScript/);

  const withoutResume = buildUserPrompt(job, 'Cargos desejados: Dev', 70);
  assert.doesNotMatch(withoutResume, /CURRÍCULO DO CANDIDATO/);
});

test('evaluateJob exige o prompt do sistema', async () => {
  await assert.rejects(
    () =>
      evaluateJob({
        job: { title: 'Dev', company: 'Acme', description: 'Node.js' },
        profile: 'Cargos desejados: Dev',
        llm: {
          apiKey: 'sk-test',
          baseUrl: 'http://127.0.0.1:1/v1',
          model: 'test-model',
          threshold: 70,
        },
      }),
    /Prompt do sistema não informado/
  );
});

test('conversa com uma API compatível com OpenAI', async (t) => {
  let captured = null;

  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      captured = {
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(body),
      };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  aderente: true,
                  nota: 88,
                  motivo: 'bom encaixe',
                  salario: 'R$ 12.000/mês',
                  tecnologias: ['Node.js', 'TypeScript'],
                }),
              },
            },
          ],
        })
      );
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const verdict = await evaluateJob({
    job: {
      title: 'Dev',
      company: 'Acme',
      location: 'Remoto',
      salary: '',
      description: 'Node.js',
    },
    profile: 'Cargos desejados: Dev',
    resumeText: 'Curriculo Teste - Node.js TypeScript',
    systemPrompt: 'Você é um recrutador de teste.',
    llm: {
      apiKey: 'sk-test',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'test-model',
      threshold: 70,
    },
  });

  assert.equal(captured.url, '/v1/chat/completions');
  assert.equal(captured.authorization, 'Bearer sk-test');
  assert.equal(captured.body.model, 'test-model');
  assert.equal(captured.body.response_format.type, 'json_object');
  assert.equal(captured.body.messages[0].role, 'system');
  assert.equal(captured.body.messages[0].content, 'Você é um recrutador de teste.');
  assert.match(captured.body.messages[1].content, /CURRÍCULO DO CANDIDATO/);
  assert.match(captured.body.messages[1].content, /Curriculo Teste - Node\.js TypeScript/);
  assert.equal(verdict.aderente, true);
  assert.equal(verdict.nota, 88);
  assert.equal(verdict.salario, 'R$ 12.000/mês');
  assert.deepEqual(verdict.tecnologias, ['Node.js', 'TypeScript']);
});
