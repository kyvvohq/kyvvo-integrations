const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAgenteCore } = require('..');
const { criarPoolFake } = require('./_mockPool');

const TABELAS = {
  config: 'tab_config', conhecimento: 'tab_conhecimento', conversas: 'tab_conversas',
  mensagens: 'tab_mensagens', execucoes: 'tab_execucoes', handoffs: 'tab_handoffs',
  numeros: 'tab_numeros', anexos: 'tab_anexos', clientes: 'tab_clientes',
};

function poolMetricasVazio() {
  return criarPoolFake([
    [/select modelo_runtime, limites, horario_atendimento from tab_config/, () => ({ rows: [{ modelo_runtime: 'claude-haiku-5-5', limites: {}, horario_atendimento: null }] })],
    [/count\(\*\) filter \(where bloqueada_por_filtro\)/, () => ({ rows: [{ total: 0, bloqueadas: 0, chamadas_ao_modelo: 0, aprovadas: 0, editadas: 0, descartadas: 0, conversas: 0 }] })],
    [/select modelo, coalesce\(sum\(tokens_in\)/, () => ({ rows: [] })],
    [/select coalesce\(categoria_cobranca/, () => ({ rows: [] })],
    [/select c\.id as conversa_id, c\.telefone_e164, c\.cliente_id/, () => ({ rows: [] })],
    [/with h as \(/, () => ({ rows: [{ total: 0, respondidos: 0, media_min: null, mediana_min: null }] })],
    [/select count\(\*\)::int as abertos/, () => ({ rows: [{ abertos: 0, mais_antigo_min: 0 }] })],
    [/select coalesce\(sum\(coalesce\(tokens_in, 0\) \+ coalesce\(tokens_out, 0\)\), 0\)::bigint as n from tab_execucoes/, () => ({ rows: [{ n: 0 }] })],
  ]);
}

test('calcularMetricas: conta zerada não quebra e devolve estrutura completa', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const r = await agenteCore.calcularMetricas(poolMetricasVazio(), 't1', {});
  assert.equal(r.execucoes.total, 0);
  assert.equal(r.custo.ia_usd, 0);
  assert.equal(r.fila.abertos, 0);
  assert.deepEqual(r.alertas, []);
});

test('calcularMetricas: resolverNomesClientes preenche o nome em por_conversa', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/select modelo_runtime, limites, horario_atendimento from tab_config/, () => ({ rows: [{ modelo_runtime: 'claude-haiku-5-5', limites: {}, horario_atendimento: null }] })],
    [/count\(\*\) filter \(where bloqueada_por_filtro\)/, () => ({ rows: [{ total: 1, bloqueadas: 0, chamadas_ao_modelo: 1, aprovadas: 1, editadas: 0, descartadas: 0, conversas: 1 }] })],
    [/select modelo, coalesce\(sum\(tokens_in\)/, () => ({ rows: [{ modelo: 'claude-haiku-5-5', tin: 1000, tout: 500 }] })],
    [/select coalesce\(categoria_cobranca/, () => ({ rows: [] })],
    [/select c\.id as conversa_id, c\.telefone_e164, c\.cliente_id/, () => ({ rows: [{ conversa_id: 'conv-1', telefone_e164: '+5511999999999', cliente_id: 'cli-1', nome_whatsapp: 'Zap Nome', turnos: 1, tin: 1000, tout: 500, modelo: 'claude-haiku-5-5', msgs_enviadas: 1 }] })],
    [/with h as \(/, () => ({ rows: [{ total: 0, respondidos: 0, media_min: null, mediana_min: null }] })],
    [/select count\(\*\)::int as abertos/, () => ({ rows: [{ abertos: 0, mais_antigo_min: 0 }] })],
    [/select coalesce\(sum\(coalesce\(tokens_in, 0\) \+ coalesce\(tokens_out, 0\)\), 0\)::bigint as n from tab_execucoes/, () => ({ rows: [{ n: 1500 }] })],
  ]);
  const resolverNomesClientes = async (_p, _t, ids) => new Map(ids.map((id) => [id, 'Nome Cadastrado']));
  const r = await agenteCore.calcularMetricas(pool, 't1', { resolverNomesClientes });
  assert.equal(r.por_conversa[0].nome, 'Nome Cadastrado');
});
