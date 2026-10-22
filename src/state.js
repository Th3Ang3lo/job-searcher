'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const STATE_VERSION = 1;

function emptyState() {
  return { version: STATE_VERSION, queries: {} };
}

function normalizeQuery({ role, location, workModeCodes = [], daysBack = 7 }) {
  return {
    role,
    location,
    workModeCodes: [...workModeCodes].sort((a, b) => a - b),
    daysBack,
  };
}

function queryKey(query) {
  const normalized = normalizeQuery(query);
  return JSON.stringify([
    normalized.role,
    normalized.location,
    normalized.workModeCodes,
    normalized.daysBack,
  ]);
}

async function loadState(file, { onWarning = () => {} } = {}) {
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw error;
  }

  try {
    const parsed = JSON.parse(content);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.queries ||
      typeof parsed.queries !== 'object'
    ) {
      throw new Error('estrutura inválida');
    }
    return { version: STATE_VERSION, queries: { ...parsed.queries } };
  } catch (error) {
    onWarning(
      `Estado de paginação inválido em ${file} (${error.message}); recomeçando da página 1.`
    );
    return emptyState();
  }
}

async function saveState(file, state) {
  const content = `${JSON.stringify(state, null, 2)}\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, file);
}

function getNextPage(state, query) {
  const entry = state.queries[queryKey(query)];
  const nextPage = entry && Number.isInteger(entry.nextPage) ? entry.nextPage : 0;
  return nextPage >= 0 ? nextPage : 0;
}

function setNextPage(state, query, nextPage) {
  const page = Number.isInteger(nextPage) && nextPage >= 0 ? nextPage : 0;
  state.queries[queryKey(query)] = {
    ...normalizeQuery(query),
    nextPage: page,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  STATE_VERSION,
  emptyState,
  queryKey,
  loadState,
  saveState,
  getNextPage,
  setNextPage,
};
