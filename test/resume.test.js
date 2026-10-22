'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { listPdfFiles, extractPdfText, loadResumeText } = require('../src/resume');

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-searcher-resume-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function buildPdf(text) {
  const escaped = String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

test('lista apenas PDFs do diretório, em ordem alfabética', async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(path.join(dir, 'b.PDF'), 'x');
  await fs.writeFile(path.join(dir, 'a.pdf'), 'x');
  await fs.writeFile(path.join(dir, 'notas.txt'), 'x');
  await fs.mkdir(path.join(dir, 'sub'));

  const files = await listPdfFiles(dir);
  assert.deepEqual(
    files.map((file) => path.basename(file)),
    ['a.pdf', 'b.PDF']
  );
});

test('aceita um arquivo PDF e ignora arquivos de outro tipo', async (t) => {
  const dir = await tempDir(t);
  const pdf = path.join(dir, 'curriculo.pdf');
  const txt = path.join(dir, 'curriculo.txt');
  await fs.writeFile(pdf, 'x');
  await fs.writeFile(txt, 'x');

  assert.deepEqual(await listPdfFiles(pdf), [pdf]);
  assert.deepEqual(await listPdfFiles(txt), []);
});

test('combina os PDFs, ignora vazios e avisa sobre falhas', async (t) => {
  const dir = await tempDir(t);
  for (const name of ['a.pdf', 'b.pdf', 'c.pdf']) {
    await fs.writeFile(path.join(dir, name), 'x');
  }

  const calls = [];
  const warnings = [];
  const result = await loadResumeText(dir, {
    maxChars: 4000,
    extractor: async (file) => {
      const name = path.basename(file);
      calls.push(name);
      if (name === 'a.pdf') return 'Ana\nNode.js';
      if (name === 'b.pdf') return '   ';
      throw new Error('corrompido');
    },
    onWarning: (message) => warnings.push(message),
  });

  assert.deepEqual(calls, ['a.pdf', 'b.pdf', 'c.pdf']);
  assert.equal(result.text, '[a.pdf]\nAna\nNode.js');
  assert.deepEqual(
    result.files.map((file) => path.basename(file)),
    ['a.pdf']
  );
  assert.equal(result.truncated, false);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /PDF sem texto extraível: b\.pdf/);
  assert.match(warnings[1], /Falha ao ler c\.pdf: corrompido/);
});

test('trunca o texto no limite configurado', async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(path.join(dir, 'curriculo.pdf'), 'x');

  const result = await loadResumeText(dir, {
    maxChars: 50,
    extractor: async () => 'x'.repeat(200),
  });

  assert.equal(result.text.length, 50);
  assert.equal(result.truncated, true);
  assert.ok(result.text.endsWith('…'));
});

test('extrai texto de um PDF real', async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, 'curriculo.pdf');
  await fs.writeFile(file, buildPdf('Curriculo Teste - Node.js TypeScript'));

  const text = await extractPdfText(file);
  assert.match(text, /Curriculo Teste/);
  assert.match(text, /Node\.js TypeScript/);

  const result = await loadResumeText(dir);
  assert.match(result.text, /\[curriculo\.pdf\]/);
  assert.match(result.text, /Curriculo Teste/);
  assert.deepEqual(result.files, [file]);
  assert.equal(result.truncated, false);
});
