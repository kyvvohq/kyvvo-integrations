const { test } = require('node:test');
const assert = require('node:assert/strict');
const { custoUsd } = require('..');

test('custoUsd: modelo conhecido calcula entrada+saída', () => {
  const v = custoUsd('claude-haiku-5-5', 1_000_000, 1_000_000);
  assert.equal(v, 0.1 + 0.5);
});

test('custoUsd: modelo desconhecido devolve null (não inventa preço)', () => {
  assert.equal(custoUsd('modelo-que-nao-existe', 100, 100), null);
});

test('custoUsd: zero tokens dá zero', () => {
  assert.equal(custoUsd('claude-haiku-5-5', 0, 0), 0);
});

test('custoUsd: tokens undefined/NaN tratados como zero', () => {
  assert.equal(custoUsd('claude-haiku-5-5', undefined, undefined), 0);
});
