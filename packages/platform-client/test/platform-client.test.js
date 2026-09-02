const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const createClient = require('..');

const ISSUER = 'https://auth.kyvvo.test';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-kid-1';

const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };

function assinar(claims, opts = {}) {
  return jwt.sign(claims, privateKey, { algorithm: 'RS256', issuer: ISSUER, keyid: KID, expiresIn: '15m', ...opts });
}

let server;
let baseUrl;
let jwksHits = 0;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/.well-known/jwks.json') {
      jwksHits += 1;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    if (req.url.startsWith('/plans')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ produto: 'studio', planos: [{ chave: 'starter', preco_mensal: 79.9 }] }));
    }
    if (req.url.startsWith('/entitlements/')) {
      if (req.headers.authorization !== 'Bearer tok-123') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'Não autenticado' }));
      }
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ tenantId: 't-1', plano: 'starter', modulos: ['agenda_inteligente'] }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

describe('platform-client', () => {
  test('verifyToken aceita um token assinado pela chave do JWKS', async () => {
    const client = createClient({ baseUrl, issuer: ISSUER });
    const payload = await client.verifyToken(assinar({ userId: 'u-1', tenantId: 't-1' }));
    assert.equal(payload.userId, 'u-1');
    assert.equal(payload.iss, ISSUER);
  });

  test('verifyToken cacheia o JWKS (não refaz fetch a cada verificação)', async () => {
    const client = createClient({ baseUrl, issuer: ISSUER });
    const hitsAntes = jwksHits;
    await client.verifyToken(assinar({ userId: 'u-1' }));
    await client.verifyToken(assinar({ userId: 'u-2' }));
    assert.equal(jwksHits - hitsAntes, 1);
  });

  test('verifyToken rejeita token expirado', async () => {
    const client = createClient({ baseUrl, issuer: ISSUER });
    await assert.rejects(() => client.verifyToken(assinar({ userId: 'u-1' }, { expiresIn: -10 })), /jwt expired/);
  });

  test('verifyToken rejeita assinatura de outra chave', async () => {
    const outra = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const forjado = jwt.sign({ userId: 'x' }, outra, { algorithm: 'RS256', issuer: ISSUER, keyid: KID });
    const client = createClient({ baseUrl, issuer: ISSUER });
    await assert.rejects(() => client.verifyToken(forjado), /invalid signature/);
  });

  test('verifyToken sinaliza kid desconhecido', async () => {
    const forjado = jwt.sign({ userId: 'x' }, privateKey, { algorithm: 'RS256', issuer: ISSUER, keyid: 'kid-fantasma' });
    const client = createClient({ baseUrl, issuer: ISSUER });
    await assert.rejects(() => client.verifyToken(forjado), (e) => e.code === 'KID_DESCONHECIDO');
  });

  test('getPlans faz GET /plans?produto=', async () => {
    const client = createClient({ baseUrl, issuer: ISSUER });
    const { planos } = await client.getPlans('studio');
    assert.equal(planos[0].chave, 'starter');
  });

  test('getEntitlements manda o Bearer e devolve o corpo', async () => {
    const client = createClient({ baseUrl, issuer: ISSUER });
    const ent = await client.getEntitlements('t-1', { token: 'tok-123' });
    assert.deepEqual(ent.modulos, ['agenda_inteligente']);
  });

  test('getEntitlements propaga erro HTTP com status', async () => {
    const client = createClient({ baseUrl, issuer: ISSUER });
    await assert.rejects(() => client.getEntitlements('t-1', { token: 'errado' }), (e) => e.status === 401);
  });

  test('baseUrl obrigatório', () => {
    assert.throws(() => createClient({}), /baseUrl/);
  });
});
