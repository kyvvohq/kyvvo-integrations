// Cota + disparo manual em lote de WhatsApp — compartilhado pelos produtos
// Kyvvo. Extraído do motor de automações do Studio (server/panel/lib/
// automacoes.js) 2026-09-23 — primeiro consumidor foi Studio (disparo por
// seleção de clientes na tela de Clientes), mas nada aqui é específico dele.
//
// Ao contrário de @kyvvohq/whatsapp (wrapper puro da Graph API, sem estado),
// este pacote SABE do schema `whatsapp_disparos` — mas não sabe nada de
// "plano" nem "cliente": quem chama resolve `limiteDisparos` a partir do
// PRÓPRIO catálogo de planos, e `destinatarios` a partir da PRÓPRIA tabela
// de clientes/candidatos/leads, antes de chamar estas funções. `pool` é
// duck-typed (só precisa de um `.query(sql, params)` que devolva `{rows}}`),
// mesmo padrão já usado no motor de automações do Studio — não é uma
// dependência declarada deste pacote.
//
// `whatsapp_disparos` (idêntico em Studio e People — ver
// kyvvo-studio/server/db/078_whatsapp_disparos.sql +
// 079_whatsapp_disparos_limite_plano.sql e
// kyvvo-people/db/026_whatsapp_disparos.sql + 027_whatsapp_disparos_limite_plano.sql):
//   id uuid, tenant_id uuid, telefone_e164 text, template_nome text,
//   gatilho text, status text check in
//   ('enviado','erro','bloqueado_optout','bloqueado_24h','bloqueado_limite_plano'),
//   criado_em timestamptz.
//
// Decisões de produto (Studio, disparo manual, 2026-09-23):
//  - NÃO respeita a trava de 24h (`whatsapp_envios`) — essa trava existe pra
//    automações não se duplicarem entre si, não se aplica a uma ação humana
//    deliberada.
//  - NÃO enfileira fora do horário comercial — sempre tenta enviar na hora,
//    pra dar feedback imediato na UI (quantos enviaram/falharam).
//  - Opt-out do cliente é SEMPRE respeitado (quem chama informa via
//    `destinatarios[].optOut`).
const crypto = require('crypto');
const { enviarTemplate } = require('@kyvvohq/whatsapp');

// Conta quantos disparos com status 'enviado' já saíram neste mês corrente
// (calendário, dia 1 até agora — mesma régua do `limiteDoPlanoExcedido` do
// Studio) e decide se cabe mandar mais `quantidade` agora, ANTES de disparar
// qualquer um (diferente de `limiteDoPlanoExcedido`, que só checa DEPOIS de
// já ter enviado 1). `limiteDisparos` nulo/undefined = plano sem trava.
async function checarCotaDisparo(pool, { tenantId, limiteDisparos, quantidade }) {
  if (limiteDisparos == null) {
    return { ok: true, restante: null, limite: null, usadoMesAtual: null };
  }
  const { rows } = await pool.query(
    `select count(*)::int as total from whatsapp_disparos
     where tenant_id = $1 and status = 'enviado' and criado_em >= date_trunc('month', now())`,
    [tenantId]
  );
  const usadoMesAtual = rows[0].total;
  const restante = Math.max(0, limiteDisparos - usadoMesAtual);
  return { ok: usadoMesAtual + quantidade <= limiteDisparos, restante, limite: limiteDisparos, usadoMesAtual };
}

async function registrarDisparo(pool, { tenantId, telefoneE164, templateNome, gatilho, status, mensagemTexto }) {
  await pool.query(
    `insert into whatsapp_disparos (id, tenant_id, telefone_e164, template_nome, gatilho, status, mensagem_texto)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), tenantId, telefoneE164, templateNome || null, gatilho || null, status, mensagemTexto || null]
  );
}

// Envia `templateNome` pra cada destinatário e registra o desfecho em
// `whatsapp_disparos`. Best-effort por destinatário — a falha de um não
// impede os demais. `destinatarios`: [{ telefoneE164, optOut, parametrosCorpo,
// parametroBotao, mensagemTexto }] (parametrosCorpo/parametroBotao no formato
// que @kyvvohq/whatsapp espera, já resolvidos por quem chama; mensagemTexto é
// o texto final do template com os parâmetros já substituídos — pra exibir
// na tela de Disparos, já que a Meta só recebe os parâmetros separados,
// nunca o texto montado. Quem chama monta isso, o pacote só persiste).
async function dispararEmLote(pool, { tenantId, destinatarios, templateNome, phoneNumberId, gatilho = 'manual' }) {
  let enviados = 0;
  let falhas = 0;
  const detalhes = [];
  for (const d of destinatarios) {
    if (d.optOut) {
      await registrarDisparo(pool, { tenantId, telefoneE164: d.telefoneE164, templateNome, gatilho, status: 'bloqueado_optout', mensagemTexto: d.mensagemTexto });
      falhas++;
      detalhes.push({ telefoneE164: d.telefoneE164, status: 'bloqueado_optout' });
      continue;
    }
    const ok = await enviarTemplate({
      to: d.telefoneE164, templateName: templateNome, parametrosCorpo: d.parametrosCorpo, parametroBotao: d.parametroBotao, phoneNumberId,
    });
    const status = ok ? 'enviado' : 'erro';
    await registrarDisparo(pool, { tenantId, telefoneE164: d.telefoneE164, templateNome, gatilho, status, mensagemTexto: d.mensagemTexto });
    if (ok) enviados++; else falhas++;
    detalhes.push({ telefoneE164: d.telefoneE164, status });
  }
  return { enviados, falhas, detalhes };
}

module.exports = { checarCotaDisparo, dispararEmLote };
