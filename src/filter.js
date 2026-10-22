'use strict';

const { normalizeText, containsTerm, parseMoney, toMonthly } = require('./util');

const STOPWORDS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'para',
  'com',
  'por',
  'a',
  'o',
  'as',
  'os',
  'um',
  'uma',
  'the',
  'and',
  'of',
  'for',
  'with',
  'in',
  'at',
  'to',
  'on',
  'jr',
  'sr',
  'junior',
  'pleno',
  'senior',
  'especialista',
  'especialist',
  'lead',
  'staff',
  'principal',
  'nivel',
  'level',
]);

function significantTokens(text) {
  return normalizeText(text)
    .split(/[^a-z0-9+#.]+/)
    .map((token) => token.replace(/^[.+#]+|[.+#]+$/g, ''))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function reject(reason) {
  return {
    rejected: true,
    reason,
    positive: false,
    keywordsPass: false,
    score: 0,
    matches: [],
  };
}

function analyzeJob(job, interests) {
  const title = normalizeText(job.title);
  const company = normalizeText(job.company);
  const combined = normalizeText(
    [job.title, job.company, job.location, job.description].filter(Boolean).join('\n')
  );

  const excludedCompany = interests.companiesExclude.find((item) => containsTerm(company, item));
  if (excludedCompany) return reject(`empresa excluída: ${excludedCompany}`);

  const excludedKeyword = interests.excludeKeywords.find((keyword) => containsTerm(combined, keyword));
  if (excludedKeyword) return reject(`palavra-chave excluída: ${excludedKeyword}`);

  if (interests.salary.min != null && job.salary) {
    const money = parseMoney(job.salary);
    if (
      money &&
      money.amount != null &&
      money.period &&
      money.currency &&
      interests.salary.currency &&
      money.currency === interests.salary.currency
    ) {
      const jobMonthly = toMonthly(money.amount, money.period);
      const minMonthly = toMonthly(interests.salary.min, interests.salary.period || 'month');
      if (jobMonthly != null && minMonthly != null && jobMonthly < minMonthly) {
        return reject(`salário abaixo do mínimo (${job.salary})`);
      }
    }
  }

  const roleTokens = [...new Set(interests.roles.flatMap((role) => significantTokens(role)))];
  const roleMatches = roleTokens.filter((token) => containsTerm(title, token));
  const skillMatches = interests.skills.filter((skill) => containsTerm(combined, skill));
  const boostMatches = interests.boostKeywords.filter((keyword) => containsTerm(combined, keyword));
  const companyMatch = interests.companiesInclude.some((item) => containsTerm(company, item));
  const seniorityMatches = interests.seniority.filter((level) => containsTerm(title, level));

  const score = Math.min(
    100,
    (roleMatches.length ? 30 + Math.min(10, (roleMatches.length - 1) * 5) : 0) +
      Math.min(25, skillMatches.length * 5) +
      Math.min(15, boostMatches.length * 5) +
      (companyMatch ? 20 : 0) +
      (seniorityMatches.length ? 10 : 0)
  );

  const positive =
    roleMatches.length > 0 ||
    skillMatches.length >= 2 ||
    (boostMatches.length > 0 && skillMatches.length > 0) ||
    companyMatch;

  const keywordsPass = roleMatches.length > 0 || skillMatches.length >= 2 || companyMatch;

  return {
    rejected: false,
    reason: '',
    positive,
    keywordsPass,
    score,
    matches: [
      ...roleMatches.map((token) => `cargo:${token}`),
      ...skillMatches.map((skill) => `skill:${skill}`),
      ...boostMatches.map((keyword) => `keyword:${keyword}`),
      ...(companyMatch ? [`empresa:${job.company}`] : []),
      ...seniorityMatches.map((level) => `senioridade:${level}`),
    ],
  };
}

module.exports = { analyzeJob, significantTokens };
