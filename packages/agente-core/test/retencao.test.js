const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAgenteCore } = require('..');
const { criarPoolFake } = require('./_mockPool');

const TABELAS = {
  config: 'tab_config', conhecimento: 'tab_conhecimento', conversas: 'tab_conversas',
  mensagens: 'tab_mensagens', execucoes: 'tab_execucoes', handoffs: 'tab_handoffs',
  numeros: 'tab_numeros', anexos: 'tab_anexos', clientes: 'tab_clientes',
};

test('expurgarLogs: sem contas com retencao configurada -> []', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/select tenant_id, retencao_logs_dias from tab_config/, () => ({ rows: [] })],
  ]);
  assert.deepEqual(await agenteCore.expurgarLogs(pool), []);
});

test('expurgarLogs: apaga execuções antigas só das contas com retencao configurada', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/select tenant_id, retencao_logs_dias from tab_config/, () => ({ rows: [{ tenant_id: 't1', retencao_logs_dias: 30 }] })],
    [/delete from tab_execucoes where tenant_id = \$1/, () => ({ rowCount: 5 })],
  ]);
  const r = await agenteCore.expurgarLogs(pool);
  assert.deepEqual(r, [{ tenant_id: 't1', execucoes_apagadas: 5 }]);
});

test('expurgarLogs: rowCount 0 não entra no resultado', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/select tenant_id, retencao_logs_dias from tab_config/, () => ({ rows: [{ tenant_id: 't1', retencao_logs_dias: 30 }] })],
    [/delete from tab_execucoes where tenant_id = \$1/, () => ({ rowCount: 0 })],
  ]);
  assert.deepEqual(await agenteCore.expurgarLogs(pool), []);
});
