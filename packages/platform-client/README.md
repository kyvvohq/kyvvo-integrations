# @kyvvohq/platform-client

SDK fino do serviço [`kyvvo-platform`](https://github.com/kyvvohq/kyvvo-platform)
(fase P3). Studio e People importam isto no lugar de query direta nas tabelas
de identidade/plano e do `fetch` ad-hoc pro `/api/auth`.

`verifyToken` verifica a assinatura **RS256 localmente** contra a chave pública
do `/.well-known/jwks.json` (sem round-trip por request). O JWKS é cacheado
(1h); um `kid` desconhecido — rotação de chave — força um refetch antes de
falhar.

## Uso

```js
const createClient = require('@kyvvohq/platform-client');

const platform = createClient({
  baseUrl: process.env.PLATFORM_URL || 'https://auth.kyvvo.com.br',
  // jwksUrl: default `${baseUrl}/.well-known/jwks.json`
  // issuer:  default 'https://auth.kyvvo.com.br'
});

// no preHandler de auth do produto, no lugar de request.jwtVerify():
const claims = await platform.verifyToken(tokenDoHeader);
// -> { userId, tenantId, email, tokenVersion, iss, exp, ... }

const ent = await platform.getEntitlements(tenantId, { token: tokenDoHeader });
// -> { plano, status, bloqueio, modulos: [...], limites: {...} }

const { planos } = await platform.getPlans('studio'); // ou 'people'
```

## API

| Método | Chama | Observação |
|---|---|---|
| `verifyToken(token)` | — (local, via JWKS) | resolve com os claims; rejeita com `err.code` `TOKEN_MALFORMADO` / `KID_DESCONHECIDO` ou o erro do `jsonwebtoken` (`jwt expired`, `invalid signature`, …) |
| `getEntitlements(tenantId, { token })` | `GET /entitlements/:tenantId` | encaminha o JWT do usuário; só devolve o próprio tenant do token |
| `getPlans(produto = 'studio')` | `GET /plans?produto=` | público |
| `startSubscription(payload, { token })` | `POST /api/pagamentos/cadastrar` | **billing — rota existe a partir da leva 1b** |
| `changePlan(payload, { token })` | `PATCH /api/pagamentos/plano` | idem |

## Opções

| Opção | Default | |
|---|---|---|
| `baseUrl` | — | obrigatório |
| `jwksUrl` | `${baseUrl}/.well-known/jwks.json` | |
| `issuer` | `https://auth.kyvvo.com.br` | checado em `verifyToken` |
| `fetchImpl` | `globalThis.fetch` | injetável pra teste / Node sem fetch |

## Testes

`npm test` (node:test) — sobe um servidor HTTP local servindo um JWKS de teste;
sem Postgres, sem serviço real. Cobre verificação (ok / expirado / assinatura
errada / kid desconhecido), cache do JWKS, e os GETs (`/plans`, `/entitlements`
com Bearer + propagação de erro HTTP).
