const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAgenteCore } = require('..');
const { criarPoolFake } = require('./_mockPool');

const TABELAS = {
  config: 'tab_config', conhecimento: 'tab_conhecimento', conversas: 'tab_conversas',
  mensagens: 'tab_mensagens', execucoes: 'tab_execucoes', handoffs: 'tab_handoffs',
  numeros: 'tab_numeros', anexos: 'tab_anexos', clientes: 'tab_clientes',
};

const AGORA_DENTRO_HORARIO = () => new Date('2026-01-14T15:00:00Z'); // 12:00 em São Paulo

function configBase(overrides = {}) {
  return { modo: 'rascunho', textos: {}, limites: {}, horario_atendimento: null, modelo_runtime: 'claude-haiku-5-5', ...overrides };
}

function poolPadrao({ config = configBase(), historico = [{ direcao: 'recebida', tipo: 'texto', conteudo: 'oi', anexo_id: null }] } = {}) {
  return criarPoolFake([
    [/select \* from tab_config/, () => ({ rows: [config] })],
    [/select count\(\*\)::int as n from tab_mensagens.*direcao = 'recebida'/s, () => ({ rows: [{ n: 0 }] })],
    [/select count\(\*\)::int as n from tab_execucoes/, () => ({ rows: [{ n: 0 }] })],
    [/select tipo, conteudo_md from tab_conhecimento/, () => ({ rows: [] })],
    [/select direcao, tipo, conteudo, anexo_id from tab_mensagens/, () => ({ rows: historico })],
    [/select 1 from tab_handoffs/, () => ({ rows: [] })],
    [/insert into tab_execucoes/, () => ({ rows: [{ id: 'exec-1' }] })],
    [/insert into tab_mensagens/, () => ({ rows: [{ id: 'msg-1' }] })],
    [/select phone_number_id from tab_numeros/, () => ({ rows: [{ phone_number_id: '123' }] })],
  ]);
}

function depsBase(overrides = {}) {
  const chamadasFerramenta = [];
  return {
    agora: AGORA_DENTRO_HORARIO,
    enviarTexto: async () => true,
    ia: { criarMensagem: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: 'Oi! Como posso ajudar?' }] }) },
    ferramentas: {
      FERRAMENTAS: [],
      executarFerramenta: async (...a) => { chamadasFerramenta.push(a); return {}; },
      anexarMidia: async () => 0,
      transferirParaEquipe: async (pool, ctx) => { ctx.estado.transferiu = true; },
    },
    blocoDinamico: async () => 'contexto dinâmico de teste',
    posfiltro: { padroes: [] },
    gatilhos: { padroes: [], comercial: /nunca-vai-bater-isso/ },
    _chamadasFerramenta: chamadasFerramenta,
    ...overrides,
  };
}

test('executarTurno: deps.agora ausente (undefined) lança erro nomeado — regressão direta do incidente de 2026-10-13', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao();
  const deps = depsBase({ agora: undefined });
  await assert.rejects(
    () => agenteCore.executarTurno({ pool, tenantId: 't1', conversa: { id: 'c1', telefone_e164: '+5511999999999' }, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'oi' }] }, deps),
    /deps\.agora é obrigatório \(recebido undefined\)/,
  );
});

test('executarTurno: deps.enviarTexto ausente (undefined) lança erro nomeado', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao();
  const deps = depsBase({ enviarTexto: undefined });
  await assert.rejects(
    () => agenteCore.executarTurno({ pool, tenantId: 't1', conversa: { id: 'c1', telefone_e164: '+5511999999999' }, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'oi' }] }, deps),
    /deps\.enviarTexto é obrigatório/,
  );
});

test('executarTurno: deps.ferramentas ausente lança erro', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao();
  const deps = depsBase({ ferramentas: undefined });
  await assert.rejects(
    () => agenteCore.executarTurno({ pool, tenantId: 't1', conversa: { id: 'c1', telefone_e164: '+5511999999999' }, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'oi' }] }, deps),
    /deps\.ferramentas é obrigatório/,
  );
});

test('executarTurno: deps.posfiltro.padroes ausente lança erro', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao();
  const deps = depsBase({ posfiltro: {} });
  await assert.rejects(
    () => agenteCore.executarTurno({ pool, tenantId: 't1', conversa: { id: 'c1', telefone_e164: '+5511999999999' }, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'oi' }] }, deps),
    /deps\.posfiltro\.padroes é obrigatório/,
  );
});

test('executarTurno: deps.gatilhos.comercial ausente/não-RegExp lança erro', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao();
  const deps = depsBase({ gatilhos: { padroes: [] } });
  await assert.rejects(
    () => agenteCore.executarTurno({ pool, tenantId: 't1', conversa: { id: 'c1', telefone_e164: '+5511999999999' }, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'oi' }] }, deps),
    /deps\.gatilhos\.comercial é obrigatório/,
  );
});

