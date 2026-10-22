'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseInterests } = require('../src/interests');
const { analyzeJob, significantTokens } = require('../src/filter');

const interests = parseInterests(`## Cargos desejados
- Desenvolvedor Backend Sênior

## Senioridade
- Sênior

## Tecnologias e habilidades
- Node.js, TypeScript, PostgreSQL

## Localização e modalidade
- País: Brasil
- Modalidade: Remoto

## Faixa salarial
- Mínimo: 15000
- Moeda: BRL
- Período: mês

## Palavras-chave que excluem a vaga
- vendas, estágio

## Empresas de interesse
- Nubank

## Empresas a evitar
- Banco X
`);

const goodJob = {
  title: 'Senior Backend Engineer',
  company: 'Acme',
  location: 'Remote - Brazil',
  description: 'Buscamos pessoa para Node.js e TypeScript. Produto fintech.',
  salary: 'R$ 18.000,00/mês',
};

test('aceita vaga aderente', () => {
  const analysis = analyzeJob(goodJob, interests);
  assert.equal(analysis.rejected, false);
  assert.equal(analysis.positive, true);
  assert.equal(analysis.keywordsPass, true);
  assert.ok(analysis.matches.includes('cargo:backend'));
  assert.ok(analysis.matches.includes('skill:Node.js'));
  assert.ok(analysis.matches.includes('senioridade:Sênior'));
});

test('descarta por palavra-chave excluída', () => {
  const analysis = analyzeJob(
    { ...goodJob, description: 'Vaga de vendas com Node.js e TypeScript.' },
    interests
  );
  assert.equal(analysis.rejected, true);
  assert.match(analysis.reason, /vendas/);
});

test('descarta por empresa excluída', () => {
  const analysis = analyzeJob({ ...goodJob, company: 'Banco X' }, interests);
  assert.equal(analysis.rejected, true);
  assert.match(analysis.reason, /Banco X/);
});

test('descarta por salário abaixo do mínimo', () => {
  const analysis = analyzeJob({ ...goodJob, salary: 'R$ 8.000,00/mês' }, interests);
  assert.equal(analysis.rejected, true);
  assert.match(analysis.reason, /salário abaixo/);
});

test('não descarta quando a moeda é diferente', () => {
  const analysis = analyzeJob({ ...goodJob, salary: '$4,000.00/mo' }, interests);
  assert.equal(analysis.rejected, false);
});

test('vaga sem sinais não passa nas palavras-chave', () => {
  const analysis = analyzeJob(
    {
      title: 'Analista de Suporte',
      company: 'Outra',
      location: 'São Paulo',
      description: 'Atendimento ao cliente.',
      salary: '',
    },
    interests
  );
  assert.equal(analysis.rejected, false);
  assert.equal(analysis.positive, false);
  assert.equal(analysis.keywordsPass, false);
});

test('reconhece empresa de interesse', () => {
  const analysis = analyzeJob(
    {
      title: 'Pessoa Engenheira de Software',
      company: 'Nubank',
      location: 'Remoto',
      description: 'Time de plataforma.',
      salary: '',
    },
    interests
  );
  assert.equal(analysis.rejected, false);
  assert.equal(analysis.positive, true);
  assert.ok(analysis.matches.includes('empresa:Nubank'));
});

test('tokens de cargo ignoram senioridade e conectivos', () => {
  assert.deepEqual(significantTokens('Desenvolvedor Backend Sênior'), ['desenvolvedor', 'backend']);
  assert.deepEqual(significantTokens('Engenheiro de Software'), ['engenheiro', 'software']);
});
