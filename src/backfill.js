'use strict';

const { extractJobId, isRateLimitError, normalizeText, sleep } = require('./util');
const { extractTechnologies } = require('./technologies');

const PLACEHOLDER = 'Não informado';
const PLACEHOLDERS = new Set([
  normalizeText(PLACEHOLDER),
  'n/a',
  'na',
  'null',
  '-',
  'sem tecnologias',
]);

function needsTechnologies(value) {
  const text = String(value ?? '').trim();
  return !text || PLACEHOLDERS.has(normalizeText(text));
}

/**
 * Preenche a coluna de tecnologias de linhas já existentes no CSV.
 *
 * Recebe as linhas no formato [empresa, título, salário, tecnologias, link],
 * busca a descrição de cada vaga ainda sem tecnologias e usa a extração
 * determinística do título + descrição. A mutação é feita nas próprias linhas;
 * `onWrite`, quando informado, é chamado após cada linha atualizada para que o
 * progresso seja salvo incrementalmente.
 */
async function backfillTechnologies(
  rows,
  {
    fetchDetail,
    delayMs = 1500,
    limit = Number.POSITIVE_INFINITY,
    maxConsecutiveFailures = 5,
    onWrite = null,
    onProgress = null,
    sleepFn = sleep,
  } = {}
) {
  if (!Array.isArray(rows)) {
    throw new Error('As linhas do CSV precisam ser um array.');
  }
  if (typeof fetchDetail !== 'function') {
    throw new Error('fetchDetail não informado.');
  }

  const targets = [];
  let skipped = 0;

  for (const row of rows) {
    if (!Array.isArray(row) || !needsTechnologies(row[3]) || !extractJobId(row[4] || '')) {
      skipped++;
      continue;
    }
    targets.push(row);
  }

  let processed = 0;
  let updated = 0;
  let fetched = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let stopped = false;
  let rateLimited = false;

  for (const row of targets) {
    if (processed >= limit) break;

    processed++;
    const id = extractJobId(row[4]);
    let detail = null;
    let error = null;

    try {
      detail = await fetchDetail(id);
      fetched++;
      consecutiveFailures = 0;
    } catch (caught) {
      error = caught;
      failed++;
      consecutiveFailures++;
      if (isRateLimitError(caught)) {
        rateLimited = true;
        stopped = true;
      }
    }

    const title = row[1] || (detail && detail.title) || '';
    const description = detail && detail.description ? detail.description : '';
    const technologies = extractTechnologies(`${title}\n${description}`);

    // Em um 429 a descrição não foi lida; não grave tecnologias parciais do título.
    if (technologies.length && !rateLimited) {
      row[3] = technologies.join(', ');
      updated++;
      if (onWrite) await onWrite(rows);
    }

    if (onProgress) {
      onProgress({
        index: processed,
        total: targets.length,
        row,
        technologies,
        fetched: Boolean(detail),
        error,
      });
    }

    if (rateLimited) break;
    if (consecutiveFailures >= maxConsecutiveFailures) {
      stopped = true;
      break;
    }

    if (processed < limit && processed < targets.length) {
      await sleepFn(delayMs);
    }
  }

  return {
    rows,
    total: targets.length,
    processed,
    updated,
    fetched,
    failed,
    skipped,
    stopped,
    rateLimited,
  };
}

module.exports = {
  PLACEHOLDER,
  needsTechnologies,
  backfillTechnologies,
};
