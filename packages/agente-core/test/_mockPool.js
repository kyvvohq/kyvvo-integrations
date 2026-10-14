// Pool fake por casamento de padrão na SQL — não tenta ser um banco de
// verdade. Os testes deste pacote validam o CONTRATO (validação de deps,
// pontos de extensão chamados do jeito certo), não a correção da SQL em si
// (isso é responsabilidade da suíte do produto consumidor, contra Postgres
// real — ver test/agente-*.test.js no kyvvo-crm).
function criarPoolFake(handlers) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, params) {
      chamadas.push(sql);
      for (const [padrao, fn] of handlers) {
        if (padrao.test(sql)) return fn(sql, params) || { rows: [] };
      }
      throw new Error('query inesperada no teste (adicione um handler): ' + sql.replace(/\s+/g, ' ').trim().slice(0, 120));
    },
    async connect() {
      const self = this;
      return { query: (...a) => self.query(...a), release() {} };
    },
  };
}

module.exports = { criarPoolFake };
