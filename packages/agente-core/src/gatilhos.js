// Gatilhos de encaminhamento garantidos em código. O prompt pede ao modelo que chame
// transferir_para_equipe nesses casos, mas modelos pequenos às vezes só respondem em texto.
// Aqui o servidor lê a mensagem da cliente e garante o handoff — o modelo continua
// conduzindo a conversa, só não pode "esquecer" de passar para a equipe. Portado de
// kyvvo-crm/lib/agente/gatilhos.js: a lista de padrões e a regex de "pergunta
// comercial" são do produto consumidor (domínio de negócio), nunca deste pacote
// — só a lógica de varredura é genérica.
const { normalizar } = require('./posfiltro');

// `padroes`: [[motivo, RegExp], ...], em ordem de prioridade. `suprimirSeVip`:
// lista de motivos que não disparam quando `vipConfirmado` é true (no CRM,
// "negociacao_desconto" — cliente VIP perguntando de desconto não é um
// problema que precisa de encaminhamento).
function detectarGatilhos(texto, { padroes, vipConfirmado = false, suprimirSeVip = [] } = {}) {
  if (!Array.isArray(padroes)) {
    throw new Error('@kyvvohq/agente-core: detectarGatilhos — padroes é obrigatório (lista [[motivo, regex], ...] do produto consumidor)');
  }
  const t = normalizar(texto);
  return padroes
    .filter(([motivo, re]) => re.test(t) && !(vipConfirmado && suprimirSeVip.includes(motivo)))
    .map(([motivo]) => motivo);
}

// `comercial`: RegExp do produto consumidor (perguntas de valor/prazo/frete/
// pagamento/disponibilidade, ou o que for "comercial" nesse domínio).
function perguntaComercial(texto, { comercial } = {}) {
  if (!(comercial instanceof RegExp)) {
    throw new Error('@kyvvohq/agente-core: perguntaComercial — comercial (RegExp) é obrigatório');
  }
  return comercial.test(normalizar(texto));
}

module.exports = { detectarGatilhos, perguntaComercial };
