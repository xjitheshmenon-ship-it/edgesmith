const { Pool } = require('pg');

// SSL is only needed for EXTERNAL connections (e.g. seeding the Render DB from a
// GitHub Actions runner). Render's own internal connection needs no SSL config,
// so this stays off unless DATABASE_SSL=true (or PGSSLMODE=require) is set — the
// in-container boot is unchanged.
const useSsl =
  process.env.DATABASE_SSL === 'true' || process.env.PGSSLMODE === 'require';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});

/**
 * Run a query. Use for simple, non-transactional reads/writes.
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.LOG_LEVEL === 'debug') {
    console.log('query', { text, duration, rows: res.rowCount });
  }
  return res;
}

/**
 * Run a function inside a transaction. Pass an async fn(client) => {...}.
 * Automatically commits on success, rolls back on throw.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
