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
const { getNextPage, loadState, saveState, setNextPage } = require('./src/state');
const { loadResumeText } = require('./src/resume');
const { technologiesForJob } = require('./src/technologies');
const {
  canonicalJobUrl,
  formatSalary,
  isRateLimitError,
  normalizeText,
  sleep,
} = require('./src/util');

function describe(job) {
  const where = job.location ? ` (${job.location})` : '';
  return `${job.company} — ${job.title}${where}`;
}

function rateLimitException(source, status) {
  const error = new Error(
    `${source} limitou as requisições${status ? ` (HTTP ${status})` : ''}. ` +
      'Aguarde alguns minutos e rode de novo com menos volume.'
  );
  error.status = status || 429;
  error.rateLimited = true;
  return error;
}

function markRateLimited(run, source, error) {
  run.rateLimited = true;
  run.rateLimitSource = source;
  run.rateLimitStatus = error && error.status ? error.status : 429;
  run.aborted = true;
  process.exitCode = 1;
}

function selectRoles(roles, requested) {
  const wanted = normalizeText(requested);
  if (!wanted) return roles;

  const exact = roles.filter((role) => normalizeText(role) === wanted);
  if (exact.length) return exact;

  const partial = roles.filter((role) => normalizeText(role).includes(wanted));
  if (partial.length === 1) return partial;
  if (partial.length > 1) {
    throw new Error(
      `O cargo "${requested}" corresponde a mais de um termo: ${partial.join(' | ')}. ` +
        'Use o nome completo em --role.'
    );
  }

  throw new Error(
    `Cargo "${requested}" não encontrado. Cargos disponíveis: ${roles.join(' | ')}.`
  );
}

function mergeDetail(card, detail) {
  const merged = { ...card };
  for (const field of ['title', 'company', 'location', 'salary', 'description']) {
    if (detail[field]) merged[field] = detail[field];
  }
  return merged;
}

/**
 * Avalia as vagas de um único termo de busca. As vagas aceitas são gravadas no
 * CSV imediatamente. Retorna quando o termo termina, quando o limite de vagas é
 * atingido ou quando LinkedIn/LLM limitam as requisições; nesse último caso,
 * `run.aborted` fica verdadeiro para o chamador interromper os próximos termos.
 */
