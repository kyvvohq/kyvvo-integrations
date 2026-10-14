// Pós-filtro determinístico sobre a resposta final do agente: garantia em
// código de que o agente não afirma algo que o produto considera sensível
// demais pra sair sem revisão humana (no CRM: valor, prazo, frete, pagamento,
// estoque, desconto — mas a lista de termos é do produto consumidor, nunca
// deste pacote). Portado de kyvvo-crm/lib/agente/posfiltro.js.
//
// `padroes` é obrigatório: `[[nome, RegExp], ...]`, testado contra o texto
// normalizado (sem acento, minúsculo). Sem `padroes`, lança erro — nenhuma
// resposta deve ser considerada "sem filtro" por omissão silenciosa.

// Compara sem acento e sem caixa. Mantém o tamanho do texto (NFD só separa
// diacríticos, que removemos) — os índices continuam válidos para recortes.
function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// { ok, motivos[] }. `fraseVip` só é aceita se `vipConfirmado` for true.
function filtrarResposta(texto, { padroes, fraseVip = null, vipConfirmado = false } = {}) {
  if (!Array.isArray(padroes)) {
    throw new Error('@kyvvohq/agente-core: filtrarResposta — padroes é obrigatório (lista [[nome, regex], ...] do produto consumidor)');
  }
  let alvo = normalizar(texto);
  if (fraseVip && vipConfirmado) {
    // remove a frase canônica antes de varrer; qualquer outra menção continua barrada
    alvo = alvo.split(normalizar(fraseVip)).join(' ');
  }
  const motivos = [];
  for (const [nome, re] of padroes) if (re.test(alvo)) motivos.push(nome);
  return { ok: motivos.length === 0, motivos };
}

// CPF e e-mail não vão ao modelo (LGPD): mascara o que a cliente digitou.
function higienizarEntrada(texto) {
  return String(texto || '')
    .replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, '[CPF removido]')
    .replace(/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}\/?\d{4}[-\s]?\d{2}\b/g, '[CNPJ removido]');
}

module.exports = { filtrarResposta, higienizarEntrada, normalizar };
