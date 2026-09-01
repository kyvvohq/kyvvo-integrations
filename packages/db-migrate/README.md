# @kyvvohq/db-migrate

Runner de migrations SQL simples, extraído de `kyvvo-people/lib/db.js`.

Aplica, em ordem alfabética, os arquivos `*.sql` de um diretório que ainda não
constam na tabela de controle. Cada arquivo roda numa transação; falha faz
rollback e interrompe.

**Não** substitui uma lib de migration dedicada: sem `down`/rollback de versão,
sem checksum de arquivo já aplicado. Suficiente pro volume dos serviços Kyvvo,
e substitui o `psql -1` manual do Studio.

## Uso

```js
const path = require('path');
const { Pool } = require('pg');
const { migrar } = require('@kyvvohq/db-migrate');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

await migrar({ pool, dir: path.join(__dirname, 'db') });
```

## Opções

| Opção | Default | |
|---|---|---|
| `pool` | — | pool `pg` já configurado (obrigatório) |
| `dir` | — | diretório com os `*.sql` (obrigatório) |
| `tabela` | `'_migrations'` | tabela de controle; validada contra `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| `logger` | `console` | objeto com `.log` |
| `prefixo` | `'[db]'` | prefixo das linhas de log |

Chamado com os defaults, o comportamento é idêntico ao runner inline que o
People usava (mesma tabela `_migrations`, mesmas mensagens `[db] migration
aplicada: X`).

## Testes

`npm test` (node:test) — pool falso em memória, sem Postgres. Cobre: aplicar só
pendentes em ordem, transação por arquivo, idempotência, rollback + release no
erro, guarda de injeção no nome da tabela.
