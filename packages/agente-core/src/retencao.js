// Retenção de logs do agente (LGPD). `tabelas.config.retencao_logs_dias` =
// null -> não apaga nada (padrão até a conta definir). O que é expurgado:
// execuções do agente (texto proposto, texto original bloqueado, ferramentas
// e entradas). O que NÃO é: mensagens, pedidos/eventos/anexos de negócio —
// são registro do relacionamento com a cliente e seguem a retenção do
// cadastro dela, decisão de cada produto. Portado de
// kyvvo-crm/lib/agente/retencao.js, bindado por `tabelas.*`.
function criarRetencao({ tabelas }) {
  async function expurgarLogs(pool) {
    const { rows: contas } = await pool.query(
      `select tenant_id, retencao_logs_dias from ${tabelas.config} where retencao_logs_dias is not null and retencao_logs_dias > 0`);
    const resultado = [];
    for (const c of contas) {
      const { rowCount } = await pool.query(
        `delete from ${tabelas.execucoes} where tenant_id = $1 and criado_em < now() - make_interval(days => $2)`, [c.tenant_id, c.retencao_logs_dias]);
      if (rowCount) resultado.push({ tenant_id: c.tenant_id, execucoes_apagadas: rowCount });
    }
    return resultado;
  }

  return { expurgarLogs };
}

module.exports = criarRetencao;
