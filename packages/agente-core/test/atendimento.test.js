const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAgenteCore } = require('..');
const { criarPoolFake } = require('./_mockPool');

const TABELAS = {
  config: 'tab_config', conhecimento: 'tab_conhecimento', conversas: 'tab_conversas',
  mensagens: 'tab_mensagens', execucoes: 'tab_execucoes', handoffs: 'tab_handoffs',
  numeros: 'tab_numeros', anexos: 'tab_anexos', clientes: 'tab_clientes',
};

test('definirModo: modo inválido lança ErroAtendimento 400', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([]);
  await assert.rejects(
    () => agenteCore.atendimento.definirModo(pool, 't1', 'modo-que-nao-existe'),
    (e) => e instanceof agenteCore.atendimento.ErroAtendimento && e.status === 400,
  );
});

test('definirModo: conta sem config -> ErroAtendimento 409', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([[/update tab_config set modo/, () => ({ rowCount: 0 })]]);
  await assert.rejects(
    () => agenteCore.atendimento.definirModo(pool, 't1', 'automatico'),
    (e) => e instanceof agenteCore.atendimento.ErroAtendimento && e.status === 409,
  );
});

test('definirModo: sucesso', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([[/update tab_config set modo/, () => ({ rowCount: 1 })]]);
  const r = await agenteCore.atendimento.definirModo(pool, 't1', 'automatico');
  assert.deepEqual(r, { ok: true, modo: 'automatico' });
});

test('conversa inexistente -> ErroAtendimento 404 em qualquer ação que dependa dela', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([[/select \* from tab_conversas/, () => ({ rows: [] })]]);
  await assert.rejects(
    () => agenteCore.atendimento.assumir(pool, 't1', 'user1', 'conv-inexistente'),
    (e) => e instanceof agenteCore.atendimento.ErroAtendimento && e.status === 404,
  );
});

test('assumir: pausa o agente, assume o handoff e descarta sugestões pendentes', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const chamadas = [];
  const pool = criarPoolFake([
    [/select \* from tab_conversas/, () => ({ rows: [{ id: 'conv-1', cliente_id: 'cli-1' }] })],
    [/update tab_conversas set situacao = 'humano'/, (sql) => { chamadas.push('conversa->humano'); return { rows: [] }; }],
    [/update tab_handoffs set status = 'assumido'/, () => { chamadas.push('handoff->assumido'); return { rows: [] }; }],
    [/update tab_execucoes set decisao = 'descartada'/, () => { chamadas.push('sugestoes->descartadas'); return { rows: [] }; }],
  ]);
  const r = await agenteCore.atendimento.assumir(pool, 't1', 'user1', 'conv-1');
  assert.deepEqual(r, { ok: true, situacao: 'humano', clienteId: 'cli-1' });
  assert.deepEqual(chamadas, ['conversa->humano', 'handoff->assumido', 'sugestoes->descartadas']);
});

test('enviarSugestao: sugestão já tratada -> ErroAtendimento 409', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/select \* from tab_execucoes where tenant_id = \$1 and id = \$2/, () => ({ rows: [{ id: 'exec-1', decisao: 'aprovada', conversa_id: 'conv-1', resposta_proposta: 'oi' }] })],
  ]);
  await assert.rejects(
    () => agenteCore.atendimento.enviarSugestao(pool, 't1', 'exec-1', null, {}),
    (e) => e instanceof agenteCore.atendimento.ErroAtendimento && e.status === 409,
  );
});

test('enviarSugestao: aprovar sem edição vs editar — autor muda, decisão muda', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  let autorGravado = null;
  function pool() {
    return criarPoolFake([
      [/select \* from tab_execucoes where tenant_id = \$1 and id = \$2/, () => ({ rows: [{ id: 'exec-1', decisao: null, resposta_enviada: null, conversa_id: 'conv-1', resposta_proposta: 'Resposta original' }] })],
      [/select \* from tab_conversas/, () => ({ rows: [{ id: 'conv-1', cliente_id: 'cli-1', telefone_e164: '+5511999999999', janela_expira_em: '2999-01-01T00:00:00Z' }] })],
      [/select phone_number_id from tab_numeros/, () => ({ rows: [{ phone_number_id: '123' }] })],
      [/insert into tab_mensagens/, (sql, params) => { autorGravado = params[3]; return { rows: [{ id: 'msg-1' }] }; }],
      [/update tab_execucoes set decisao/, () => ({ rows: [] })],
    ]);
  }
  const deps = { agora: () => new Date('2020-01-01'), enviarTexto: async () => true };

  const aprovada = await agenteCore.atendimento.enviarSugestao(pool(), 't1', 'exec-1', null, deps);
  assert.equal(aprovada.decisao, 'aprovada');
  assert.equal(autorGravado, 'agente');

  const editada = await agenteCore.atendimento.enviarSugestao(pool(), 't1', 'exec-1', 'Resposta editada pela equipe', deps);
  assert.equal(editada.decisao, 'editada');
  assert.equal(autorGravado, 'humano');
});

test('enviarPeloCanal (via enviarSugestao): janela expirada -> ErroAtendimento 409', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const pool = criarPoolFake([
    [/select \* from tab_execucoes where tenant_id = \$1 and id = \$2/, () => ({ rows: [{ id: 'exec-1', decisao: null, resposta_enviada: null, conversa_id: 'conv-1', resposta_proposta: 'oi' }] })],
    [/select \* from tab_conversas/, () => ({ rows: [{ id: 'conv-1', cliente_id: 'cli-1', telefone_e164: '+5511999999999', janela_expira_em: '2000-01-01T00:00:00Z' }] })],
  ]);
  await assert.rejects(
    () => agenteCore.atendimento.enviarSugestao(pool, 't1', 'exec-1', null, { agora: () => new Date('2026-01-01'), enviarTexto: async () => true }),
    (e) => e instanceof agenteCore.atendimento.ErroAtendimento && e.status === 409,
  );
});

test('gravarHandoff: insere o handoff e move a conversa pra aguardando_equipe', async () => {
  const agenteCore = criarAgenteCore({ tabelas: TABELAS });
  const chamadas = [];
  const pool = criarPoolFake([
    [/insert into tab_handoffs/, (sql, params) => { chamadas.push({ sql: 'insert-handoff', params }); return { rows: [] }; }],
    [/update tab_conversas set situacao = 'aguardando_equipe'/, () => { chamadas.push({ sql: 'update-conversa' }); return { rows: [] }; }],
  ]);
  await agenteCore.gravarHandoff(pool, { tenantId: 't1', conversaId: 'conv-1', clienteId: 'cli-1', pedidoId: null, motivo: 'urgencia', resumo: 'resumo', dadosColetados: { a: 1 }, ehVip: false });
  assert.equal(chamadas.length, 2);
  assert.deepEqual(chamadas[0].params, ['t1', 'conv-1', 'cli-1', null, 'urgencia', 'resumo', JSON.stringify({ a: 1 }), false]);
});
