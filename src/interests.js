'use strict';

const { normalizeText, parseAmount, detectCurrency, detectPeriod } = require('./util');

const COUNTRY_SEARCH = {
  brasil: 'Brazil',
  brazil: 'Brazil',
  portugal: 'Portugal',
  'estados unidos': 'United States',
  eua: 'United States',
  usa: 'United States',
  'reino unido': 'United Kingdom',
  espanha: 'Spain',
  alemanha: 'Germany',
  canada: 'Canada',
  irlanda: 'Ireland',
  holanda: 'Netherlands',
  'paises baixos': 'Netherlands',
  franca: 'France',
  italia: 'Italy',
  argentina: 'Argentina',
  mexico: 'Mexico',
};

const CURRENCY_ALIASES = {
  brl: 'BRL',
  real: 'BRL',
  reais: 'BRL',
  usd: 'USD',
  dolar: 'USD',
  dollar: 'USD',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  gbp: 'GBP',
};

const WORK_MODE_CODES = {
  remoto: 2,
  remote: 2,
  hibrido: 3,
  hybrid: 3,
  presencial: 1,
  onsite: 1,
  'on-site': 1,
};

function emptyInterests() {
  return {
    roles: [],
    seniority: [],
    skills: [],
    country: '',
    cities: [],
    workModes: [],
    contracts: [],
    salary: { min: null, currency: '', period: '' },
    languages: [],
    boostKeywords: [],
    excludeKeywords: [],
    companiesInclude: [],
    companiesExclude: [],
    about: [],
    notes: [],
  };
}

function classifySection(heading) {
  const value = normalizeText(heading);
  if (value.startsWith('cargos')) return 'roles';
  if (value.startsWith('senioridade')) return 'seniority';
  if (value.startsWith('tecnologias')) return 'skills';
  if (value.startsWith('localizacao')) return 'location';
  if (value.startsWith('tipo de contrato') || value === 'contrato') return 'contracts';
  if (value.startsWith('faixa salarial')) return 'salary';
  if (value.startsWith('idiomas')) return 'languages';
  if (value.startsWith('palavras-chave') && value.includes('excluem')) return 'excludeKeywords';
  if (value.startsWith('palavras-chave')) return 'boostKeywords';
  if (value.startsWith('empresas de interesse')) return 'companiesInclude';
  if (value.startsWith('empresas a evitar')) return 'companiesExclude';
  if (value.startsWith('sobre mim')) return 'about';
  if (value.startsWith('observacoes')) return 'notes';
  return null;
}

function stripMarkdownEmphasis(value) {
  return String(value).replace(/^[\s*_`~]+|[\s*_`~]+$/g, '');
}

function isExample(value) {
  const text = stripMarkdownEmphasis(value);
  return /^ex\.?\s*:/i.test(text) || /^exemplo\b/i.test(text) || text === '...';
}

function splitList(value) {
  return String(value)
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseInterests(markdown) {
  const data = emptyInterests();
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  let section = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = classifySection(heading[1]);
      continue;
    }
    if (!section) continue;

    const bullet = line.match(/^\s*[-*+]\s+(.+?)\s*$/);
    if (!bullet) continue;

    const content = bullet[1].trim();
    if (!content || isExample(content)) continue;

    if (section === 'location') {
      const pair = content.match(/^([^:]+):\s*(.+)$/);
      if (!pair) continue;
      const key = normalizeText(pair[1]);
      const value = pair[2].trim();
      if (isExample(value)) continue;

      if (key.startsWith('pais')) data.country = value;
      else if (key.startsWith('cidade')) data.cities = splitList(value);
      else if (key.startsWith('modalidade')) data.workModes = splitList(value);
      continue;
    }

    if (section === 'salary') {
      const pair = content.match(/^([^:]+):\s*(.+)$/);
      if (!pair) continue;
      const key = normalizeText(pair[1]);
      const value = pair[2].trim();
      if (isExample(value)) continue;

      if (key.startsWith('min')) {
        data.salary.min = parseAmount(value);
      } else if (key.startsWith('moeda')) {
        data.salary.currency =
          detectCurrency(value) || CURRENCY_ALIASES[normalizeText(value)] || value.toUpperCase();
      } else if (key.startsWith('periodo')) {
        data.salary.period = detectPeriod(value) || '';
      }
      continue;
    }

    if (section === 'about' || section === 'notes') {
      data[section].push(content);
      continue;
    }

    data[section].push(...splitList(content));
  }

  // Padrões definidos com o usuário: Brasil, remoto e salário em BRL.
  if (!data.country) data.country = 'Brasil';
  if (!data.workModes.length) data.workModes = ['Remoto'];
  if (data.salary.min != null && !data.salary.currency) data.salary.currency = 'BRL';

  return data;
}

function buildSearchLocation(interests) {
  const country = COUNTRY_SEARCH[normalizeText(interests.country)] || interests.country || 'Brazil';
  const isRemote = interests.workModes.some((mode) => {
    const value = normalizeText(mode);
    return value.includes('remot') || value.includes('remote') || value.includes('home');
  });

  if (isRemote || !interests.cities.length) return country;
  return `${interests.cities[0]}, ${country}`;
}

function workModeCodes(workModes) {
  const codes = new Set();
  for (const mode of workModes) {
    const value = normalizeText(mode);
    for (const [key, code] of Object.entries(WORK_MODE_CODES)) {
      if (value.includes(key)) codes.add(code);
    }
  }
  return [...codes];
}

function renderProfileForLLM(interests) {
  const lines = [];
  const add = (label, value) => {
    if (Array.isArray(value)) {
      if (value.length) lines.push(`${label}: ${value.join('; ')}`);
      return;
    }
    if (value) lines.push(`${label}: ${value}`);
  };

  add('Cargos desejados', interests.roles);
  add('Senioridade', interests.seniority);
  add('Tecnologias e habilidades', interests.skills);
  add(
    'Localização',
    [interests.country, interests.cities.length ? interests.cities.join(', ') : '']
      .filter(Boolean)
      .join(' — ')
  );
  add('Modalidade', interests.workModes);
  add('Tipo de contrato', interests.contracts);
  if (interests.salary.min != null) {
    lines.push(
      `Salário mínimo: ${interests.salary.currency || ''} ${interests.salary.min} por ${
        interests.salary.period === 'year' ? 'ano' : interests.salary.period === 'hour' ? 'hora' : 'mês'
      }`.replace(/\s+/g, ' ')
    );
  }
  add('Idiomas das vagas', interests.languages);
  add('Palavras-chave que reforçam aderência', interests.boostKeywords);
  add('Palavras-chave que excluem a vaga', interests.excludeKeywords);
  add('Empresas de interesse', interests.companiesInclude);
  add('Empresas a evitar', interests.companiesExclude);
  add('Sobre o candidato', interests.about.join(' '));
  add('Observações', interests.notes.join(' '));

  return lines.join('\n');
}

module.exports = {
  parseInterests,
  buildSearchLocation,
  workModeCodes,
  renderProfileForLLM,
  isExample,
  splitList,
};
