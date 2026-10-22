'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { truncate } = require('./util');

const PDF_EXTENSION = /\.pdf$/i;

async function listPdfFiles(target) {
  const stats = await fs.stat(target);

  if (stats.isFile()) {
    return PDF_EXTENSION.test(target) ? [target] : [];
  }
  if (!stats.isDirectory()) return [];

  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && PDF_EXTENSION.test(entry.name))
    .map((entry) => path.join(target, entry.name))
    .sort();
}

async function extractPdfText(file) {
  const { extractText } = require('unpdf');
  const buffer = await fs.readFile(file);
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return Array.isArray(text) ? text.join('\n\n') : String(text || '');
}

async function loadResumeText(
  target,
  { maxChars = 8000, extractor = extractPdfText, onWarning = () => {} } = {}
) {
  const files = await listPdfFiles(target);
  const parts = [];
  const usedFiles = [];

  for (const file of files) {
    try {
      const text = String((await extractor(file)) || '')
        .replace(/\r\n?/g, '\n')
        .trim();

      if (!text) {
        onWarning(`PDF sem texto extraível: ${path.basename(file)}`);
        continue;
      }

      parts.push(`[${path.basename(file)}]\n${text}`);
      usedFiles.push(file);
    } catch (error) {
      onWarning(`Falha ao ler ${path.basename(file)}: ${error.message}`);
    }
  }

  const fullText = parts.join('\n\n');
  const text = truncate(fullText, maxChars);

  return {
    text,
    files: usedFiles,
    truncated: text.length < fullText.length,
  };
}

module.exports = {
  listPdfFiles,
  extractPdfText,
  loadResumeText,
};
