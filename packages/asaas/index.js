// Cliente Asaas compartilhado pelos produtos Kyvvo (Studio, People).
//
// Antes desta extração, Studio (server/panel/asaas-service.js) e People
// (lib/asaas.js) mantinham duas cópias do mesmo cliente. Este módulo é o
// superset das duas: chamado do jeito que cada produto chama hoje, produz
// requisições byte-a-byte idênticas às de antes.
//
// Diferenças reconciliadas:
//   - `cycle` (mensal/anual): People usa, Studio não passava — default MONTHLY.
//   - `produtoNome`: entra na `description` da subscription. Default 'Kyvvo'
//     (mantém a string do Studio); People passa 'Kyvvo People'.
//   - `description` no PUT /subscriptions: só é enviada quando `planoNome` vem
//     preenchido. People passa e ganha a correção de description defasada
//     (achado 2026-08-31); os call sites do Studio não passam `planoNome`,
//     então o corpo do PUT continua idêntico.
//
// Sem ASAAS_API_KEY_* no ambiente, cai em modo de log (devolve id fake) — útil
// em dev/homologação sem conta real. `ASAAS_ENV` escolhe sandbox/produção;
// nunca aponta pra produção sem a variável explícita.

const BASE_URL_SANDBOX = 'https://sandbox.asaas.com/api/v3';
const BASE_URL_PRODUCTION = 'https://www.asaas.com/api/v3';

function ambiente() {
  return process.env.ASAAS_ENV === 'production' ? 'production' : 'sandbox';
}

function baseUrl() {
  return ambiente() === 'production' ? BASE_URL_PRODUCTION : BASE_URL_SANDBOX;
}

function apiKey() {
  return ambiente() === 'production'
    ? process.env.ASAAS_API_KEY_PRODUCTION
    : process.env.ASAAS_API_KEY_SANDBOX;
}

function modoDev() {
  return !apiKey();
}

