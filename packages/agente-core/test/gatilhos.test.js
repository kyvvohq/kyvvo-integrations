const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectarGatilhos, perguntaComercial } = require('..');

const PADROES = [
  ['pedido_humano', /\batendente\b/],
  ['negociacao_desconto', /\bdesconto\b/],
];
const COMERCIAL = /\bquanto\s+custa\b/;

test('detectarGatilhos: sem padroes lança erro', () => {
  assert.throws(() => detectarGatilhos('oi', {}), /padroes é obrigatório/);
});

test('detectarGatilhos: detecta o motivo certo', () => {
  assert.deepEqual(detectarGatilhos('quero falar com atendente', { padroes: PADROES }), ['pedido_humano']);
});

test('detectarGatilhos: suprimirSeVip some quando vipConfirmado', () => {
  const semVip = detectarGatilhos('tem desconto?', { padroes: PADROES, vipConfirmado: false, suprimirSeVip: ['negociacao_desconto'] });
  assert.deepEqual(semVip, ['negociacao_desconto']);
  const comVip = detectarGatilhos('tem desconto?', { padroes: PADROES, vipConfirmado: true, suprimirSeVip: ['negociacao_desconto'] });
  assert.deepEqual(comVip, []);
});

test('perguntaComercial: sem comercial lança erro', () => {
  assert.throws(() => perguntaComercial('oi', {}), /comercial \(RegExp\) é obrigatório/);
});

test('perguntaComercial: detecta pergunta configurada', () => {
  assert.equal(perguntaComercial('quanto custa isso?', { comercial: COMERCIAL }), true);
  assert.equal(perguntaComercial('oi, tudo bem?', { comercial: COMERCIAL }), false);
});
