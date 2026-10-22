'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { loadSystemPrompt } = require('../src/prompt');

async function tempFile(t, name, content) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'job-searcher-prompt-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, name);
  await fs.writeFile(file, content, 'utf8');
  return file;
}

test('lê e normaliza o prompt do sistema', async (t) => {
  const file = await tempFile(t, 'prompt.md', '\r\n  Você é um recrutador.  \r\n');

  assert.equal(await loadSystemPrompt(file), 'Você é um recrutador.');
});

test('rejeita prompt vazio', async (t) => {
  const file = await tempFile(t, 'prompt.md', ' \n\t\n');

  await assert.rejects(() => loadSystemPrompt(file), /está vazio/);
});

test('informa o caminho quando o arquivo não existe', async () => {
  const file = path.join(os.tmpdir(), `job-searcher-missing-prompt-${process.pid}-${Date.now()}.md`);

  await assert.rejects(() => loadSystemPrompt(file), /Não foi possível ler o prompt do sistema/);
});
