// Parte assíncrona do agente: roda depois do 200 do webhook e na varredura.
// Uma conversa por vez (advisory lock) para manter a ordem das mensagens. A
// "fila" é a própria tabela de mensagens (processada_em nulo). Portado de
// kyvvo-crm/lib/agente/processador.js, bindado por `tabelas.conversas`/
// `tabelas.mensagens`.
//
// Nota: este arquivo já usava desestruturação-com-default (`const { x = d }
// = deps`) para os valores de runtime, não spread incondicional — esse
// estilo é seguro mesmo se `deps.x` chegar explicitamente `undefined`
// (desestruturação aplica o default; spread, não). `midiaPermitida` é a
// exceção: obrigatório e SEM default, porque é 100% decisão do produto
// (allowlist de tipo de arquivo) — nunca foi cogitado ter um padrão
// "genérico" aqui.
const crypto = require('crypto');

const MAX_TENTATIVAS = 3;
const MIDIA_MAX_BYTES_PADRAO = 20 * 1024 * 1024;

function agenteEmPausa(conversa, agora) {
  return conversa.situacao === 'humano' || (conversa.pausada_ate && new Date(conversa.pausada_ate) > agora);
}

function criarProcessador({ tabelas }) {
  // Baixa a mídia de uma mensagem e vira anexo. Falha de mídia nunca derruba o turno.
  async function anexarMidia(pool, m, { baixarMidia, armazenamento, maxBytes, log, midiaPermitida }) {
    const info = m.midia || {};
    try {
      if (!info.mediaId) return;
      const { buffer, tipoMime } = await baixarMidia(info.mediaId, { maxBytes });
      const mime = tipoMime || info.mime;
      if (!midiaPermitida({ mime, nomeArquivo: info.nomeArquivo })) throw new Error(`tipo não permitido (${mime})`);
      if (buffer.length > maxBytes) throw new Error('acima do limite de tamanho');
      const { chave } = await armazenamento.salvar({ tenantId: m.tenant_id, nomeArquivo: info.nomeArquivo || `${info.mediaId}`, buffer });
      const { rows } = await pool.query(
        `insert into ${tabelas.anexos} (tenant_id, mensagem_id, chave_armazenamento, nome_arquivo, mime, tamanho, sha256)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [m.tenant_id, m.id, chave, info.nomeArquivo, mime, buffer.length, crypto.createHash('sha256').update(buffer).digest('hex')],
      );
      await pool.query(`update ${tabelas.mensagens} set anexo_id = $2 where tenant_id = $1 and id = $3`, [m.tenant_id, rows[0].id, m.id]);
    } catch (err) {
      log(`[agente] mídia da mensagem ${m.id} não anexada: ${err.message}`);
      await pool.query(
        `update ${tabelas.mensagens} set midia = coalesce(midia, '{}'::jsonb) || jsonb_build_object('erro', $3::text) where tenant_id = $1 and id = $2`,
        [m.tenant_id, m.id, err.message],
      );
    }
  }

  // deps.executarAgente({ pool, tenantId, conversa, mensagens }) é o ponto de
  // entrada do agente. Sem ele, o turno só registra e marca como visto.
  async function processarConversa(pool, tenantId, conversaId, deps = {}) {
    const {
      executarAgente = async () => {}, baixarMidia, armazenamento, midiaPermitida,
      agora = () => new Date(), log = console.error,
      maxBytes = Number(process.env.AGENTE_MIDIA_MAX_BYTES) || MIDIA_MAX_BYTES_PADRAO,
    } = deps;
    if (typeof midiaPermitida !== 'function') {
      throw new Error('@kyvvohq/agente-core: processarConversa — deps.midiaPermitida é obrigatório (function)');
    }

    const client = await pool.connect();
    try {
      await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [conversaId]);

      const { rows: [conversa] } = await pool.query(
        `select * from ${tabelas.conversas} where tenant_id = $1 and id = $2`, [tenantId, conversaId]);
      if (!conversa) return { processadas: 0 };

      const { rows: pendentes } = await pool.query(
        `select * from ${tabelas.mensagens}
          where tenant_id = $1 and telefone_e164 = $2 and autor = 'cliente'
            and processada_em is null and tentativas < $3
          order by criado_em, id`,
        [tenantId, conversa.telefone_e164, MAX_TENTATIVAS]);
      if (pendentes.length === 0) return { processadas: 0 };
      const ids = pendentes.map((p) => p.id);

      // Uma pessoa assumiu: o agente fica em silêncio, mas a mensagem fica registrada como vista.
      if (agenteEmPausa(conversa, agora())) {
        await pool.query(`update ${tabelas.mensagens} set processada_em = now() where tenant_id = $1 and id = any($2)`, [tenantId, ids]);
        return { processadas: ids.length, pausado: true };
      }

      for (const m of pendentes) {
        if (m.midia && m.midia.mediaId && (m.tipo === 'imagem' || m.tipo === 'documento') && !m.anexo_id) {
          await anexarMidia(pool, m, { baixarMidia, armazenamento, maxBytes, log, midiaPermitida });
        }
      }

      try {
        const { rows: mensagens } = await pool.query(
          `select * from ${tabelas.mensagens} where tenant_id = $1 and id = any($2) order by criado_em, id`, [tenantId, ids]);
        await executarAgente({ pool, tenantId, conversa, mensagens });
      } catch (err) {
        log(`[agente] falha no turno da conversa ${conversaId}: ${err.message}`);
        await pool.query(`update ${tabelas.mensagens} set tentativas = tentativas + 1 where tenant_id = $1 and id = any($2)`, [tenantId, ids]);
        return { processadas: 0, erro: err.message };
      }
      await pool.query(`update ${tabelas.mensagens} set processada_em = now() where tenant_id = $1 and id = any($2)`, [tenantId, ids]);
      return { processadas: ids.length };
    } finally {
      await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [conversaId]).catch(() => {});
      client.release();
    }
  }

  // Reprocessa o que ficou para trás (queda entre o 200 e o agente). Só olha
  // mensagens com mais de `esperaSegundos` para não competir com o fluxo normal.
  async function varrerPendentes(pool, deps = {}, { esperaSegundos = 30 } = {}) {
    const { rows } = await pool.query(
      `select distinct c.tenant_id, c.id as conversa_id
         from ${tabelas.mensagens} m
         join ${tabelas.conversas} c on c.tenant_id = m.tenant_id and c.telefone_e164 = m.telefone_e164
        where m.autor = 'cliente' and m.processada_em is null and m.tentativas < $1
          and m.criado_em < now() - make_interval(secs => $2)
          and m.criado_em > now() - interval '24 hours'`,
      [MAX_TENTATIVAS, esperaSegundos]);
    for (const r of rows) await processarConversa(pool, r.tenant_id, r.conversa_id, deps);
    return rows.length;
  }

  return { processarConversa, varrerPendentes };
}

module.exports = criarProcessador;
module.exports.agenteEmPausa = agenteEmPausa;
module.exports.MAX_TENTATIVAS = MAX_TENTATIVAS;
