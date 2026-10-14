// Monta o que o modelo enxerga: histórico recente (sem CPF/CNPJ) e as
// camadas fixas de conhecimento (voz/regras/fluxo/casos/respostas). O bloco
// de contexto DINÂMICO (dados da conversa específicos do domínio do
// produto — pedido em aberto, agenda, etc.) NÃO mora aqui: é contrato, não
// implementação (ver `blocoDinamico` em src/executor.js). Portado de
// kyvvo-crm/lib/agente/contexto.js, bindado por `tabelas.conhecimento`/
// `tabelas.mensagens` em vez de nomes fixos.
const { higienizarEntrada } = require('./posfiltro');

const ORDEM_CONHECIMENTO = ['voz', 'regras', 'fluxo', 'casos', 'respostas'];
const HISTORICO_MAX_PADRAO = 30;

function montarSystem({ sistema, base, dinamico }) {
  const blocos = [{ type: 'text', text: sistema }];
  if (base) blocos.push({ type: 'text', text: `Base de conhecimento da conta:\n\n${base}`, cache_control: { type: 'ephemeral' } });
  else blocos[0].cache_control = { type: 'ephemeral' };
  blocos.push({ type: 'text', text: dinamico });
  return blocos;
}

function criarContexto({ tabelas }) {
  async function carregarConhecimento(pool, tenantId) {
    const { rows } = await pool.query(
      `select tipo, conteudo_md from ${tabelas.conhecimento} where tenant_id = $1 and ativo`, [tenantId]);
    const porTipo = Object.fromEntries(rows.map((r) => [r.tipo, r.conteudo_md]));
    return {
      sistema: porTipo.sistema || '',
      base: ORDEM_CONHECIMENTO.filter((t) => porTipo[t]).map((t) => `<${t}>\n${porTipo[t]}\n</${t}>`).join('\n\n'),
    };
  }

  // `rotuloAnexo`: como descrever uma mídia já anexada no histórico (CRM diz
  // "anexado ao pedido"; o padrão genérico serve pra quem não tiver o
  // conceito de pedido).
  function textoDaMensagem(m, { rotuloAnexo = 'recebido e anexado' } = {}) {
    if ((m.tipo === 'imagem' || m.tipo === 'documento') && m.anexo_id) {
      const legenda = m.conteudo && !m.conteudo.startsWith('[') ? ` Legenda: ${m.conteudo}` : '';
      return `[${m.tipo} ${rotuloAnexo}]${legenda}`;
    }
    if (['audio', 'video', 'localizacao', 'figurinha'].includes(m.tipo)) return `[a cliente enviou ${m.tipo}, que não é interpretado]`;
    return higienizarEntrada(m.conteudo);
  }

  // Histórico -> messages da API: user/assistant alternando, começando por user.
  async function carregarHistorico(pool, tenantId, telefone, { historicoMax = HISTORICO_MAX_PADRAO, rotuloAnexo } = {}) {
    const { rows } = await pool.query(
      `select direcao, tipo, conteudo, anexo_id from ${tabelas.mensagens}
        where tenant_id = $1 and telefone_e164 = $2 and direcao in ('recebida', 'enviada')
        order by criado_em desc, id desc limit $3`, [tenantId, telefone, historicoMax]);
    const out = [];
    for (const m of rows.reverse()) {
      const role = m.direcao === 'recebida' ? 'user' : 'assistant';
      const texto = textoDaMensagem(m, { rotuloAnexo });
      if (!texto) continue;
      if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n${texto}`;
      else out.push({ role, content: texto });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
  }

  return { carregarConhecimento, carregarHistorico, montarSystem, textoDaMensagem };
}

module.exports = criarContexto;
