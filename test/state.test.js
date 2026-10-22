'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  emptyState,
  queryKey,
  loadState,
  saveState,
  getNextPage,
  setNextPage,
} = require('../src/state');

async function tempStateFile(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'job-searcher-state-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'state.json');
}

const query = {
  role: 'Dev Backend',
  location: 'Brazil',
  workModeCodes: [3, 2],
  daysBack: 7,
};

test('queryKey normaliza a ordem das modalidades', () => {
  assert.equal(
    queryKey({ ...query, workModeCodes: [2, 3] }),
    queryKey({ ...query, workModeCodes: [3, 2] })
  );
  assert.notEqual(queryKey(query), queryKey({ ...query, role: 'Outro' }));
  assert.notEqual(queryKey(query), queryKey({ ...query, daysBack: 30 }));
});

test('getNextPage começa em zero e lê o valor salvo', () => {
  const state = emptyState();
  assert.equal(getNextPage(state, query), 0);

  setNextPage(state, query, 4);
  assert.equal(getNextPage(state, query), 4);
  assert.equal(state.queries[queryKey(query)].nextPage, 4);
  assert.deepEqual(state.queries[queryKey(query)].workModeCodes, [2, 3]);
});

test('salva e recarrega o progresso', async (t) => {
  const file = await tempStateFile(t);
  const state = emptyState();
  setNextPage(state, query, 2);
  await saveState(file, state);

  const loaded = await loadState(file);
  assert.equal(getNextPage(loaded, query), 2);
});

test('estado ausente começa vazio', async (t) => {
  const file = await tempStateFile(t);
  assert.deepEqual(await loadState(file), emptyState());
});

test('estado inválido avisa e recomeça', async (t) => {
  const file = await tempStateFile(t);
  await fs.writeFile(file, '{quebrado', 'utf8');

  const warnings = [];
  const loaded = await loadState(file, { onWarning: (message) => warnings.push(message) });

  assert.deepEqual(loaded, emptyState());
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Estado de paginação inválido/);
});
