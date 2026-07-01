/**
 * Spread operator jobs across every Dharmapuri workstation so each station shows
 * an operator (one live in-progress job + a short queue). Idempotent, per-unit
 * top-up: it only fills a unit that has no live operator job yet, so it is safe
 * to run repeatedly and after more UIDs are seeded (e.g. bulk-jobs).
 *
 * Faridabad WELD stations run off faridabad_items (not jobs) and are excluded.
 *
 * @param {{ query: Function, withTransaction: Function }} db
 * @returns {Promise<{created:number, stationsCovered:number}>}
 */
async function spreadOperatorJobs({ query, withTransaction }) {
  const { rows: verRows } = await query(
    `SELECT cv.id AS ver FROM cycle_versions cv JOIN cycle_types ct ON ct.id=cv.cycle_type_id
     WHERE ct.code='EAT' AND cv.is_current`
  );
  if (!verRows[0]) return { created: 0, stationsCovered: 0 };
  const ver = verRows[0].ver;

  const { rows: ops } = await query(`SELECT id FROM employees WHERE role='operator' ORDER BY id`);
  if (ops.length === 0) return { created: 0, stationsCovered: 0 };

  const dhr = (await query(`SELECT id FROM locations WHERE code='dharmapuri'`)).rows[0]?.id;
  const farId = (await query(`SELECT id FROM locations WHERE code='faridabad'`)).rows[0]?.id || -1;
  const sup = (await query(`SELECT id FROM employees WHERE role='supervisor' ORDER BY id LIMIT 1`)).rows[0]?.id || null;
  let shiftId = (await query(`SELECT id FROM shifts WHERE location_id=$1 ORDER BY id DESC LIMIT 1`, [dhr])).rows[0]?.id;
  if (!shiftId) {
    shiftId = (await query(
      `INSERT INTO shifts (shift_date, shift_number, location_id, supervisor_id, started_at)
       VALUES (CURRENT_DATE, 1, $1, $2, now() - interval '2 hours') RETURNING id`,
      [dhr, sup]
    )).rows[0].id;
  }

  // One representative EAT step per workstation type.
  const { rows: steps } = await query(
    `SELECT id AS step_id, step_number, operation_name, workstation_type_id
     FROM cycle_steps WHERE cycle_version_id=$1 AND workstation_type_id IS NOT NULL ORDER BY sequence_order`,
    [ver]
  );
  const stepByType = {};
  for (const s of steps) if (!stepByType[s.workstation_type_id]) stepByType[s.workstation_type_id] = s;

  // Dharmapuri-flow workstation units (exclude Faridabad WELD units).
  const { rows: units } = await query(
    `SELECT wu.id AS unit_id, wu.workstation_type_id
     FROM workstation_units wu JOIN workstation_types wt ON wt.id = wu.workstation_type_id
     WHERE COALESCE(wt.location_id, 0) <> $1 ORDER BY wu.id`,
    [farId]
  );

  let opIdx = 0;
  let created = 0;
  let stationsCovered = 0;
  const assigned = new Set();
  await withTransaction(async (client) => {
    for (const u of units) {
      const st = stepByType[u.workstation_type_id];
      if (!st) continue;
      const { rows: has } = await client.query(
        `SELECT 1 FROM jobs WHERE workstation_unit_id=$1 AND status IN ('queued','in_progress','paused') LIMIT 1`,
        [u.unit_id]
      );
      if (has.length) { stationsCovered++; continue; }
      const { rows: uids } = await client.query(
        `SELECT u2.id FROM uids u2
         WHERE u2.current_step=$1 AND u2.status='active'
           AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.uid_id=u2.id AND j.status IN ('queued','in_progress','paused'))
         ORDER BY u2.id LIMIT 3`,
        [st.step_number]
      );
      if (!uids.length) continue;
      const op = ops[opIdx % ops.length]; opIdx++;
      for (let i = 0; i < uids.length; i++) {
        const running = i === 0;
        await client.query(
          `INSERT INTO jobs (shift_id, uid_id, cycle_step_id, workstation_unit_id, operator_id, status, assigned_by, assignment_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'manual')`,
          [shiftId, uids[i].id, st.step_id, u.unit_id, op.id, running ? 'in_progress' : 'queued', sup]
        );
        if (running) {
          await client.query(
            `INSERT INTO uid_step_logs (uid_id, step_number, operation_name, workstation_unit_id, operator_id, shift_id, started_at)
             VALUES ($1,$2,$3,$4,$5,$6, now() - make_interval(mins => $7))`,
            [uids[i].id, st.step_number, st.operation_name, u.unit_id, op.id, shiftId, 5 + (created % 40)]
          );
        }
        created++;
      }
      stationsCovered++;
      const akey = `${op.id}:${u.workstation_type_id}`;
      if (!assigned.has(akey)) {
        assigned.add(akey);
        await client.query(
          `INSERT INTO workstation_assignments (shift_id, employee_id, workstation_type_id, assigned_by)
           SELECT $1,$2,$3,$4 WHERE NOT EXISTS (
             SELECT 1 FROM workstation_assignments WHERE shift_id=$1 AND employee_id=$2 AND workstation_type_id=$3)`,
          [shiftId, op.id, u.workstation_type_id, sup]
        );
      }
    }
  });
  return { created, stationsCovered };
}

module.exports = { spreadOperatorJobs };
