const { test } = require('node:test');
const assert = require('node:assert/strict');
const { filtrarResposta, higienizarEntrada, normalizar } = require('..');

const PADROES = [
  ['valor_monetario', /r\s*\$/],
  ['prazo', /\bamanha\b/],
];

test('filtrarResposta: sem padroes lança erro (nunca "sem filtro" por omissão)', () => {
  assert.throws(() => filtrarResposta('qualquer coisa', {}), /padroes é obrigatório/);
});

test('filtrarResposta: texto limpo passa', () => {
  const r = filtrarResposta('Oi! Como posso ajudar?', { padroes: PADROES });
  assert.deepEqual(r, { ok: true, motivos: [] });
});

test('filtrarResposta: bloqueia termo configurado', () => {
  const r = filtrarResposta('Fica R$ 50,00', { padroes: PADROES });
  assert.equal(r.ok, false);
  assert.ok(r.motivos.includes('valor_monetario'));
});

test('filtrarResposta: frase VIP só passa com vipConfirmado true', () => {
  const frase = 'você ganha 10% de desconto';
  const padroesComDesconto = [...PADROES, ['desconto', /desconto/]];
  const semVip = filtrarResposta(frase, { padroes: padroesComDesconto, fraseVip: frase, vipConfirmado: false });
  assert.equal(semVip.ok, false);
  const comVip = filtrarResposta(frase, { padroes: padroesComDesconto, fraseVip: frase, vipConfirmado: true });
  assert.equal(comVip.ok, true);
});

test('higienizarEntrada: remove CPF e CNPJ', () => {
  assert.equal(higienizarEntrada('meu cpf é 123.456.789-00'), 'meu cpf é [CPF removido]');
  assert.equal(higienizarEntrada('cnpj 12.345.678/0001-99'), 'cnpj [CNPJ removido]');
});

test('normalizar: remove acento e caixa', () => {
  assert.equal(normalizar('AMANHÃ não É hoje'), 'amanha nao e hoje');
});
