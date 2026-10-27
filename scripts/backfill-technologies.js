#!/usr/bin/env node
'use strict';

const { loadConfig } = require('../src/config');
const { HEADER, readExistingJobs, writeCsv } = require('../src/csv');
const { backfillTechnologies } = require('../src/backfill');
const { fetchJobDetail } = require('../src/linkedin');
const { isRateLimitError } = require('../src/util');

const HELP = `Uso: node scripts/backfill-technologies.js [opções]

Preenche a coluna Tecnologias_Pedidas das vagas que já estão no CSV, lendo o
título e a descrição de cada anúncio no LinkedIn. Linhas que já têm tecnologias
são ignoradas. O progresso é salvo a cada linha atualizada.

Opções:
  --dry-run       Busca as descrições e mostra o resultado, sem alterar o CSV
  --limit=N       Processa no máximo N linhas nesta execução
  --csv=PATH      CSV a atualizar (padrão: vagas.csv)
  --delay=MS      Intervalo entre requisições ao LinkedIn (padrão: .env)
  -h, --help      Mostra esta ajuda`;

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
    help: false,
    limit: Number.POSITIVE_INFINITY,
    csv: null,
    delay: null,
  };

  for (const argument of argv) {
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument.startsWith('--limit=')) {
      options.limit = parsePositiveInt(argument.slice('--limit='.length), '--limit');
    } else if (argument.startsWith('--csv=')) {
      options.csv = argument.slice('--csv='.length);
    } else if (argument.startsWith('--delay=')) {
      const delay = Number.parseInt(argument.slice('--delay='.length), 10);
      if (!Number.isFinite(delay) || delay < 0) {
        throw new Error('--delay precisa ser um número inteiro maior ou igual a zero.');
      }
      options.delay = delay;
    } else {
      throw new Error(`Argumento desconhecido: ${argument}. Use --help.`);
    }
  }

  return options;
}

function normalizeRow(row) {
  return HEADER.map((_, index) => (row && row[index] != null ? row[index] : ''));
}

function toCurrentRows(existing) {
  return existing.rows.map((row) => {
    if (!existing.legacy) return normalizeRow(row);
    return [
      row[0] ?? '',
      row[1] ?? '',
      row[2] ?? '',
      'Não informado',
      row[3] ?? '',
    ];
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  const config = loadConfig({ csv: options.csv });
  const existing = await readExistingJobs(config.csvFile);

  if (!existing.count) {
    console.log(`Nenhuma vaga encontrada em ${config.csvFile}; nada a fazer.`);
    return;
  }

  const rows = toCurrentRows(existing);

  if (existing.legacy && !options.dryRun) {
    await writeCsv(config.csvFile, rows);
  }

  console.log(
    `${existing.count} linha(s) em ${config.csvFile}. ` +
      `Buscando vagas sem tecnologias${options.dryRun ? ' (simulação)' : ''}...`
  );
  console.log('');

  const result = await backfillTechnologies(rows, {
    fetchDetail: fetchJobDetail,
    delayMs: options.delay != null ? options.delay : config.delayMs,
    limit: options.limit,
    onWrite: options.dryRun ? null : (updatedRows) => writeCsv(config.csvFile, updatedRows),
    onProgress: ({ index, total, row, technologies, error }) => {
      const label = `[${index}/${total}] ${row[0]} — ${row[1]}`;
      if (error) {
        console.warn(`${label}: falha ao abrir a vaga (${error.message}); usando o título.`);
      }
      console.log(
        `${label}: ${
          technologies.length ? technologies.join(', ') : 'nenhuma tecnologia encontrada'
        }`
      );
    },
  });

  console.log('');
  console.log(
    `Resumo: ${result.updated} linha(s) ${options.dryRun ? 'seriam atualizadas' : 'atualizadas'}, ` +
      `${result.fetched} vaga(s) aberta(s), ${result.failed} falha(s), ` +
      `${result.skipped} linha(s) sem link ou já preenchida(s).`
  );
  if (result.rateLimited) {
    console.warn(
      'Interrompido: o LinkedIn limitou as requisições (HTTP 429/999). Aguarde alguns minutos ' +
        'e rode de novo; o que já foi atualizado está salvo.'
    );
    process.exitCode = 1;
  } else if (result.stopped) {
    console.warn(
      'Parado após várias falhas seguidas. O LinkedIn pode estar limitando as requisições; ' +
        'tente novamente mais tarde (o que já foi atualizado está salvo).'
    );
  }
  if (!options.dryRun && result.updated) {
    console.log(`CSV salvo em ${config.csvFile}.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Erro: ${error.message}`);
    if (isRateLimitError(error)) {
      console.error(
        'Dica: o LinkedIn está limitando as requisições. Aguarde alguns minutos e rode de novo.'
      );
    }
    if (process.env.DEBUG) console.error(error.stack);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, normalizeRow, toCurrentRows, main };
