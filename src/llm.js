'use strict';

const { normalizeText, truncate } = require('./util');

function isLlmConfigured(llm) {
  const key = String(llm && llm.apiKey ? llm.apiKey : '').trim();
  if (!key) return false;
  if (/^(your_api_key_here|sua_chave(_aqui)?|changeme|placeholder|xxx+)$/i.test(key)) return false;
  return Boolean(llm.baseUrl && llm.model);
}

function buildUserPrompt(job, profile, threshold, resumeText = '') {
  const description = job.description
    ? truncate(job.description, 6000)
    : '(descrição não disponível)';

  const sections = [
    'PERFIL DO CANDIDATO:',
    profile || '(perfil não preenchido)',
  ];

  if (resumeText) {
    sections.push('', 'CURRÍCULO DO CANDIDATO (texto extraído do PDF):', resumeText);
  }

  sections.push(
    '',
    'VAGA:',
    `Título: ${job.title || '(não informado)'}`,
    `Empresa: ${job.company || '(não informada)'}`,
    `Local: ${job.location || '(não informado)'}`,
    `Salário informado na página: ${job.salary || 'não informado'}`,
    'Descrição:',
    description,
    '',
    'TAREFA:',
    'Avalie a aderência desta vaga ao perfil do candidato. Considere cargo, senioridade,',
    'tecnologias, localização/modalidade, tipo de contrato, idioma e faixa salarial.',
    '',
    'CRITÉRIOS TÉCNICOS:',
    '- Trate versões específicas e frameworks do mesmo ecossistema como cobertos quando o',
    '  candidato demonstra domínio da base. Exemplos: vaga pede "Java 17+" e o candidato tem',
    '  Java → considere atendido; vaga pede "Spring Boot" e o candidato tem Java/Spring →',
    '  considere aderente.',
    '- Tecnologias relacionadas contam como proximidade, mas não invente experiência: se o',
    '  candidato não tem nenhuma base relacionada, não considere atendido.',
    '',
    `Considere "aderente" somente se a nota for maior ou igual a ${threshold}.`,
    'Não estime salário: use apenas um valor explícito na descrição. Se não houver, use null.',
    'Liste em "tecnologias" as tecnologias e requisitos técnicos explicitamente pedidos pela',
    'vaga (linguagens, versões, frameworks, bancos, cloud, ferramentas), sem duplicatas.',
    'Se a vaga não pedir nenhuma tecnologia explícita, use uma lista vazia.',
    'Responda APENAS com JSON válido no formato:',
    '{"aderente": true, "nota": 0, "motivo": "até 2 frases", "salario": "valor explícito ou null", "tecnologias": ["Java", "Spring Boot"]}'
  );

  return sections.join('\n');
}

function parseJson(text) {
  let value = String(text || '').trim();
  value = value.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(value.slice(start, end + 1));
    }
    throw new Error('Resposta do LLM não contém JSON válido');
  }
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return /^(true|sim|yes|1)$/i.test(value.trim());
  return false;
}

function technologyItem(item) {
  if (item && typeof item === 'object') {
    return item.nome ?? item.name ?? item.tecnologia ?? item.technology ?? item.label ?? '';
  }
  return item;
}

function normalizeTechnologies(raw) {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[;,]/)
      : [];
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const text = truncate(
      String(technologyItem(item) ?? '').replace(/\s+/g, ' ').trim(),
      60
    );
    if (!text || /^(n\/a|nao informado|não informado|null|-)$/i.test(text)) continue;

    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(text);
    if (result.length >= 20) break;
  }

  return result;
}

function normalizeVerdict(raw, threshold) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('JSON do LLM sem objeto de avaliação');
  }

  const nota = Number(raw.nota ?? raw.score ?? raw.nota_aderencia);
  if (!Number.isFinite(nota)) {
    throw new Error('JSON do LLM sem nota numérica');
  }

  const aderente =
    raw.aderente != null
      ? toBoolean(raw.aderente)
      : raw.match != null
        ? toBoolean(raw.match)
        : nota >= threshold;

  const salaryText = raw.salario == null ? '' : String(raw.salario).trim();
  const salario =
    salaryText && !/^(null|n\/a|nao informado|não informado|-)$/i.test(salaryText)
      ? salaryText
      : null;

  return {
    aderente,
    nota: Math.max(0, Math.min(100, Math.round(nota))),
    motivo: truncate(raw.motivo || raw.reason || '', 300),
    salario,
    tecnologias: normalizeTechnologies(
      raw.tecnologias ??
        raw.technologies ??
        raw.tecnologias_pedidas ??
        raw.tech_stack ??
        raw.stack ??
        raw.requisitos_tecnicos ??
        raw.technical_requirements
    ),
  };
}

async function postCompletion(body, llm, signal) {
  const baseUrl = String(llm.baseUrl || '').replace(/\/+$/, '');
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llm.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: signal || AbortSignal.timeout(60000),
  });
}

async function chatCompletion({ messages, llm, jsonMode = true, signal }) {
  const body = {
    model: llm.model,
    messages,
    temperature: 0,
    max_tokens: 500,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  let response = await postCompletion(body, llm, signal);

  // Alguns provedores compatíveis não aceitam response_format.
  if (!response.ok && response.status === 400 && jsonMode) {
    delete body.response_format;
    response = await postCompletion(body, llm, signal);
  }

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`LLM respondeu HTTP ${response.status}: ${truncate(detail, 300)}`);
    error.status = response.status;
    error.rateLimited = response.status === 429;
    throw error;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('LLM não retornou conteúdo');
  }
  return content;
}

async function evaluateJob({ job, profile, resumeText = '', llm, systemPrompt, signal }) {
  const threshold = Number.isFinite(llm.threshold) ? llm.threshold : 70;
  const system = String(systemPrompt || '').trim();
  if (!system) {
    throw new Error('Prompt do sistema não informado');
  }

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: buildUserPrompt(job, profile, threshold, resumeText) },
  ];

  let content = await chatCompletion({ messages, llm, jsonMode: true, signal });
  let parsed;
  try {
    parsed = parseJson(content);
  } catch {
    content = await chatCompletion({
      messages: [
        ...messages,
        { role: 'user', content: 'Responda apenas com o objeto JSON pedido, sem markdown.' },
      ],
      llm,
      jsonMode: false,
      signal,
    });
    parsed = parseJson(content);
  }

  return normalizeVerdict(parsed, threshold);
}

module.exports = {
  isLlmConfigured,
  evaluateJob,
  buildUserPrompt,
  parseJson,
  normalizeVerdict,
  normalizeTechnologies,
};
