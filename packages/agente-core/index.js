// @kyvvohq/agente-core — motor compartilhado do agente de atendimento por
// WhatsApp (contexto -> modelo com ferramentas -> pós-filtro -> rascunho ou
// envio), extraído do kyvvo-crm (2026-10-14). Ver README.md para o contrato
// completo de cada ponto de extensão.
const { dentroDoHorario } = require('./src/horario');
const { PRECOS_USD_POR_MTOK, custoUsd } = require('./src/precos');
const { filtrarResposta, higienizarEntrada, normalizar } = require('./src/posfiltro');
const { detectarGatilhos, perguntaComercial } = require('./src/gatilhos');
const { extrairMudancas, normalizarMensagem, tipoNormalizado } = require('./src/entrada');
const criarContexto = require('./src/contexto');
const criarExecutor = require('./src/executor');
const criarProcessador = require('./src/processador');
const { agenteEmPausa, MAX_TENTATIVAS } = criarProcessador;
const criarRecebimento = require('./src/recebimento');
const criarAtendimento = require('./src/atendimento');
const criarMetricas = require('./src/metricas');
const criarRetencao = require('./src/retencao');

// Nenhum default: falha cedo e nomeado no boot do produto consumidor, nunca
// silenciosamente em produção (ver DECISÃO DELIBERADA em src/executor.js,
// ligada ao incidente de 2026-10-13 no kyvvo-crm).
const CHAVES_TABELAS_OBRIGATORIAS = [
  'config', 'conhecimento', 'conversas', 'mensagens', 'execucoes', 'handoffs', 'numeros', 'anexos', 'clientes',
];

function criarAgenteCore({ tabelas } = {}) {
  if (!tabelas || typeof tabelas !== 'object') {
    throw new Error('@kyvvohq/agente-core: criarAgenteCore — tabelas é obrigatório');
  }
  for (const chave of CHAVES_TABELAS_OBRIGATORIAS) {
    if (!tabelas[chave]) throw new Error(`@kyvvohq/agente-core: tabelas.${chave} é obrigatório`);
  }

  const contexto = criarContexto({ tabelas });
  const executor = criarExecutor({ tabelas, contexto });
  const processador = criarProcessador({ tabelas });
  const recebimento = criarRecebimento({ tabelas });
  const atendimento = criarAtendimento({ tabelas });
  const metricas = criarMetricas({ tabelas });
  const retencao = criarRetencao({ tabelas });

  return {
    // contexto
    carregarConhecimento: contexto.carregarConhecimento,
    carregarHistorico: contexto.carregarHistorico,
    montarSystem: contexto.montarSystem,
    // executor
    executarTurno: executor.executarTurno,
    criarClienteAnthropic: executor.criarClienteAnthropic,
    MAX_ITERACOES: executor.MAX_ITERACOES,
    // processador
    processarConversa: processador.processarConversa,
    varrerPendentes: processador.varrerPendentes,
    agenteEmPausa,
    MAX_TENTATIVAS,
    // recebimento
    receberWebhook: recebimento.receberWebhook,
    carregarCanalAtivo: recebimento.carregarCanalAtivo,
    // atendimento (inclui gravarHandoff, usado pelas ferramentas do produto)
    atendimento,
    gravarHandoff: atendimento.gravarHandoff,
    // métricas e retenção
    calcularMetricas: metricas.calcular,
    expurgarLogs: retencao.expurgarLogs,
  };
}

module.exports = {
  criarAgenteCore,
  // Funções puras, sem pool/schema — não precisam de criarAgenteCore.
  dentroDoHorario,
  PRECOS_USD_POR_MTOK,
  custoUsd,
  filtrarResposta,
  higienizarEntrada,
  normalizar,
  detectarGatilhos,
  perguntaComercial,
  extrairMudancas,
  normalizarMensagem,
  tipoNormalizado,
};
