const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checarCotaDisparo, dispararEmLote } = require('..');

// Mock mínimo de um `pg` Pool/Client — só o que o pacote usa (`.query`).
function poolMock({ totalUsadoMesAtual = 0 } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, params) {
      chamadas.push({ sql, params });
      if (sql.includes('count(*)')) return { rows: [{ total: totalUsadoMesAtual }] };
      return { rows: [] }; // INSERT em whatsapp_disparos
    },
  };
}

test('checarCotaDisparo: limiteDisparos nulo nunca trava', async () => {
  const pool = poolMock();
  const r = await checarCotaDisparo(pool, { tenantId: 't1', limiteDisparos: null, quantidade: 999 });
  assert.deepEqual(r, { ok: true, restante: null, limite: null, usadoMesAtual: null });
  assert.equal(pool.chamadas.length, 0, 'não deve consultar o banco quando o plano não tem limite');
});

test('checarCotaDisparo: quantidade cabe dentro do restante', async () => {
  const pool = poolMock({ totalUsadoMesAtual: 10 });
  const r = await checarCotaDisparo(pool, { tenantId: 't1', limiteDisparos: 15, quantidade: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.restante, 5);
  assert.equal(r.usadoMesAtual, 10);
});

test('checarCotaDisparo: quantidade estoura o restante', async () => {
  const pool = poolMock({ totalUsadoMesAtual: 10 });
  const r = await checarCotaDisparo(pool, { tenantId: 't1', limiteDisparos: 15, quantidade: 6 });
  assert.equal(r.ok, false);
  assert.equal(r.restante, 5);
});

test('checarCotaDisparo: exatamente no limite cabe (não é ">")', async () => {
  const pool = poolMock({ totalUsadoMesAtual: 10 });
  const r = await checarCotaDisparo(pool, { tenantId: 't1', limiteDisparos: 15, quantidade: 5 });
  assert.equal(r.ok, true);
});

function comFetchMock(respostasPorChamada, fn) {
  const original = global.fetch;
  let chamada = 0;
  global.fetch = async () => {
    const r = respostasPorChamada[chamada];
    chamada += 1;
    if (r === 'erro') return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return Promise.resolve(fn()).finally(() => { global.fetch = original; });
}

test('dispararEmLote: opt-out pula o envio (não chama a Graph API) e conta como falha', async () => {
  const pool = poolMock();
  const envAntes = { ...process.env };
  process.env.META_WHATSAPP_TOKEN = 't';
  try {
    const r = await dispararEmLote(pool, {
      tenantId: 't1',
      destinatarios: [{ telefoneE164: '+5511999999999', optOut: true }],
      templateNome: 'promo_1',
      phoneNumberId: 'num-1',
    });
    assert.equal(r.enviados, 0);
    assert.equal(r.falhas, 1);
    assert.deepEqual(r.detalhes, [{ telefoneE164: '+5511999999999', status: 'bloqueado_optout' }]);
    const insercoes = pool.chamadas.filter((c) => c.sql.includes('insert into whatsapp_disparos'));
    assert.equal(insercoes.length, 1);
    assert.equal(insercoes[0].params[5], 'bloqueado_optout');
  } finally {
    process.env = envAntes;
  }
});

test('dispararEmLote: 1 sucesso + 1 falha da Graph API — contadores e status gravados corretos', async () => {
  const pool = poolMock();
  const envAntes = { ...process.env };
  process.env.META_WHATSAPP_TOKEN = 't';
  try {
    await comFetchMock(['ok', 'erro'], async () => {
      const r = await dispararEmLote(pool, {
        tenantId: 't1',
        destinatarios: [
          { telefoneE164: '+5511111111111', parametrosCorpo: [{ nome: 'cliente', valor: 'Ana', nomeado: true }] },
          { telefoneE164: '+5511222222222', parametrosCorpo: [{ nome: 'cliente', valor: 'Bia', nomeado: true }] },
        ],
        templateNome: 'promo_1',
        phoneNumberId: 'num-1',
        gatilho: 'manual',
      });
      assert.equal(r.enviados, 1);
      assert.equal(r.falhas, 1);
      assert.deepEqual(r.detalhes, [
        { telefoneE164: '+5511111111111', status: 'enviado' },
        { telefoneE164: '+5511222222222', status: 'erro' },
      ]);
      const insercoes = pool.chamadas.filter((c) => c.sql.includes('insert into whatsapp_disparos'));
      assert.equal(insercoes.length, 2);
      assert.equal(insercoes[0].params[4], 'manual');
      assert.equal(insercoes[0].params[5], 'enviado');
      assert.equal(insercoes[1].params[5], 'erro');
    });
  } finally {
    process.env = envAntes;
  }
});
