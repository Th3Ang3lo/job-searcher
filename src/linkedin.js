'use strict';

const {
  cleanText,
  htmlToText,
  decodeEntities,
  canonicalJobUrl,
  extractJobId,
  sleep,
} = require('./util');

const BASE_URL = 'https://www.linkedin.com';
const SEARCH_URL = `${BASE_URL}/jobs-guest/jobs/api/seeMoreJobPostings/search`;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function requestHeaders() {
  return {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Referer: 'https://www.linkedin.com/jobs/search/',
  };
}

async function fetchHtml(url, { attempts = 3, timeoutMs = 30000, label = 'requisição' } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        headers: requestHeaders(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const wait = 2000 * attempt;
      console.warn(`  Falha de rede em ${label}; tentando de novo em ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }

    const body = await response.text();
    if (response.ok) return body;

    const error = new Error(`LinkedIn respondeu HTTP ${response.status} em ${label}`);
    error.status = response.status;
    lastError = error;

    const retryable = response.status === 429 || response.status === 999 || response.status >= 500;
    if (!retryable || attempt === attempts) break;

    const wait = 2000 * attempt;
    console.warn(`  HTTP ${response.status} em ${label}; tentando de novo em ${wait / 1000}s...`);
    await sleep(wait);
  }

  throw lastError || new Error(`Falha ao acessar ${label}`);
}

function firstMatch(source, regex) {
  const match = String(source || '').match(regex);
  return match ? match[1] : '';
}

function parseSearchResults(html) {
  const chunks = String(html || '')
    .split(/(?=<li[^>]*>)/i)
    .filter((chunk) => /data-entity-urn="urn:li:jobPosting:\d+"/i.test(chunk));

  const jobs = [];
  const seen = new Set();

  for (const chunk of chunks) {
    const id =
      firstMatch(chunk, /data-entity-urn="urn:li:jobPosting:(\d+)"/i) ||
      extractJobId(decodeEntities(firstMatch(chunk, /href="(https:\/\/www\.linkedin\.com\/jobs\/view\/[^"]+)"/i)));
    if (!id || seen.has(id)) continue;

    const title = cleanText(
      firstMatch(chunk, /<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i)
    );
    const company = cleanText(
      firstMatch(chunk, /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i)
    );
    if (!title || !company) continue;

    const location = cleanText(
      firstMatch(chunk, /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    );
    const salary = cleanText(
      firstMatch(chunk, /<span[^>]*class="[^"]*job-search-card__salary-info[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
    );
    const link =
      canonicalJobUrl(
        decodeEntities(
          firstMatch(chunk, /href="(https:\/\/www\.linkedin\.com\/jobs\/view\/[^"]+)"/i)
        )
      ) || `${BASE_URL}/jobs/view/${id}`;
    const postedAt = firstMatch(chunk, /<time[^>]*datetime="([^"]+)"/i);

    seen.add(id);
    jobs.push({ id, title, company, location, salary, link, postedAt });
  }

  return jobs;
}

function parseJobDetail(html, id) {
  const source = String(html || '');

  const title = cleanText(
    firstMatch(source, /<h2[^>]*class="[^"]*top-card-layout__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)
  );
  const company = cleanText(
    firstMatch(source, /<a[^>]*class="[^"]*topcard__org-name-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
  );
  const location = cleanText(
    firstMatch(source, /<span[^>]*class="[^"]*topcard__flavor--bullet[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
  );
  const salary = cleanText(
    firstMatch(
      source,
      /<div[^>]*class="[^"]*compensation__salary(?![-\w])[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    )
  );

  const descriptionSection = firstMatch(
    source,
    /<section[^>]*class="[^"]*show-more-less-html[^"]*"[^>]*>([\s\S]*?)<\/section>/i
  );
  const descriptionContainer = firstMatch(
    source,
    /<div[^>]*class="[^"]*description__text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/i
  );
  const description = htmlToText(descriptionSection || descriptionContainer);

  return { id, title, company, location, salary, description };
}

function recencyParam(daysBack) {
  if (!daysBack || daysBack <= 0) return null;
  if (daysBack <= 1) return 'r86400';
  if (daysBack <= 7) return 'r604800';
  if (daysBack <= 30) return 'r2592000';
  return null;
}

async function searchJobs({
  role,
  location,
  workModeCodes = [],
  daysBack = 7,
  pages = 1,
  maxJobs = 0,
  delayMs = 1500,
}) {
  const jobs = [];
  const seen = new Set();

  for (let page = 0; page < pages; page++) {
    if (page > 0) await sleep(delayMs + Math.floor(Math.random() * 400));

    const params = new URLSearchParams();
    params.set('keywords', role);
    params.set('location', location);
    if (workModeCodes.length) params.set('f_WT', workModeCodes.join(','));
    const recency = recencyParam(daysBack);
    if (recency) params.set('f_TPR', recency);
    params.set('start', String(page * 10));

    const html = await fetchHtml(`${SEARCH_URL}?${params.toString()}`, {
      label: `busca "${role}" (página ${page + 1})`,
    });
    const pageJobs = parseSearchResults(html);

    for (const job of pageJobs) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
    }

    if (maxJobs > 0 && jobs.length >= maxJobs) break;
    if (pageJobs.length < 10) break;
  }

  return maxJobs > 0 ? jobs.slice(0, maxJobs) : jobs;
}

async function fetchJobDetail(jobId) {
  const url = `${BASE_URL}/jobs-guest/jobs/api/jobPosting/${encodeURIComponent(jobId)}`;
  const html = await fetchHtml(url, { label: `vaga ${jobId}` });
  return parseJobDetail(html, jobId);
}

module.exports = {
  searchJobs,
  fetchJobDetail,
  parseSearchResults,
  parseJobDetail,
  recencyParam,
};
