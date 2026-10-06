const { test } = require('node:test');
const assert = require('node:assert/strict');

const ENV_VARS = ['META_WHATSAPP_TOKEN', 'META_PHONE_NUMBER_ID', 'META_WABA_ID'];

// Isola cada teste de env vars herdadas do shell (mesmo padrão do @kyvvohq/asaas).
function comEnv(vars, fn) {
  const antes = { ...process.env };
  for (const k of ENV_VARS) delete process.env[k];
  Object.assign(process.env, vars);
  delete require.cache[require.resolve('..')];
  try {
    return fn(require('..'));
  } finally {
    for (const k of ENV_VARS) delete process.env[k];
    Object.assign(process.env, antes);
    delete require.cache[require.resolve('..')];
  }
}

function comFetchMock(respostas, fn) {
  const original = global.fetch;
  let chamada = 0;
  global.fetch = async () => {
    const resposta = respostas[chamada];
    chamada += 1;
    return { ok: resposta.ok !== false, status: resposta.status || 200, json: async () => resposta.body };
  };
  try {
    return fn();
  } finally {
    global.fetch = original;
  }
}

test('enviarTemplate: modo dev sem credencial, não toca a rede', async () => {
  await comEnv({}, async (whatsapp) => {
    const original = global.fetch;
    global.fetch = () => { throw new Error('não devia chamar fetch em modo dev'); };
    try {
      const ok = await whatsapp.enviarTemplate({ to: '+5511999999999', templateName: 'x' });
      assert.equal(ok, false);
    } finally {
      global.fetch = original;
    }
  });
});

test('enviarTemplate: sem templateName aborta mesmo com credencial', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_PHONE_NUMBER_ID: 'p' }, async (whatsapp) => {
    const ok = await whatsapp.enviarTemplate({ to: '+5511999999999', templateName: '' });
    assert.equal(ok, false);
  });
});

test('enviarTemplate: phoneNumberId por argumento vale sem META_PHONE_NUMBER_ID no env', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't' }, async (whatsapp) => {
    let urlChamada = null;
    const original = global.fetch;
    global.fetch = async (url) => { urlChamada = String(url); return { ok: true, status: 200, json: async () => ({}) }; };
    try {
      const ok = await whatsapp.enviarTemplate({ to: '+5511999999999', templateName: 'x', phoneNumberId: 'tenant-123' });
      assert.equal(ok, true);
      assert.ok(urlChamada.includes('/tenant-123/messages'), urlChamada);
    } finally {
      global.fetch = original;
    }
  });
});

test('enviarTemplate: sem phoneNumberId (arg nem env) cai em modo dev', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't' }, async (whatsapp) => {
    const original = global.fetch;
    global.fetch = () => { throw new Error('não devia chamar fetch'); };
    try {
      assert.equal(await whatsapp.enviarTemplate({ to: '+5511999999999', templateName: 'x' }), false);
    } finally {
      global.fetch = original;
    }
  });
});

test('enviarTexto: modo dev sem credencial, não toca a rede', async () => {
  await comEnv({}, async (whatsapp) => {
    const original = global.fetch;
    global.fetch = () => { throw new Error('não devia chamar fetch em modo dev'); };
    try {
      const ok = await whatsapp.enviarTexto({ to: '+5511999999999', texto: 'oi' });
      assert.equal(ok, false);
    } finally {
      global.fetch = original;
    }
  });
});

test('enviarTexto: phoneNumberId por argumento vale sem META_PHONE_NUMBER_ID no env', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't' }, async (whatsapp) => {
    let urlChamada = null;
    let corpoChamado = null;
    const original = global.fetch;
    global.fetch = async (url, opts) => {
      urlChamada = String(url);
      corpoChamado = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({}) };
    };
    try {
      const ok = await whatsapp.enviarTexto({ to: '+5511999999999', texto: 'oi', phoneNumberId: 'tenant-123' });
      assert.equal(ok, true);
      assert.ok(urlChamada.includes('/tenant-123/messages'), urlChamada);
      assert.deepEqual(corpoChamado.text, { body: 'oi' });
      assert.equal(corpoChamado.type, 'text');
    } finally {
      global.fetch = original;
    }
  });
});

