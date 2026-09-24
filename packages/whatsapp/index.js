// Cliente WhatsApp Cloud API (Meta) compartilhado pelos produtos Kyvvo.
// Extraído de kyvvo-people/lib/whatsapp.js (2026-09-09) — primeiro produto a
// usar foi o People (notificações de candidatura), mas nada aqui é
// específico dele; cada produto lê suas próprias env vars (mesmo container,
// nomes iguais aos de antes) e passa o que for específico como argumento.
//
// Modelos de número/WABA (2026-09-10): o People tem UM número/WABA
// (`META_PHONE_NUMBER_ID`/`META_WABA_ID` no env). O Studio tem UM POR TENANT
// (`tenants.meta_phone_number_id`/`meta_waba_id`), com o mesmo token de
// System User — por isso `enviarTemplate` aceita `phoneNumberId` e
// `listarTemplates` aceita `wabaId` por chamada, caindo no env quando o arg
// não vem. O token (`META_WHATSAPP_TOKEN`) é sempre do env.
//
// Mensagem proativa (o destinatário nunca escreveu antes pro número) só é
// aceita pela Meta via `template` (nome aprovado previamente no Meta
// Business Manager) — texto livre só funciona dentro da janela de 24h de
// uma conversa que o destinatário iniciou, o que nunca é o caso dos envios
// deste cliente.
//
// Achado em produção (People, 2026-09-09): os templates aprovados podem
// usar parâmetro NOMEADO no corpo (`{{nome}}`, `{{vaga}}`) em vez de
// posicional (`{{1}}`, `{{2}}`) — mandar posicional sem `parameter_name`
// faz a Meta devolver 400 "(#132000) Number of parameters does not match
// the expected number of params", mesmo com a contagem certa.
// `parametrosCorpo` aqui é `[{ nome?, valor, nomeado }]` — `nomeado:true`
// manda `parameter_name`, `nomeado:false` manda posicional puro (templates
// mais antigos que ainda usem `{{1}}`/`{{2}}`).
//
// O botão de URL dinâmica é sempre posicional (é assim que a Meta define
// botão, nomeado ou não o corpo) — `parametroBotao` preenche o `{{1}}` da
// URL do botão, só o trecho dinâmico (a base já está fixa no template
// aprovado). Achado (People, 2026-09-09): a base do botão varia por
// template — alguns terminam num subcaminho fixo (ex.: ".../avaliacao/"),
// outros são só a raiz do domínio — por isso o valor certo do parâmetro
// depende de comparar o CAMINHO alvo com `botao_url_prefixo` (devolvido por
// listarTemplates), não é sempre "só o último segmento". Essa comparação é
// específica de cada produto (o formato do link varia por produto), então
// fica por conta de quem chama montar o parâmetro certo antes de passar
// pra enviarTemplate — este módulo só transporta o que foi decidido.
const GRAPH_API_VERSION = 'v22.0';

// `phoneNumberId` opcional: quem manda o argumento (Studio — um número Meta
// por tenant, token de System User compartilhado) sobrepõe o env; quem não
// manda (People — um número só) cai em `META_PHONE_NUMBER_ID`. Sem token nem
// número (arg ou env), cai em modo de log (mesmo padrão dev-mode do
// @kyvvohq/asaas) — seguro em dev/homologação e até as credenciais existirem.
async function enviarTemplate({ to, templateName, parametrosCorpo = [], parametroBotao, idioma = 'pt_BR', phoneNumberId }) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const numeroId = phoneNumberId || process.env.META_PHONE_NUMBER_ID;

  if (!token || !numeroId) {
    console.log(`[whatsapp] (dev) template "${templateName}" para ${to}: corpo=${JSON.stringify(parametrosCorpo)} botao=${parametroBotao || '-'}`);
    return false;
  }
  if (!templateName) {
    console.error(`[whatsapp] Sem templateName — envio pra ${to} abortado.`);
    return false;
  }

  const components = [];
  if (parametrosCorpo.length) {
    components.push({
      type: 'body',
      parameters: parametrosCorpo.map((p) => (p.nomeado
        ? { type: 'text', parameter_name: p.nome, text: String(p.valor) }
        : { type: 'text', text: String(p.valor) })),
    });
  }
  if (parametroBotao) {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(parametroBotao) }] });
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${numeroId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: idioma }, components: components.length ? components : undefined },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const erro = await res.json().catch(() => ({}));
      console.error(`[whatsapp] Meta respondeu ${res.status} ao enviar template "${templateName}" pra ${to}: ${(erro.error && erro.error.message) || ''}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[whatsapp] Falha ao enviar template "${templateName}" pra ${to}: ${err.message}`);
    return false;
  }
}

