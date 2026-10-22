'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { ROOT, HELP, parseArgs, loadConfig } = require('../src/config');

function setEnv(t, values) {
  const previous = new Map();
  for (const key of Object.keys(values)) previous.set(key, process.env[key]);

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('parseArgs lê --resume e as demais opções', () => {
  assert.deepEqual(
    parseArgs([
      '--dry-run',
      '--pages=2',
      '--limit=5',
      '--interests=perfil.md',
      '--csv=saida.csv',
      '--resume=/tmp/curriculo.pdf',
    ]),
    {
      dryRun: true,
      keywordsOnly: false,
      help: false,
      pages: 2,
      limit: 5,
      interests: 'perfil.md',
      csv: 'saida.csv',
      resume: '/tmp/curriculo.pdf',
    }
  );
});

test('parseArgs rejeita argumentos desconhecidos', () => {
  assert.throws(() => parseArgs(['--foo']), /Argumento desconhecido/);
});

test('a ajuda menciona --resume', () => {
  assert.match(HELP, /--resume=PATH/);
});

test('loadConfig resolve um currículo relativo à raiz do projeto', (t) => {
  setEnv(t, { RESUME_PATH: '' });

  const config = loadConfig({ resume: 'curriculos/meu.pdf' });
  assert.equal(config.resumePath, path.join(ROOT, 'curriculos', 'meu.pdf'));
});

test('loadConfig mantém um caminho absoluto de currículo', (t) => {
  setEnv(t, { RESUME_PATH: '' });

  const config = loadConfig({ resume: '/tmp/curriculo.pdf' });
  assert.equal(config.resumePath, '/tmp/curriculo.pdf');
});

test('loadConfig usa RESUME_PATH e aceita RESUME_DIR como alternativa', (t) => {
  setEnv(t, { RESUME_PATH: '/tmp/do-ambiente.pdf', RESUME_DIR: '' });
  assert.equal(loadConfig({}).resumePath, '/tmp/do-ambiente.pdf');

  process.env.RESUME_PATH = '';
  process.env.RESUME_DIR = '/tmp/pasta-de-curriculos';
  assert.equal(loadConfig({}).resumePath, '/tmp/pasta-de-curriculos');
});

test('--resume tem precedência sobre o ambiente', (t) => {
  setEnv(t, { RESUME_PATH: '/tmp/do-ambiente.pdf' });

  const config = loadConfig({ resume: '/tmp/da-linha-de-comando.pdf' });
  assert.equal(config.resumePath, '/tmp/da-linha-de-comando.pdf');
});

test('RESUME_MAX_CHARS tem mínimo de 1000 caracteres', (t) => {
  setEnv(t, { RESUME_MAX_CHARS: '250' });
  assert.equal(loadConfig({}).resumeMaxChars, 1000);

  process.env.RESUME_MAX_CHARS = '12000';
  assert.equal(loadConfig({}).resumeMaxChars, 12000);
});
