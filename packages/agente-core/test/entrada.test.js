const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extrairMudancas, normalizarMensagem, tipoNormalizado } = require('..');

test('tipoNormalizado: mapeia tipos conhecidos e cai em "outro"', () => {
  assert.equal(tipoNormalizado('text'), 'texto');
  assert.equal(tipoNormalizado('image'), 'imagem');
  assert.equal(tipoNormalizado('algo-novo-da-meta'), 'outro');
});

test('normalizarMensagem: texto simples', () => {
  const m = normalizarMensagem({ id: 'wamid1', from: '5511999999999', timestamp: '1700000000', type: 'text', text: { body: 'oi' } });
  assert.equal(m.wamid, 'wamid1');
  assert.equal(m.de, '5511999999999');
  assert.equal(m.tipo, 'texto');
  assert.equal(m.conteudo, 'oi');
  assert.ok(m.enviadaEm instanceof Date);
});

test('normalizarMensagem: botão interativo vira texto com o título', () => {
  const m = normalizarMensagem({ type: 'interactive', interactive: { button_reply: { id: 'b1', title: 'Sim' } } });
  assert.equal(m.tipo, 'texto');
  assert.equal(m.conteudo, 'Sim');
});

test('normalizarMensagem: imagem guarda mediaId e mime', () => {
  const m = normalizarMensagem({ type: 'image', image: { id: 'media1', mime_type: 'image/png', caption: 'legenda' } });
  assert.equal(m.tipo, 'imagem');
  assert.equal(m.conteudo, 'legenda');
  assert.deepEqual(m.midia, { mediaId: 'media1', nomeArquivo: null, mime: 'image/png' });
});

test('normalizarMensagem: áudio nunca baixa, só registra', () => {
  const m = normalizarMensagem({ type: 'audio' });
  assert.equal(m.tipo, 'audio');
  assert.equal(m.conteudo, '[audio]');
  assert.equal(m.midia, null);
});

test('extrairMudancas: mensagem + status + eco de coexistência no mesmo payload', () => {
  const body = {
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: '123' },
          contacts: [{ wa_id: '5511999999999', profile: { name: 'Cliente' } }],
          messages: [{ id: 'w1', from: '5511999999999', timestamp: '1700000000', type: 'text', text: { body: 'oi' } }],
          statuses: [{ id: 'w2', status: 'delivered', pricing: { category: 'service' } }],
          message_echoes: [{ id: 'w3', to: '5511988888888', timestamp: '1700000001', type: 'text', text: { body: 'resposta manual' } }],
        },
      }],
    }],
  };
  const [mudanca] = extrairMudancas(body);
  assert.equal(mudanca.phoneNumberId, '123');
  assert.equal(mudanca.mensagens.length, 1);
  assert.equal(mudanca.mensagens[0].nomeWhatsapp, 'Cliente');
  assert.equal(mudanca.statuses[0].status, 'delivered');
  assert.equal(mudanca.statuses[0].categoria, 'service');
  assert.equal(mudanca.ecos.length, 1);
  assert.equal(mudanca.ecos[0].para, '5511988888888');
});

test('extrairMudancas: evento sem phone_number_id é ignorado', () => {
  const body = { entry: [{ changes: [{ value: {} }] }] };
  assert.deepEqual(extrairMudancas(body), []);
});
