'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseInterests,
  buildSearchLocation,
  workModeCodes,
  renderProfileForLLM,
  isExample,
} = require('../src/interests');

const template = `# Perfil de Interesses — Busca de Vagas

## Cargos desejados

- *ex.: Desenvolvedor Backend Sênior*

## Tecnologias e habilidades

- *ex.: Node.js, TypeScript*

## Localização e modalidade

- País: *ex.: Brasil*
- Cidades: *ex.: São Paulo*
- Modalidade: *ex.: Remoto*

## Faixa salarial

- Mínimo: *ex.: 15000*
- Moeda: *ex.: BRL*
- Período: *ex.: mês*

## Sobre mim (contexto para o filtro inteligente)

- *ex.: 8 anos de experiência em backend.*
`;

const filled = `# Perfil

## Cargos desejados

- Desenvolvedor Backend Sênior
- Engenheiro de Software

## Senioridade

- Sênior

## Tecnologias e habilidades

- Node.js, TypeScript, PostgreSQL

## Localização e modalidade

- País: Brasil
- Cidades: São Paulo, Rio de Janeiro
- Modalidade: Remoto, Híbrido

## Tipo de contrato

- CLT, PJ

## Faixa salarial

- Mínimo: 15000
- Moeda: BRL
- Período: mês

## Idiomas das vagas

- Português, Inglês

## Palavras-chave que reforçam a aderência

- fintech, produto

## Palavras-chave que excluem a vaga

- estágio, vendas

## Empresas de interesse

- Nubank, Mercado Livre

## Empresas a evitar

- Banco X

## Sobre mim (contexto para o filtro inteligente)

- 8 anos de experiência em backend.

## Observações

- Aceito sobreaviso.
`;

test('o template ignora os exemplos', () => {
  const interests = parseInterests(template);
  assert.deepEqual(interests.roles, []);
  assert.deepEqual(interests.skills, []);
  assert.equal(interests.salary.min, null);
  assert.equal(interests.country, 'Brasil');
  assert.deepEqual(interests.workModes, ['Remoto']);
});

test('lê um perfil preenchido', () => {
  const interests = parseInterests(filled);
  assert.deepEqual(interests.roles, ['Desenvolvedor Backend Sênior', 'Engenheiro de Software']);
  assert.deepEqual(interests.seniority, ['Sênior']);
  assert.deepEqual(interests.skills, ['Node.js', 'TypeScript', 'PostgreSQL']);
  assert.equal(interests.country, 'Brasil');
  assert.deepEqual(interests.cities, ['São Paulo', 'Rio de Janeiro']);
  assert.deepEqual(interests.workModes, ['Remoto', 'Híbrido']);
  assert.deepEqual(interests.contracts, ['CLT', 'PJ']);
  assert.deepEqual(interests.salary, { min: 15000, currency: 'BRL', period: 'month' });
  assert.deepEqual(interests.languages, ['Português', 'Inglês']);
  assert.deepEqual(interests.boostKeywords, ['fintech', 'produto']);
  assert.deepEqual(interests.excludeKeywords, ['estágio', 'vendas']);
  assert.deepEqual(interests.companiesInclude, ['Nubank', 'Mercado Livre']);
  assert.deepEqual(interests.companiesExclude, ['Banco X']);
  assert.deepEqual(interests.about, ['8 anos de experiência em backend.']);
  assert.deepEqual(interests.notes, ['Aceito sobreaviso.']);
});

test('ignora exemplos misturados com itens reais', () => {
  const interests = parseInterests(`## Cargos desejados
- *ex.: Desenvolvedor Backend Sênior*
- Engenheiro de Plataforma
- ex.: outro cargo
`);
  assert.deepEqual(interests.roles, ['Engenheiro de Plataforma']);
});

test('localização usa o nome em inglês e a modalidade remota', () => {
  const interests = parseInterests(filled);
  assert.equal(buildSearchLocation(interests), 'Brazil');
  assert.deepEqual(workModeCodes(interests.workModes), [2, 3]);
});

test('localização presencial usa a primeira cidade', () => {
  const interests = parseInterests(`## Localização e modalidade
- País: Brasil
- Cidades: São Paulo, Rio de Janeiro
- Modalidade: Presencial
`);
  assert.equal(buildSearchLocation(interests), 'São Paulo, Brazil');
  assert.deepEqual(workModeCodes(interests.workModes), [1]);
});

test('renderiza o perfil para o LLM', () => {
  const profile = renderProfileForLLM(parseInterests(filled));
  assert.match(profile, /Cargos desejados: Desenvolvedor Backend Sênior; Engenheiro de Software/);
  assert.match(profile, /Salário mínimo: BRL 15000 por mês/);
  assert.match(profile, /Empresas a evitar: Banco X/);
});

test('isExample reconhece os formatos do template', () => {
  assert.equal(isExample('*ex.: Desenvolvedor*'), true);
  assert.equal(isExample('ex.: Brasil'), true);
  assert.equal(isExample('Desenvolvedor Backend'), false);
  assert.equal(isExample('Exemplo de cargo'), true);
});
