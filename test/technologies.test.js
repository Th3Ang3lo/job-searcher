'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractTechnologies,
  mergeTechnologies,
  formatTechnologies,
  technologiesForJob,
} = require('../src/technologies');

test('extrai linguagens, frameworks, bancos e ferramentas do texto', () => {
  const technologies = extractTechnologies(
    'Vaga para C# .NET 8 com ASP.NET Core, SQL Server e Azure. ' +
      'Desejável Java 17+, Spring Boot, Node.js, TypeScript, Docker e Kubernetes.'
  );

  assert.deepEqual(technologies, [
    'C#',
    '.NET',
    'ASP.NET Core',
    'SQL Server',
    'Azure',
    'Java',
    'Spring Boot',
    'Node.js',
    'TypeScript',
    'Docker',
    'Kubernetes',
  ]);
});

test('não confunde tecnologias parecidas', () => {
  assert.deepEqual(extractTechnologies('JavaScript e Node.js'), ['JavaScript', 'Node.js']);
  assert.deepEqual(extractTechnologies('Node.js e TypeScript'), ['Node.js', 'TypeScript']);
  assert.deepEqual(extractTechnologies('C++ e C#'), ['C++', 'C#']);
  assert.deepEqual(extractTechnologies('React Native'), ['React Native']);
  assert.deepEqual(extractTechnologies('Spring Boot'), ['Spring Boot']);
  assert.deepEqual(extractTechnologies('Ruby on Rails'), ['Ruby on Rails']);
  assert.deepEqual(extractTechnologies('SQL Server'), ['SQL Server']);
  assert.deepEqual(extractTechnologies('PL/SQL'), ['PL/SQL']);
  assert.deepEqual(extractTechnologies('R$ 10.000 por mês'), []);
});

test('evita falsos positivos de palavras ambíguas', () => {
  assert.deepEqual(extractTechnologies('auxílio lua de mel'), []);
  assert.deepEqual(extractTechnologies('swift communication e rust prevention'), []);
  assert.deepEqual(extractTechnologies('bootstrap the team'), []);
  assert.deepEqual(extractTechnologies('Spring 2025'), []);
  assert.deepEqual(extractTechnologies('Lua, Swift, Rust, Dart e Julia'), [
    'Lua',
    'Swift',
    'Rust',
    'Dart',
    'Julia',
  ]);
});

test('distingue frameworks do ecossistema Spring e ferramentas de build', () => {
  assert.deepEqual(
    extractTechnologies('Spring Boot, Spring Security, Java EE, Maven e Gradle.'),
    ['Spring Boot', 'Spring Security', 'Java', 'Java EE', 'Maven', 'Gradle']
  );
});

test('reconhece ferramentas de observabilidade e infraestrutura', () => {
  assert.deepEqual(
    extractTechnologies(
      'Splunk, Grafana, Prometheus, Datadog, OpenTelemetry, CloudFormation e CircleCI.'
    ),
    ['Splunk', 'Grafana', 'Prometheus', 'Datadog', 'OpenTelemetry', 'CloudFormation', 'CircleCI']
  );
});

test('mantém a ordem em que as tecnologias aparecem', () => {
  assert.deepEqual(
    extractTechnologies('Python, AWS e PostgreSQL; depois Java e Kubernetes.'),
    ['Python', 'AWS', 'PostgreSQL', 'Java', 'Kubernetes']
  );
});

test('texto vazio não produz tecnologias', () => {
  assert.deepEqual(extractTechnologies(''), []);
  assert.deepEqual(extractTechnologies('   '), []);
  assert.deepEqual(extractTechnologies(null), []);
});

test('merge canonicaliza versões e remove duplicatas', () => {
  assert.deepEqual(
    mergeTechnologies(
      ['Java', 'Spring Boot', 'Node.js'],
      ['Java 17', 'Spring Boot 3', 'APIs REST', 'Ferramenta Interna', 'java']
    ),
    ['Java', 'Spring Boot', 'Node.js', 'REST', 'Ferramenta Interna']
  );
});

test('merge aceita string separada por vírgula ou ponto e vírgula', () => {
  assert.deepEqual(mergeTechnologies('Java; Spring Boot, Java'), ['Java', 'Spring Boot']);
});

test('formata a coluna com fallback', () => {
  assert.equal(formatTechnologies([]), 'Não informado');
  assert.equal(formatTechnologies(null), 'Não informado');
  assert.equal(formatTechnologies(['Java', 'Spring Boot']), 'Java, Spring Boot');
});

test('tecnologias da vaga combinam descrição e veredito do LLM', () => {
  const result = technologiesForJob(
    {
      title: 'Desenvolvedor Backend Sênior (C# / .NET)',
      description:
        'Requisitos: C#, .NET 8, ASP.NET Core, SQL Server e Azure. ' +
        'Desejável Java, Spring Boot, Node.js e Docker.',
    },
    {
      tecnologias: ['C#', '.NET 8', 'APIs REST', 'Microsserviços', 'Ferramenta Interna'],
    }
  );

  assert.equal(
    result,
    'C#, .NET, ASP.NET Core, SQL Server, Azure, Java, Spring Boot, Node.js, Docker, ' +
      'REST, Microsserviços, Ferramenta Interna'
  );
});

test('tecnologias da vaga funcionam sem veredito (modo keywords)', () => {
  assert.equal(
    technologiesForJob(
      {
        title: 'Dev Java',
        description: 'Spring Boot, PostgreSQL e AWS.',
      },
      null
    ),
    'Java, Spring Boot, PostgreSQL, AWS'
  );
});
