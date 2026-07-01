/**
 * CPCMS — Bulk Faridabad blocks
 * Run on boot when SEED_BULK=true (see docker-entrypoint.sh), or manually:
 *   node seeds/bulk-blocks.js
 *
 * Seeds ~600 Faridabad blocks (faridabad_items) spread across every step of the
 * FAR cycle, so each Faridabad operation shows a pending queue on the Faridabad
 * production floor and workstation views. Idempotent — skips when the item table
 * is already sizeable.
 */
require('dotenv').config();
const format = require('pg-format');
const { pool, query, withTransaction } = require('../src/config/database');

const PER_STEP = 60;                 // 10 FAR steps × 60 ≈ 600 blocks
const SKIP_IF_ITEMS_ATLEAST = 400;   // idempotency guard
const CHUNK = 1000;
const SIZES = [1250, 850];           // Faridabad standard block sizes

function pickPriority(i) {
  const r = (i * 2654435761) % 100;
  if (r < 6) return 'High';
  if (r < 22) return 'Low';
  return 'Normal';
}

async function main() {
  const { rows: cnt } = await query(`SELECT COUNT(*)::int AS c FROM faridabad_items`);
  if (cnt[0].c >= SKIP_IF_ITEMS_ATLEAST) {
    console.log(`bulk-blocks: ${cnt[0].c} Faridabad blocks already present — skipping.`);
    await pool.end();
    return;
  }

  const far = (await query(`SELECT id FROM cycle_types WHERE code = 'FAR' LIMIT 1`)).rows[0];
  if (!far) { console.log('bulk-blocks: FAR cycle not found — run base seed first.'); await pool.end(); return; }

  const steps = (await query(
    `SELECT cs.step_number
     FROM cycle_steps cs
     JOIN cycle_versions cv ON cv.id = cs.cycle_version_id
     JOIN cycle_types ct ON ct.id = cv.cycle_type_id
     WHERE ct.code = 'FAR' AND cv.is_current
     ORDER BY cs.sequence_order`
  )).rows.map((r) => r.step_number);
  if (!steps.length) { console.log('bulk-blocks: FAR cycle has no steps.'); await pool.end(); return; }

  // Faridabad operators for in-progress attribution (falls back to none).
  const ops = (await query(
    `SELECT e.id FROM employees e
     LEFT JOIN locations l ON l.id = e.location_id
     WHERE e.role = 'operator' AND (l.code = 'faridabad' OR e.location_id IS NULL)
     ORDER BY e.id`
  )).rows.map((r) => r.id);

  const lastStep = steps[steps.length - 1];
  const rows = [];
  let i = 0;
  for (const step of steps) {
    for (let n = 0; n < PER_STEP; n++, i++) {
      const size = SIZES[i % SIZES.length];
      // Every step keeps a pending queue; ~1 in 4 is actively in progress; the
      // final step has some finished blocks.
      let status = 'queued';
      let operatorId = null;
      let startedAt = null;
      if (step === lastStep && n % 4 === 0) {
        status = 'done';
      } else if (n % 4 === 1) {
        status = 'in_progress';
        operatorId = ops.length ? ops[i % ops.length] : null;
        startedAt = "now() - interval '15 minutes'";
      }
      rows.push({ size, step, status, operatorId, startedAt, priority: pickPriority(i) });
    }
  }

  // started_at carries a SQL expression for in-progress rows, so build the VALUES
  // list by hand (pg-format %L would quote the expression as a string).
  const esc = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  await withTransaction(async (client) => {
    for (let c = 0; c < rows.length; c += CHUNK) {
      const chunk = rows.slice(c, c + CHUNK);
      const values = chunk.map((r) =>
        `(${far.id}, ${r.size}, ${esc(r.step)}, ${esc(r.status)}, ${r.operatorId == null ? 'NULL' : r.operatorId}, ${r.startedAt || 'NULL'}, ${esc(r.priority)})`
      ).join(', ');
      await client.query(
        `INSERT INTO faridabad_items (cycle_type_id, size_mm, current_step, status, current_operator_id, started_at, priority)
         VALUES ${values}`
      );
    }
  });

  console.log(`bulk-blocks: seeded ${rows.length} Faridabad blocks across ${steps.length} FAR steps.`);
  await pool.end();
}

main().catch((err) => {
  console.error('bulk-blocks failed:', err);
  process.exit(1);
});
