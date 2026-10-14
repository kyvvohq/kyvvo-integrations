# @kyvvohq/agente-core

Motor compartilhado do agente de atendimento por WhatsApp — contexto ->
modelo (Anthropic, com ferramentas) -> pós-filtro determinístico -> rascunho
pra equipe aprovar ou envio automático. Extraído de `kyvvo-crm/lib/agente/*`
em 2026-10-14 (primeiro consumidor: kyvvo-crm; o motivo da extração e o
histórico completo da decisão estão no PR que criou este pacote).

## Por que este pacote existe

Esse motor tem lógica de segurança sensível (pós-filtro que nunca deixa o
agente prometer o que o produto considerar sensível demais, ex.:
preço/prazo/pagamento no CRM) e já causou um incidente real em produção
(2026-10-13, kyvvo-crm#149/#150: `deps.agora`/`deps.enviarTexto` chegando
`undefined` e sobrescrevendo defaults via spread, derrubando o agente de
**todos** os tenants). Duplicar esse código em cada produto Kyvvo significa
corrigir o mesmo bug 2x, ou dois produtos divergindo silenciosamente.

A **execução** continua rodando dentro de cada produto, contra o Postgres
**próprio** dele — este pacote nunca abre conexão, nunca decide schema,
nunca fala com a Meta ou a Anthropic diretamente fora do que o produto
injetar. Ele só sabe executar SQL contra nomes de tabela que o produto
informa (ver "Tabelas", abaixo) e delegar toda decisão de negócio
(ferramentas, contexto dinâmico, termos bloqueados pelo filtro) pra quem
chama — mesmo princípio já usado em `@kyvvohq/disparos`.

## Instalar

```
@kyvvohq:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_PACKAGES_TOKEN}
```

```json
"dependencies": { "@kyvvohq/agente-core": "^0.1.0" }
```

## Uso

```js
const { criarAgenteCore } = require('@kyvvohq/agente-core');

const agenteCore = criarAgenteCore({
  tabelas: {
    config: 'crm_agente_config',
    conhecimento: 'crm_agente_conhecimento',
    conversas: 'crm_conversas_whatsapp',
    mensagens: 'crm_mensagens_whatsapp',
    execucoes: 'crm_agente_execucoes',
    handoffs: 'crm_handoffs',
    numeros: 'crm_whatsapp_numeros',
    anexos: 'crm_anexos',
    clientes: 'crm_clientes',
  },
});
```

## Tabelas — `tabelas` é obrigatório, sem default nenhum

**Decisão deliberada**: `criarAgenteCore` valida as 9 chaves no momento da
criação e lança erro síncrono e nomeado se faltar uma
(`tabelas.execucoes é obrigatório`). Isso falha cedo e no boot, nunca
silenciosamente em produção — ligação direta com o incidente de
2026-10-13 citado acima. Nunca adicione um default aqui, mesmo que pareça
conveniente: foi exatamente um default parcial (`{a: default, b: default,
...overrides}` repassando TODAS as chaves adiante, inclusive as sem
default) que causou o incidente.

Por que não hardcoded como em `@kyvvohq/disparos` (que já resolveu o mesmo
tipo de problema sem essa camada de config): lá, os dois consumidores
originais (Studio e People) já tinham criado a tabela com o MESMO nome por
coincidência. Aqui, o CRM já tinha dados reais em produção sob nomes
prefixados `crm_*` no momento da extração — renomear tabelas em produção é
arriscado e desnecessário, então os nomes viram configuração em vez de
hardcoded.

