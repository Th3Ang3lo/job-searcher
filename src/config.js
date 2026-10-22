'use strict';

const path = require('node:path');
const { loadEnv } = require('./env');

const ROOT = path.resolve(__dirname, '..');

const HELP = `Uso: node index.js [opções]

Opções:
  --dry-run          Avalia e mostra os resultados, sem escrever no CSV
  --reset-pages      Recomeça da primeira página em todas as buscas
  --keywords-only    Usa apenas palavras-chave (ignora o LLM)
  --pages=N          Páginas de resultados por cargo em cada execução
  --limit=N          Máximo de vagas avaliadas a fundo nesta execução
  --interests=PATH   Arquivo de interesses (padrão: interests.md)
  --system-prompt=PATH  Arquivo com o prompt do sistema (padrão: system-prompt.md)
  --csv=PATH         Arquivo CSV de saída (padrão: vagas.csv)
  --state=PATH       Progresso das páginas (padrão: .job-searcher-state.json)
  --resume=PATH      Currículo em PDF ou diretório com PDFs (opcional)
  -h, --help         Mostra esta ajuda`;

function parsePositiveInt(value, flag) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${flag} precisa ser um número inteiro maior que zero.`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    resetPages: false,
    keywordsOnly: false,
    help: false,
    pages: null,
    limit: null,
    interests: null,
    systemPrompt: null,
    csv: null,
    state: null,
    resume: null,
  };

  for (const argument of argv) {
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--reset-pages') options.resetPages = true;
    else if (argument === '--keywords-only') options.keywordsOnly = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument.startsWith('--pages=')) {
      options.pages = parsePositiveInt(argument.slice('--pages='.length), '--pages');
    } else if (argument.startsWith('--limit=')) {
      options.limit = parsePositiveInt(argument.slice('--limit='.length), '--limit');
    } else if (argument.startsWith('--interests=')) {
      options.interests = argument.slice('--interests='.length);
    } else if (argument.startsWith('--system-prompt=')) {
      options.systemPrompt = argument.slice('--system-prompt='.length);
    } else if (argument.startsWith('--csv=')) {
      options.csv = argument.slice('--csv='.length);
    } else if (argument.startsWith('--state=')) {
      options.state = argument.slice('--state='.length);
    } else if (argument.startsWith('--resume=')) {
      options.resume = argument.slice('--resume='.length);
    } else {
      throw new Error(`Argumento desconhecido: ${argument}. Use --help.`);
    }
  }

  return options;
}

function loadConfig(options) {
  loadEnv(path.join(ROOT, '.env'));

  const integer = (value, fallback) => {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : fallback;
  };

  const resolvePath = (value, fallback) => {
    if (!value) return path.join(ROOT, fallback);
    return path.isAbsolute(value) ? value : path.join(ROOT, value);
  };

  const mode = (options.keywordsOnly ? 'keywords' : process.env.FILTER_MODE || 'hybrid')
    .trim()
    .toLowerCase();
  const envLimit = integer(process.env.MAX_JOBS_TOTAL, 0);
  const resumeValue =
    options.resume || process.env.RESUME_PATH || process.env.RESUME_DIR || '';

  return {
    root: ROOT,
    interestsFile: resolvePath(options.interests || process.env.INTERESTS_FILE, 'interests.md'),
    systemPromptFile: resolvePath(
      options.systemPrompt || process.env.SYSTEM_PROMPT_FILE,
      'system-prompt.md'
    ),
    csvFile: resolvePath(options.csv || process.env.OUTPUT_CSV, 'vagas.csv'),
    searchStateFile: resolvePath(
      options.state || process.env.SEARCH_STATE_FILE,
      '.job-searcher-state.json'
    ),
    resetPages: Boolean(options.resetPages),
    resumePath: resumeValue ? resolvePath(resumeValue, '') : '',
    resumeMaxChars: Math.max(1000, integer(process.env.RESUME_MAX_CHARS, 8000)),
    pagesPerQuery: options.pages ?? Math.max(1, integer(process.env.PAGES_PER_QUERY, 1)),
    maxJobsPerQuery: Math.max(0, integer(process.env.MAX_JOBS_PER_QUERY, 0)),
    totalLimit:
      options.limit && options.limit > 0
        ? options.limit
        : envLimit > 0
          ? envLimit
          : Number.POSITIVE_INFINITY,
    daysBack: Math.max(1, integer(process.env.SEARCH_DAYS_BACK, 7)),
    delayMs: Math.max(500, integer(process.env.REQUEST_DELAY_MS, 1500)),
    threshold: Math.min(100, Math.max(0, integer(process.env.MATCH_THRESHOLD, 70))),
    filterMode: ['hybrid', 'keywords', 'llm'].includes(mode) ? mode : 'hybrid',
    dryRun: options.dryRun,
    llm: {
      apiKey: String(process.env.LLM_API_KEY || '').trim(),
      baseUrl: String(process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').trim(),
      model: String(process.env.LLM_MODEL || 'deepseek-v4-flash').trim(),
    },
  };
}

module.exports = { ROOT, HELP, parseArgs, loadConfig };
