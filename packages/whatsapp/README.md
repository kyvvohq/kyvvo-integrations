# @kyvvohq/whatsapp

Cliente WhatsApp Cloud API (Meta) compartilhado pelos produtos Kyvvo. Extraído
de `kyvvo-people/lib/whatsapp.js` (2026-09-09) — primeiro produto a usar foi o
People, mas nada aqui é específico dele.

## Contrato

```js
const whatsapp = require('@kyvvohq/whatsapp');

await whatsapp.enviarTemplate({ to, templateName, parametrosCorpo, parametroBotao, idioma });
await whatsapp.listarTemplates({ prefixo });
```

### `enviarTemplate`

Mensagem proativa (destinatário nunca escreveu antes) só é aceita pela Meta
via template aprovado — nunca texto livre.

- `parametrosCorpo`: `[{ nome?, valor, nomeado }]`. Templates aprovados podem
  usar parâmetro **nomeado** no corpo (`{{nome}}`, `{{vaga}}`) — nesse caso
  `nomeado: true` + `nome` (o nome exato que a Meta espera, vem de
  `listarTemplates().parametros_corpo`). Sem isso a Meta devolve 400
  `(#132000) Number of parameters does not match`, mesmo com a contagem
  certa. Templates antigos com `{{1}}`/`{{2}}` posicional usam
  `nomeado: false` (sem `nome`).
- `parametroBotao`: só o trecho dinâmico da URL do botão (a base já está
  fixa no template aprovado) — sempre posicional, nomeado ou não o corpo.
  **A base do botão varia por template** (alguns terminam num subcaminho
  fixo, outros são só a raiz do domínio) — comparar o caminho alvo com
  `botao_url_prefixo` (de `listarTemplates`) pra saber o valor certo é
  responsabilidade de quem chama, não deste módulo.

### `listarTemplates({ prefixo })`

Lista os templates da WABA (`META_WABA_ID`). `prefixo` filtra por nome —
várias WABAs são compartilhadas entre produtos Kyvvo, sem filtrar a lista de
um produto traria templates de outro. Cada item devolvido:

```js
{
  nome, status, idioma, corpo,
  parametros_corpo,      // nomes reais (nomeado) ou ['1','2',...] sintético (posicional)
  parametros_nomeados,   // true = manda parameter_name em enviarTemplate
  tem_botao_url, botao_texto, botao_url_prefixo,
}
```

## Ambiente

- `META_WHATSAPP_TOKEN`, `META_PHONE_NUMBER_ID`, `META_WABA_ID` — sem essas
  três, `enviarTemplate` cai em **modo dev** (só loga, não toca a rede) e
  `listarTemplates` devolve `[]`. Cada produto lê a própria env var (mesmo
  nome, valor isolado por container — mesmo padrão do `@kyvvohq/asaas`).

## Testes

`npm test` (node:test). Cobre modo dev (sem credencial) e o filtro por
`prefixo`/parsing de `listarTemplates` contra uma resposta mockada da Meta.