| Chave | Linhas mínimas esperadas (colunas que o pacote lê/escreve) |
|---|---|
| `config` | `tenant_id, modo ('desligado'\|'rascunho'\|'automatico'), modelo_runtime, limites (jsonb), horario_atendimento (jsonb), textos (jsonb), mensagem_fora_horario, retencao_logs_dias` |
| `conhecimento` | `tenant_id, tipo, conteudo_md, ativo` |
| `conversas` | `tenant_id, id, telefone_e164, situacao, cliente_id, nome_whatsapp, janela_expira_em, ultima_msg_cliente_em, pausada_ate, estado, atualizado_em` |
| `mensagens` | `tenant_id, telefone_e164, direcao, tipo, conteudo, autor, wamid, midia (jsonb), anexo_id, processada_em, tentativas, criado_em, status_entrega, categoria_cobranca, tokens_in, tokens_out, modelo` |
| `execucoes` | `tenant_id, conversa_id, mensagem_entrada_id, modelo, ferramentas_chamadas (jsonb), resposta_proposta, resposta_enviada, resposta_original, bloqueada_por_filtro, motivo_bloqueio, decisao, decidida_em, tokens_in, tokens_out, latencia_ms, aviso_fora_horario, criado_em` |
| `handoffs` | `tenant_id, conversa_id, cliente_id, pedido_id (pode ser null sempre, se o produto não tiver "pedido"), motivo, resumo, dados_coletados (jsonb), eh_vip, status ('aberto'\|'assumido'\|'resolvido'), atribuido_a, criado_em, atualizado_em` — índice único parcial `(tenant_id, conversa_id) where status = 'aberto'` |
| `numeros` | `tenant_id, phone_number_id, status ('ativo'\|...), criado_em` |
| `anexos` | `tenant_id, id, mensagem_id, chave_armazenamento, nome_arquivo, mime, tamanho, sha256` |
| `clientes` | `tenant_id, id, telefone, nome` — só usado pra resolver `cliente_id` no primeiro contato (`recebimento.js`); o NOME da cliente nunca é lido daqui pelo pacote, sempre via `resolverNomesClientes` (ver abaixo) |

## Pontos de extensão (o que o produto consumidor sempre fornece)

Tudo que é decisão de negócio — ferramentas do modelo, o que entra no
contexto dinâmico da conversa, o que o pós-filtro bloqueia, o que conta
como "gatilho de encaminhamento" — é responsabilidade de quem chama,
**nunca** deste pacote. `executarTurno` valida a presença de cada um destes
no topo e lança erro nomeado se faltar (mesmo princípio de `tabelas`):

```js
await agenteCore.executarTurno({ pool, tenantId, conversa, mensagens }, {
  agora,        // () => Date — obrigatório, sem default
  enviarTexto,  // ({to, texto, phoneNumberId}) => Promise<boolean> — obrigatório
  log,          // opcional, default console.error (único default aceitável: cosmético)
  ia,           // opcional — cria client Anthropic lazy se ausente

  ferramentas: { FERRAMENTAS, executarFerramenta, anexarMidia, transferirParaEquipe }, // obrigatório
  blocoDinamico,     // async (pool, {tenantId, conversa, config, agora}) => string — contrato, não implementação
  posfiltro: { padroes, fraseVip }, // padroes: [[nome, RegExp], ...] — termos bloqueados são do produto
  gatilhos: {
    padroes,          // [[motivo, RegExp], ...] — obrigatório
    comercial,         // RegExp — obrigatório ("pergunta comercial": valor/prazo/disponibilidade etc.)
    suprimirSeVip,     // opcional, default [] — motivos que não disparam com vipConfirmado
    motivoComercial,   // opcional, default 'pergunta_comercial' — nome do motivo quando `comercial` casa
    briefingMinimoExistente, // opcional, async (pool, {tenantId, clienteId}) => boolean, default sempre true
    extras,            // opcional, default [] — [{ ferramenta, extrair(texto), montarInput?(valor) }]
  },
});
```

`processarConversa` exige `midiaPermitida: ({mime, nomeArquivo}) => boolean`
(sem default — é 100% allowlist do produto). `receberWebhook` exige
`paraE164: (telefone) => string|null` (cada produto Kyvvo já mantém sua
própria cópia de normalização de telefone, propositalmente não
compartilhada entre produtos).

`atendimento.listarConversas`/`listarEncaminhamentos`/`obterConversaBase` e
`calcularMetricas` aceitam `resolverNomesClientes?: (pool, tenantId,
clienteIds[]) => Promise<Map<string,string>>` — opcional; sem ele, o nome
cai pro `nome_whatsapp` já salvo na conversa.

`atendimento.gravarHandoff(pool, {tenantId, conversaId, clienteId, pedidoId,
motivo, resumo, dadosColetados, ehVip})` é a função de baixo nível que as
ferramentas do produto chamam depois de resolver `pedidoId`/
`dadosColetados`/`ehVip` com as próprias queries (ex.: CRM resolve isso
contra `crm_pedidos`, que este pacote nunca vê).

## Testes

`node --test`, sem Postgres real — mock de pool (`{ query: async (sql,
params) => ({ rows }) }`), mesmo padrão de `@kyvvohq/disparos`.
