// Atendimento: o que a equipe faz com as conversas do agente — ver,
// aprovar/editar/descartar a sugestão (modo rascunho), assumir, responder,
// devolver ao agente. Toda função recebe o tenant do servidor (nunca do
// cliente) e filtra por ele. Portado de kyvvo-crm/lib/agente/atendimento.js.
//
// O que NÃO está aqui (fica no produto consumidor, ver README):
//  - rótulos de "motivo" de handoff (vocabulário de negócio de cada produto)
//  - nome da cliente (resolvido via `resolverNomesClientes`, nunca por um
//    join fixo com uma tabela de clientes que este pacote não conhece)
//  - qualquer coisa de "pedido" (o CRM compõe isso por cima de
//    `obterConversaBase`; outro produto pode não ter esse conceito)
//  - o log de auditoria (`crm_eventos` no CRM) — cada função devolve
//    `clienteId` (e o que mais for preciso) pra quem chama registrar o
//    próprio evento, sem precisar reconsultar
class ErroAtendimento extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const SITUACOES = ['bot', 'aguardando_equipe', 'humano', 'encerrada'];
const TEXTO_MAX = 4000;

function limparTexto(t) {
  const texto = String(t || '').trim();
  if (!texto) throw new ErroAtendimento(400, 'Escreva a mensagem antes de enviar');
  if (texto.length > TEXTO_MAX) throw new ErroAtendimento(400, `Mensagem longa demais (máximo ${TEXTO_MAX} caracteres)`);
  return texto;
}

async function resolverNomes(resolverNomesClientes, pool, tenantId, ids) {
  if (!resolverNomesClientes || ids.length === 0) return new Map();
  return resolverNomesClientes(pool, tenantId, ids);
}

