const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAgenteCore } = require('..');
const { criarPoolFake } = require('./_mockPool');

const TABELAS = {
  config: 'tab_config', conhecimento: 'tab_conhecimento', conversas: 'tab_conversas',
  mensagens: 'tab_mensagens', execucoes: 'tab_execucoes', handoffs: 'tab_handoffs',
  numeros: 'tab_numeros', anexos: 'tab_anexos', clientes: 'tab_clientes',
};

function poolComConversaEMensagens({ conversa, pendentes }) {
  return criarPoolFake([
    [/select pg_advisory_lock/, () => ({ rows: [] })],
    [/select pg_advisory_unlock/, () => ({ rows: [] })],
    [/select \* from tab_conversas where tenant_id = \$1 and id = \$2/, () => ({ rows: [conversa] })],
    [/select \* from tab_mensagens\s+where tenant_id = \$1 and telefone_e164 = \$2 and autor = 'cliente'/s, () => ({ rows: pendentes })],
    [/select \* from tab_mensagens where tenant_id = \$1 and id = any/, () => ({ rows: pendentes })],
    [/update tab_mensagens set processada_em/, () => ({ rows: [] })],
    [/update tab_mensagens set tentativas/, () => ({ rows: [] })],
  ]);
}

test('processarConversa: sem midiaPermitida lança erro nomeado', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolComConversaEMensagens({ conversa: { situacao: 'bot' }, pendentes: [] });
  await assert.rejects(
    () => agenteCore.processarConversa(pool, 't1', 'c1', {}),
    /deps\.midiaPermitida é obrigatório/,
  );
});

test('processarConversa: conversa inexistente -> processadas: 0, sem erro', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/select pg_advisory_lock/, () => ({ rows: [] })],
    [/select pg_advisory_unlock/, () => ({ rows: [] })],
    [/select \* from tab_conversas/, () => ({ rows: [] })],
  ]);
  const r = await agenteCore.processarConversa(pool, 't1', 'c1', { midiaPermitida: () => true });
  assert.deepEqual(r, { processadas: 0 });
});

test('processarConversa: agente em pausa (situacao humano) -> marca visto, não chama o agente', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  let chamouAgente = false;
  const pool = poolComConversaEMensagens({
    conversa: { situacao: 'humano', telefone_e164: '+5511999999999' },
    pendentes: [{ id: 1 }],
  });
  const r = await agenteCore.processarConversa(pool, 't1', 'c1', {
    midiaPermitida: () => true,
    executarAgente: async () => { chamouAgente = true; },
  });
  assert.deepEqual(r, { processadas: 1, pausado: true });
  assert.equal(chamouAgente, false);
});

test('processarConversa: falha no agente incrementa tentativas e devolve o erro', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolComConversaEMensagens({
    conversa: { situacao: 'bot', telefone_e164: '+5511999999999' },
    pendentes: [{ id: 1, midia: null }],
  });
  const r = await agenteCore.processarConversa(pool, 't1', 'c1', {
    midiaPermitida: () => true,
    executarAgente: async () => { throw new Error('boom'); },
  });
  assert.equal(r.processadas, 0);
  assert.equal(r.erro, 'boom');
});

test('agenteEmPausa: humano sempre pausa; pausada_ate no futuro pausa; no passado não', () => {
  const agora = new Date('2026-01-14T15:00:00Z');
  assert.equal(agenteCore_agenteEmPausa({ situacao: 'humano' }, agora), true);
  assert.equal(agenteCore_agenteEmPausa({ situacao: 'bot', pausada_ate: '2026-01-14T16:00:00Z' }, agora), true);
  assert.equal(agenteCore_agenteEmPausa({ situacao: 'bot', pausada_ate: '2026-01-14T10:00:00Z' }, agora), false);
  // sem pausada_ate, o `&&` devolve undefined, não false — comportamento
  // idêntico ao original (kyvvo-crm/lib/agente/processador.js), preservado
  // de propósito nesta extração.
  assert.ok(!agenteCore_agenteEmPausa({ situacao: 'bot' }, agora));
});

function agenteCore_agenteEmPausa(conversa, agora) {
  const { criarAgenteCore: criar } = require('..');
  const ac = criar({ tabelas: TABELAS });
  return ac.agenteEmPausa(conversa, agora);
}
