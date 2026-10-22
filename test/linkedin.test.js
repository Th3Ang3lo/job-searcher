'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSearchResults, parseJobDetail, recencyParam } = require('../src/linkedin');

const searchHtml = `<!DOCTYPE html>
<li>
<div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:4410262237">
<a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/senior-backend-at-acme-4410262237?position=1&amp;pageNum=0"></a>
<h3 class="base-search-card__title"> Senior Backend Engineer </h3>
<h4 class="base-search-card__subtitle"> <a href="https://www.linkedin.com/company/acme"> Acme </a> </h4>
<span class="job-search-card__location"> São Paulo, Brazil </span>
<span class="job-search-card__salary-info"> R$ 15.000,00/mês </span>
<time datetime="2026-10-20">2 days ago</time>
</div>
</li>
<li>
<div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:4410262238">
<a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/dev-at-beta-4410262238"></a>
<h3 class="base-search-card__title"> Desenvolvedor(a) Backend </h3>
<h4 class="base-search-card__subtitle"> <a href="https://www.linkedin.com/company/beta"> Beta </a> </h4>
<span class="job-search-card__location"> Remoto </span>
</div>
</li>`;

const detailHtml = `
<h2 class="top-card-layout__title font-sans text-lg">Senior Backend Engineer</h2>
<a class="topcard__org-name-link topcard__flavor--black-link" href="#">Acme</a>
<span class="topcard__flavor topcard__flavor--bullet">São Paulo, Brazil</span>
<div class="compensation__salary-range">
  <h3 class="compensation__heading">Faixa salarial</h3>
  <div class="salary compensation__salary">R$ 15.000,00/mês - R$ 20.000,00/mês</div>
</div>
<section class="show-more-less-html" data-max-lines="5">
  <div class="show-more-less-html__markup">Buscamos pessoa para backend.<br>Node.js e TypeScript.</div>
</section>`;

test('parseia os cards da busca', () => {
  const jobs = parseSearchResults(searchHtml);
  assert.equal(jobs.length, 2);

  assert.equal(jobs[0].id, '4410262237');
  assert.equal(jobs[0].title, 'Senior Backend Engineer');
  assert.equal(jobs[0].company, 'Acme');
  assert.equal(jobs[0].location, 'São Paulo, Brazil');
  assert.equal(jobs[0].salary, 'R$ 15.000,00/mês');
  assert.equal(jobs[0].link, 'https://www.linkedin.com/jobs/view/4410262237');
  assert.equal(jobs[0].postedAt, '2026-10-20');

  assert.equal(jobs[1].id, '4410262238');
  assert.equal(jobs[1].company, 'Beta');
  assert.equal(jobs[1].salary, '');
  assert.equal(jobs[1].link, 'https://www.linkedin.com/jobs/view/4410262238');
});

test('parseia o detalhe da vaga com salário e descrição', () => {
  const job = parseJobDetail(detailHtml, '4410262237');
  assert.equal(job.title, 'Senior Backend Engineer');
  assert.equal(job.company, 'Acme');
  assert.equal(job.location, 'São Paulo, Brazil');
  assert.equal(job.salary, 'R$ 15.000,00/mês - R$ 20.000,00/mês');
  assert.match(job.description, /Buscamos pessoa para backend\./);
  assert.match(job.description, /Node\.js e TypeScript\./);
});

test('parseia detalhe sem salário', () => {
  const job = parseJobDetail('<h2 class="top-card-layout__title">Dev</h2>', '1234567');
  assert.equal(job.title, 'Dev');
  assert.equal(job.salary, '');
  assert.equal(job.description, '');
});

test('mapeia a janela de recência', () => {
  assert.equal(recencyParam(1), 'r86400');
  assert.equal(recencyParam(7), 'r604800');
  assert.equal(recencyParam(30), 'r2592000');
  assert.equal(recencyParam(31), null);
});
