/**
 * CPCMS — Migration Runner
 * Run with: npm run migrate
 *
 * Applies every .sql file in /migrations in filename order (001_, 002_, ...)
 * that hasn't already been applied, tracked via a schema_migrations table.
 * Safe to run repeatedly — already-applied migrations are skipped.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations() {
  const { rows } = await query(`SELECT filename FROM schema_migrations`);
  return new Set(rows.map((r) => r.filename));
}

async function main() {
  console.log('Running CPCMS migrations...\n');

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // filename prefix (001_, 002_, ...) controls order

  if (!files.length) {
    console.log('No migration files found in', MIGRATIONS_DIR);
    await pool.end();
    return;
  }

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`✓ ${file} (already applied, skipped)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file} (applied)`);
      appliedCount++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ ${file} FAILED:`, err.message);
      client.release();
      await pool.end();
      process.exit(1);
    }
    client.release();
  }

  console.log(`\nDone. ${appliedCount} new migration(s) applied, ${files.length - appliedCount} already up to date.`);
  await pool.end();
}

main().catch((err) => {
  console.error('MIGRATION RUNNER FAILED:', err);
  process.exit(1);
});
