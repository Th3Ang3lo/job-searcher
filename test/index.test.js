'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { selectRoles } = require('../index');

const ROLES = [
  'Desenvolvedor Backend Sênior',
  'Engenheiro de Software',
  'Software Engineer',
];

test('selectRoles devolve todos os termos quando nenhum é pedido', () => {
  assert.deepEqual(selectRoles(ROLES, null), ROLES);
  assert.deepEqual(selectRoles(ROLES, ''), ROLES);
});

test('selectRoles encontra o termo exato sem diferenciar maiúsculas e acentos', () => {
  assert.deepEqual(selectRoles(ROLES, 'Software Engineer'), ['Software Engineer']);
  assert.deepEqual(selectRoles(ROLES, 'software engineer'), ['Software Engineer']);
  assert.deepEqual(selectRoles(ROLES, 'Desenvolvedor Backend Senior'), [
    'Desenvolvedor Backend Sênior',
  ]);
});

test('selectRoles aceita um trecho quando ele identifica um único termo', () => {
  assert.deepEqual(selectRoles(ROLES, 'engenheiro'), ['Engenheiro de Software']);
  assert.deepEqual(selectRoles(ROLES, 'backend'), ['Desenvolvedor Backend Sênior']);
});

test('selectRoles recusa trechos ambíguos ou inexistentes', () => {
  assert.throws(() => selectRoles(ROLES, 'software'), /mais de um termo/);
  assert.throws(() => selectRoles(ROLES, 'inexistente'), /não encontrado/);
});
