const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { migrar } = require('..');

// Pool falso: registra toda query e simula a tabela de controle em memória.
function fakePool({ jaAplicadas = [] } = {}) {
  const aplicadas = new Set(jaAplicadas);
  const queries = [];
  const clientQueries = [];
  const client = {
    query: async (sql, params) => {
      clientQueries.push(sql.trim().split('\n')[0].trim());
      if (/^insert into/i.test(sql.trim())) aplicadas.add(params[0]);
      return { rows: [] };
    },
    release: () => { client.released = true; },
    released: false,
  };
  const pool = {
    query: async (sql, params) => {
      queries.push(sql.trim().split('\n')[0].trim());
      if (/^select 1 from/i.test(sql.trim())) {
        return { rows: aplicadas.has(params[0]) ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [] };
    },
    connect: async () => client,
  };
  return { pool, queries, clientQueries, client, aplicadas };
}

function dirTemp(arquivos) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dbmig-'));
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    fs.writeFileSync(path.join(d, nome), conteudo);
  }
  return d;
}

test('aplica só os .sql pendentes, em ordem, cada um numa transação', async () => {
  const dir = dirTemp({
    '002_b.sql': 'create table b();',
    '001_a.sql': 'create table a();',
    '003_c.sql': 'create table c();',
    'nota.txt': 'ignorar',
  });
  const { pool, clientQueries, aplicadas } = fakePool({ jaAplicadas: ['001_a.sql'] });
  const logs = [];

  await migrar({ pool, dir, logger: { log: (m) => logs.push(m) } });

  // 001 já aplicada -> pulada; 002 e 003 aplicadas em ordem.
  assert.deepEqual(logs, [
    '[db] migration aplicada: 002_b.sql',
    '[db] migration aplicada: 003_c.sql',
  ]);
  assert.deepEqual(clientQueries, [
    'begin', 'create table b();', 'insert into _migrations (nome) values ($1)', 'commit',
    'begin', 'create table c();', 'insert into _migrations (nome) values ($1)', 'commit',
  ]);
  assert.ok(aplicadas.has('002_b.sql') && aplicadas.has('003_c.sql'));
});

test('idempotente: segunda rodada não aplica nada', async () => {
  const dir = dirTemp({ '001_a.sql': 'select 1;' });
  const { pool } = fakePool();
  const logs = [];
  await migrar({ pool, dir, logger: { log: (m) => logs.push(m) } });
  assert.equal(logs.length, 1);

  const logs2 = [];
  await migrar({ pool, dir, logger: { log: (m) => logs2.push(m) } });
  assert.deepEqual(logs2, []);
});

test('erro numa migration faz rollback, libera o client e propaga', async () => {
  const dir = dirTemp({ '001_ruim.sql': 'boom;' });
  const { pool, client } = fakePool();
  client.query = async (sql) => {
    if (sql.includes('boom')) throw new Error('syntax error');
    if (/^rollback/i.test(sql.trim())) { client.rolledBack = true; return { rows: [] }; }
    return { rows: [] };
  };

  await assert.rejects(
    () => migrar({ pool, dir }),
    /\[db\] falha na migration 001_ruim\.sql: syntax error/
  );
  assert.ok(client.rolledBack, 'deu rollback');
  assert.ok(client.released, 'liberou o client');
});

test('rejeita nome de tabela de controle inválido (guarda de injeção)', async () => {
  const dir = dirTemp({});
  const { pool } = fakePool();
  await assert.rejects(
    () => migrar({ pool, dir, tabela: 'migrations; drop table users' }),
    /nome de tabela inválido/
  );
});

test('pool e dir são obrigatórios', async () => {
  await assert.rejects(() => migrar({ dir: '/x' }), /opts\.pool é obrigatório/);
  await assert.rejects(() => migrar({ pool: {} }), /opts\.dir é obrigatório/);
});
