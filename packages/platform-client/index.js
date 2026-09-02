// SDK do serviço kyvvo-platform.
//
// Studio e People importam isto no lugar de query direta nas tabelas de
// identidade/plano e do `fetch` ad-hoc pro /api/auth. Superfície mínima:
//
//   const client = require('@kyvvohq/platform-client')({ baseUrl, jwksUrl });
//   await client.verifyToken(token);          // local, cacheia JWKS
//   await client.getEntitlements(tenantId, { token });
//   await client.getPlans('studio' | 'people');
//   await client.startSubscription(payload, { token });   // billing — leva 1b
//   await client.changePlan(payload, { token });          // billing — leva 1b
//
// `verifyToken` verifica a assinatura RS256 localmente contra a chave pública
// do /.well-known/jwks.json (sem round-trip por request), no mesmo espírito
// do que o People já faz hoje. O JWKS é cacheado; um `kid` desconhecido
// (rotação de chave) força um refetch antes de falhar.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWKS_TTL_MS = 60 * 60 * 1000; // 1h
const ISSUER_PADRAO = 'https://auth.kyvvo.com.br';

function createClient({ baseUrl, jwksUrl, issuer = ISSUER_PADRAO, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) throw new Error('platform-client: baseUrl é obrigatório');
  const jwks = jwksUrl || `${baseUrl.replace(/\/$/, '')}/.well-known/jwks.json`;
  const fetch = fetchImpl;
  if (typeof fetch !== 'function') {
    throw new Error('platform-client: fetch indisponível (Node < 18?) — passe fetchImpl');
  }

  let cache = { porKid: new Map(), expiraEm: 0 };

  async function carregarJwks() {
    const res = await fetch(jwks, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`platform-client: JWKS respondeu ${res.status}`);
    const { keys } = await res.json();
    const porKid = new Map();
    for (const jwk of keys || []) {
      const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      porKid.set(jwk.kid, pub.export({ type: 'spki', format: 'pem' }));
    }
    cache = { porKid, expiraEm: Date.now() + JWKS_TTL_MS };
    return porKid;
  }

  async function chavePara(kid) {
    if (cache.porKid.has(kid) && Date.now() < cache.expiraEm) {
      return cache.porKid.get(kid);
    }
    const porKid = await carregarJwks();
    return porKid.get(kid) || null;
  }

  async function verifyToken(token) {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header) {
      const err = new Error('token malformado');
      err.code = 'TOKEN_MALFORMADO';
      throw err;
    }
    const pem = await chavePara(decoded.header.kid);
    if (!pem) {
      const err = new Error(`kid "${decoded.header.kid}" não está no JWKS`);
      err.code = 'KID_DESCONHECIDO';
      throw err;
    }
    return jwt.verify(token, pem, { algorithms: ['RS256'], issuer });
  }

  async function req(method, caminho, { token, body } = {}) {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${caminho}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const texto = await res.text();
    const dados = texto ? JSON.parse(texto) : null;
    if (!res.ok) {
      const err = new Error((dados && dados.error) || `platform-client: ${method} ${caminho} -> ${res.status}`);
      err.status = res.status;
      err.body = dados;
      throw err;
    }
    return dados;
  }

  return {
    verifyToken,
    getEntitlements: (tenantId, { token } = {}) =>
      req('GET', `/entitlements/${encodeURIComponent(tenantId)}`, { token }),
    getPlans: (produto = 'studio') =>
      req('GET', `/plans?produto=${encodeURIComponent(produto)}`),
    startSubscription: (payload, { token } = {}) =>
      req('POST', '/api/pagamentos/cadastrar', { token, body: payload }),
    changePlan: (payload, { token } = {}) =>
      req('PATCH', '/api/pagamentos/plano', { token, body: payload }),
  };
}

module.exports = createClient;
