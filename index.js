#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');

const { HELP, loadConfig, parseArgs } = require('./src/config');
const {
  buildSearchLocation,
  parseInterests,
  renderProfileForLLM,
  workModeCodes,
} = require('./src/interests');
const { fetchJobDetail, searchJobs } = require('./src/linkedin');
const { analyzeJob } = require('./src/filter');
const { evaluateJob, isLlmConfigured } = require('./src/llm');
const { loadSystemPrompt } = require('./src/prompt');
const { appendJobs, readExistingJobs } = require('./src/csv');
const { loadResumeText } = require('./src/resume');
const { canonicalJobUrl, formatSalary, sleep } = require('./src/util');

function describe(job) {
  const where = job.location ? ` (${job.location})` : '';
  return `${job.company} — ${job.title}${where}`;
}

function mergeDetail(card, detail) {
  const merged = { ...card };
  for (const field of ['title', 'company', 'location', 'salary', 'description']) {
    if (detail[field]) merged[field] = detail[field];
  }
  return merged;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  const config = loadConfig(options);
  const systemPrompt = await loadSystemPrompt(config.systemPromptFile);

  let markdown;
  try {
    markdown = await fs.readFile(config.interestsFile, 'utf8');
  } catch (error) {
    throw new Error(`Não foi possível ler ${config.interestsFile}: ${error.message}`);
  }

  const interests = parseInterests(markdown);
  if (!interests.roles.length) {
    throw new Error(
      `Nenhum cargo encontrado em ${config.interestsFile}. ` +
        'Preencha a seção "## Cargos desejados" (os exemplos iniciados por "ex.:" são ignorados).'
    );
  }

  const location = buildSearchLocation(interests);
  const modeCodes = workModeCodes(interests.workModes);
  const profile = renderProfileForLLM(interests);

  let effectiveMode = config.filterMode;
  const llmReady = isLlmConfigured(config.llm);

  if (effectiveMode === 'llm' && !llmReady) {
    throw new Error('FILTER_MODE=llm requer LLM_API_KEY, LLM_BASE_URL e LLM_MODEL configurados no .env.');
  }
  if (effectiveMode === 'hybrid' && !llmReady) {
    console.warn('AVISO: LLM_API_KEY não configurada; usando filtro por palavras-chave nesta execução.');
    effectiveMode = 'keywords';
  }

  let resumeText = '';
  if (config.resumePath) {
    if (effectiveMode === 'keywords') {
      console.warn(
        'AVISO: currículo configurado, mas o modo keywords não usa LLM; o PDF será ignorado.'
      );
    } else {
      console.log(`Lendo currículo em ${config.resumePath}...`);
      try {
        const resume = await loadResumeText(config.resumePath, {
          maxChars: config.resumeMaxChars,
          onWarning: (message) => console.warn(`  ${message}`),
        });
        resumeText = resume.text;

        if (resumeText) {
          console.log(
            `Currículo: ${resume.files.length} PDF(s), ${resumeText.length} caracteres` +
              `${resume.truncated ? ' (truncado)' : ''}.`
          );
        } else {
          console.warn(
            `AVISO: nenhum texto de PDF encontrado em ${config.resumePath}; ` +
              'seguindo sem currículo.'
          );
        }
      } catch (error) {
        throw new Error(
          `Não foi possível ler o currículo em ${config.resumePath}: ${error.message}`
        );
      }
    }
  }

  console.log('Busca de vagas — LinkedIn');
  console.log(`Cargos: ${interests.roles.join(' | ')}`);
  console.log(
    `Local: ${location} | Modalidade: ${interests.workModes.join(', ')} | ` +
      `Período: últimos ${config.daysBack} dias`
  );
  console.log(
    `Filtro: ${effectiveMode}${
      effectiveMode === 'keywords' ? '' : ` (nota mínima ${config.threshold})`
    }`
  );
  if (config.dryRun) console.log('Modo simulação: o CSV não será alterado.');
  console.log(`Prompt do sistema: ${config.systemPromptFile}`);
  console.log('');

  const found = new Map();
  let searchErrors = 0;

  for (const role of interests.roles) {
    console.log(`Buscando "${role}" em ${location}...`);
    try {
      const jobs = await searchJobs({
        role,
        location,
        workModeCodes: modeCodes,
        daysBack: config.daysBack,
        pages: config.pagesPerQuery,
        maxJobs: config.maxJobsPerQuery,
        delayMs: config.delayMs,
      });
      for (const job of jobs) {
        if (!found.has(job.id)) found.set(job.id, job);
      }
      console.log(`  ${jobs.length} vaga(s).`);
    } catch (error) {
      searchErrors++;
      console.warn(`  Falha: ${error.message}`);
    }
    await sleep(config.delayMs);
  }

  console.log('');
  if (!found.size) {
    if (searchErrors) {
      throw new Error(
        'Nenhuma vaga encontrada e houve falhas de busca. ' +
          'O LinkedIn pode estar bloqueando as requisições; tente novamente mais tarde.'
      );
    }
    console.log('Nenhuma vaga encontrada para os cargos informados.');
    return;
  }

  const existing = await readExistingJobs(config.csvFile);
  const knownIds = new Set(existing.ids);
  const candidates = [];

  for (const job of found.values()) {
    if (!job.id || knownIds.has(job.id)) continue;
    knownIds.add(job.id);
    candidates.push(job);
  }

  console.log(
    `${found.size} vaga(s) encontrada(s); ${candidates.length} nova(s) para avaliar ` +
      `(${existing.count} já no CSV).`
  );
  if (!candidates.length) return;
  console.log('');

  let evaluated = 0;
  let accepted = 0;
  let rejected = 0;
  let detailFailures = 0;
  let llmFailures = 0;
  let llmDisabled = false;
  const acceptedJobs = [];

  for (const card of candidates) {
    if (evaluated >= config.totalLimit) break;

    const preCheck = analyzeJob(card, interests);
    if (preCheck.rejected) {
      rejected++;
      console.log(`- ${describe(card)} — descartada: ${preCheck.reason}`);
      continue;
    }

    await sleep(config.delayMs + Math.floor(Math.random() * 400));

    let detail = null;
    try {
      detail = await fetchJobDetail(card.id);
    } catch (error) {
      detailFailures++;
      console.warn(`! ${describe(card)} — não foi possível abrir a vaga: ${error.message}`);
    }

    const job = detail ? mergeDetail(card, detail) : card;
    const analysis = analyzeJob(job, interests);

    if (analysis.rejected) {
      rejected++;
      console.log(`- ${describe(job)} — descartada: ${analysis.reason}`);
      continue;
    }
    if (effectiveMode === 'hybrid' && !analysis.positive) {
      rejected++;
      console.log(`- ${describe(job)} — descartada: sem sinais suficientes de aderência.`);
      continue;
    }

    evaluated++;

    let verdict = null;
    if (effectiveMode !== 'keywords' && !llmDisabled) {
      try {
        verdict = await evaluateJob({
          job,
          profile,
          resumeText,
          systemPrompt,
          llm: { ...config.llm, threshold: config.threshold },
        });
        llmFailures = 0;
      } catch (error) {
        llmFailures++;
        console.warn(`! LLM falhou em "${job.title}": ${error.message}`);
        if (llmFailures >= 3) {
          llmDisabled = true;
          console.warn('! LLM desativado pelo resto da execução; usando palavras-chave.');
        }
      }
    }

    let include;
    let reason;

    if (effectiveMode === 'keywords') {
      include = analysis.keywordsPass;
      reason = analysis.matches.length
        ? `palavras-chave: ${analysis.matches.join(', ')}`
        : 'sem sinais suficientes';
    } else if (verdict) {
      include = verdict.aderente && verdict.nota >= config.threshold;
      reason = `LLM ${verdict.nota}/100 — ${
        verdict.motivo || (include ? 'aderente' : 'não aderente')
      }`;
    } else if (llmDisabled) {
      if (effectiveMode === 'llm') {
        include = false;
        reason = 'LLM indisponível (modo llm)';
      } else {
        include = analysis.keywordsPass;
        reason = `LLM desativado; fallback por palavras-chave (${
          analysis.matches.join(', ') || 'sem sinais'
        })`;
      }
    } else if (effectiveMode === 'hybrid') {
      include = analysis.keywordsPass;
      reason = `LLM indisponível; fallback por palavras-chave (${
        analysis.matches.join(', ') || 'sem sinais'
      })`;
    } else {
      include = false;
      reason = 'LLM indisponível (modo llm)';
    }

    if (!include) {
      rejected++;
      console.log(`- ${describe(job)} — descartada: ${reason}`);
      continue;
    }

    const link = canonicalJobUrl(job.link);
    if (!link) {
      rejected++;
      console.log(`- ${describe(job)} — descartada: link inválido.`);
      continue;
    }

    const salary = formatSalary(job.salary || (verdict && verdict.salario) || '');
    const technologies =
      verdict && verdict.tecnologias && verdict.tecnologias.length
        ? verdict.tecnologias.join(', ')
        : 'Não informado';
    acceptedJobs.push({
      company: job.company,
      title: job.title,
      salary,
      technologies,
      link,
    });
    accepted++;
    console.log(`+ ${describe(job)} — aceita: ${reason}`);
    console.log(`  ${link} | Salário: ${salary} | Tecnologias: ${technologies}`);
  }

  console.log('');
  if (!acceptedJobs.length) {
    console.log('Nenhuma vaga aderente nesta execução; CSV não alterado.');
  } else if (config.dryRun) {
    console.log(`Simulação: ${acceptedJobs.length} vaga(s) seriam gravadas em ${config.csvFile}:`);
    console.table(
      acceptedJobs.map((job) => ({
        Empresa: job.company,
        Título_Vaga: job.title,
        Salário: job.salary,
        Tecnologias_Pedidas: job.technologies,
        Link_da_vaga: job.link,
      }))
    );
  } else {
    const added = await appendJobs(config.csvFile, acceptedJobs);
    console.log(`${added} vaga(s) gravada(s) em ${config.csvFile}.`);
  }

  console.log(
    `Resumo: ${found.size} encontrada(s), ${candidates.length} nova(s), ${accepted} aceita(s), ` +
      `${rejected} descartada(s), ${detailFailures} falha(s) ao abrir vaga(s).`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Erro: ${error.message}`);
    if (error.status === 429 || error.status === 999) {
      console.error('Dica: o LinkedIn está limitando as requisições. Aguarde alguns minutos e tente novamente.');
    }
    if (process.env.DEBUG) console.error(error.stack);
    process.exitCode = 1;
  });
}

module.exports = { main };
