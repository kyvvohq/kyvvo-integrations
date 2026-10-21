# @kyvvohq/asaas

Cliente Asaas compartilhado pelos produtos Kyvvo (Studio, People). Substitui as
duas cópias que existiam em `kyvvo/server/panel/asaas-service.js` e
`kyvvo-people/lib/asaas.js`.

## Contrato

```js
const asaas = require('@kyvvohq/asaas');

asaas.ambiente();                 // 'sandbox' | 'production'
asaas.modoDev();                  // true quando não há API key -> devolve ids fake

await asaas.criarOuRecuperarCustomer({ tenantId, nome, email, whatsapp, cpfCnpj, asaasCustomerId });
await asaas.tokenizarCartao({ customerId, holderName, number, expiryMonth, expiryYear, ccv, holderInfo, remoteIp });
await asaas.criarSubscription({ customerId, billingType, valor, planoNome, nextDueDate, creditCardToken, tenantId, cycle, produtoNome });
await asaas.atualizarSubscription({ subscriptionId, billingType, creditCardToken, valor, cycle, planoNome, produtoNome, tenantId });
await asaas.cancelarSubscription({ subscriptionId, tenantId });
await asaas.atualizarCustomer({ customerId, nome, whatsapp });
await asaas.buscarSubscription(subscriptionId);
await asaas.listarUltimasCobrancas(subscriptionId, limite);

// Cobrança avulsa (sem recorrência) — ex.: compra de créditos do CRM.
await asaas.criarCobranca({ customerId, billingType, valor, descricao, dueDate, creditCardToken, tenantId, externalReference });
await asaas.buscarCobranca(paymentId);
await asaas.buscarPixQrCode(paymentId);

asaas.EVENTO_STATUS;              // mapa congelado: evento do webhook -> status do tenant
```

## Parâmetros que vieram da reconciliação das duas cópias

| Parâmetro | Default | Nota |
|---|---|---|
| `cycle` | `'MONTHLY'` | People usa mensal/anual; Studio não passava. |
| `produtoNome` | `'Kyvvo'` | Entra na `description` da subscription. People passa `'Kyvvo People'`. |
| `description` no `atualizarSubscription` | só quando `planoNome` vem preenchido | Corrige a description defasada na troca de plano (achado 2026-08-31). Call sites do Studio não passam `planoNome`, então o corpo do PUT continua idêntico ao de antes. |

## Ambiente

- `ASAAS_ENV` — `production` para produção; qualquer outra coisa (ou ausente) = sandbox.
- `ASAAS_API_KEY_SANDBOX` / `ASAAS_API_KEY_PRODUCTION` — sem a key do ambiente
  ativo, o cliente entra em **modo dev**: não toca a rede, devolve ids fake
  (`cus_dev_*`, `card_dev_*`, `sub_dev_*`) e loga.

## Webhook

`EVENTO_STATUS` traz só os eventos mapeados. O chamador deve **logar** os
eventos fora do mapa, nunca ignorar em silêncio — foi assim que
`PAYMENT_REFUNDED` passou despercebido nas duas cópias antigas.

```js
const novoStatus = asaas.EVENTO_STATUS[evento];
if (!novoStatus) {
  console.log(`[pagamentos] webhook Asaas: evento "${evento}" sem mapeamento, ignorado`);
  return reply.send({ ok: true });
}
```

## Testes

`npm test` (node:test). Cobre o switch de ambiente, o modo dev e o formato do
`EVENTO_STATUS`. A chamada real ao sandbox Asaas (criar Subscription de ponta a
ponta) é verificação manual — precisa de `ASAAS_API_KEY_SANDBOX`.