test('executarTurno: modo desligado -> ignorado, sem chamar o modelo', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao({ config: configBase({ modo: 'desligado' }) });
  const deps = depsBase();
  const r = await agenteCore.executarTurno({ pool, tenantId: 't1', conversa: { id: 'c1', telefone_e164: '+5511999999999' }, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'oi' }] }, deps);
  assert.deepEqual(r, { ignorado: true });
});

test('executarTurno: feliz, modo rascunho -> gera resposta mas não envia', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao();
  const deps = depsBase();
  const r = await agenteCore.executarTurno({ pool, tenantId: 't1', conversa: { id: 'c1', telefone_e164: '+5511999999999' }, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'oi' }] }, deps);
  assert.equal(r.enviada, null);
  assert.equal(r.bloqueada, false);
  assert.equal(r.resposta, 'Oi! Como posso ajudar?');
  assert.equal(r.execucaoId, 'exec-1');
});

test('executarTurno: modo automatico dentro da janela -> envia de verdade', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao({ config: configBase({ modo: 'automatico' }) });
  const deps = depsBase();
  const conversa = { id: 'c1', telefone_e164: '+5511999999999', janela_expira_em: new Date('2026-01-15T00:00:00Z') };
  const r = await agenteCore.executarTurno({ pool, tenantId: 't1', conversa, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'oi' }] }, deps);
  assert.equal(r.enviada, 'Oi! Como posso ajudar?');
});

test('executarTurno: modo automatico fora da janela -> não envia', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao({ config: configBase({ modo: 'automatico' }) });
  const deps = depsBase();
  const conversa = { id: 'c1', telefone_e164: '+5511999999999', janela_expira_em: new Date('2026-01-10T00:00:00Z') }; // já expirou
  const r = await agenteCore.executarTurno({ pool, tenantId: 't1', conversa, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'oi' }] }, deps);
  assert.equal(r.enviada, null);
});

test('executarTurno: gatilho do produto detecta e força encaminhamento', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao();
  let transferiuMotivo = null;
  const deps = depsBase({
    gatilhos: { padroes: [['pedido_humano', /atendente/]], comercial: /nunca-vai-bater/ },
    ferramentas: {
      FERRAMENTAS: [],
      executarFerramenta: async () => ({}),
      anexarMidia: async () => 0,
      transferirParaEquipe: async (pool2, ctx, { motivo }) => { ctx.estado.transferiu = true; transferiuMotivo = motivo; },
    },
  });
  await agenteCore.executarTurno({ pool, tenantId: 't1', conversa: { id: 'c1', telefone_e164: '+5511999999999' }, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'quero falar com atendente' }] }, deps);
  assert.equal(transferiuMotivo, 'pedido_humano');
});

test('executarTurno: pós-filtro bloqueia resposta sensível e aciona encaminhamento', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao();
  let transferiuMotivo = null;
  const deps = depsBase({
    ia: { criarMensagem: async () => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'Fica R$ 50,00' }] }) },
    posfiltro: { padroes: [['valor_monetario', /r\s*\$/]] },
    ferramentas: {
      FERRAMENTAS: [],
      executarFerramenta: async () => ({}),
      anexarMidia: async () => 0,
      transferirParaEquipe: async (pool2, ctx, { motivo }) => { ctx.estado.transferiu = true; transferiuMotivo = motivo; },
    },
  });
  const r = await agenteCore.executarTurno({ pool, tenantId: 't1', conversa: { id: 'c1', telefone_e164: '+5511999999999' }, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'quanto custa' }] }, deps);
  assert.equal(r.bloqueada, true);
  assert.equal(transferiuMotivo, 'bloqueio_filtro');
  assert.notEqual(r.resposta, 'Fica R$ 50,00');
});

test('executarTurno: gatilhos.extras chama a ferramenta certa quando extrair() acha algo', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = poolPadrao();
  const chamadas = [];
  const deps = depsBase({
    gatilhos: {
      padroes: [], comercial: /nunca-vai-bater/,
      extras: [{ ferramenta: 'registrar_id_shopee', extrair: (texto) => (/\bID123456\b/.test(texto) ? 'ID123456' : null), montarInput: (v) => ({ id_pedido: v }) }],
    },
    ferramentas: {
      FERRAMENTAS: [],
      executarFerramenta: async (pool2, ctx, nome, input) => { chamadas.push({ nome, input }); return {}; },
      anexarMidia: async () => 0,
      transferirParaEquipe: async (pool2, ctx) => { ctx.estado.transferiu = true; },
    },
  });
  await agenteCore.executarTurno({ pool, tenantId: 't1', conversa: { id: 'c1', telefone_e164: '+5511999999999' }, mensagens: [{ id: 1, tipo: 'texto', conteudo: 'meu pedido é ID123456' }] }, deps);
  assert.deepEqual(chamadas, [{ nome: 'registrar_id_shopee', input: { id_pedido: 'ID123456' } }]);
});
