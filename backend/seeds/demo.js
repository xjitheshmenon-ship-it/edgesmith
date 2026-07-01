/**
 * CPCMS — Comprehensive DEMO data (NOT real production data)
 * Run on boot only when SEED_DEMO=true (see docker-entrypoint.sh).
 *
 * Populates a coherent, fully-exercised factory so every page has data:
 *   - extra employees (manager, supervisors, operators, service) + badges
 *   - manufacturing orders
 *   - Faridabad chain: raw-material intakes, weld log, dispatches, receiving
 *   - ~36 UIDs spread across steps / storages / statuses (active/hold/done)
 *   - step history + QC logs, furnace & production batches
 *   - today's shift, schedule, workstation assignments and jobs
 *   - a handful of alerts
 *
 * Idempotent: keyed on the demo dispatch reference, so re-running does nothing.
 * Everything created here uses DEMO-* references or the seeded baseline, so it
 * is easy to spot and remove later.
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool, query, withTransaction } = require('../src/config/database');

const DEMO_DISPATCH_REF = 'FAR-DISP-DEMO-001';

async function one(sql, params, label) {
  const { rows } = await query(sql, params);
  if (!rows[0]) throw new Error(`Demo seed needs ${label || sql} but found nothing — run the base seed first.`);
  return rows[0];
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Faridabad items seed independently of the main demo guard, so they populate
// on a normal deploy even when the rest of the demo already exists (no RESET).
async function seedFaridabadItemsIfEmpty() {
  const { rows: far } = await query(`SELECT id FROM cycle_types WHERE code='FAR'`);
  if (!far[0]) return; // FAR cycle not seeded yet
  const { rows: cnt } = await query(`SELECT count(*)::int AS c FROM faridabad_items`);
  if (cnt[0].c > 0) return; // already populated
  const farId = far[0].id;
  const sup = (await query(`SELECT id FROM employees WHERE username='supervisor_far' OR role='supervisor' ORDER BY id LIMIT 1`)).rows[0]?.id || null;
  // [step, status, sizeMm]
  const farDist = [
    ['1', 'queued', 1200], ['2', 'in_progress', 1200], ['3', 'queued', 1200],
    ['5', 'in_progress', null], ['6', 'queued', null], ['7', 'queued', null],
    ['8', 'queued', 1200], ['9', 'queued', 1200],
  ];
  for (const [step, status, size] of farDist) {
    await query(
      `INSERT INTO faridabad_items (cycle_type_id, size_mm, current_step, status, current_operator_id, started_at, priority)
       VALUES ($1,$2,$3,$4,$5, ${status === 'in_progress' ? "now() - interval '18 minutes'" : 'NULL'}, 'Normal')`,
      [farId, size, step, status, status === 'in_progress' ? sup : null]
    );
  }
  console.log(`✓ Seeded ${farDist.length} Faridabad items (top-up).`);
}

// Non-destructive top-up: give existing demo welds a block BOM (and alloy/MS
// refs) when none exist yet, so the Joining page's BOM view has sample data
// without requiring a full DB reset.
async function backfillWeldBomIfEmpty() {
  const { rows: bomCnt } = await query(`SELECT count(*)::int AS c FROM faridabad_weld_bom`);
  if (bomCnt[0].c > 0) return; // already populated
  const { rows: welds } = await query(`SELECT id, alloy_intake_id, ms_intake_id FROM faridabad_weld_log ORDER BY id`);
  if (!welds.length) return; // nothing to backfill
  const alloyIntakes = (await query(`SELECT id FROM raw_material_intakes WHERE material_type='alloy_steel' ORDER BY id`)).rows;
  const msIntakes = (await query(`SELECT id FROM raw_material_intakes WHERE material_type='ms' ORDER BY id`)).rows;
  if (!alloyIntakes.length || !msIntakes.length) return;
  let n = 0;
  for (let i = 0; i < welds.length; i++) {
    const w = welds[i];
    const alloyId = w.alloy_intake_id || alloyIntakes[i % alloyIntakes.length].id;
    const msId = w.ms_intake_id || msIntakes[i % msIntakes.length].id;
    if (!w.alloy_intake_id || !w.ms_intake_id) {
      await query(`UPDATE faridabad_weld_log SET alloy_intake_id = $1, ms_intake_id = $2 WHERE id = $3`, [alloyId, msId, w.id]);
    }
    await query(
      `INSERT INTO faridabad_weld_bom (weld_log_id, component_type, intake_id, dimensions_mm, quantity)
       VALUES ($1,'alloy',$2,'1200 x 185 x 80',1), ($1,'ms',$3,'1200 x 90 x 20',2)`,
      [w.id, alloyId, msId]
    );
    n++;
  }
  console.log(`✓ Backfilled block BOM for ${n} demo welds (top-up).`);
}

// Spread operator jobs across every Dharmapuri workstation (shared helper), so
// each station shows an operator. Idempotent per-unit top-up.
async function seedOperatorJobsAcrossWorkstations() {
  const { spreadOperatorJobs } = require('./spreadOperatorJobs');
  const r = await spreadOperatorJobs({ query, withTransaction });
  if (r.created) console.log(`\u2713 Spread ${r.created} operator jobs so every Dharmapuri workstation shows an operator (${r.stationsCovered} units).`);
}

async function main() {
  console.log('Seeding comprehensive DEMO data (SEED_DEMO=true)...\n');

  // Runs regardless of the main guard below.
  await seedFaridabadItemsIfEmpty();
  await backfillWeldBomIfEmpty();
  await seedOperatorJobsAcrossWorkstations();

  const exists = await query(`SELECT id FROM contractor_dispatches WHERE batch_reference = $1`, [DEMO_DISPATCH_REF]);
  if (exists.rows[0]) {
    console.log('✓ Demo data already present, skipping.');
    await pool.end();
    return;
  }

  // ── Reference lookups (from the base seed) ────────────────────────────────
  const dhr = (await one(`SELECT id FROM locations WHERE code='dharmapuri'`, [], 'Dharmapuri location')).id;
  const far = (await one(`SELECT id FROM locations WHERE code='faridabad'`, [], 'Faridabad location')).id;
  const eat = await one(`SELECT id, letter FROM cycle_types WHERE code='EAT'`, [], 'EAT cycle type');
  const eatVersion = (await one(
    `SELECT cv.id FROM cycle_versions cv JOIN cycle_types ct ON ct.id=cv.cycle_type_id WHERE ct.code='EAT' AND cv.is_current`,
    [], 'EAT current version'
  )).id;
  const admin = (await one(`SELECT id FROM employees WHERE username='admin'`, [], 'admin user')).id;
  const colorCode = (await one(`SELECT id FROM color_codes ORDER BY id LIMIT 1`, [], 'a color code')).id;
  const contractor = (await one(`SELECT id FROM contractors ORDER BY id LIMIT 1`, [], 'a contractor')).id;
  const alloySupplier = (await one(`SELECT id FROM suppliers WHERE material_type IN ('alloy_steel','both') ORDER BY id LIMIT 1`, [], 'an alloy supplier')).id;
  const msSupplier = (await one(`SELECT id FROM suppliers WHERE material_type IN ('ms','both') ORDER BY id LIMIT 1`, [], 'an MS supplier')).id;

  // cycle steps: step_number -> {id, dest_storage_id, workstation_type_id, step_type, operation_name}
  const stepRows = (await query(
    `SELECT id, step_number, dest_storage_id, workstation_type_id, step_type, operation_name
     FROM cycle_steps WHERE cycle_version_id=$1 ORDER BY sequence_order`, [eatVersion]
  )).rows;
  const stepByNum = Object.fromEntries(stepRows.map((s) => [s.step_number, s]));

  // first workstation unit of each type
  const unitRows = (await query(`SELECT id, workstation_type_id FROM workstation_units ORDER BY id`)).rows;
  const unitByType = {};
  for (const u of unitRows) if (unitByType[u.workstation_type_id] == null) unitByType[u.workstation_type_id] = u.id;
  const unitForStep = (sn) => unitByType[stepByNum[sn]?.workstation_type_id] || null;
  const storeForStep = (sn) => stepByNum[sn]?.dest_storage_id || null;

  await withTransaction(async (client) => {
    const q = (sql, params) => client.query(sql, params);
    const ins = async (sql, params) => (await client.query(sql, params)).rows[0];

    // ── Employees ───────────────────────────────────────────────────────────
    const hash = await bcrypt.hash('Demo123!', 10);
    const emp = async (code, name, username, role, locId) =>
      (await ins(
        `INSERT INTO employees (employee_code, full_name, username, password_hash, role, location_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING id`,
        [code, name, username, hash, role, locId]
      )).id;

    const manager = await emp('EMP-D101', 'Priya Menon', 'manager', 'manager', null);
    const supDhr = await emp('EMP-D102', 'Ravi Kumar', 'supervisor', 'supervisor', dhr);
    const supFar = await emp('EMP-F101', 'Anil Sharma', 'supervisor_far', 'supervisor', far);
    const service = await emp('EMP-D103', 'Latha R', 'service', 'service', dhr);
    await emp('EMP-D104', 'Shop Floor Display', 'shopfloor', 'shopfloor', dhr);
    const operators = [];
    const opNames = ['Suresh B', 'Mani K', 'Deepa S', 'Vijay R', 'Karthik M'];
    for (let i = 0; i < opNames.length; i++) {
      operators.push(await emp(`EMP-D2${String(i + 1).padStart(2, '0')}`, opNames[i], `operator${i === 0 ? '' : i + 1}`, 'operator', dhr));
    }

    // ── Badges (some expiring soon → drives badge-expiry alerts) ──────────────
    const wtMill = (await one(`SELECT id FROM workstation_types WHERE code='MM22'`, [], 'MM22 type')).id;
    const wtHt = (await one(`SELECT id FROM workstation_types WHERE code='HT90'`, [], 'HT90 type')).id;
    const wtGrind = (await one(`SELECT id FROM workstation_types WHERE code='SG-DLT'`, [], 'SG-DLT type')).id;
    const bt = async (name, wtId, months) =>
      (await ins(
        `INSERT INTO badge_types (name, workstation_type_id, expires, validity_months) VALUES ($1,$2,true,$3) RETURNING id`,
        [name, wtId, months]
      )).id;
    const badgeMill = await bt('Milling Certified', wtMill, 12);
    const badgeHt = await bt('Heat Treatment Certified', wtHt, 12);
    const badgeGrind = await bt('Grinding Certified', wtGrind, 12);
    const giveBadge = (empId, badgeId, expiryDays) =>
      q(`INSERT INTO employee_badges (employee_id, badge_type_id, certified_date, certified_by, expiry_date)
         VALUES ($1,$2,$3,'Plant Head',$4)`,
        [empId, badgeId, daysFromNow(-200), daysFromNow(expiryDays)]);
    await giveBadge(operators[0], badgeMill, 240);
    await giveBadge(operators[1], badgeHt, 12);   // expiring soon
    await giveBadge(operators[2], badgeGrind, 5); // expiring very soon
    await giveBadge(operators[3], badgeMill, 300);

    // ── Plate sizes (block is 4500mm; plates cut to these lengths) ────────────
    for (const [mm, desc] of [[1500, 'Plate 1500mm'], [1424, 'Plate 1424mm'], [2750, 'Plate 2750mm']]) {
      await q(`INSERT INTO sizes (size_mm, description) SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM sizes WHERE size_mm=$1)`, [mm, desc]);
    }

    // ── Manufacturing orders ──────────────────────────────────────────────────
    const sizeRow = await one(`SELECT id FROM sizes WHERE size_mm=1500 ORDER BY id LIMIT 1`, [], 'the 1500mm plate size');
    const designRow = await one(`SELECT id FROM designs ORDER BY id LIMIT 1`, [], 'a design');
    const moIds = [];
    const moDefs = [
      ['MO-DEMO-001', 'Hindustan Tools', 500, 'High', 'open'],
      ['MO-DEMO-002', 'Bharat Forge', 1200, 'Normal', 'in_progress'],
      ['MO-DEMO-003', 'Ashok Leyland', 300, 'High', 'in_progress'],
    ];
    for (const [no, cust, qty, prio, status] of moDefs) {
      moIds.push((await ins(
        `INSERT INTO manufacturing_orders (mo_number, customer, quantity, size_id, design_id, priority, required_delivery_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [no, cust, qty, sizeRow.id, designRow.id, prio, daysFromNow(30), status, admin]
      )).id);
    }

    // ── Faridabad chain ───────────────────────────────────────────────────────
    const alloyHeats = ['DEMO-ALLOY-H1', 'DEMO-ALLOY-H2', 'DEMO-ALLOY-H3'];
    const msHeats = ['DEMO-MS-H1', 'DEMO-MS-H2'];
    for (const h of alloyHeats) {
      await q(
        `INSERT INTO raw_material_intakes (material_type, supplier_id, heat_number, grade, cycle_type_id, steel_grade, weight_kg, bar_count, dimensions_mm, date_received, po_reference, notes, created_by)
         VALUES ('alloy_steel',$1,$2,'EN8',$3,'EN8',1500,30,'Ø32',$4,'DEMO-PO','Demo data',$5)`,
        [alloySupplier, h, eat.id, daysFromNow(-20), admin]
      );
    }
    for (const h of msHeats) {
      await q(
        `INSERT INTO raw_material_intakes (material_type, supplier_id, heat_number, weight_kg, bar_count, dimensions_mm, date_received, po_reference, notes, created_by)
         VALUES ('ms',$1,$2,800,16,'Ø20',$3,'DEMO-PO','Demo data',$4)`,
        [msSupplier, h, daysFromNow(-20), admin]
      );
    }

    // weld log (a few welds, mix of dispatched/not), each with a block BOM
    const weldUnit = (await one(`SELECT id FROM workstation_units WHERE unit_code='WB-1'`, [], 'a weld bench')).id;
    const demoAlloyIntakes = (await q(`SELECT id FROM raw_material_intakes WHERE material_type='alloy_steel' AND heat_number LIKE 'DEMO-%' ORDER BY id`)).rows;
    const demoMsIntakes = (await q(`SELECT id FROM raw_material_intakes WHERE material_type='ms' AND heat_number LIKE 'DEMO-%' ORDER BY id`)).rows;
    for (let i = 0; i < 6; i++) {
      // Faridabad block input is 1200×185×80mm (rolled to 4500×190×19mm output).
      const alloyIntakeId = demoAlloyIntakes.length ? demoAlloyIntakes[i % demoAlloyIntakes.length].id : null;
      const msIntakeId = demoMsIntakes.length ? demoMsIntakes[i % demoMsIntakes.length].id : null;
      const weld = await ins(
        `INSERT INTO faridabad_weld_log (cycle_type_id, alloy_intake_id, ms_intake_id, operator_id, workstation_unit_id, size_mm, net_work_seconds, started_at, closed_at, dispatched)
         VALUES ($1,$2,$3,$4,$5,1200,900, now() - interval '3 hours', now() - interval '2 hours', $6) RETURNING id`,
        [eat.id, alloyIntakeId, msIntakeId, supFar, weldUnit, i < 4]
      );
      // Block bill of materials: one alloy billet + two MS plates.
      if (alloyIntakeId) {
        await q(
          `INSERT INTO faridabad_weld_bom (weld_log_id, component_type, intake_id, dimensions_mm, quantity)
           VALUES ($1,'alloy',$2,'1200 x 185 x 80',1)`,
          [weld.id, alloyIntakeId]
        );
      }
      if (msIntakeId) {
        await q(
          `INSERT INTO faridabad_weld_bom (weld_log_id, component_type, intake_id, dimensions_mm, quantity)
           VALUES ($1,'ms',$2,'1200 x 90 x 20',2)`,
          [weld.id, msIntakeId]
        );
      }
    }

    // dispatches: pending, partial, fully-received (the demo key)
    const mkDispatch = async (ref, status, blocks) =>
      (await ins(
        `INSERT INTO contractor_dispatches
           (batch_reference, cycle_type_id, color_code_id, block_count, contractor_id, possible_alloy_heats, possible_ms_heats, date_dispatched, expected_delivery_date, challan_reference, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DEMO-CHALLAN',$10,$11) RETURNING id`,
        [ref, eat.id, colorCode, blocks, contractor, alloyHeats, msHeats, daysFromNow(-7), daysFromNow(-1), status, admin]
      )).id;
    await mkDispatch('FAR-DISP-DEMO-002', 'pending', 40);
    const partialDispatch = await mkDispatch('FAR-DISP-DEMO-003', 'partially_received', 60);
    const mainDispatch = await mkDispatch(DEMO_DISPATCH_REF, 'fully_received', 50);

    // receiving events
    const mkReceiving = async (ref, dispatchId, blocks, status, blocksCut) =>
      (await ins(
        `INSERT INTO receiving_events (receiving_reference, dispatch_batch_id, block_count, color_code_on_arrival_id, color_match, condition, condition_notes, received_by, date_received, status, blocks_cut)
         VALUES ($1,$2,$3,$4,true,'good','Demo receiving',$5,$6,$7,$8) RETURNING id`,
        [ref, dispatchId, blocks, colorCode, supDhr, daysFromNow(-3), status, blocksCut]
      )).id;
    await mkReceiving('DHR-RCV-DEMO-002', partialDispatch, 30, 'awaiting_cut', 0);
    const mainReceiving = await mkReceiving('DHR-RCV-DEMO-001', mainDispatch, 50, 'in_production', 36);

    // ── Today's shift, schedule, assignments ──────────────────────────────────
    const shift = await ins(
      `INSERT INTO shifts (shift_date, shift_number, location_id, supervisor_id, started_at)
       VALUES (CURRENT_DATE, 2, $1, $2, now() - interval '4 hours') RETURNING id`,
      [dhr, supDhr]
    );
    const shiftId = shift.id;
    await q(
      `INSERT INTO shift_schedule (shift_date, shift_number, location_id, supervisor_id, operator_ids, published, created_by)
       VALUES (CURRENT_DATE, 2, $1, $2, $3, true, $4)`,
      [dhr, supDhr, operators, admin]
    );
    // assign operators to workstation types for the shift
    const assignTypes = [wtMill, wtHt, wtGrind];
    for (let i = 0; i < assignTypes.length; i++) {
      await q(
        `INSERT INTO workstation_assignments (shift_id, employee_id, workstation_type_id, assigned_by)
         VALUES ($1,$2,$3,$4)`,
        [shiftId, operators[i], assignTypes[i], supDhr]
      );
    }

    // ── UIDs spread across steps / storages / statuses ────────────────────────
    // [step_number, status, count]
    const dist = [
      ['1', 'active', 4], ['2', 'active', 3], ['4', 'active', 3], ['5', 'active', 3],
      ['9', 'active', 4], ['12', 'active', 4], ['14', 'active', 2], ['18', 'active', 3],
      ['23', 'active', 2], ['26', 'active', 3], ['27', 'done', 3],
      ['6', 'hold', 2],
    ];
    let seq = 1;
    const uidsByStep = {};
    for (const [stepNum, status, count] of dist) {
      uidsByStep[stepNum] = uidsByStep[stepNum] || [];
      for (let i = 0; i < count; i++) {
        const code = `${eat.letter}${String(seq).padStart(5, '0')}`;
        seq++;
        const moId = moIds[seq % moIds.length];
        const holdReason = status === 'hold' ? 'Awaiting QC re-check (demo)' : null;
        const row = await ins(
          `INSERT INTO uids
             (uid_code, cycle_version_id, current_step, current_storage_id, current_workstation_unit_id, size_id, design_id, mo_id, priority, status, hold_reason, receiving_event_id, dispatch_batch_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Normal',$9,$10,$11,$12,$13) RETURNING id`,
          [code, eatVersion, stepNum, storeForStep(stepNum), unitForStep(stepNum), sizeRow.id, designRow.id, moId, status, holdReason, mainReceiving, mainDispatch, admin]
        );
        uidsByStep[stepNum].push(row.id);
      }
    }
    await q(`UPDATE uid_series SET next_number=$1 WHERE cycle_type_id=$2`, [seq, eat.id]);

    const allUidIds = Object.values(uidsByStep).flat();

    // ── Step history + QC logs for UIDs past step 1 ───────────────────────────
    for (const [stepNum, ids] of Object.entries(uidsByStep)) {
      const target = parseInt(stepNum, 10);
      if (Number.isNaN(target) || target <= 1) continue;
      for (const uidId of ids.slice(0, 2)) { // a couple per step to keep it light
        for (let s = 1; s < Math.min(target, 5); s++) {
          const sn = String(s);
          const st = stepByNum[sn];
          if (!st) continue;
          await q(
            `INSERT INTO uid_step_logs (uid_id, step_number, operation_name, workstation_unit_id, operator_id, shift_id, started_at, closed_at, net_work_seconds, total_elapsed_seconds)
             VALUES ($1,$2,$3,$4,$5,$6, now() - interval '6 hours', now() - interval '5 hours', 1800, 3600)`,
            [uidId, sn, st.operation_name, unitForStep(sn), operators[s % operators.length], shiftId]
          );
        }
      }
    }
    // QC logs (pass + one fail) on UIDs at the QC step
    const qcUids = uidsByStep['26'] || [];
    for (let i = 0; i < qcUids.length; i++) {
      const result = i === 0 ? 'fail' : 'pass';
      await q(
        `INSERT INTO uid_step_logs (uid_id, step_number, operation_name, workstation_unit_id, operator_id, shift_id, started_at, closed_at, net_work_seconds, qc_check_type, qc_value, qc_result)
         VALUES ($1,'26','QC Inspection',$2,$3,$4, now() - interval '2 hours', now() - interval '1 hours', 1200, 'hardness', $5, $6)`,
        [qcUids[i], unitForStep('26'), service, shiftId, result === 'pass' ? '58 HRC' : '52 HRC', result]
      );
    }

    // ── Furnace batch (running) at Tempering 1 (step 9) ───────────────────────
    const temperStep = stepByNum['9'];
    const tp = (await query(
      `SELECT target_temp_c, target_soak_min FROM tempering_parameters WHERE cycle_type_id=$1 AND tempering_step='tempering_1'`, [eat.id]
    )).rows[0] || { target_temp_c: 180, target_soak_min: 90 };
    const furnace = await ins(
      `INSERT INTO furnace_batches (batch_number, cycle_step_id, cycle_type_id, workstation_unit_id, target_temp_c, target_soak_min, status, started_at, operator_id, shift_id)
       VALUES ('FB-DEMO-001',$1,$2,$3,$4,$5,'running', now() - interval '40 minutes',$6,$7) RETURNING id`,
      [temperStep.id, eat.id, unitForStep('9'), tp.target_temp_c, tp.target_soak_min, operators[1], shiftId]
    );
    for (const uidId of (uidsByStep['9'] || [])) {
      await q(`INSERT INTO furnace_batch_uids (furnace_batch_id, uid_id) VALUES ($1,$2)`, [furnace.id, uidId]);
    }

    // ── Production batch (running) at Surface Grind (step 12) ──────────────────
    const grindStep = stepByNum['12'];
    const prodBatch = await ins(
      `INSERT INTO production_batches (batch_number, cycle_step_id, workstation_unit_id, combined_length_mm, status, started_at, operator_id, shift_id)
       VALUES ('PB-DEMO-001',$1,$2,4500,'running', now() - interval '25 minutes',$3,$4) RETURNING id`,
      [grindStep.id, unitForStep('12'), operators[2], shiftId]
    );
    let setNo = 1;
    for (const uidId of (uidsByStep['12'] || [])) {
      await q(`INSERT INTO production_batch_uids (production_batch_id, uid_id, set_number) VALUES ($1,$2,$3)`, [prodBatch.id, uidId, setNo++]);
    }

    // ── Jobs for the current shift — all assigned to the primary operator so the
    //    'operator' demo login sees MULTIPLE workstations (one tab each), with one
    //    live in-progress job whose timer is actually running.
    const primaryOp = operators[0];
    // Pick steps that have a real workstation unit so every job lands on a
    // named workstation (four distinct ones → four tabs).
    const jobSteps = ['1', '4', '5', '18'].filter((sn) => unitForStep(sn));
    let activeUid = null;
    for (const sn of jobSteps) {
      const ids = (uidsByStep[sn] || []).slice(0, 2);
      for (let i = 0; i < ids.length; i++) {
        const isActive = sn === '1' && i === 0; // one running job at the first station
        await q(
          `INSERT INTO jobs (shift_id, uid_id, cycle_step_id, workstation_unit_id, operator_id, status, assigned_by, assignment_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'manual')`,
          [shiftId, ids[i], stepByNum[sn].id, unitForStep(sn), primaryOp, isActive ? 'in_progress' : 'queued', supDhr]
        );
        if (isActive) activeUid = ids[i];
      }
    }
    // Open (un-closed) step log for the running job so its timer shows ~12 min.
    if (activeUid) {
      await q(
        `INSERT INTO uid_step_logs (uid_id, step_number, operation_name, workstation_unit_id, operator_id, shift_id, started_at)
         VALUES ($1,'1',$2,$3,$4,$5, now() - interval '12 minutes')`,
        [activeUid, stepByNum['1'].operation_name, unitForStep('1'), primaryOp, shiftId]
      );
    }

    // ── Alerts ────────────────────────────────────────────────────────────────
    const holdUid = (uidsByStep['6'] || [])[0] || null;
    const alertDefs = [
      ['uid_on_hold', 'warning', dhr, holdUid, 'UID on hold awaiting QC re-check', 'supervisor', 'uid', String(holdUid)],
      ['qc_failure', 'critical', dhr, qcUids[0] || null, 'QC failure recorded at final inspection (52 HRC)', 'supervisor', 'qc', null],
      ['badge_expiring', 'warning', dhr, null, 'Grinding badge expiring within 7 days for Deepa S', 'manager', 'employees', null],
      ['dispatch_arrival', 'info', dhr, null, 'Dispatch FAR-DISP-DEMO-002 expected for receiving', 'supervisor', 'receiving', null],
    ];
    for (const [type, sev, loc, uidId, msg, role, page, recId] of alertDefs) {
      await q(
        `INSERT INTO alerts (alert_type, severity, location_id, uid_id, message, target_role, link_page, link_record_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
        [type, sev, loc, uidId, msg, role, page, recId]
      );
    }

    console.log(`✓ Demo data created: ${operators.length + 4} extra employees, 3 MOs, Faridabad chain (3 dispatches), ${allUidIds.length} UIDs, step+QC logs, 1 furnace + 1 production batch, today's shift with jobs, and 4 alerts.`);
  });

  // Fresh DB: operators exist now — spread jobs across every workstation.
  await seedOperatorJobsAcrossWorkstations();

  console.log('  Log in and explore — every page should now have data. Default new-user password: Demo123!');
  await pool.end();
}

main().catch((err) => {
  console.error('DEMO SEED FAILED:', err);
  process.exit(1);
});
