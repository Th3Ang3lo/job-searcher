'use strict';

const { truncate } = require('./util');

const SYSTEM_PROMPT = [
  'Você é um recrutador técnico sênior avaliando se uma vaga combina com o perfil de um candidato.',
  'Seja rigoroso, objetivo e consistente. Não invente informações.',
  'Responda somente com o objeto JSON pedido, sem markdown e sem texto adicional.',
].join(' ');

function isLlmConfigured(llm) {
  const key = String(llm && llm.apiKey ? llm.apiKey : '').trim();
  if (!key) return false;
  if (/^(your_api_key_here|sua_chave(_aqui)?|changeme|placeholder|xxx+)$/i.test(key)) return false;
  return Boolean(llm.baseUrl && llm.model);
}

function buildUserPrompt(job, profile, threshold) {
  const description = job.description
    ? truncate(job.description, 6000)
    : '(descrição não disponível)';

  return [
    'PERFIL DO CANDIDATO:',
    profile || '(perfil não preenchido)',
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
    `Considere "aderente" somente se a nota for maior ou igual a ${threshold}.`,
    'Não estime salário: use apenas um valor explícito na descrição. Se não houver, use null.',
    'Responda APENAS com JSON válido no formato:',
    '{"aderente": true, "nota": 0, "motivo": "até 2 frases", "salario": "valor explícito ou null"}',
  ].join('\n');
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
    throw new Error(`LLM respondeu HTTP ${response.status}: ${truncate(detail, 300)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('LLM não retornou conteúdo');
  }
  return content;
}

async function evaluateJob({ job, profile, llm, signal }) {
  const threshold = Number.isFinite(llm.threshold) ? llm.threshold : 70;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(job, profile, threshold) },
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
};
