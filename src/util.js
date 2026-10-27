'use strict';

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  iacute: 'í',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  uacute: 'ú',
  uuml: 'ü',
  ccedil: 'ç',
  Aacute: 'Á',
  Agrave: 'À',
  Acirc: 'Â',
  Atilde: 'Ã',
  Eacute: 'É',
  Ecirc: 'Ê',
  Iacute: 'Í',
  Oacute: 'Ó',
  Ocirc: 'Ô',
  Otilde: 'Õ',
  Uacute: 'Ú',
  Ccedil: 'Ç',
};

function decodeEntities(input) {
  if (!input) return '';
  return String(input).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const isHex = code[1] && code[1].toLowerCase() === 'x';
      const value = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(value)) return match;
      try {
        return String.fromCodePoint(value);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[code] ?? NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

function htmlToText(html) {
  if (!html) return '';
  const withBreaks = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '');

  return decodeEntities(withBreaks)
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanText(html) {
  return htmlToText(html).replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, maxLength) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsTerm(haystack, term) {
  const hay = normalizeText(haystack);
  const needle = normalizeText(term);
  if (!hay || !needle) return false;

  if (needle.length < 3) {
    const regex = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`);
    return regex.test(hay);
  }

  if (hay.includes(needle)) return true;

  if (!needle.includes(' ')) {
    const compactHay = hay.replace(/[.\-_/]/g, '');
    const compactNeedle = needle.replace(/[.\-_/]/g, '');
    if (compactNeedle.length >= 3 && compactHay.includes(compactNeedle)) return true;
  }

  return false;
}

function parseAmount(raw) {
  if (raw == null) return null;
  let value = String(raw).replace(/[^\d.,]/g, '');
  if (!value || !/\d/.test(value)) return null;

  const hasComma = value.includes(',');
  const hasDot = value.includes('.');

  if (hasComma && hasDot) {
    if (value.lastIndexOf(',') > value.lastIndexOf('.')) {
      value = value.replace(/\./g, '').replace(/,/g, '.');
    } else {
      value = value.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = value.split(',');
    if (parts.length === 2 && parts[1].length === 3) value = parts.join('');
    else value = value.replace(/,/g, '.');
  } else if (hasDot) {
    const parts = value.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      value = parts.join('');
    }
  }

  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function detectCurrency(text) {
  if (!text) return null;
  const raw = String(text);
  const upper = raw.toUpperCase();
  if (/R\$/.test(raw) || /\bBRL\b/.test(upper)) return 'BRL';
  if (/€/.test(raw) || /\bEUR\b/.test(upper)) return 'EUR';
  if (/£/.test(raw) || /\bGBP\b/.test(upper)) return 'GBP';
  if (/\$/.test(raw) || /\bUSD\b/.test(upper)) return 'USD';
  return null;
}

function detectPeriod(text) {
  if (!text) return null;
  const value = String(text).toLowerCase();
  if (/\b(ano|anos|year|years|anual|annual)\b/.test(value) || /\/\s*(y|yr)\b/.test(value)) {
    return 'year';
  }
  if (
    /\b(mes|mês|months?|mensal|monthly)\b/.test(value) ||
    /\/\s*(mo|m)\b/.test(value)
  ) {
    return 'month';
  }
  if (
    /\b(hora|horas|hour|hours|hourly)\b/.test(value) ||
    /\/\s*(hr|h)\b/.test(value)
  ) {
    return 'hour';
  }
  return null;
}

function toMonthly(amount, period) {
  if (!Number.isFinite(amount)) return null;
  if (period === 'year') return amount / 12;
  if (period === 'hour') return amount * 160;
  if (period === 'month') return amount;
  return null;
}

function parseMoney(text) {
  if (!text) return null;
  return {
    amount: parseAmount(text),
    currency: detectCurrency(text),
    period: detectPeriod(text),
  };
}

function extractJobId(url) {
  if (!url) return null;
  const clean = String(url).split(/[?#]/)[0];
  const segment = clean.split('/').filter(Boolean).pop() || '';
  const match = segment.match(/(\d{6,})$/);
  return match ? match[1] : null;
}

function canonicalJobUrl(url) {
  if (!url) return '';
  const id = extractJobId(url);
  if (id) return `https://www.linkedin.com/jobs/view/${id}`;
  return String(url).split(/[?#]/)[0];
}

function formatSalary(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || 'Não informado';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
  return Boolean(
    error && (error.status === 429 || error.status === 999 || error.rateLimited === true)
  );
}

module.exports = {
  decodeEntities,
  htmlToText,
  cleanText,
  normalizeText,
  truncate,
  escapeRegExp,
  containsTerm,
  parseAmount,
  detectCurrency,
  detectPeriod,
  toMonthly,
  parseMoney,
  extractJobId,
  canonicalJobUrl,
  formatSalary,
  sleep,
  isRateLimitError,
};
