const { test } = require('node:test');
const assert = require('node:assert/strict');

// Isola cada teste de env vars herdadas do shell.
function comEnv(vars, fn) {
  const antes = { ...process.env };
  for (const k of ['ASAAS_ENV', 'ASAAS_API_KEY_SANDBOX', 'ASAAS_API_KEY_PRODUCTION']) delete process.env[k];
  Object.assign(process.env, vars);
  delete require.cache[require.resolve('..')];
  try {
    return fn(require('..'));
  } finally {
    for (const k of ['ASAAS_ENV', 'ASAAS_API_KEY_SANDBOX', 'ASAAS_API_KEY_PRODUCTION']) delete process.env[k];
    Object.assign(process.env, antes);
    delete require.cache[require.resolve('..')];
  }
}

test('ambiente() default é sandbox, production só com a var explícita', () => {
  comEnv({}, (asaas) => assert.equal(asaas.ambiente(), 'sandbox'));
  comEnv({ ASAAS_ENV: 'qualquer-coisa' }, (asaas) => assert.equal(asaas.ambiente(), 'sandbox'));
  comEnv({ ASAAS_ENV: 'production' }, (asaas) => assert.equal(asaas.ambiente(), 'production'));
});

test('modoDev() é true sem API key, false com', () => {
  comEnv({}, (asaas) => assert.equal(asaas.modoDev(), true));
  comEnv({ ASAAS_API_KEY_SANDBOX: 'k' }, (asaas) => assert.equal(asaas.modoDev(), false));
  comEnv({ ASAAS_ENV: 'production', ASAAS_API_KEY_SANDBOX: 'k' }, (asaas) => assert.equal(asaas.modoDev(), true));
  comEnv({ ASAAS_ENV: 'production', ASAAS_API_KEY_PRODUCTION: 'k' }, (asaas) => assert.equal(asaas.modoDev(), false));
});

test('modo dev: ids fake determinísticos, sem tocar a rede', async () => {
  await comEnv({}, async (asaas) => {
    assert.deepEqual(await asaas.criarOuRecuperarCustomer({ tenantId: 't1' }), { id: 'cus_dev_t1' });
    assert.deepEqual(await asaas.tokenizarCartao({ customerId: 'c1' }), { creditCardToken: 'card_dev_c1' });
    assert.deepEqual(await asaas.criarSubscription({ tenantId: 't1', billingType: 'PIX' }), { id: 'sub_dev_t1' });
    assert.deepEqual(await asaas.cancelarSubscription({ subscriptionId: 's1', tenantId: 't1' }), { deleted: true });
    assert.equal(await asaas.buscarSubscription('s1'), null);
    assert.deepEqual(await asaas.listarUltimasCobrancas('s1'), []);
  });
});

test('criarOuRecuperarCustomer curto-circuita quando já há asaasCustomerId', async () => {
  await comEnv({ ASAAS_API_KEY_SANDBOX: 'k' }, async (asaas) => {
    assert.deepEqual(await asaas.criarOuRecuperarCustomer({ tenantId: 't1', asaasCustomerId: 'cus_123' }), { id: 'cus_123' });
  });
});

test('EVENTO_STATUS: mapa congelado, com os eventos que faltavam nas cópias antigas', () => {
  const { EVENTO_STATUS } = require('..');
  assert.deepEqual({ ...EVENTO_STATUS }, {
    PAYMENT_CONFIRMED: 'ativo',
    PAYMENT_RECEIVED: 'ativo',
    PAYMENT_OVERDUE: 'inadimplente',
    PAYMENT_DELETED: 'suspenso',
    PAYMENT_REFUNDED: 'suspenso',
    PAYMENT_CHARGEBACK_REQUESTED: 'suspenso',
    SUBSCRIPTION_DELETED: 'cancelado',
  });
  assert.ok(Object.isFrozen(EVENTO_STATUS));
  assert.equal(EVENTO_STATUS.SUBSCRIPTION_CANCELLED, undefined);
});
