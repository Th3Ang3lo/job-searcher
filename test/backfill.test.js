'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { needsTechnologies, backfillTechnologies } = require('../src/backfill');
const {
  parseArgs,
  normalizeRow,
  toCurrentRows,
} = require('../scripts/backfill-technologies');

function makeRows() {
  return [
    ['A', 'Dev Java', 'x', 'Java', 'https://www.linkedin.com/jobs/view/1111111'],
    ['B', 'Dev C# .NET', 'x', 'Não informado', 'https://www.linkedin.com/jobs/view/2222222'],
    ['C', 'Dev Python', 'x', '', 'https://www.linkedin.com/jobs/view/3333333'],
    ['D', 'Dev sem link', 'x', 'Não informado', ''],
    ['E', 'Dev Node.js', 'x', 'Não informado', 'https://www.linkedin.com/jobs/view/4444444'],
  ];
}

test('reconhece valores que precisam de preenchimento', () => {
  assert.equal(needsTechnologies(''), true);
  assert.equal(needsTechnologies('Não informado'), true);
  assert.equal(needsTechnologies('n/a'), true);
  assert.equal(needsTechnologies('-'), true);
  assert.equal(needsTechnologies('sem tecnologias'), true);
  assert.equal(needsTechnologies('Java, Spring Boot'), false);
});

test('preenche as tecnologias das linhas e salva a cada atualização', async () => {
  const rows = makeRows();
  const writes = [];
  const events = [];

  const result = await backfillTechnologies(rows, {
    fetchDetail: async (id) => {
      if (id === '2222222') {
        return { description: 'C#, .NET 8, ASP.NET Core, Azure e SQL Server.' };
      }
      if (id === '3333333') throw new Error('LinkedIn bloqueou');
      return { description: 'Node.js e TypeScript.' };
    },
    delayMs: 0,
    sleepFn: async () => {},
    onWrite: async (updatedRows) => writes.push(updatedRows.map((row) => row[3])),
    onProgress: (event) => events.push(event),
  });

  assert.equal(result.total, 3);
  assert.equal(result.processed, 3);
  assert.equal(result.updated, 3);
  assert.equal(result.fetched, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 2);
  assert.equal(writes.length, 3);
  assert.equal(events.length, 3);

  assert.equal(rows[0][3], 'Java');
  assert.equal(rows[1][3], 'C#, .NET, ASP.NET Core, Azure, SQL Server');
  assert.equal(rows[2][3], 'Python');
  assert.equal(rows[3][3], 'Não informado');
  assert.equal(rows[4][3], 'Node.js, TypeScript');
});

test('respeita o limite de linhas processadas', async () => {
  const rows = makeRows();
  let calls = 0;

  const result = await backfillTechnologies(rows, {
    fetchDetail: async () => {
      calls++;
      return { description: 'Java e Spring Boot.' };
    },
    limit: 1,
    delayMs: 0,
    sleepFn: async () => {},
  });

  assert.equal(result.total, 3);
  assert.equal(result.processed, 1);
  assert.equal(result.updated, 1);
  assert.equal(calls, 1);
  assert.equal(rows[2][3], '');
  assert.equal(rows[4][3], 'Não informado');
});

test('para após várias falhas seguidas', async () => {
  const rows = Array.from({ length: 8 }, (_, index) => [
    'Empresa',
    'Dev',
    'x',
    'Não informado',
    `https://www.linkedin.com/jobs/view/${5000000 + index}`,
  ]);

  let calls = 0;
  const result = await backfillTechnologies(rows, {
    fetchDetail: async () => {
      calls++;
      throw new Error('bloqueado');
    },
    delayMs: 0,
    sleepFn: async () => {},
  });

  assert.equal(result.stopped, true);
  assert.equal(result.processed, 5);
  assert.equal(result.failed, 5);
  assert.equal(result.updated, 0);
  assert.equal(calls, 5);
  assert.equal(result.total, 8);
});

test('para imediatamente quando o LinkedIn limita as requisições', async () => {
  const rows = Array.from({ length: 6 }, (_, index) => [
    'Empresa',
    'Dev Java',
    'x',
    'Não informado',
    `https://www.linkedin.com/jobs/view/${6000000 + index}`,
  ]);

  const rateError = new Error('LinkedIn respondeu HTTP 429');
  rateError.status = 429;

  let calls = 0;
  const result = await backfillTechnologies(rows, {
    fetchDetail: async () => {
      calls++;
      throw rateError;
    },
    delayMs: 0,
    sleepFn: async () => {},
  });

  assert.equal(calls, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.stopped, true);
  assert.equal(result.rateLimited, true);
  assert.equal(result.failed, 1);
  assert.equal(result.updated, 0);
  // Não grava tecnologias parciais extraídas só do título.
  assert.equal(rows[0][3], 'Não informado');
  assert.equal(rows[1][3], 'Não informado');
});

test('exige uma função de busca da descrição', async () => {
  await assert.rejects(() => backfillTechnologies(makeRows(), {}), /fetchDetail/);
});

test('parseArgs do backfill aceita as opções', () => {
  assert.deepEqual(parseArgs([]), {
    dryRun: false,
    help: false,
    limit: Number.POSITIVE_INFINITY,
    csv: null,
    delay: null,
  });
  assert.deepEqual(parseArgs(['--dry-run', '--limit=10', '--csv=x.csv', '--delay=0']), {
    dryRun: true,
    help: false,
    limit: 10,
    csv: 'x.csv',
    delay: 0,
  });
  assert.throws(() => parseArgs(['--limit=0']), /maior que zero/);
  assert.throws(() => parseArgs(['--delay=-1']), /maior ou igual a zero/);
  assert.throws(() => parseArgs(['--nope']), /desconhecido/);
});

test('normalizeRow sempre devolve as cinco colunas', () => {
  assert.deepEqual(normalizeRow(['A', 'B']), ['A', 'B', '', '', '']);
  assert.deepEqual(normalizeRow(['A', 'B', 'C', 'D', 'E', 'F']), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(normalizeRow(null), ['', '', '', '', '']);
});

test('toCurrentRows migra o formato antigo sem perder o link', () => {
  assert.deepEqual(
    toCurrentRows({
      legacy: true,
      rows: [['Acme', 'Dev', 'R$ 10.000', 'https://www.linkedin.com/jobs/view/1234567']],
    }),
    [['Acme', 'Dev', 'R$ 10.000', 'Não informado', 'https://www.linkedin.com/jobs/view/1234567']]
  );

  assert.deepEqual(
    toCurrentRows({
      legacy: false,
      rows: [['Acme', 'Dev', 'R$ 10.000', 'Java', 'https://www.linkedin.com/jobs/view/1234567']],
    }),
    [['Acme', 'Dev', 'R$ 10.000', 'Java', 'https://www.linkedin.com/jobs/view/1234567']]
  );
});
