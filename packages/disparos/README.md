# @kyvvohq/disparos

Cota + disparo manual em lote de WhatsApp — compartilhado pelos produtos
Kyvvo. Extraído do motor de automações do Studio
(`kyvvo-studio/server/panel/lib/automacoes.js`) em 2026-09-23 — primeiro
consumidor foi o Studio (disparo por seleção de clientes na tela de
Clientes), mas nada aqui é específico dele.

Ao contrário do `@kyvvohq/whatsapp` (wrapper puro da Graph API, sem estado),
este pacote sabe do schema `whatsapp_disparos` — mas **não sabe nada de
"plano" nem "cliente"**: quem chama resolve `limiteDisparos` a partir do
próprio catálogo de planos, e `destinatarios` a partir da própria tabela de
clientes/candidatos/leads, antes de chamar estas funções.

## Contrato

```js
const { checarCotaDisparo, dispararEmLote } = require('@kyvvohq/disparos');

const cota = await checarCotaDisparo(pool, { tenantId, limiteDisparos, quantidade });
// -> { ok, restante, limite, usadoMesAtual }

const resultado = await dispararEmLote(pool, { tenantId, destinatarios, templateNome, phoneNumberId, gatilho });
// -> { enviados, falhas, detalhes: [{ telefoneE164, status }] }
```

`pool` é duck-typed — só precisa de um `.query(sql, params)` que devolva
`{ rows }` (client ou pool do `pg`, ou qualquer coisa com essa forma). Não é
uma dependência declarada deste pacote.

### `checarCotaDisparo(pool, { tenantId, limiteDisparos, quantidade })`

Conta quantos disparos `status = 'enviado'` já saíram no mês corrente
(calendário, dia 1 até agora) e decide se cabe mandar mais `quantidade`
**antes** de disparar qualquer um — diferente de checar "já bati o teto"
depois de já ter enviado 1. `limiteDisparos == null` → sem trava, sempre
`{ ok: true, restante: null, limite: null, usadoMesAtual: null }` (não
consulta o banco).

### `dispararEmLote(pool, { tenantId, destinatarios, templateNome, phoneNumberId, gatilho })`

`destinatarios`: `[{ telefoneE164, optOut, parametrosCorpo, parametroBotao }]`
— `parametrosCorpo`/`parametroBotao` no formato que `@kyvvohq/whatsapp`
espera, já resolvidos por quem chama. `gatilho` (default `'manual'`) só
identifica a origem na linha gravada em `whatsapp_disparos`.

Por destinatário: `optOut` → grava `bloqueado_optout` e pula (nunca chama a
Graph API); senão chama `enviarTemplate` e grava `enviado`/`erro`. Best-effort
— a falha de um destinatário não impede os demais.

**Decisões de produto deliberadas (não são bugs a corrigir depois):**
- **Não** respeita a trava de 24h (`whatsapp_envios`) — essa trava existe pra
  automações não se duplicarem entre si; não se aplica a uma ação humana
  explícita.
- **Não** enfileira fora do horário comercial — sempre tenta enviar na hora,
  pra dar feedback imediato na UI (quantos enviaram/falharam agora).
- Opt-out é **sempre** respeitado — quem chama informa via
  `destinatarios[].optOut`.

## Schema esperado (`whatsapp_disparos`)

Idêntico em Studio e People:

```sql
id uuid, tenant_id uuid, telefone_e164 text, template_nome text, gatilho text,
status text check in ('enviado','erro','bloqueado_optout','bloqueado_24h','bloqueado_limite_plano'),
criado_em timestamptz
```

Um produto que ainda não tem essa tabela (ex.: CRM, em 2026-09-23) precisa
criá-la antes de adotar este pacote — ver as migrations do Studio
(`078_whatsapp_disparos.sql`/`079_whatsapp_disparos_limite_plano.sql`) como
referência.

## Testes

`npm install ../whatsapp --no-save && npm test` (node:test, mocka `pool.query`
e `global.fetch` — sem Postgres real). Em CI/publish, `@kyvvohq/whatsapp` vem
do GitHub Packages normalmente (dependency declarada).
