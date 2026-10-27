'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAmount,
  parseMoney,
  detectCurrency,
  detectPeriod,
  extractJobId,
  canonicalJobUrl,
  decodeEntities,
  containsTerm,
  formatSalary,
  isRateLimitError,
} = require('../src/util');

test('converte valores monetários em formato brasileiro e americano', () => {
  assert.equal(parseAmount('R$ 15.000,00'), 15000);
  assert.equal(parseAmount('$190,800.00/yr'), 190800);
  assert.equal(parseAmount('1,5'), 1.5);
  assert.equal(parseAmount('15.000'), 15000);
  assert.equal(parseAmount('sem valor'), null);
});

test('detecta moeda e período', () => {
  assert.equal(detectCurrency('R$ 10.000,00'), 'BRL');
  assert.equal(detectCurrency('$190,800.00'), 'USD');
  assert.equal(detectCurrency('€ 70.000'), 'EUR');
  assert.equal(detectPeriod('R$ 10.000,00/mês'), 'month');
  assert.equal(detectPeriod('$190,800.00/yr'), 'year');
  assert.equal(detectPeriod('R$ 80/hora'), 'hour');
});

test('parseMoney devolve os três campos', () => {
  assert.deepEqual(parseMoney('R$ 10.000,00/mês'), {
    amount: 10000,
    currency: 'BRL',
    period: 'month',
  });
  assert.deepEqual(parseMoney('$190,800.00/yr'), {
    amount: 190800,
    currency: 'USD',
    period: 'year',
  });
});

test('extrai e canonicaliza o ID da vaga', () => {
  const url =
    'https://www.linkedin.com/jobs/view/senior-backend-at-acme-4410262237?position=1&pageNum=0';
  assert.equal(extractJobId(url), '4410262237');
  assert.equal(canonicalJobUrl(url), 'https://www.linkedin.com/jobs/view/4410262237');
  assert.equal(extractJobId('https://www.linkedin.com/jobs/search'), null);
});

test('decodifica entidades HTML', () => {
  assert.equal(decodeEntities('&amp; &ccedil; &#39;'), '& ç \'');
});

test('containsTerm trata termos curtos e compactos', () => {
  assert.equal(containsTerm('NodeJS e TypeScript', 'Node.js'), true);
  assert.equal(containsTerm('PostgreSQL', 'sql'), true);
  assert.equal(containsTerm('Google', 'go'), false);
  assert.equal(containsTerm('C# developer', 'c#'), true);
});

test('formatSalary usa o fallback', () => {
  assert.equal(formatSalary('  R$ 10.000  '), 'R$ 10.000');
  assert.equal(formatSalary(''), 'Não informado');
  assert.equal(formatSalary(null), 'Não informado');
});

test('identifica erros de limite de requisições', () => {
  assert.equal(isRateLimitError(Object.assign(new Error('x'), { status: 429 })), true);
  assert.equal(isRateLimitError(Object.assign(new Error('x'), { status: 999 })), true);
  assert.equal(isRateLimitError({ rateLimited: true }), true);
  assert.equal(isRateLimitError(Object.assign(new Error('x'), { status: 500 })), false);
  assert.equal(isRateLimitError(new Error('x')), false);
  assert.equal(isRateLimitError(null), false);
});
