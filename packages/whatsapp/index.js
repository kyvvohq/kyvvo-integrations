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

// Mensagem interativa com até 3 botões de resposta rápida (WhatsApp
// "interactive/button") — usado pelo bot do CRM pra fluxo guiado por toque
// em vez de "responda com o número X". `botoes`: [{ id, titulo }], `titulo`
// até 20 caracteres (limite da Meta) e `id` é o que volta no
// `interactive.button_reply.id` da mensagem seguinte, não o texto exibido.
// Mesma janela de 24h/contrato de phoneNumberId/modo dev de enviarTexto.
async function enviarBotoes({ to, texto, botoes = [], phoneNumberId }) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const numeroId = phoneNumberId || process.env.META_PHONE_NUMBER_ID;

  if (!token || !numeroId) {
    console.log(`[whatsapp] (dev) botões para ${to}: ${texto} | opções: ${botoes.map((b) => b.titulo).join(', ')}`);
    return false;
  }
  if (!botoes.length) {
    console.error(`[whatsapp] enviarBotoes sem botões — envio pra ${to} abortado.`);
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
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: texto },
          action: { buttons: botoes.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.titulo } })) },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const erro = await res.json().catch(() => ({}));
      console.error(`[whatsapp] Meta respondeu ${res.status} ao enviar botões pra ${to}: ${(erro.error && erro.error.message) || ''}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[whatsapp] Falha ao enviar botões pra ${to}: ${err.message}`);
    return false;
  }
}

// Mensagem interativa com lista de opções (WhatsApp "interactive/list") —
// pra quando há mais opções do que cabem em botões (máx. 3 em enviarBotoes;
// lista aceita até 10). `opcoes`: [{ id, titulo, descricao? }], `titulo` até
// 24 caracteres e `descricao` até 72 (limites da Meta). `tituloBotao` é o
// rótulo do botão que abre a lista (até 20 caracteres). `id` volta em
// `interactive.list_reply.id` na próxima mensagem do cliente. Mesma janela
// de 24h/fallback/modo dev de enviarTexto.
async function enviarLista({ to, texto, tituloBotao, opcoes = [], phoneNumberId }) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const numeroId = phoneNumberId || process.env.META_PHONE_NUMBER_ID;

  if (!token || !numeroId) {
    console.log(`[whatsapp] (dev) lista para ${to}: ${texto} | opções: ${opcoes.map((o) => o.titulo).join(', ')}`);
    return false;
  }
  if (!opcoes.length) {
    console.error(`[whatsapp] enviarLista sem opções — envio pra ${to} abortado.`);
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
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: texto },
          action: {
            button: tituloBotao,
            sections: [{ rows: opcoes.map((o) => ({ id: o.id, title: o.titulo, description: o.descricao })) }],
          },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const erro = await res.json().catch(() => ({}));
      console.error(`[whatsapp] Meta respondeu ${res.status} ao enviar lista pra ${to}: ${(erro.error && erro.error.message) || ''}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[whatsapp] Falha ao enviar lista pra ${to}: ${err.message}`);
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

// Exemplos padrão pro `example.body_text_named_params` que a Meta exige ao
// criar um template com parâmetro nomeado — nomes já usados pelos produtos
// (ver CRM lib/automacoes.js e Studio server/panel/lib/automacoes.js);
// "Exemplo" cobre qualquer nome que não esteja no mapa.
const EXEMPLOS_PARAMETRO = {
  cliente: 'Maria', etapa: 'Produção', dias_parado: '3', pedido_valor: 'R$ 150,00',
  salao: 'Studio Kyvvo', servico: 'Corte', profissional: 'Ana', data: '20/10/2026', hora: '14:00',
};

// Criação de template pra onboarding de WABA (Fase 2, 2026-10-06): até aqui
// só listarTemplates (ler) e enviarTemplate (mandar um já aprovado) — nada
// criava um template novo. Usado quando um tenant conecta a própria WABA:
// cada produto já tem o corpo/nome das mensagens padrão (crm_automacoes.corpo,
// Studio automacoes.corpo) — isto só submete cada corpo como template de
// verdade pra Meta aprovar, extraindo os nomes de parâmetro ({{cliente}},
// {{etapa}}...) do próprio texto em vez de pedir uma lista separada.
// `categoria`: 'UTILITY'|'MARKETING'|'AUTHENTICATION' (exigência da Meta).
// Devolve {ok, jaExiste, erro} — nunca lança (um template malformado não
// pode derrubar o resto do onboarding). `jaExiste:true` conta como sucesso
// (reconectar uma WABA não deve falhar por um template que já existe de uma
// tentativa anterior).
async function criarTemplate({ wabaId, nome, categoria, corpo, idioma = 'pt_BR' }) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const waba = wabaId || process.env.META_WABA_ID;

  if (!token || !waba) {
    console.log(`[whatsapp] (dev) criarTemplate "${nome}" (${categoria}): ${corpo}`);
    return { ok: false, jaExiste: false, erro: 'sem credencial' };
  }

  const nomesParametros = [...new Set((corpo.match(/\{\{\w+\}\}/g) || []).map((m) => m.slice(2, -2)))];
  const componenteCorpo = {
    type: 'BODY',
    text: corpo,
    ...(nomesParametros.length ? {
      example: { body_text_named_params: nomesParametros.map((p) => ({ param_name: p, example: EXEMPLOS_PARAMETRO[p] || 'Exemplo' })) },
    } : {}),
  };

  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${waba}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nome, language: idioma, category: categoria, components: [componenteCorpo] }),
      signal: AbortSignal.timeout(8000),
    });
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) {
      const mensagem = (dados.error && dados.error.message) || '';
      const jaExiste = /already exists|duplicate/i.test(mensagem);
      if (!jaExiste) console.error(`[whatsapp] Meta respondeu ${res.status} ao criar template "${nome}": ${mensagem}`);
      return { ok: jaExiste, jaExiste, erro: jaExiste ? null : mensagem };
    }
    return { ok: true, jaExiste: false, id: dados.id };
  } catch (err) {
    console.error(`[whatsapp] Falha ao criar template "${nome}": ${err.message}`);
    return { ok: false, jaExiste: false, erro: err.message };
  }
}

module.exports = { enviarTemplate, enviarTexto, enviarBotoes, enviarLista, listarTemplates, criarTemplate };