test('enviarTexto: resposta de erro da Meta devolve false, não lança', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_PHONE_NUMBER_ID: 'p' }, async (whatsapp) => {
    await comFetchMock([{ ok: false, status: 401, body: { error: { message: 'token inválido' } } }], async () => {
      assert.equal(await whatsapp.enviarTexto({ to: '+5511999999999', texto: 'oi' }), false);
    });
  });
});

test('enviarBotoes: modo dev sem credencial, não toca a rede', async () => {
  await comEnv({}, async (whatsapp) => {
    const original = global.fetch;
    global.fetch = () => { throw new Error('não devia chamar fetch em modo dev'); };
    try {
      const ok = await whatsapp.enviarBotoes({ to: '+5511999999999', texto: 'oi', botoes: [{ id: 'a', titulo: 'A' }] });
      assert.equal(ok, false);
    } finally {
      global.fetch = original;
    }
  });
});

test('enviarBotoes: sem botões aborta mesmo com credencial', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_PHONE_NUMBER_ID: 'p' }, async (whatsapp) => {
    const ok = await whatsapp.enviarBotoes({ to: '+5511999999999', texto: 'oi', botoes: [] });
    assert.equal(ok, false);
  });
});

test('enviarBotoes: monta o payload interactive/button com id+title de cada botão', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't' }, async (whatsapp) => {
    let corpoChamado = null;
    const original = global.fetch;
    global.fetch = async (url, opts) => { corpoChamado = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({}) }; };
    try {
      const ok = await whatsapp.enviarBotoes({
        to: '+5511999999999', texto: 'Escolha uma opção', phoneNumberId: 'tenant-123',
        botoes: [{ id: 'fazer_pedido', titulo: 'Fazer pedido' }, { id: 'ver_lojas', titulo: 'Ver lojas' }],
      });
      assert.equal(ok, true);
      assert.equal(corpoChamado.type, 'interactive');
      assert.equal(corpoChamado.interactive.type, 'button');
      assert.equal(corpoChamado.interactive.body.text, 'Escolha uma opção');
      assert.deepEqual(corpoChamado.interactive.action.buttons, [
        { type: 'reply', reply: { id: 'fazer_pedido', title: 'Fazer pedido' } },
        { type: 'reply', reply: { id: 'ver_lojas', title: 'Ver lojas' } },
      ]);
    } finally {
      global.fetch = original;
    }
  });
});

test('enviarBotoes: resposta de erro da Meta devolve false, não lança', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_PHONE_NUMBER_ID: 'p' }, async (whatsapp) => {
    await comFetchMock([{ ok: false, status: 401, body: { error: { message: 'token inválido' } } }], async () => {
      assert.equal(await whatsapp.enviarBotoes({ to: '+5511999999999', texto: 'oi', botoes: [{ id: 'a', titulo: 'A' }] }), false);
    });
  });
});

test('enviarLista: modo dev sem credencial, não toca a rede', async () => {
  await comEnv({}, async (whatsapp) => {
    const original = global.fetch;
    global.fetch = () => { throw new Error('não devia chamar fetch em modo dev'); };
    try {
      const ok = await whatsapp.enviarLista({ to: '+5511999999999', texto: 'oi', tituloBotao: 'Escolher', opcoes: [{ id: 'a', titulo: 'A' }] });
      assert.equal(ok, false);
    } finally {
      global.fetch = original;
    }
  });
});

test('enviarLista: sem opções aborta mesmo com credencial', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_PHONE_NUMBER_ID: 'p' }, async (whatsapp) => {
    const ok = await whatsapp.enviarLista({ to: '+5511999999999', texto: 'oi', tituloBotao: 'Escolher', opcoes: [] });
    assert.equal(ok, false);
  });
});

test('enviarLista: monta o payload interactive/list com button + rows', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't' }, async (whatsapp) => {
    let corpoChamado = null;
    const original = global.fetch;
    global.fetch = async (url, opts) => { corpoChamado = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({}) }; };
    try {
      const ok = await whatsapp.enviarLista({
        to: '+5511999999999', texto: 'Qual é o tipo da peça?', tituloBotao: 'Escolher', phoneNumberId: 'tenant-123',
        opcoes: [{ id: 'biscoito', titulo: 'Cortador de biscoito' }, { id: 'outro', titulo: 'Outro' }],
      });
      assert.equal(ok, true);
      assert.equal(corpoChamado.type, 'interactive');
      assert.equal(corpoChamado.interactive.type, 'list');
      assert.equal(corpoChamado.interactive.body.text, 'Qual é o tipo da peça?');
      assert.equal(corpoChamado.interactive.action.button, 'Escolher');
      assert.deepEqual(corpoChamado.interactive.action.sections, [{
        rows: [
          { id: 'biscoito', title: 'Cortador de biscoito' },
          { id: 'outro', title: 'Outro' },
        ],
      }]);
    } finally {
      global.fetch = original;
    }
  });
});

