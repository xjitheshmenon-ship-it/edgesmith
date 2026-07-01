/**
 * CPCMS — Bulk sample jobs
 * Run on boot only when SEED_BULK=true (see docker-entrypoint.sh), or manually:
 *   node seeds/bulk-jobs.js
 *
 * Generates 2000+ in-flight UIDs (jobs) spread across EVERY EAT operation, so
 * every step shows a pending queue on the production floor, workstation queues,
 * and reports. Idempotent — skips when the UID table is already large.
 */
require('dotenv').config();
const format = require('pg-format');
const { pool, query, withTransaction } = require('../src/config/database');

const PER_STEP = 75;          // jobs per operation → ~28 steps × 75 = ~2100
const SKIP_IF_UIDS_ATLEAST = 1500;   // idempotency guard
const CHUNK = 1000;           // rows per multi-row INSERT

function pickPriority(i) {
  const r = (i * 2654435761) % 100;   // deterministic spread, no RNG needed
  if (r < 6) return 'High';
  if (r < 22) return 'Low';           // some Low, rest Normal — a visible mix
  return 'Normal';
}

async function main() {
  const { rows: cntRows } = await query(`SELECT COUNT(*)::int AS c FROM uids`);
  if (cntRows[0].c >= SKIP_IF_UIDS_ATLEAST) {
    console.log(`bulk-jobs: ${cntRows[0].c} UIDs already present — skipping.`);
    await pool.end();
    return;
  }

  const eat = (await query(
    `SELECT ct.id, ct.letter, cv.id AS version_id
     FROM cycle_types ct JOIN cycle_versions cv ON cv.cycle_type_id = ct.id
     WHERE ct.code = 'EAT' AND cv.is_current LIMIT 1`
  )).rows[0];
  if (!eat) { console.log('bulk-jobs: no current EAT cycle — run base seed first.'); await pool.end(); return; }

  const steps = (await query(
    `SELECT step_number, source_storage_id, dest_storage_id
     FROM cycle_steps WHERE cycle_version_id = $1 ORDER BY sequence_order`, [eat.version_id]
  )).rows;
  if (!steps.length) { console.log('bulk-jobs: EAT cycle has no steps.'); await pool.end(); return; }

  // Valid (size, design) pairs — restricted to global product sizes (not the
  // per-location raw-material sizes). Fall back to any global size if the
  // design/size validity matrix is empty.
  let pairs = (await query(
    `SELECT dvs.size_id, dvs.design_id
     FROM design_valid_sizes dvs
     JOIN sizes s ON s.id = dvs.size_id AND s.location_id IS NULL`
  )).rows.map((r) => [r.size_id, r.design_id]);
  if (!pairs.length) {
    const sizes = (await query(`SELECT id FROM sizes WHERE location_id IS NULL ORDER BY id`)).rows;
    pairs = sizes.map((s) => [s.id, null]);
  }
  if (!pairs.length) pairs = [[null, null]];

  const moIds = (await query(`SELECT id FROM manufacturing_orders ORDER BY id`)).rows.map((r) => r.id);
  const admin = (await query(`SELECT id FROM employees WHERE username = 'admin' LIMIT 1`)).rows[0];
  const adminId = admin ? admin.id : null;

  // Continue the UID number series so codes never collide.
  const series = (await query(`SELECT next_number FROM uid_series WHERE cycle_type_id = $1`, [eat.id])).rows[0];
  let seq = series ? series.next_number : 1;

  const rows = [];
  let idx = 0;
  const lastStep = steps[steps.length - 1].step_number;
  for (const step of steps) {
    for (let i = 0; i < PER_STEP; i++, idx++) {
      const [sizeId, designId] = pairs[idx % pairs.length];
      const moId = moIds.length ? moIds[idx % moIds.length] : null;
      // Mostly active; a slice of the final step is 'done'; a few mid-cycle 'hold'.
      let status = 'active';
      if (step.step_number === lastStep && i % 3 === 0) status = 'done';
      else if (i % 37 === 0) status = 'hold';
      const holdReason = status === 'hold' ? 'Awaiting QC re-check (sample)' : null;
      const code = `${eat.letter}${String(seq++).padStart(5, '0')}`;
      rows.push([
        code, eat.version_id, step.step_number, step.source_storage_id,
        sizeId, designId, moId, pickPriority(idx), status, holdReason, adminId,
      ]);
    }
  }

  await withTransaction(async (client) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await client.query(format(
        `INSERT INTO uids
           (uid_code, cycle_version_id, current_step, current_storage_id,
            size_id, design_id, mo_id, priority, status, hold_reason, created_by)
         VALUES %L`, chunk
      ));
    }
    await client.query(`UPDATE uid_series SET next_number = $1 WHERE cycle_type_id = $2`, [seq, eat.id]);
    // MOs with linked jobs move to active.
    await client.query(
      `UPDATE manufacturing_orders SET status = 'active'
       WHERE status = 'open' AND id IN (SELECT DISTINCT mo_id FROM uids WHERE mo_id IS NOT NULL)`
    );
  });

  console.log(`bulk-jobs: seeded ${rows.length} jobs across ${steps.length} EAT operations (codes ${eat.letter}${String(series ? series.next_number : 1).padStart(5, '0')}…${eat.letter}${String(seq - 1).padStart(5, '0')}).`);

  // With the full UID population in place, ensure every Dharmapuri workstation
  // shows an operator (idempotent per-unit top-up).
  try {
    const { spreadOperatorJobs } = require('./spreadOperatorJobs');
    const r = await spreadOperatorJobs({ query, withTransaction });
    if (r.created) console.log(`bulk-jobs: spread ${r.created} operator jobs across ${r.stationsCovered} Dharmapuri workstations.`);
  } catch (e) {
    console.error('bulk-jobs: operator-job spread skipped —', e.message);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('bulk-jobs failed:', err);
  process.exit(1);
});
