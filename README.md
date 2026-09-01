# kyvvo-integrations

Clientes de integração compartilhados entre os produtos Kyvvo. Cada pasta em
`packages/` é um pacote npm publicado no GitHub Packages privado da org
`kyvvohq`.

| Pacote | O que é |
|---|---|
| [`@kyvvohq/asaas`](packages/asaas) | Cliente Asaas (cobrança recorrente). Superset das cópias de `kyvvo/server/panel/asaas-service.js` e `kyvvo-people/lib/asaas.js`. |
| [`@kyvvohq/db-migrate`](packages/db-migrate) | Runner de migrations SQL simples, extraído de `kyvvo-people/lib/db.js`. |

## Publicar

Versionado por tag git, no formato `<pacote>-v<versão>`:

```
# subir @kyvvohq/asaas 1.1.0
#  1. editar packages/asaas/package.json -> "version": "1.1.0"
#  2. commit
git tag asaas-v1.1.0
git push origin asaas-v1.1.0
```

O workflow `publish` resolve o pacote pelo prefixo da tag, confere
`package.json.version == tag`, roda `npm test` e publica.

## Consumir

`.npmrc` no repo consumidor:

```
@kyvvohq:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_PACKAGES_TOKEN}
```

`NPM_PACKAGES_TOKEN` = PAT (classic) com `read:packages`.

## Testes

Cada pacote: `cd packages/<nome> && npm test` (node:test, sem dependências
externas — não precisa de `npm install` nem de Postgres).