async function chamar(metodo, caminho, corpo) {
  const res = await fetch(`${baseUrl()}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey(),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    const mensagem =
      (dados.errors && dados.errors[0] && dados.errors[0].description) ||
      `Asaas respondeu ${res.status}`;
    throw new Error(mensagem);
  }
  return dados;
}

// Cria (ou recupera, se já existir) o Customer no Asaas pro tenant. Em modo
// dev, devolve um id fake e loga em vez de chamar a API.
async function criarOuRecuperarCustomer({ tenantId, nome, email, whatsapp, cpfCnpj, asaasCustomerId }) {
  if (asaasCustomerId) return { id: asaasCustomerId };

  if (modoDev()) {
    const idFake = `cus_dev_${tenantId}`;
    console.log(`[asaas] (dev) customer para tenant ${tenantId} — id: ${idFake}`);
    return { id: idFake };
  }

  return chamar('POST', '/customers', {
    name: nome,
    email,
    phone: whatsapp || undefined,
    cpfCnpj,
    externalReference: tenantId,
  });
}

// Tokeniza o cartão de crédito. A Asaas não tem tokenização client-side, só um
// endpoint de servidor (POST /creditCard/tokenize), então o dado do cartão
// passa (só de passagem, nunca armazenado/logado) pelo backend antes de virar
// token. Em modo dev, devolve um token fake.
async function tokenizarCartao({ customerId, holderName, number, expiryMonth, expiryYear, ccv, holderInfo, remoteIp }) {
  if (modoDev()) {
    console.log(`[asaas] (dev) tokeniza cartão do customer ${customerId}`);
    return { creditCardToken: `card_dev_${customerId}` };
  }

  return chamar('POST', '/creditCard/tokenize', {
    customer: customerId,
    creditCard: { holderName, number, expiryMonth, expiryYear, ccv },
    creditCardHolderInfo: holderInfo,
    remoteIp,
  });
}

// Cria a Subscription no Asaas (Pix ou cartão). `valor`/`planoNome` sempre vêm
// do chamador (catálogo lido da tabela `planos`, nunca hardcoded aqui).
// `cycle` default MONTHLY. Em modo dev, devolve um id fake e loga.
async function criarSubscription({
  customerId, billingType, valor, planoNome, nextDueDate, creditCardToken, tenantId, cycle, produtoNome,
}) {
  const ciclo = cycle || 'MONTHLY';
  const descricao = `${produtoNome || 'Kyvvo'} — Plano ${planoNome}`;

  if (modoDev()) {
    const idFake = `sub_dev_${tenantId}`;
    console.log(
      `[asaas] (dev) subscription ${billingType} para tenant ${tenantId} — id: ${idFake}, valor: ${valor}, ciclo: ${ciclo}`
    );
    return { id: idFake };
  }

  return chamar('POST', '/subscriptions', {
    customer: customerId,
    billingType,
    value: valor,
    cycle: ciclo,
    nextDueDate,
    description: descricao,
    creditCardToken: billingType === 'CREDIT_CARD' ? creditCardToken : undefined,
  });
}

// Troca o meio de pagamento, o valor (troca de plano) e/ou o ciclo de uma
// assinatura existente. A Asaas não faz cálculo proporcional nem retroage
// cobranças pendentes por padrão (updatePendingPayments não é enviado) — o
// valor/ciclo novo só vale a partir da próxima cobrança. `description` só é
// enviada quando `planoNome` vem preenchido (sem isso a description fica presa
// no nome do plano da criação — achado 2026-08-31). Em modo dev, só loga.
async function atualizarSubscription({
  subscriptionId, billingType, creditCardToken, valor, cycle, planoNome, produtoNome, tenantId,
}) {
  if (modoDev()) {
    console.log(
      `[asaas] (dev) atualiza subscription ${subscriptionId} do tenant ${tenantId}` +
        `${billingType ? ` para ${billingType}` : ''}` +
        `${valor != null ? `, valor ${valor}` : ''}` +
        `${cycle ? `, ciclo ${cycle}` : ''}`
    );
    return { id: subscriptionId };
  }

  return chamar('PUT', `/subscriptions/${subscriptionId}`, {
    billingType,
    creditCardToken: billingType === 'CREDIT_CARD' ? creditCardToken : undefined,
    value: valor,
    cycle,
    description: planoNome ? `${produtoNome || 'Kyvvo'} — Plano ${planoNome}` : undefined,
  });
}

// Cancela a Subscription no Asaas (self-service, pelo próprio tenant). Em modo
// dev, só loga (não há assinatura real pra cancelar).
async function cancelarSubscription({ subscriptionId, tenantId }) {
  if (modoDev()) {
    console.log(`[asaas] (dev) cancela subscription ${subscriptionId} do tenant ${tenantId}`);
    return { deleted: true };
  }
  return chamar('DELETE', `/subscriptions/${subscriptionId}`);
}

// Sincroniza nome/telefone com o Customer já existente no Asaas quando o
// usuário edita o perfil. Em modo dev, só loga.
async function atualizarCustomer({ customerId, nome, whatsapp }) {
  if (modoDev()) {
    console.log(`[asaas] (dev) atualiza customer ${customerId} — nome: ${nome}`);
    return { id: customerId };
  }
  return chamar('PUT', `/customers/${customerId}`, { name: nome, phone: whatsapp || undefined });
}

// Próxima cobrança (data + valor) da assinatura, pra exibir na aba de
// pagamentos. Em modo dev, devolve null (não há assinatura real na Asaas).
async function buscarSubscription(subscriptionId) {
  if (modoDev() || !subscriptionId) return null;
  return chamar('GET', `/subscriptions/${subscriptionId}`);
}

// Últimas cobranças da assinatura, pro histórico na aba de pagamentos. Em modo
// dev, devolve uma lista vazia.
async function listarUltimasCobrancas(subscriptionId, limite = 5) {
  if (modoDev() || !subscriptionId) return [];

  const dados = await chamar(
    'GET',
    `/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=${limite}&sort=dueDate&order=desc`
  );
  return dados.data || [];
}

// Cobrança avulsa (Pix ou cartão), sem recorrência — POST /payments, diferente
// de criarSubscription. Pro cartão, a Asaas processa e já devolve o status
// (normalmente CONFIRMED) na resposta; pro Pix, a cobrança nasce PENDING e só
// confirma depois, via webhook (PAYMENT_CONFIRMED/PAYMENT_RECEIVED). Em modo
// dev, devolve um id fake com status CONFIRMED (simula o caminho feliz pra
// quem está testando o fluxo sem conta Asaas real).
//
// `remoteIp` (achado 2026-10-26, cobrança de créditos do CRM negada com 403
// "sem permissão... fale com seu gerente de contas") — a doc da Asaas lista
// `remoteIp` como campo obrigatório de POST /payments ("IP de quem está
// pagando"), mas ele só estava sendo mandado pra /creditCard/tokenize, nunca
// pra /payments em si. Sem ele, a Asaas rejeita cobrança no cartão (tokenizado)
// com essa mensagem genérica de permissão/antifraude, em vez de um 400 claro
// de campo faltando — Pix não passa por isso (não usa remoteIp).
async function criarCobranca({ customerId, billingType, valor, descricao, dueDate, creditCardToken, tenantId, externalReference, remoteIp }) {
  if (modoDev()) {
    const idFake = `pay_dev_${tenantId}_${Date.now()}`;
    console.log(`[asaas] (dev) cobrança avulsa ${billingType} para tenant ${tenantId} — id: ${idFake}, valor: ${valor}`);
    return { id: idFake, status: 'CONFIRMED' };
  }

  return chamar('POST', '/payments', {
    customer: customerId,
    billingType,
    value: valor,
    dueDate,
    description: descricao,
    creditCardToken: billingType === 'CREDIT_CARD' ? creditCardToken : undefined,
    remoteIp: billingType === 'CREDIT_CARD' ? remoteIp : undefined,
    externalReference,
  });
}

// Status atual de uma cobrança avulsa (poll de apoio — a confirmação de
// verdade chega pelo webhook). Em modo dev, devolve CONFIRMED (id fake nunca
// existiu na Asaas de verdade).
async function buscarCobranca(paymentId) {
  if (modoDev() || !paymentId) return { id: paymentId, status: 'CONFIRMED' };
  return chamar('GET', `/payments/${paymentId}`);
}

// QR code Pix (copia-e-cola + imagem) de uma cobrança avulsa PIX. Em modo dev,
// devolve um payload fake só pra não quebrar a tela.
async function buscarPixQrCode(paymentId) {
  if (modoDev() || !paymentId) {
    return { success: true, encodedImage: null, payload: '00020126 (dev) pix fake — sem conta Asaas real', expirationDate: null };
  }
  return chamar('GET', `/payments/${paymentId}/pixQrCode`);
}

// Mapa evento do webhook Asaas -> status do tenant. Idêntico nos dois produtos
// hoje. SUBSCRIPTION_CANCELLED não existe na API da Asaas (achado 2026-08-31
// consultando GET /v3/webhooks) — o evento real do DELETE /subscriptions/:id é
// SUBSCRIPTION_DELETED. PAYMENT_REFUNDED/PAYMENT_CHARGEBACK_REQUESTED faltavam
// no mapa das duas cópias antigas (mesmo achado). Evento fora do mapa: o
// chamador deve logar, não ignorar em silêncio — foi assim que PAYMENT_REFUNDED
// passou despercebido.
const EVENTO_STATUS = Object.freeze({
  PAYMENT_CONFIRMED: 'ativo',
  PAYMENT_RECEIVED: 'ativo',
  PAYMENT_OVERDUE: 'inadimplente',
  PAYMENT_DELETED: 'suspenso',
  PAYMENT_REFUNDED: 'suspenso',
  PAYMENT_CHARGEBACK_REQUESTED: 'suspenso',
  SUBSCRIPTION_DELETED: 'cancelado',
});

module.exports = {
  ambiente,
  modoDev,
  criarOuRecuperarCustomer,
  tokenizarCartao,
  criarSubscription,
  atualizarSubscription,
  cancelarSubscription,
  atualizarCustomer,
  buscarSubscription,
  listarUltimasCobrancas,
  criarCobranca,
  buscarCobranca,
  buscarPixQrCode,
  EVENTO_STATUS,
};