async function evaluateCandidates(candidates, run) {
  const { config, interests, effectiveMode, profile, resumeText, systemPrompt } = run;

  for (const card of candidates) {
    if (run.stats.evaluated >= config.totalLimit) return;

    const preCheck = analyzeJob(card, interests);
    if (preCheck.rejected) {
      run.stats.rejected++;
      console.log(`- ${describe(card)} — descartada: ${preCheck.reason}`);
      continue;
    }

    await sleep(config.delayMs + Math.floor(Math.random() * 400));

    let detail = null;
    try {
      detail = await fetchJobDetail(card.id);
    } catch (error) {
      if (isRateLimitError(error)) {
        markRateLimited(run, 'linkedin', error);
        console.warn(
          `! ${describe(card)} — LinkedIn limitou as requisições ` +
            `(HTTP ${error.status || 429}); interrompendo a execução.`
        );
        return;
      }
      run.stats.detailFailures++;
      console.warn(`! ${describe(card)} — não foi possível abrir a vaga: ${error.message}`);
    }

    const job = detail ? mergeDetail(card, detail) : card;
    const analysis = analyzeJob(job, interests);

    if (analysis.rejected) {
      run.stats.rejected++;
      console.log(`- ${describe(job)} — descartada: ${analysis.reason}`);
      continue;
    }
    if (effectiveMode === 'hybrid' && !analysis.positive) {
      run.stats.rejected++;
      console.log(`- ${describe(job)} — descartada: sem sinais suficientes de aderência.`);
      continue;
    }

    run.stats.evaluated++;

    let verdict = null;
    if (effectiveMode !== 'keywords' && !run.llmDisabled) {
      try {
        verdict = await evaluateJob({
          job,
          profile,
          resumeText,
          systemPrompt,
          llm: { ...config.llm, threshold: config.threshold },
        });
        run.llmFailures = 0;
      } catch (error) {
        if (isRateLimitError(error)) {
          markRateLimited(run, 'llm', error);
          console.warn(
            `! LLM limitou as requisições (HTTP ${error.status || 429}); ` +
              'interrompendo a execução.'
          );
          return;
        }
        run.llmFailures++;
        console.warn(`! LLM falhou em "${job.title}": ${error.message}`);
        if (run.llmFailures >= 3) {
          run.llmDisabled = true;
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
    } else if (run.llmDisabled) {
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
      run.stats.rejected++;
      console.log(`- ${describe(job)} — descartada: ${reason}`);
      continue;
    }

    const link = canonicalJobUrl(job.link);
    if (!link) {
      run.stats.rejected++;
      console.log(`- ${describe(job)} — descartada: link inválido.`);
      continue;
    }

    const salary = formatSalary(job.salary || (verdict && verdict.salario) || '');
    const technologies = technologiesForJob(job, verdict);
    const acceptedJob = {
      company: job.company,
      title: job.title,
      salary,
      technologies,
      link,
    };
    run.acceptedJobs.push(acceptedJob);
    run.stats.accepted++;
    console.log(`+ ${describe(job)} — aceita: ${reason}`);
    console.log(`  ${link} | Salário: ${salary} | Tecnologias: ${technologies}`);

    if (!config.dryRun) {
      try {
        const added = await appendJobs(config.csvFile, [acceptedJob]);
        run.stats.saved += added;
        console.log(
          added
            ? `  Gravada em ${config.csvFile}.`
            : `  Já existia em ${config.csvFile}; não duplicada.`
        );
      } catch (error) {
        run.stats.saveFailures++;
        console.warn(`! Falha ao gravar em ${config.csvFile}: ${error.message}`);
      }
    }
  }
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

  const roles = selectRoles(interests.roles, options.role);
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
  console.log(`Cargos (um por vez): ${roles.join(' | ')}`);
  console.log(
    `Local: ${location} | Modalidade: ${interests.workModes.join(', ')} | ` +
      `Período: últimos ${config.daysBack} dias`
  );
  console.log(
    `Filtro: ${effectiveMode}${
      effectiveMode === 'keywords' ? '' : ` (nota mínima ${config.threshold})`
    }`
  );
  if (config.dryRun) {
    console.log('Modo simulação: o CSV e o cursor de páginas não serão alterados.');
  }
  console.log(`Prompt do sistema: ${config.systemPromptFile}`);
  console.log(`Progresso das páginas: ${config.searchStateFile}`);
  console.log(
    `Pausa entre termos: ${Math.round(config.roleDelayMs / 1000)}s ` +
      '(ROLE_DELAY_MS)'
  );
  console.log('');

  const state = await loadState(config.searchStateFile, {
    onWarning: (message) => console.warn(`AVISO: ${message}`),
  });
  if (config.resetPages) {
    state.queries = {};
    console.log('Cursor de páginas reiniciado; todas as buscas começam da página 1.');
  }

  const existing = await readExistingJobs(config.csvFile);
  const knownIds = new Set(existing.ids);
  console.log(`CSV: ${existing.count} vaga(s) já gravada(s) em ${config.csvFile}.`);
  console.log('');

  const run = {
    config,
    interests,
    effectiveMode,
    profile,
    resumeText,
    systemPrompt,
    knownIds,
    stats: {
      candidates: 0,
      evaluated: 0,
      accepted: 0,
      saved: 0,
      saveFailures: 0,
      rejected: 0,
      detailFailures: 0,
    },
    acceptedJobs: [],
    llmFailures: 0,
    llmDisabled: false,
    rateLimited: false,
    rateLimitSource: null,
    rateLimitStatus: null,
    aborted: false,
  };

  const found = new Map();
  let searchErrors = 0;
  let stateSaveFailed = false;

  // Cada termo é processado do começo ao fim antes do próximo: busca, avaliação
  // e gravação no CSV. Só então a próxima busca no LinkedIn é iniciada.
  for (let index = 0; index < roles.length; index++) {
    const role = roles[index];

    if (index > 0) {
      console.log('');
      console.log(
        `Aguardando ${Math.round(config.roleDelayMs / 1000)}s antes do próximo termo...`
      );
      await sleep(config.roleDelayMs);
    }

    const query = { role, location, workModeCodes: modeCodes, daysBack: config.daysBack };
    const startPage = getNextPage(state, query);
    const fromPage = startPage > 0 ? ` (a partir da página ${startPage + 1})` : '';
    console.log(`[${index + 1}/${roles.length}] Buscando "${role}" em ${location}${fromPage}...`);

    let result;
    try {
      result = await searchJobs({
        role,
        location,
        workModeCodes: modeCodes,
        daysBack: config.daysBack,
        pages: config.pagesPerQuery,
        startPage,
        maxJobs: config.maxJobsPerQuery,
        delayMs: config.delayMs,
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        markRateLimited(run, 'linkedin', error);
        console.warn(
          `  LinkedIn limitou as requisições (HTTP ${error.status || 429}); ` +
            'interrompendo as buscas restantes.'
        );
        break;
      }
      searchErrors++;
      console.warn(`  Falha: ${error.message}`);
      continue;
    }

    for (const job of result.jobs) {
      if (!found.has(job.id)) found.set(job.id, job);
    }
    setNextPage(state, query, result.nextPage);

    if (!config.dryRun) {
      try {
        await saveState(config.searchStateFile, state);
      } catch (error) {
        if (!stateSaveFailed) {
          stateSaveFailed = true;
          console.warn(
            `! Não foi possível salvar o progresso em ${config.searchStateFile}: ${error.message}`
          );
        }
      }
    }

    console.log(`  ${result.jobs.length} vaga(s).`);
    if (result.reachedEnd) {
      console.log('  Fim dos resultados; a próxima execução recomeça da página 1.');
    } else {
      console.log(`  Próxima execução continua na página ${result.nextPage + 1}.`);
    }

    const candidates = [];
    for (const job of result.jobs) {
      if (!job.id || knownIds.has(job.id)) continue;
      knownIds.add(job.id);
      candidates.push(job);
    }
    run.stats.candidates += candidates.length;

    if (!candidates.length) {
      console.log('  Nenhuma vaga nova para avaliar neste termo.');
      continue;
    }

    console.log(`  ${candidates.length} nova(s) para avaliar:`);
    console.log('');
    await evaluateCandidates(candidates, run);

    if (run.aborted) break;
    console.log(`  Termo "${role}" concluído.`);
    if (run.stats.evaluated >= config.totalLimit) break;
  }

  console.log('');
  if (!found.size) {
    if (run.rateLimited) {
      throw rateLimitException(
        run.rateLimitSource === 'llm' ? 'O LLM' : 'O LinkedIn',
        run.rateLimitStatus
      );
    }
    if (searchErrors) {
      throw new Error(
        'Nenhuma vaga encontrada e houve falhas de busca. ' +
          'O LinkedIn pode estar bloqueando as requisições; tente novamente mais tarde.'
      );
    }
    console.log('Nenhuma vaga encontrada para os cargos informados.');
    return;
  }

  if (!run.acceptedJobs.length) {
    console.log('Nenhuma vaga aderente nesta execução; CSV não alterado.');
  } else if (config.dryRun) {
    console.log(
      `Simulação: ${run.acceptedJobs.length} vaga(s) seriam gravadas em ${config.csvFile}:`
    );
    console.table(
      run.acceptedJobs.map((job) => ({
        Empresa: job.company,
        Título_Vaga: job.title,
        Salário: job.salary,
        Tecnologias_Pedidas: job.technologies,
        Link_da_vaga: job.link,
      }))
    );
  } else {
    console.log(`${run.stats.saved} vaga(s) gravada(s) em ${config.csvFile}.`);
    if (run.stats.saveFailures) {
      console.warn(`AVISO: ${run.stats.saveFailures} vaga(s) aceita(s) não puderam ser gravadas.`);
    }
  }

  if (run.aborted) {
    console.warn('');
    console.warn(
      `AVISO: execução interrompida — ${
        run.rateLimitSource === 'llm' ? 'o LLM' : 'o LinkedIn'
      } limitou as requisições (HTTP ${run.rateLimitStatus || 429}). ` +
        'As vagas já aceitas foram gravadas. Aguarde alguns minutos e rode de novo.'
    );
  }

  console.log(
    `Resumo: ${roles.length} termo(s), ${found.size} encontrada(s), ` +
      `${run.stats.candidates} nova(s), ${run.stats.accepted} aceita(s)` +
      `${config.dryRun ? '' : `, ${run.stats.saved} gravada(s)`}, ` +
      `${run.stats.rejected} descartada(s), ` +
      `${run.stats.detailFailures} falha(s) ao abrir vaga(s).`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Erro: ${error.message}`);
    if (isRateLimitError(error)) {
      console.error(
        'Dica: um dos serviços (LinkedIn ou LLM) limitou as requisições. Aguarde alguns ' +
          'minutos e rode de novo com menos volume (ex.: --role="Cargo" --pages=1 --limit=10).'
      );
    }
    if (process.env.DEBUG) console.error(error.stack);
    process.exitCode = 1;
  });
}

module.exports = { main, selectRoles };
