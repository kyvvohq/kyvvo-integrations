// Preço por modelo, US$ por 1 milhão de tokens [entrada, saída]. Tokens de
// cache entram como entrada normal (estimativa conservadora, um pouco acima
// do real). Portado de kyvvo-crm/lib/agente/precos.js sem mudança de
// comportamento. É preço da Anthropic, não do produto — compartilhado entre
// todos os consumidores do pacote. Atualizar a tabela aqui (nova versão do
// pacote) quando a Anthropic mudar os preços, em vez de em cada produto.
const PRECOS_USD_POR_MTOK = {
  'claude-haiku-4-5': [1.0, 5.0],
  'claude-haiku-5-5': [0.1, 0.5], // acima de 100 mil tokens de prompt o preço sobe; prompt típico é bem menor
};

function custoUsd(modelo, tokensIn, tokensOut) {
  const p = PRECOS_USD_POR_MTOK[modelo];
  if (!p) return null; // modelo sem preço conhecido: não inventa
  return ((Number(tokensIn) || 0) * p[0] + (Number(tokensOut) || 0) * p[1]) / 1e6;
}

module.exports = { PRECOS_USD_POR_MTOK, custoUsd };