// Texto livre — só é aceito pela Meta dentro da janela de 24h de uma
// conversa que o destinatário iniciou (diferente de enviarTemplate, que é
// pra mensagem proativa). Primeiro uso: bot conversacional do CRM
// (kyvvo-crm), respondendo a uma mensagem que acabou de chegar — está
// sempre dentro da janela porque é sempre uma resposta. Mesmo `phoneNumberId`
// opcional/modo dev de enviarTemplate.
async function enviarTexto({ to, texto, phoneNumberId }) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const numeroId = phoneNumberId || process.env.META_PHONE_NUMBER_ID;

  if (!token || !numeroId) {
    console.log(`[whatsapp] (dev) texto para ${to}: ${texto}`);
    return false;
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${numeroId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: texto },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const erro = await res.json().catch(() => ({}));
      console.error(`[whatsapp] Meta respondeu ${res.status} ao enviar texto pra ${to}: ${(erro.error && erro.error.message) || ''}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[whatsapp] Falha ao enviar texto pra ${to}: ${err.message}`);
    return false;
  }
}

// Lista os templates cadastrados numa WABA — usado pra virar um <select> em
// vez de digitar o nome na mão, E pra saber os nomes exatos dos parâmetros do
// corpo/a base do botão na hora de montar o envio de verdade. `wabaId`
// opcional: Studio passa o `meta_waba_id` do tenant (uma WABA por tenant),
// People/os demais caem no env `META_WABA_ID`. `prefixo`, se passado, filtra
// por nome — quando a WABA é compartilhada entre produtos (ex.: People e o
// pool do Studio), sem o filtro a lista de um produto traz os do outro. Sem
// credencial, devolve lista vazia.
async function listarTemplates({ prefixo, wabaId } = {}) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const waba = wabaId || process.env.META_WABA_ID;
  if (!token || !waba) return [];

  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${waba}/message_templates`);
    url.searchParams.set('fields', 'name,status,language,components');
    url.searchParams.set('limit', '100');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      const erro = await res.json().catch(() => ({}));
      console.error(`[whatsapp] Meta respondeu ${res.status} ao listar templates: ${(erro.error && erro.error.message) || ''}`);
      return [];
    }
    const { data } = await res.json();
    return (data || [])
      .filter((t) => !prefixo || t.name.startsWith(prefixo))
      .map((t) => {
        const corpo = (t.components || []).find((c) => c.type === 'BODY');
        const botoes = (t.components || []).find((c) => c.type === 'BUTTONS');
        const botaoUrl = botoes && botoes.buttons && botoes.buttons.find((b) => b.type === 'URL' && /\{\{\d+\}\}/.test(b.url || ''));

        // Nomeado (`{{nome}}`, `{{vaga}}`): a Meta devolve os nomes em
        // body_text_named_params. Sem isso, é template antigo/posicional
        // (`{{1}}`, `{{2}}`) — sintetiza nomes "1", "2"... só pra contar.
        const nomeadosInfo = corpo && corpo.example && corpo.example.body_text_named_params;
        const parametrosNomeados = !!(nomeadosInfo && nomeadosInfo.length);
        const parametrosCorpo = parametrosNomeados
          ? nomeadosInfo.map((p) => p.param_name)
          : Array.from({ length: corpo && corpo.text ? (corpo.text.match(/\{\{\d+\}\}/g) || []).length : 0 }, (_, i) => String(i + 1));

        return {
          nome: t.name, status: t.status, idioma: t.language, corpo: corpo ? corpo.text : '',
          parametros_corpo: parametrosCorpo, parametros_nomeados: parametrosNomeados,
          tem_botao_url: !!botaoUrl, botao_texto: botaoUrl ? botaoUrl.text : null,
          botao_url_prefixo: botaoUrl ? botaoUrl.url.split('{{1}}')[0] : null,
        };
      });
  } catch (err) {
    console.error(`[whatsapp] Falha ao listar templates: ${err.message}`);
    return [];
  }
}

module.exports = { enviarTemplate, enviarTexto, listarTemplates };
