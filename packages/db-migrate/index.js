// Runner de migrations simples, extraído de kyvvo-people/lib/db.js.
//
// Aplica, em ordem alfabética, os arquivos `*.sql` de um diretório que ainda
// não constam na tabela de controle. Cada arquivo roda numa transação; falha
// faz rollback e interrompe. Suficiente pro volume de migrations dos serviços
// Kyvvo — não substitui uma lib de migration dedicada (sem down/rollback de
// versão, sem checksum).
//
//   const { migrar } = require('@kyvvohq/db-migrate');
//   const { Pool } = require('pg');
//   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
//   await migrar({ pool, dir: require('path').join(__dirname, 'db') });

const fs = require('fs');
const path = require('path');

function validarIdentificador(nome) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nome)) {
    throw new Error(`[db-migrate] nome de tabela inválido: ${JSON.stringify(nome)}`);
  }
  return nome;
}

/**
 * @param {object}   opts
 * @param {import('pg').Pool} opts.pool  pool `pg` já configurado
 * @param {string}   opts.dir            diretório com os arquivos *.sql
 * @param {string}  [opts.tabela]        tabela de controle (default '_migrations')
 * @param {object}  [opts.logger]        objeto com .log (default console)
 * @param {string}  [opts.prefixo]       prefixo das linhas de log (default '[db]')
 */
async function migrar({ pool, dir, tabela = '_migrations', logger = console, prefixo = '[db]' }) {
  if (!pool) throw new Error('[db-migrate] opts.pool é obrigatório');
  if (!dir) throw new Error('[db-migrate] opts.dir é obrigatório');
  validarIdentificador(tabela);

  await pool.query(`
    create table if not exists ${tabela} (
      nome text primary key,
      aplicada_em timestamptz not null default now()
    )
  `);

  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const arquivo of arquivos) {
    const { rows } = await pool.query(`select 1 from ${tabela} where nome = $1`, [arquivo]);
    if (rows.length) continue;

    const sql = fs.readFileSync(path.join(dir, arquivo), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(`insert into ${tabela} (nome) values ($1)`, [arquivo]);
      await client.query('commit');
      logger.log(`${prefixo} migration aplicada: ${arquivo}`);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`${prefixo} falha na migration ${arquivo}: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

module.exports = { migrar };