test('enviarLista: resposta de erro da Meta devolve false, não lança', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_PHONE_NUMBER_ID: 'p' }, async (whatsapp) => {
    await comFetchMock([{ ok: false, status: 401, body: { error: { message: 'token inválido' } } }], async () => {
      assert.equal(await whatsapp.enviarLista({ to: '+5511999999999', texto: 'oi', tituloBotao: 'Escolher', opcoes: [{ id: 'a', titulo: 'A' }] }), false);
    });
  });
});

test('listarTemplates: wabaId por argumento vale sem META_WABA_ID no env', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't' }, async (whatsapp) => {
    let urlChamada = null;
    const original = global.fetch;
    global.fetch = async (url) => { urlChamada = String(url); return { ok: true, status: 200, json: async () => ({ data: [] }) }; };
    try {
      await whatsapp.listarTemplates({ wabaId: 'waba-do-tenant' });
      assert.ok(urlChamada.includes('/waba-do-tenant/message_templates'), urlChamada);
    } finally {
      global.fetch = original;
    }
  });
});

test('listarTemplates: sem wabaId (arg nem env) devolve lista vazia', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't' }, async (whatsapp) => {
    assert.deepEqual(await whatsapp.listarTemplates(), []);
  });
});

test('listarTemplates: sem credencial devolve lista vazia, não toca a rede', async () => {
  await comEnv({}, async (whatsapp) => {
    assert.deepEqual(await whatsapp.listarTemplates(), []);
    assert.deepEqual(await whatsapp.listarTemplates({ prefixo: 'people_' }), []);
  });
});

const TEMPLATE_NOMEADO_COM_BOTAO = {
  name: 'people_confirma_1', status: 'APPROVED', language: 'pt_BR',
  components: [
    {
      type: 'BODY', text: 'Olá {{nome}}, vaga {{vaga}}',
      example: { body_text_named_params: [{ param_name: 'nome', example: 'Ana' }, { param_name: 'vaga', example: 'Dev' }] },
    },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Ver', url: 'https://x.com/people/avaliacao/{{1}}' }] },
  ],
};
const TEMPLATE_STUDIO = { name: 'studio_confirma_agenda', status: 'APPROVED', language: 'pt_BR', components: [] };

test('listarTemplates: filtra por prefixo — WABA compartilhada entre produtos', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_WABA_ID: 'w' }, async (whatsapp) => {
    await comFetchMock([{ body: { data: [TEMPLATE_NOMEADO_COM_BOTAO, TEMPLATE_STUDIO] } }], async () => {
      const lista = await whatsapp.listarTemplates({ prefixo: 'people_' });
      assert.equal(lista.length, 1);
      assert.equal(lista[0].nome, 'people_confirma_1');
    });
  });
});

test('listarTemplates: extrai parâmetros nomeados, botão e o prefixo da URL do botão', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_WABA_ID: 'w' }, async (whatsapp) => {
    await comFetchMock([{ body: { data: [TEMPLATE_NOMEADO_COM_BOTAO] } }], async () => {
      const [t] = await whatsapp.listarTemplates();
      assert.deepEqual(t.parametros_corpo, ['nome', 'vaga']);
      assert.equal(t.parametros_nomeados, true);
      assert.equal(t.tem_botao_url, true);
      assert.equal(t.botao_texto, 'Ver');
      assert.equal(t.botao_url_prefixo, 'https://x.com/people/avaliacao/');
    });
  });
});

const TEMPLATE_POSICIONAL_SEM_BOTAO = {
  name: 'people_antigo', status: 'APPROVED', language: 'pt_BR',
  components: [{ type: 'BODY', text: 'Olá {{1}}, vaga {{2}}' }],
};

test('listarTemplates: template posicional (sem nome) sintetiza "1","2"... e não marca nomeado', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_WABA_ID: 'w' }, async (whatsapp) => {
    await comFetchMock([{ body: { data: [TEMPLATE_POSICIONAL_SEM_BOTAO] } }], async () => {
      const [t] = await whatsapp.listarTemplates();
      assert.deepEqual(t.parametros_corpo, ['1', '2']);
      assert.equal(t.parametros_nomeados, false);
      assert.equal(t.tem_botao_url, false);
      assert.equal(t.botao_url_prefixo, null);
    });
  });
});

