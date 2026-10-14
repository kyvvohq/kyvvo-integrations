const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAgenteCore } = require('..');
const { criarPoolFake } = require('./_mockPool');

const TABELAS = {
  config: 'tab_config', conhecimento: 'tab_conhecimento', conversas: 'tab_conversas',
  mensagens: 'tab_mensagens', execucoes: 'tab_execucoes', handoffs: 'tab_handoffs',
  numeros: 'tab_numeros', anexos: 'tab_anexos', clientes: 'tab_clientes',
};

const paraE164 = (t) => (t ? `+${t}` : null);

function corpoComMensagemTexto(phoneNumberId, telefone) {
  return {
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: phoneNumberId },
          contacts: [{ wa_id: telefone, profile: { name: 'Cliente Teste' } }],
          messages: [{ id: 'wamid1', from: telefone, timestamp: '1700000000', type: 'text', text: { body: 'oi' } }],
        },
      }],
    }],
  };
}

test('receberWebhook: sem paraE164 lança erro', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([]);
  await assert.rejects(() => agenteCore.receberWebhook(pool, {}, {}), /paraE164 é obrigatório/);
});

test('receberWebhook: numero sem canal ativo -> não trata, não grava nada', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/from tab_numeros n\s+join tab_config c/s, () => ({ rows: [] })],
  ]);
  const r = await agenteCore.receberWebhook(pool, corpoComMensagemTexto('999', '5511999999999'), { paraE164 });
  assert.equal(r.tratados.size, 0);
  assert.deepEqual(r.novas, []);
});

test('receberWebhook: numero com canal ativo -> grava conversa e mensagem, marca como nova', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/from tab_numeros n\s+join tab_config c/s, () => ({ rows: [{ phone_number_id: '123', tenant_id: 't1', modo: 'api', limites: {} }] })],
    [/insert into tab_conversas/, () => ({ rows: [{ id: 'conv-1' }] })],
    [/insert into tab_mensagens/, () => ({ rows: [{ id: 'msg-1' }] })],
  ]);
  const r = await agenteCore.receberWebhook(pool, corpoComMensagemTexto('123', '5511999999999'), { paraE164 });
  assert.ok(r.tratados.has('123'));
  assert.deepEqual(r.novas, [{ tenantId: 't1', conversaId: 'conv-1' }]);
});

test('receberWebhook: wamid repetido (conflict) -> não entra em "novas"', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/from tab_numeros n\s+join tab_config c/s, () => ({ rows: [{ phone_number_id: '123', tenant_id: 't1', modo: 'api', limites: {} }] })],
    [/insert into tab_conversas/, () => ({ rows: [{ id: 'conv-1' }] })],
    [/insert into tab_mensagens/, () => ({ rows: [] })], // ON CONFLICT DO NOTHING -> sem retorno
  ]);
  const r = await agenteCore.receberWebhook(pool, corpoComMensagemTexto('123', '5511999999999'), { paraE164 });
  assert.deepEqual(r.novas, []);
});

test('carregarCanalAtivo: devolve a linha quando existe, null quando não', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const poolComCanal = criarPoolFake([[/from tab_numeros n\s+join tab_config c/s, () => ({ rows: [{ phone_number_id: '123', tenant_id: 't1' }] })]]);
  assert.deepEqual(await agenteCore.carregarCanalAtivo(poolComCanal, '123'), { phone_number_id: '123', tenant_id: 't1' });
  const poolSemCanal = criarPoolFake([[/from tab_numeros n\s+join tab_config c/s, () => ({ rows: [] })]]);
  assert.equal(await agenteCore.carregarCanalAtivo(poolSemCanal, '999'), null);
});