function criarAtendimento({ tabelas }) {
  async function conversaDoTenant(pool, tenantId, id) {
    const { rows } = await pool.query(`select * from ${tabelas.conversas} where tenant_id = $1 and id = $2`, [tenantId, id]);
    if (!rows[0]) throw new ErroAtendimento(404, 'Conversa não encontrada');
    return rows[0];
  }

  // Só conversas que o agente (ou a equipe) já tocou: um bot/fluxo anterior não aparece aqui.
  const SO_AGENTE = (alias) => `exists (select 1 from ${tabelas.mensagens} m where m.tenant_id = ${alias}.tenant_id and m.telefone_e164 = ${alias}.telefone_e164 and m.autor is not null)`;

  async function listarConversas(pool, tenantId, { situacao = 'todas', resolverNomesClientes } = {}) {
    const filtro = SITUACOES.includes(situacao) ? 'and c.situacao = $2' : 'and $2::text is not null';
    const { rows } = await pool.query(
      `select c.id, c.telefone_e164, c.situacao, c.janela_expira_em, c.ultima_msg_cliente_em, c.cliente_id, c.nome_whatsapp,
              lm.conteudo as ultima_mensagem, lm.direcao as ultima_direcao, lm.autor as ultimo_autor, lm.criado_em as ultima_em,
              h.id as handoff_id, h.motivo as handoff_motivo, h.resumo as handoff_resumo, h.eh_vip, h.status as handoff_status, h.criado_em as handoff_em,
              (s.id is not null) as sugestao_pendente
         from ${tabelas.conversas} c
         left join lateral (select conteudo, direcao, autor, criado_em from ${tabelas.mensagens} m
                             where m.tenant_id = c.tenant_id and m.telefone_e164 = c.telefone_e164 order by criado_em desc, id desc limit 1) lm on true
         left join lateral (select id, motivo, resumo, eh_vip, status, criado_em from ${tabelas.handoffs} h
                             where h.tenant_id = c.tenant_id and h.conversa_id = c.id and h.status in ('aberto', 'assumido') order by (h.status = 'aberto') desc, criado_em desc limit 1) h on true
         left join lateral (select id from ${tabelas.execucoes} e
                             where e.tenant_id = c.tenant_id and e.conversa_id = c.id and e.decisao is null and e.resposta_enviada is null and e.resposta_proposta is not null
                               and not exists (select 1 from ${tabelas.execucoes} e2 where e2.tenant_id = e.tenant_id and e2.conversa_id = e.conversa_id and e2.criado_em > e.criado_em)
                             limit 1) s on true
        where c.tenant_id = $1 ${filtro} and ${SO_AGENTE('c')}
        order by (h.status = 'aberto') desc nulls last, h.eh_vip desc nulls last, coalesce(lm.criado_em, c.atualizado_em) desc
        limit 200`,
      [tenantId, SITUACOES.includes(situacao) ? situacao : 'todas'],
    );
    const nomes = await resolverNomes(resolverNomesClientes, pool, tenantId, [...new Set(rows.map((r) => r.cliente_id).filter(Boolean))]);
    return rows.map((r) => ({
      ...r,
      cliente_nome: (nomes.get(r.cliente_id) && nomes.get(r.cliente_id) !== 'Sem nome' ? nomes.get(r.cliente_id) : null) || r.nome_whatsapp,
    }));
  }

  // Conversa + mensagens + sugestão pendente + handoff — SEM bloco de pedido
  // (o produto consumidor compõe isso por cima, se tiver esse conceito).
  async function obterConversaBase(pool, tenantId, id, { resolverNomesClientes } = {}) {
    const c = await conversaDoTenant(pool, tenantId, id);
    const nomes = await resolverNomes(resolverNomesClientes, pool, tenantId, c.cliente_id ? [c.cliente_id] : []);
    const { rows: mensagens } = await pool.query(
      `select m.id, m.direcao, m.autor, m.tipo, m.conteudo, m.criado_em, m.status_entrega,
              a.id as anexo_id, a.nome_arquivo as anexo_nome, a.mime as anexo_mime, a.tamanho as anexo_tamanho
         from ${tabelas.mensagens} m left join ${tabelas.anexos} a on a.id = m.anexo_id and a.tenant_id = m.tenant_id
        where m.tenant_id = $1 and m.telefone_e164 = $2 order by m.criado_em, m.id`, [tenantId, c.telefone_e164]);
    const { rows: [sug] } = await pool.query(
      `select id, resposta_proposta, resposta_original, bloqueada_por_filtro, motivo_bloqueio, ferramentas_chamadas, criado_em
         from ${tabelas.execucoes} e
        where e.tenant_id = $1 and e.conversa_id = $2 and e.decisao is null and e.resposta_enviada is null and e.resposta_proposta is not null
          and not exists (select 1 from ${tabelas.execucoes} e2 where e2.tenant_id = e.tenant_id and e2.conversa_id = e.conversa_id and e2.criado_em > e.criado_em)
        limit 1`, [tenantId, id]);
    const { rows: [handoff] } = await pool.query(
      `select id, motivo, resumo, dados_coletados, eh_vip, status, criado_em from ${tabelas.handoffs}
        where tenant_id = $1 and conversa_id = $2 and status in ('aberto', 'assumido') order by (status = 'aberto') desc, criado_em desc limit 1`, [tenantId, id]);
    const nomeResolvido = nomes.get(c.cliente_id);
    return {
      conversa: {
        id: c.id, telefone: c.telefone_e164, situacao: c.situacao, janela_expira_em: c.janela_expira_em,
        janela_aberta: !!c.janela_expira_em && new Date(c.janela_expira_em) > new Date(), cliente_id: c.cliente_id,
        cliente_nome: (nomeResolvido && nomeResolvido !== 'Sem nome' ? nomeResolvido : null) || c.nome_whatsapp,
      },
      mensagens,
      sugestao: sug ? {
        execucao_id: sug.id, texto: sug.resposta_proposta, bloqueada: sug.bloqueada_por_filtro, motivo_bloqueio: sug.motivo_bloqueio,
        original: sug.resposta_original, criada_em: sug.criado_em,
      } : null,
      handoff: handoff || null,
    };
  }

  async function numeroDoCanal(pool, tenantId) {
    const { rows } = await pool.query(`select phone_number_id from ${tabelas.numeros} where tenant_id = $1 and status = 'ativo' order by criado_em limit 1`, [tenantId]);
    if (!rows[0]) throw new ErroAtendimento(409, 'Nenhum número de WhatsApp conectado a esta conta');
    return rows[0].phone_number_id;
  }

  // Envia texto livre pela Cloud API (só dentro da janela de 24 h) e registra a mensagem.
  async function enviarPeloCanal(pool, tenantId, conversa, texto, autor, { agora, enviarTexto }) {
    if (!conversa.janela_expira_em || new Date(conversa.janela_expira_em) <= (agora ? agora() : new Date())) {
      throw new ErroAtendimento(409, 'A janela de 24 h desta conversa expirou: só dá para responder quando a cliente escrever de novo');
    }
    const phoneNumberId = await numeroDoCanal(pool, tenantId);
    const ok = await enviarTexto({ to: conversa.telefone_e164, texto, phoneNumberId });
    if (!ok) throw new ErroAtendimento(502, 'Não foi possível enviar pelo WhatsApp agora. Tente novamente');
    const { rows: [m] } = await pool.query(
      `insert into ${tabelas.mensagens} (tenant_id, telefone_e164, direcao, tipo, conteudo, autor, processada_em)
       values ($1, $2, 'enviada', 'texto', $3, $4, now()) returning id`, [tenantId, conversa.telefone_e164, texto, autor]);
    return m.id;
  }

  async function descartarSugestoesPendentes(pool, tenantId, conversaId) {
    await pool.query(
      `update ${tabelas.execucoes} set decisao = 'descartada', decidida_em = now()
        where tenant_id = $1 and conversa_id = $2 and decisao is null and resposta_enviada is null and resposta_proposta is not null`, [tenantId, conversaId]);
  }

  // Aprovar (sem edição) ou editar e enviar a sugestão do agente.
  async function enviarSugestao(pool, tenantId, execucaoId, texto, deps) {
    const { rows: [e] } = await pool.query(`select * from ${tabelas.execucoes} where tenant_id = $1 and id = $2`, [tenantId, execucaoId]);
    if (!e) throw new ErroAtendimento(404, 'Sugestão não encontrada');
    if (e.decisao || e.resposta_enviada) throw new ErroAtendimento(409, 'Esta sugestão já foi tratada');
    const conversa = await conversaDoTenant(pool, tenantId, e.conversa_id);
    const final = limparTexto(texto === undefined || texto === null ? e.resposta_proposta : texto);
    const editada = final !== String(e.resposta_proposta || '').trim();
    await enviarPeloCanal(pool, tenantId, conversa, final, editada ? 'humano' : 'agente', deps);
    await pool.query(
      `update ${tabelas.execucoes} set decisao = $3, resposta_enviada = $4, decidida_em = now() where tenant_id = $1 and id = $2`,
      [tenantId, execucaoId, editada ? 'editada' : 'aprovada', final]);
    return { ok: true, decisao: editada ? 'editada' : 'aprovada', conversaId: e.conversa_id, clienteId: conversa.cliente_id };
  }

  async function descartarSugestao(pool, tenantId, execucaoId) {
    const { rows: [e] } = await pool.query(`select * from ${tabelas.execucoes} where tenant_id = $1 and id = $2`, [tenantId, execucaoId]);
    if (!e) throw new ErroAtendimento(404, 'Sugestão não encontrada');
    if (e.decisao || e.resposta_enviada) throw new ErroAtendimento(409, 'Esta sugestão já foi tratada');
    await pool.query(`update ${tabelas.execucoes} set decisao = 'descartada', decidida_em = now() where tenant_id = $1 and id = $2`, [tenantId, execucaoId]);
    const conversa = await conversaDoTenant(pool, tenantId, e.conversa_id);
    return { ok: true, conversaId: e.conversa_id, clienteId: conversa.cliente_id };
  }

  // A equipe assume: o agente fica em silêncio nesta conversa até ser devolvida.
  async function assumir(pool, tenantId, userId, conversaId) {
    const conversa = await conversaDoTenant(pool, tenantId, conversaId);
    await pool.query(`update ${tabelas.conversas} set situacao = 'humano', pausada_ate = null, atualizado_em = now() where tenant_id = $1 and id = $2`, [tenantId, conversaId]);
    await pool.query(
      `update ${tabelas.handoffs} set status = 'assumido', atribuido_a = $3, atualizado_em = now() where tenant_id = $1 and conversa_id = $2 and status = 'aberto'`, [tenantId, conversaId, userId || null]);
    await descartarSugestoesPendentes(pool, tenantId, conversaId);
    return { ok: true, situacao: 'humano', clienteId: conversa.cliente_id };
  }

  // Resposta escrita pela equipe: também assume a conversa (o agente pausa).
  async function responderComoHumano(pool, tenantId, userId, conversaId, texto, deps) {
    const conversa = await conversaDoTenant(pool, tenantId, conversaId);
    const final = limparTexto(texto);
    await enviarPeloCanal(pool, tenantId, conversa, final, 'humano', deps);
    const r = await assumir(pool, tenantId, userId, conversaId);
    return { ok: true, clienteId: r.clienteId };
  }

  async function devolverAoAgente(pool, tenantId, conversaId) {
    const conversa = await conversaDoTenant(pool, tenantId, conversaId);
    // Zera a contagem de limite de turnos (ver executor.js#maxTurnos) — sem
    // isso, uma conversa que já passou do limite uma vez fica travada em
    // handoff pra sempre, mesmo depois de a equipe devolver pro agente.
    await pool.query(`update ${tabelas.conversas} set situacao = 'bot', pausada_ate = null, turnos_contados_desde = now(), atualizado_em = now() where tenant_id = $1 and id = $2`, [tenantId, conversaId]);
    await pool.query(`update ${tabelas.handoffs} set status = 'resolvido', atualizado_em = now() where tenant_id = $1 and conversa_id = $2 and status in ('aberto', 'assumido')`, [tenantId, conversaId]);
    return { ok: true, situacao: 'bot', clienteId: conversa.cliente_id };
  }

  async function encerrar(pool, tenantId, conversaId) {
    const conversa = await conversaDoTenant(pool, tenantId, conversaId);
    await pool.query(`update ${tabelas.conversas} set situacao = 'encerrada', atualizado_em = now() where tenant_id = $1 and id = $2`, [tenantId, conversaId]);
    await pool.query(`update ${tabelas.handoffs} set status = 'resolvido', atualizado_em = now() where tenant_id = $1 and conversa_id = $2 and status in ('aberto', 'assumido')`, [tenantId, conversaId]);
    await descartarSugestoesPendentes(pool, tenantId, conversaId);
    return { ok: true, situacao: 'encerrada', clienteId: conversa.cliente_id };
  }

  // Encaminhamentos abertos: VIP primeiro, depois o que espera há mais tempo.
  async function listarEncaminhamentos(pool, tenantId, limite = 30, { resolverNomesClientes } = {}) {
    const { rows } = await pool.query(
      `select h.id, h.conversa_id, h.motivo, h.resumo, h.eh_vip, h.criado_em, h.cliente_id,
              c.nome_whatsapp, c.telefone_e164 as telefone,
              floor(extract(epoch from (now() - h.criado_em)) / 60)::int as minutos_esperando
         from ${tabelas.handoffs} h join ${tabelas.conversas} c on c.tenant_id = h.tenant_id and c.id = h.conversa_id
        where h.tenant_id = $1 and h.status = 'aberto'
        order by h.eh_vip desc, h.criado_em asc limit $2`, [tenantId, limite],
    );
    const nomes = await resolverNomes(resolverNomesClientes, pool, tenantId, [...new Set(rows.map((r) => r.cliente_id).filter(Boolean))]);
    return rows.map((r) => ({
      ...r,
      cliente_nome: (nomes.get(r.cliente_id) && nomes.get(r.cliente_id) !== 'Sem nome' ? nomes.get(r.cliente_id) : null) || r.nome_whatsapp || r.telefone,
    }));
  }

  async function contarAbertos(pool, tenantId) {
    const { rows: [r] } = await pool.query(`select count(*)::int as n from ${tabelas.handoffs} where tenant_id = $1 and status = 'aberto'`, [tenantId]);
    return r.n;
  }

  async function obterConfig(pool, tenantId) {
    const { rows: [c] } = await pool.query(`select modo, modelo_runtime, horario_atendimento from ${tabelas.config} where tenant_id = $1`, [tenantId]);
    return c ? { configurado: true, ...c } : { configurado: false, modo: 'desligado' };
  }

  // Chave de liga/desliga: só o modo. O resto da configuração vem do seed por conta.
  async function definirModo(pool, tenantId, modo) {
    if (!['desligado', 'rascunho', 'automatico'].includes(modo)) throw new ErroAtendimento(400, 'Modo inválido');
    const { rowCount } = await pool.query(`update ${tabelas.config} set modo = $2, atualizado_em = now() where tenant_id = $1`, [tenantId, modo]);
    if (!rowCount) throw new ErroAtendimento(409, 'O agente ainda não foi configurado para esta conta');
    return { ok: true, modo };
  }

  // Chamada pelas ferramentas do produto (ex.: "transferir_para_equipe") — só
  // o `insert`/`update` genérico do handoff. `dadosColetados`/`ehVip`/
  // `pedidoId` são resolvidos pelo produto antes de chamar (consultam o
  // próprio schema de negócio, que este pacote não conhece).
  async function gravarHandoff(pool, { tenantId, conversaId, clienteId, pedidoId, motivo, resumo, dadosColetados, ehVip }) {
    await pool.query(
      `insert into ${tabelas.handoffs} (tenant_id, conversa_id, cliente_id, pedido_id, motivo, resumo, dados_coletados, eh_vip)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (tenant_id, conversa_id) where status = 'aberto' do update set
         motivo = excluded.motivo, resumo = excluded.resumo, dados_coletados = excluded.dados_coletados,
         pedido_id = coalesce(excluded.pedido_id, ${tabelas.handoffs}.pedido_id), eh_vip = excluded.eh_vip, atualizado_em = now()`,
      [tenantId, conversaId, clienteId || null, pedidoId || null, motivo, resumo, JSON.stringify(dadosColetados || {}), !!ehVip],
    );
    await pool.query(
      `update ${tabelas.conversas} set situacao = 'aguardando_equipe', atualizado_em = now() where tenant_id = $1 and id = $2 and situacao in ('bot', 'encerrada')`,
      [tenantId, conversaId],
    );
  }

  return {
    ErroAtendimento, listarConversas, obterConversaBase, enviarSugestao, descartarSugestao, assumir,
    responderComoHumano, devolverAoAgente, encerrar, listarEncaminhamentos, contarAbertos, obterConfig,
    definirModo, gravarHandoff,
  };
}

module.exports = criarAtendimento;
module.exports.ErroAtendimento = ErroAtendimento;
