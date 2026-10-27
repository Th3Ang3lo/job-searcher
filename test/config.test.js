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
      '--reset-pages',
      '--pages=2',
      '--limit=5',
      '--role=Engenheiro de Software',
      '--interests=perfil.md',
      '--system-prompt=prompt.md',
      '--csv=saida.csv',
      '--state=progresso.json',
      '--resume=/tmp/curriculo.pdf',
    ]),
    {
      dryRun: true,
      resetPages: true,
      keywordsOnly: false,
      help: false,
      pages: 2,
      limit: 5,
      role: 'Engenheiro de Software',
      interests: 'perfil.md',
      systemPrompt: 'prompt.md',
      csv: 'saida.csv',
      state: 'progresso.json',
      resume: '/tmp/curriculo.pdf',
    }
  );
});

test('parseArgs rejeita argumentos desconhecidos', () => {
  assert.throws(() => parseArgs(['--foo']), /Argumento desconhecido/);
  assert.throws(() => parseArgs(['--role=']), /--role precisa de um cargo/);
});

test('a ajuda menciona --resume e --system-prompt', () => {
  assert.match(HELP, /--resume=PATH/);
  assert.match(HELP, /--system-prompt=PATH/);
  assert.match(HELP, /--role=TERMO/);
  assert.match(HELP, /--reset-pages/);
  assert.match(HELP, /--state=PATH/);
});

test('ROLE_DELAY_MS configura a pausa entre termos', (t) => {
  setEnv(t, { ROLE_DELAY_MS: '250' });
  assert.equal(loadConfig({}).roleDelayMs, 1000);

  process.env.ROLE_DELAY_MS = '45000';
  assert.equal(loadConfig({}).roleDelayMs, 45000);
});

test('loadConfig configura o progresso das páginas', (t) => {
  setEnv(t, { SEARCH_STATE_FILE: '' });

  const config = loadConfig({});
  assert.equal(config.searchStateFile, path.join(ROOT, '.job-searcher-state.json'));
  assert.equal(config.resetPages, false);
  assert.equal(loadConfig({ resetPages: true }).resetPages, true);
  assert.equal(loadConfig({ state: '/tmp/progresso.json' }).searchStateFile, '/tmp/progresso.json');
});

test('loadConfig usa o prompt do sistema padrão ou o caminho informado', (t) => {
  setEnv(t, { SYSTEM_PROMPT_FILE: '' });
  assert.equal(loadConfig({}).systemPromptFile, path.join(ROOT, 'system-prompt.md'));
  assert.equal(
    loadConfig({ systemPrompt: 'prompts/meu.md' }).systemPromptFile,
    path.join(ROOT, 'prompts', 'meu.md')
  );

  process.env.SYSTEM_PROMPT_FILE = '/tmp/prompt-do-ambiente.md';
  assert.equal(
    loadConfig({}).systemPromptFile,
    '/tmp/prompt-do-ambiente.md'
  );
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
