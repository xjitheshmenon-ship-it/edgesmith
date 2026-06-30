/**
 * CPCMS — DESTRUCTIVE schema reset
 * Run with: node scripts/reset-schema.js   (gated by RESET_DB=true in the entrypoint)
 *
 * Drops and recreates the `public` schema, removing EVERY table and all data.
 * This exists to clear a database that still holds an older backend's tables
 * (whose schema collides with this app's migrations) so the migration runner
 * can rebuild from a clean slate. After it has run once, set RESET_DB=false /
 * remove the var so subsequent deploys never wipe the database again.
 */

require('dotenv').config();
const { pool, query } = require('../src/config/database');

async function main() {
  console.log('⚠️  RESET_DB=true — dropping the public schema. ALL EXISTING DATA WILL BE LOST.');
  await query('DROP SCHEMA IF EXISTS public CASCADE');
  await query('CREATE SCHEMA public');
  // Restore the conventional grants so the migration runner (and the app role)
  // can create objects in the fresh schema.
  await query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
  await query('GRANT ALL ON SCHEMA public TO public');
  console.log('✓ public schema reset — ready for a clean migrate.');
  await pool.end();
}

main().catch((err) => {
  console.error('SCHEMA RESET FAILED:', err);
  process.exit(1);
});
