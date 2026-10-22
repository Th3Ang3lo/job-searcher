'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { canonicalJobUrl, extractJobId, normalizeText } = require('./util');

const HEADER = ['Empresa', 'Título_Vaga', 'Salário', 'Tecnologias_Pedidas', 'Link_da_vaga'];
const LEGACY_HEADER = ['Empresa', 'Título_Vaga', 'Salário', 'Link_da_vaga'];

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const source = String(text || '')
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n');

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else if (char !== '\r') {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value !== '')) rows.push(row);

  return rows;
}

async function readExistingJobs(file) {
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { rows: [], ids: new Set(), count: 0 };
    throw error;
  }

  const parsed = parseCsv(content);
  if (!parsed.length) return { rows: [], ids: new Set(), count: 0 };

  const header = parsed[0].map((value) => value.trim());
  const normalized = header.map(normalizeText);
  const expected = HEADER.map(normalizeText);
  const legacyExpected = LEGACY_HEADER.map(normalizeText);
  const matchesCurrent =
    header.length === HEADER.length &&
    expected.every((value, index) => normalized[index] === value);
  const matchesLegacy =
    header.length === LEGACY_HEADER.length &&
    legacyExpected.every((value, index) => normalized[index] === value);

  if (!matchesCurrent && !matchesLegacy) {
    throw new Error(
      `O CSV ${file} não tem o cabeçalho esperado (${HEADER.join(', ')}). ` +
        'Faça backup e renomeie/remova o arquivo para recomeçar.'
    );
  }

  const linkIndex = normalized.indexOf('link_da_vaga');
  const rows = parsed.slice(1).filter((row) => row.some((value) => value.trim() !== ''));
  const ids = new Set();

  for (const row of rows) {
    const id = extractJobId(row[linkIndex] || '');
    if (id) ids.add(id);
  }

  return { rows, ids, count: rows.length, legacy: matchesLegacy };
}

async function writeCsv(file, rows) {
  const lines = [HEADER, ...rows.map((row) => row.slice(0, HEADER.length))].map((row) =>
    row.map(csvEscape).join(',')
  );

  const content = `﻿${lines.join('\n')}\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, file);
}

async function appendJobs(file, jobs) {
  const existing = await readExistingJobs(file);
  const ids = new Set(existing.ids);
  const newRows = [];

  for (const job of jobs) {
    const link = canonicalJobUrl(job.link);
    const id = extractJobId(link);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    newRows.push([
      job.company,
      job.title,
      job.salary,
      job.technologies || 'Não informado',
      link,
    ]);
  }

  if (!newRows.length) return 0;

  const existingRows = existing.rows.map((row) => {
    if (!existing.legacy) return row.slice(0, HEADER.length);
    const [company = '', title = '', salary = '', link = ''] = row;
    return [company, title, salary, 'Não informado', link];
  });

  await writeCsv(file, [...existingRows, ...newRows]);
  return newRows.length;
}

module.exports = {
  HEADER,
  LEGACY_HEADER,
  csvEscape,
  parseCsv,
  readExistingJobs,
  writeCsv,
  appendJobs,
};
