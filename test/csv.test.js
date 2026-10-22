'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { parseCsv, csvEscape, readExistingJobs, appendJobs, HEADER } = require('../src/csv');

test('parseCsv lida com aspas, vírgulas e quebras de linha', () => {
  const rows = parseCsv('﻿a,b,c\n"x, y","d ""e""","linha\nnova"\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'd "e"', 'linha\nnova'],
  ]);
});

test('csvEscape só coloca aspas quando necessário', () => {
  assert.equal(csvEscape('Acme'), 'Acme');
  assert.equal(csvEscape('Acme, Inc'), '"Acme, Inc"');
  assert.equal(csvEscape('Dev "Backend"'), '"Dev ""Backend"""');
  assert.equal(csvEscape(null), '');
});

test('grava, deduplica e relê o CSV', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'job-searcher-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'vagas.csv');

  const addedFirst = await appendJobs(file, [
    {
      company: 'Acme, Inc',
      title: 'Dev "Backend"',
      salary: 'R$ 10.000,00',
      link: 'https://www.linkedin.com/jobs/view/dev-backend-1234567?tracking=abc',
    },
  ]);
  assert.equal(addedFirst, 1);

  const addedSecond = await appendJobs(file, [
    {
      company: 'Acme, Inc',
      title: 'Dev "Backend"',
      salary: 'R$ 10.000,00',
      link: 'https://www.linkedin.com/jobs/view/1234567',
    },
    {
      company: 'Beta',
      title: 'Engenheiro de Software',
      salary: 'Não informado',
      link: 'https://www.linkedin.com/jobs/view/engenheiro-7654321',
    },
  ]);
  assert.equal(addedSecond, 1);

  const content = await fs.readFile(file, 'utf8');
  assert.ok(content.startsWith(`﻿${HEADER.join(',')}`));
  assert.ok(content.includes('"Acme, Inc"'));
  assert.ok(content.includes('"Dev ""Backend"""'));
  assert.ok(content.includes('https://www.linkedin.com/jobs/view/1234567'));
  assert.ok(!content.includes('tracking=abc'));

  const existing = await readExistingJobs(file);
  assert.equal(existing.count, 2);
  assert.equal(existing.ids.size, 2);
  assert.ok(existing.ids.has('1234567'));
  assert.ok(existing.ids.has('7654321'));
});

test('rejeita CSV com cabeçalho diferente', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'job-searcher-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'vagas.csv');
  await fs.writeFile(file, 'Empresa,Link\nAcme,https://www.linkedin.com/jobs/view/1234567\n', 'utf8');

  await assert.rejects(() => readExistingJobs(file), /cabeçalho esperado/);
});

test('arquivo inexistente começa vazio', async () => {
  const missing = path.join(
    os.tmpdir(),
    `job-searcher-missing-${process.pid}-${Date.now()}.csv`
  );
  const existing = await readExistingJobs(missing);
  assert.equal(existing.count, 0);
  assert.equal(existing.ids.size, 0);
});