test('listarTemplates: resposta de erro da Meta devolve lista vazia, não lança', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_WABA_ID: 'w' }, async (whatsapp) => {
    await comFetchMock([{ ok: false, status: 401, body: { error: { message: 'token inválido' } } }], async () => {
      assert.deepEqual(await whatsapp.listarTemplates(), []);
    });
  });
});

test('criarTemplate: modo dev sem credencial, não toca a rede e devolve ok:false', async () => {
  await comEnv({}, async (whatsapp) => {
    const original = global.fetch;
    global.fetch = () => { throw new Error('não devia chamar fetch em modo dev'); };
    try {
      const r = await whatsapp.criarTemplate({ wabaId: 'w', nome: 'x', categoria: 'UTILITY', corpo: 'Oi {{cliente}}' });
      assert.deepEqual(r, { ok: false, jaExiste: false, erro: 'sem credencial' });
    } finally {
      global.fetch = original;
    }
  });
});

test('criarTemplate: extrai parâmetros nomeados do próprio corpo e manda no payload', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't' }, async (whatsapp) => {
    let corpoEnviado = null;
    let urlChamada = null;
    const original = global.fetch;
    global.fetch = async (url, opts) => {
      urlChamada = String(url);
      corpoEnviado = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ id: 'tpl-1' }) };
    };
    try {
      const r = await whatsapp.criarTemplate({
        wabaId: 'waba-1', nome: 'pedido_parado', categoria: 'UTILITY',
        corpo: 'Oi {{cliente}}, pedido parado em {{etapa}} há {{dias_parado}} dia(s).',
      });
      assert.deepEqual(r, { ok: true, jaExiste: false, id: 'tpl-1' });
      assert.ok(urlChamada.includes('/waba-1/message_templates'), urlChamada);
      assert.equal(corpoEnviado.name, 'pedido_parado');
      assert.equal(corpoEnviado.category, 'UTILITY');
      assert.equal(corpoEnviado.components[0].type, 'BODY');
      assert.deepEqual(
        corpoEnviado.components[0].example.body_text_named_params.map((p) => p.param_name),
        ['cliente', 'etapa', 'dias_parado']
      );
    } finally {
      global.fetch = original;
    }
  });
});

test('criarTemplate: sem parâmetro no corpo não manda "example"', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_WABA_ID: 'w' }, async (whatsapp) => {
    let corpoEnviado = null;
    await comFetchMock([{ body: { id: 'tpl-2' } }], async () => {
      const original = global.fetch;
      global.fetch = async (url, opts) => { corpoEnviado = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ id: 'tpl-2' }) }; };
      try {
        await whatsapp.criarTemplate({ nome: 'sem_param', categoria: 'MARKETING', corpo: 'Mensagem fixa, sem variável.' });
      } finally {
        global.fetch = original;
      }
    });
    assert.equal(corpoEnviado.components[0].example, undefined);
  });
});

test('criarTemplate: Meta recusando por nome duplicado conta como ok (jaExiste)', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_WABA_ID: 'w' }, async (whatsapp) => {
    await comFetchMock([{ ok: false, status: 400, body: { error: { message: 'Template name already exists in this language' } } }], async () => {
      const r = await whatsapp.criarTemplate({ nome: 'pedido_parado', categoria: 'UTILITY', corpo: 'Oi {{cliente}}' });
      assert.deepEqual(r, { ok: true, jaExiste: true, erro: null });
    });
  });
});

test('criarTemplate: outro erro da Meta devolve ok:false sem lançar', async () => {
  await comEnv({ META_WHATSAPP_TOKEN: 't', META_WABA_ID: 'w' }, async (whatsapp) => {
    await comFetchMock([{ ok: false, status: 400, body: { error: { message: 'Invalid parameter' } } }], async () => {
      const r = await whatsapp.criarTemplate({ nome: 'x', categoria: 'UTILITY', corpo: 'Oi {{cliente}}' });
      assert.equal(r.ok, false);
      assert.equal(r.jaExiste, false);
      assert.equal(r.erro, 'Invalid parameter');
    });
  });
});
