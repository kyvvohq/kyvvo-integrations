const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAgenteCore } = require('..');
const { criarPoolFake } = require('./_mockPool');

const TABELAS = {
  config: 'tab_config', conhecimento: 'tab_conhecimento', conversas: 'tab_conversas',
  mensagens: 'tab_mensagens', execucoes: 'tab_execucoes', handoffs: 'tab_handoffs',
  numeros: 'tab_numeros', anexos: 'tab_anexos', clientes: 'tab_clientes',
};

test('carregarConhecimento: agrupa por tipo e monta a base na ordem certa', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/select tipo, conteudo_md from tab_conhecimento/, () => ({
      rows: [
        { tipo: 'respostas', conteudo_md: 'R' },
        { tipo: 'sistema', conteudo_md: 'S' },
        { tipo: 'voz', conteudo_md: 'V' },
      ],
    })],
  ]);
  const r = await agenteCore.carregarConhecimento(pool, 't1');
  assert.equal(r.sistema, 'S');
  assert.equal(r.base, '<voz>\nV\n</voz>\n\n<respostas>\nR\n</respostas>');
});

test('carregarHistorico: alterna user/assistant e junta mensagens consecutivas do mesmo papel', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/select direcao, tipo, conteudo, anexo_id from tab_mensagens/, () => ({
      rows: [
        { direcao: 'enviada', tipo: 'texto', conteudo: 'oi, antes de qualquer coisa do cliente', anexo_id: null },
        { direcao: 'recebida', tipo: 'texto', conteudo: 'pergunta 1', anexo_id: null },
        { direcao: 'recebida', tipo: 'texto', conteudo: 'pergunta 2', anexo_id: null },
        { direcao: 'enviada', tipo: 'texto', conteudo: 'resposta', anexo_id: null },
      ].reverse(), // a query real vem desc; carregarHistorico re-inverte
    })],
  ]);
  const r = await agenteCore.carregarHistorico(pool, 't1', '+5511999999999');
  // a primeira mensagem (assistant, antes de qualquer "user") é descartada
  assert.deepEqual(r, [
    { role: 'user', content: 'pergunta 1\npergunta 2' },
    { role: 'assistant', content: 'resposta' },
  ]);
});

test('montarSystem: cache_control no bloco certo conforme tem base ou não', () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const comBase = agenteCore.montarSystem({ sistema: 'S', base: 'B', dinamico: 'D' });
  assert.equal(comBase.length, 3);
  assert.ok(comBase[1].cache_control);
  assert.ok(!comBase[0].cache_control);

  const semBase = agenteCore.montarSystem({ sistema: 'S', base: '', dinamico: 'D' });
  assert.equal(semBase.length, 2);
  assert.ok(semBase[0].cache_control);
});
