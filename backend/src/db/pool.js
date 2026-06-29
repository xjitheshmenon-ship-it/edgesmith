// PostgreSQL connection pool + thin query helpers (raw SQL, parameterised).
import pg from 'pg';
import { config } from '../config/env.js';

// Return numeric (float8 / double precision) as JS numbers rather than strings.
pg.types.setTypeParser(701, (v) => (v === null ? null : parseFloat(v)));
// numeric/decimal (1700) — parse to float as well (we avoid it in schema, but be safe).
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// DATE (1082) — keep the raw 'YYYY-MM-DD' string instead of a JS Date.
pg.types.setTypeParser(1082, (v) => v);

const needsSsl =
  /render\.com|amazonaws\.com|\bsslmode=require\b/.test(config.databaseUrl) ||
  process.env.PGSSL === 'true';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 20,
});

// Run a query, return the rows array.
export async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

// Run a query, return the first row or null.
export async function one(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

// Run a set of statements inside a transaction. `fn` receives a client with
// the same { query, one } helpers bound to that client.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const helpers = {
      query: async (text, params = []) => (await client.query(text, params)).rows,
      one: async (text, params = []) => (await client.query(text, params)).rows[0] || null,
      client,
    };
    const result = await fn(helpers);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
