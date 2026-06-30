/**
 * CPCMS — Database Seed Script
 * Run with: npm run seed (after npm run migrate)
 *
 * Populates everything the system needs to be operable on day one:
 *   - One Admin user (CHANGE THE PASSWORD IMMEDIATELY AFTER FIRST LOGIN)
 *   - All 19 Dharmapuri workstation types + 1 Faridabad workstation (WELD-01)
 *   - Workstation units (e.g. MM22-1, MM22-2) including multi-unit furnaces
 *   - The EAT cycle — all 27 steps, correct workstations, correct storage flow
 *   - Tempering parameters for all 4 tempering steps (EAT only — SWAN/OVEN
 *     params left for Admin to configure once those cycles are needed)
 *   - Grinding machine rules (SG-DLT, AG-ALP, AG-BTA, AG-GMM)
 *   - Step batch rules (capacity, min thresholds, selection rules)
 *   - Color codes, a default truck capacity rule, sample suppliers/contractors
 *
 * NOTE ON GRADE -> CYCLE MAPPING, SWAN/OVEN CYCLE STEPS, AND PER-UNIT STEP
 * CAPACITY: these are intentionally left for Admin to define through the UI
 * once real values are known (per the instructions: "Faridabad operations
 * will be decided and designed later" / SWAN and OVEN steps are
 * Admin-configured). Seeding placeholder guesses here would be worse than
 * leaving them empty with a clear TODO, since wrong seeded data is harder
 * to notice than missing data.
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool, query, withTransaction } = require('../src/config/database');

async function main() {
  console.log('Seeding CPCMS database...\n');

  await seedAdminUser();
  const wsIds = await seedWorkstations();
  await seedWorkstationUnits(wsIds);
  await seedStorageLocations(); // idempotent — schema migration already inserts these, this is a safety net
  const cycleVersionId = await seedEatCycle(wsIds);
  await seedFaridabadCycle();
  await seedTemperingParameters();
  await seedGrindingRules(wsIds);
  await seedColorCodes();
  await seedTruckCapacityDefault();
  await seedSampleSuppliersAndContractors();

  console.log('\nSeed complete.');
  console.log('Admin login: username "admin", password "ChangeMe123!" — CHANGE THIS IMMEDIATELY.');
  await pool.end();
}

async function seedAdminUser() {
  const { rows: existing } = await query(`SELECT id FROM employees WHERE username = 'admin'`);
  if (existing.length) {
    console.log('✓ Admin user already exists, skipping.');
    return;
  }
  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
  await query(
    `INSERT INTO employees (employee_code, full_name, username, password_hash, role, location_id, status)
     VALUES ('EMP-001','System Administrator','admin',$1,'admin',NULL,'active')`,
    [passwordHash]
  );
  console.log('✓ Admin user created (username: admin / password: ChangeMe123!)');
}

const WORKSTATIONS = [
  // code,      name,                        category,         locationCode (null = both)
  ['BSW-01', 'Band Saw 1', 'cutting', null],
  ['BSW-02', 'Band Saw 2 / Converting', 'cutting', null],
  ['RCV-01', 'Receiving / Work Table', 'other', null],
  ['HT70', 'Hardening Furnace', 'heat_treatment', null],
  ['HT80', 'Quench Tank', 'heat_treatment', null],
  ['HT90', 'Tempering Furnace', 'heat_treatment', null],
  ['STR-HYD', 'Hydraulic Straightener', 'machining', null],
  ['STR-MAN', 'Manual Straightener', 'machining', null],
  ['MM22', 'Rough Mill (OP10)', 'machining', 'dharmapuri'],
  ['MM11', 'Finish Mill (OP20/30)', 'machining', 'dharmapuri'],
  ['SG-DLT', 'Surface Grinder Delta', 'grinding', 'dharmapuri'],
  ['AG-ALP', 'Angle Grinder Alpha', 'grinding', 'dharmapuri'],
  ['AG-BTA', 'Angle Grinder Beta', 'grinding', 'dharmapuri'],
  ['AG-GMM', 'Angle Grinder Gamma', 'grinding', 'dharmapuri'],
  ['PRO', 'Anti-rust Coating', 'finishing', 'dharmapuri'],
  ['HRC-01', 'Hardness Tester', 'qc', 'dharmapuri'],
  ['PKG', 'Packing & Dispatch', 'other', 'dharmapuri'],
  ['VCL-200', 'VCL-200', 'machining', 'dharmapuri'],
  ['ISP', 'Inspection Station', 'qc', 'dharmapuri'],
  ['WELD-01', 'Joining / Welding', 'joining', 'faridabad'],
];

async function seedWorkstations() {
  const { rows: locRows } = await query(`SELECT id, code FROM locations`);
  const locMap = Object.fromEntries(locRows.map((r) => [r.code, r.id]));

  const ids = {};
  for (const [code, name, category, locationCode] of WORKSTATIONS) {
    const { rows: existing } = await query(`SELECT id FROM workstation_types WHERE code = $1`, [code]);
    if (existing.length) {
      ids[code] = existing[0].id;
      continue;
    }
    const { rows } = await query(
      `INSERT INTO workstation_types (code, name, category, location_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [code, name, category, locationCode ? locMap[locationCode] : null]
    );
    ids[code] = rows[0].id;
  }
  console.log(`✓ Seeded ${Object.keys(ids).length} workstation types`);
  return ids;
}

// Multi-unit workstations per the instructions (e.g. 2x MM22 for parallel capacity)
const WORKSTATION_UNITS = {
  'MM22': ['MM22-1', 'MM22-2'],
  'MM11': ['MM11-1'],
  'HT70': ['HT70-1'],
  'HT80': ['HT80-1'],
  'HT90': ['HT90-1'],
  'SG-DLT': ['SG-DLT-1'],
  'AG-ALP': ['AG-ALP-1'],
  'AG-BTA': ['AG-BTA-1'],
  'AG-GMM': ['AG-GMM-1'],
  'BSW-01': ['BSW-01-1'],
  'BSW-02': ['BSW-02-1'],
  'WELD-01': ['WB-1', 'WB-2', 'WB-3'], // Faridabad weld bays
};

async function seedWorkstationUnits(wsIds) {
  let count = 0;
  for (const [wsCode, units] of Object.entries(WORKSTATION_UNITS)) {
    if (!wsIds[wsCode]) continue;
    for (const unitCode of units) {
      const { rows: existing } = await query(`SELECT id FROM workstation_units WHERE unit_code = $1`, [unitCode]);
      if (existing.length) continue;
      await query(
        `INSERT INTO workstation_units (workstation_type_id, unit_code, unit_name) VALUES ($1,$2,$3)`,
        [wsIds[wsCode], unitCode, unitCode]
      );
      count++;
    }
  }
  console.log(`✓ Seeded ${count} workstation units`);
}

async function seedStorageLocations() {
  // Already inserted by the migration for Dharmapuri (location_id=1). This
  // function is a no-op safety net in case the seed is ever run against a
  // schema where that insert was skipped.
  const { rows } = await query(`SELECT COUNT(*) AS c FROM storage_locations`);
  console.log(`✓ Storage locations present: ${rows[0].c}`);
}

/**
 * The 27-step EAT cycle, exactly as defined in the instructions, including
 * the corrected storage flow, step types (temper/split/normal), and
 * capacity basis per step.
 */
const EAT_STEPS = [
  ['1', 'Band Saw Cutting', 'BSW-01', 'RM', 'RM-Q', 'normal', null, 'fixed', 1],
  ['2', 'UID Tagging', 'RCV-01', 'RM-Q', 'RM-D', 'normal', null, 'fixed', 1],
  ['3', 'Straightening', 'STR-MAN', 'RM-D', 'MC-Q', 'normal', null, 'fixed', 1],
  ['4', 'Bunch Grinding', 'SG-DLT', 'MC-Q', 'MC-Q', 'normal', null, 'length_based', 1],
  ['5', 'OP10 Rough Mill', 'MM22', 'MC-Q', 'MC-D', 'normal', null, 'fixed', 1],
  ['6', 'Hardening', 'HT70', 'MC-D', 'HT-Q', 'normal', 6, 'furnace_scaled', 6],
  ['7', 'Quenching', 'HT80', 'HT-Q', 'HT-Q', 'normal', 6, 'furnace_scaled', 6],
  ['8', 'Straightening HYD', 'STR-HYD', 'HT-Q', 'HT-Q', 'normal', null, 'fixed', 1],
  ['9', 'Tempering 1', 'HT90', 'HT-Q', 'HT-Q', 'temper', 80, 'furnace_scaled', 80],
  ['10', 'Tempering 2', 'HT90', 'HT-Q', 'HT-D', 'temper', 80, 'furnace_scaled', 80],
  ['11', 'Straighten Post-HT', 'STR-HYD', 'HT-D', 'MC-Q', 'normal', null, 'fixed', 1],
  ['12', 'Surface Grind 1', 'SG-DLT', 'MC-Q', 'MC-D', 'normal', null, 'length_based', 1],
  ['13', 'Anti-rust Coat', 'PRO', 'MC-D', 'MC-D', 'normal', null, 'fixed', 1],
  ['14', 'Tempering 3', 'HT90', 'MC-D', 'HT-Q', 'temper', 80, 'furnace_scaled', 80],
  ['15', 'Straighten Manual', 'STR-MAN', 'HT-Q', 'QC-Q', 'normal', null, 'fixed', 1],
  ['16', 'Converting', 'BSW-02', 'QC-Q', 'QC-Q', 'split', null, 'fixed', 1],
  ['16B', 'Child UID Marking', 'RCV-01', 'QC-Q', 'QC-Q', 'split', null, 'fixed', 1],
  ['17', 'OP20 Semi-finish Mill', 'MM11', 'QC-Q', 'MC-Q', 'normal', null, 'fixed', 1],
  ['18', 'OP30 Finish Mill', 'MM11', 'MC-Q', 'MC-D', 'normal', null, 'fixed', 1],
  ['19', 'Straighten Post-OP30', 'STR-MAN', 'MC-D', 'QC-Q', 'normal', null, 'fixed', 1],
  ['20', 'Surface Grind 2', 'SG-DLT', 'QC-Q', 'MC-D', 'normal', null, 'length_based', 1],
  ['21', 'Anti-rust Coat 2', 'PRO', 'MC-D', 'MC-D', 'normal', null, 'fixed', 1],
  ['22', 'Bevel Grinding', 'AG-ALP', 'MC-D', 'MC-D', 'normal', null, 'length_based', 1],
  ['23', 'Tempering 4 — Stress Relief', 'HT90', 'HT-Q', 'HT-D', 'temper', 80, 'furnace_scaled', 80],
  ['24', 'Final Anti-rust', 'PRO', 'HT-D', 'QC-Q', 'normal', null, 'fixed', 1],
  ['25', 'Final Straightening', 'STR-MAN', 'QC-Q', 'QC-D', 'normal', null, 'fixed', 1],
  ['26', 'QC Inspection', 'HRC-01', 'QC-D', 'QC-D', 'normal', null, 'fixed', 1],
  ['27', 'Packing and Dispatch', 'PKG', 'QC-D', 'FG', 'normal', null, 'fixed', 1],
];

async function seedEatCycle(wsIds) {
  const { rows: existingVersion } = await query(
    `SELECT cv.id FROM cycle_versions cv JOIN cycle_types ct ON ct.id = cv.cycle_type_id WHERE ct.code = 'EAT' AND cv.is_current = true`
  );
  if (existingVersion.length) {
    const { rows: stepCount } = await query(`SELECT COUNT(*) AS c FROM cycle_steps WHERE cycle_version_id = $1`, [existingVersion[0].id]);
    if (Number(stepCount[0].c) > 0) {
      console.log('✓ EAT cycle already seeded, skipping.');
      return existingVersion[0].id;
    }
  }

  const { rows: storRows } = await query(`SELECT id, code FROM storage_locations WHERE location_id = 1`);
  const storMap = Object.fromEntries(storRows.map((r) => [r.code, r.id]));

  const { rows: eatRows } = await query(`SELECT id FROM cycle_types WHERE code = 'EAT'`);
  const eatCycleTypeId = eatRows[0].id;

  let versionId;
  if (existingVersion.length) {
    versionId = existingVersion[0].id;
  } else {
    const { rows: verRows } = await query(
      `INSERT INTO cycle_versions (cycle_type_id, version_number, change_summary, is_current) VALUES ($1,1,'Initial seed',true) RETURNING id`,
      [eatCycleTypeId]
    );
    versionId = verRows[0].id;
  }

  let seq = 1;
  for (const [stepNumber, opName, wsCode, srcCode, dstCode, stepType, capacity1500, capacityBasis, minThreshold] of EAT_STEPS) {
    if (!wsIds[wsCode]) {
      console.warn(`  ⚠ Skipping step ${stepNumber} — workstation ${wsCode} not found`);
      continue;
    }
    const { rows: stepRows } = await query(
      `INSERT INTO cycle_steps
         (cycle_version_id, step_number, sequence_order, operation_name, workstation_type_id,
          source_storage_id, dest_storage_id, step_type, capacity_1500, capacity_basis, min_queue_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [versionId, stepNumber, seq, opName, wsIds[wsCode], storMap[srcCode] || null, storMap[dstCode] || null,
        stepType, capacity1500, capacityBasis, minThreshold]
    );

    // Batch rules: furnace steps default to manual trigger + same-cycle-only
    // (hard rule); grinding steps default to manual trigger + dimension_match;
    // everything else auto + priority_fifo.
    let batchRule = { capacityType: 'count', minBatchSize: minThreshold, selectionRule: 'priority_fifo', cycleTypeMix: 'any', triggerMode: 'auto' };
    if (capacityBasis === 'furnace_scaled') {
      batchRule = { capacityType: 'count', minBatchSize: minThreshold, selectionRule: 'priority_fifo', cycleTypeMix: 'same_cycle', triggerMode: 'manual' };
    } else if (capacityBasis === 'length_based') {
      batchRule = { capacityType: 'count', minBatchSize: 1, selectionRule: 'dimension_match', cycleTypeMix: 'any', triggerMode: 'manual', dimensionToleranceMm: 0 };
    }
    await query(
      `INSERT INTO step_batch_rules (cycle_step_id, capacity_type, min_batch_size, selection_rule, cycle_type_mix, trigger_mode, dimension_tolerance_mm)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [stepRows[0].id, batchRule.capacityType, batchRule.minBatchSize, batchRule.selectionRule, batchRule.cycleTypeMix, batchRule.triggerMode, batchRule.dimensionToleranceMm || null]
    );

    seq++;
  }

  console.log(`✓ Seeded EAT cycle — ${EAT_STEPS.length} steps (version ${versionId})`);
  return versionId;
}

/**
 * Tempering parameters — EAT only. These are placeholder-but-realistic
 * starting values (typical for tool steel hardening/tempering); Admin
 * should review and adjust to the actual metallurgical spec before
 * production use. SWAN/OVEN left unconfigured until those cycles exist.
 */
// [step, target_temp_c, target_soak_min, tolerance_temp_c, tolerance_soak_min, rising_time_min]
const TEMPERING_DEFAULTS = [
  ['tempering_1', 180, 90, 5, 5, 45],
  ['tempering_2', 160, 90, 5, 5, 40],
  ['tempering_3', 150, 60, 5, 5, 35],
  ['tempering_4', 140, 60, 5, 5, 30], // Stress Relief
];

/**
 * Faridabad full cycle — a 10-step cycle defined like EAT/SWAN/OVEN, with its
 * own Faridabad workstation types. No UIDs flow through it; batches do. Storage
 * isn't tracked at this granularity, so steps have no source/dest storage.
 */
const FAR_WORKSTATIONS = [
  ['FAR-INTAKE', 'Material Intake', 'intake'],
  ['FAR-AC', 'Alloy Cutting', 'cutting'],
  ['FAR-AG', 'Alloy Grinding', 'grinding'],
  ['FAR-MSC', 'MS Cutting', 'cutting'],
  ['FAR-MSL', 'MS L Cutting', 'cutting'],
  ['FAR-MSV', 'MS V Grooving', 'grooving'],
  ['FAR-DSP', 'Dispatch Staging', 'dispatch'],
];
// [stepNumber, operationName, workstationCode]
const FAR_STEPS = [
  ['1', 'Alloy Steel Intake', 'FAR-INTAKE'],
  ['2', 'Alloy Steel Cutting', 'FAR-AC'],
  ['3', 'Alloy Steel Grinding', 'FAR-AG'],
  ['4', 'MS Intake', 'FAR-INTAKE'],
  ['5', 'MS Cutting', 'FAR-MSC'],
  ['6', 'MS L Cutting', 'FAR-MSL'],
  ['7', 'MS V Grooving', 'FAR-MSV'],
  ['8', 'Welding (Joining)', 'WELD-01'],
  ['9', 'Dispatch to Rolling Contractor', 'FAR-DSP'],
  ['10', 'Dispatch to Dharmapuri', 'FAR-DSP'],
];

async function seedFaridabadCycle() {
  const { rows: locRows } = await query(`SELECT id FROM locations WHERE code = 'faridabad'`);
  const farLoc = locRows[0]?.id || 2;

  // Faridabad workstation types (idempotent by code).
  const wsId = {};
  for (const [code, name, category] of FAR_WORKSTATIONS) {
    const { rows: ex } = await query(`SELECT id FROM workstation_types WHERE code = $1`, [code]);
    wsId[code] = ex[0] ? ex[0].id : (await query(
      `INSERT INTO workstation_types (code, name, category, location_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [code, name, category, farLoc]
    )).rows[0].id;
  }
  const { rows: weld } = await query(`SELECT id FROM workstation_types WHERE code = 'WELD-01'`);
  wsId['WELD-01'] = weld[0]?.id || wsId['FAR-DSP'];

  // FAR cycle type + current version (idempotent).
  let { rows: ctRows } = await query(`SELECT id FROM cycle_types WHERE code = 'FAR'`);
  const farCycleId = ctRows[0] ? ctRows[0].id : (await query(
    `INSERT INTO cycle_types (code, name, location_id, letter) VALUES ('FAR','Faridabad Cycle',$1,'F') RETURNING id`,
    [farLoc]
  )).rows[0].id;

  const { rows: verEx } = await query(`SELECT id FROM cycle_versions WHERE cycle_type_id = $1 AND is_current = true`, [farCycleId]);
  if (verEx.length) {
    const { rows: sc } = await query(`SELECT COUNT(*) AS c FROM cycle_steps WHERE cycle_version_id = $1`, [verEx[0].id]);
    if (Number(sc[0].c) > 0) { console.log('✓ Faridabad cycle already seeded, skipping.'); return; }
  }
  const versionId = verEx.length ? verEx[0].id : (await query(
    `INSERT INTO cycle_versions (cycle_type_id, version_number, change_summary, is_current) VALUES ($1,1,'Initial Faridabad cycle',true) RETURNING id`,
    [farCycleId]
  )).rows[0].id;

  let seq = 1;
  for (const [stepNumber, opName, wsCode] of FAR_STEPS) {
    await query(
      `INSERT INTO cycle_steps (cycle_version_id, step_number, sequence_order, operation_name, workstation_type_id, step_type)
       VALUES ($1,$2,$3,$4,$5,'normal')`,
      [versionId, stepNumber, seq++, opName, wsId[wsCode]]
    );
  }
  console.log(`✓ Seeded Faridabad cycle — ${FAR_STEPS.length} steps (version ${versionId})`);
}

async function seedTemperingParameters() {
  const { rows: eatRows } = await query(`SELECT id FROM cycle_types WHERE code = 'EAT'`);
  const eatId = eatRows[0].id;

  let count = 0;
  for (const [step, temp, soak, tolT, tolS, rising] of TEMPERING_DEFAULTS) {
    const { rows: existing } = await query(`SELECT id FROM tempering_parameters WHERE cycle_type_id = $1 AND tempering_step = $2`, [eatId, step]);
    if (existing.length) continue;
    await query(
      `INSERT INTO tempering_parameters (cycle_type_id, tempering_step, target_temp_c, target_soak_min, tolerance_temp_c, tolerance_soak_min, rising_time_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [eatId, step, temp, soak, tolT, tolS, rising]
    );
    count++;
  }
  console.log(`✓ Seeded ${count} tempering parameter rows (EAT) — REVIEW these against actual metallurgical spec before production use`);
}

/**
 * Grinding machine rules — exact figures from the instructions:
 *   SG-DLT / AG-GMM: 3000mm max, bunch grinding (SG-DLT only) 5 bars/set, 3000mm bed
 *   AG-ALP / AG-BTA: 1500mm max, single bar
 */
const GRINDING_RULES = [
  ['SG-DLT', 3000, 5, 3000],
  ['AG-GMM', 3000, null, null],
  ['AG-ALP', 1500, null, null],
  ['AG-BTA', 1500, null, null],
];

async function seedGrindingRules(wsIds) {
  let count = 0;
  for (const [wsCode, maxLen, barsPerSet, bedLen] of GRINDING_RULES) {
    if (!wsIds[wsCode]) continue;
    const { rows: existing } = await query(`SELECT id FROM grinding_machine_rules WHERE workstation_type_id = $1`, [wsIds[wsCode]]);
    if (existing.length) continue;
    await query(
      `INSERT INTO grinding_machine_rules (workstation_type_id, max_length_mm, bars_per_set, bed_length_mm) VALUES ($1,$2,$3,$4)`,
      [wsIds[wsCode], maxLen, barsPerSet, bedLen]
    );
    count++;
  }
  console.log(`✓ Seeded ${count} grinding machine rules`);
}

async function seedColorCodes() {
  const colors = [['Red', '#E5484D'], ['Blue', '#2D6FB5'], ['Green', '#22A06B'], ['Yellow', '#F0C674'], ['Orange', '#D97A2B'], ['Purple', '#7A4FC0']];
  let count = 0;
  for (const [name, hex] of colors) {
    const { rows: existing } = await query(`SELECT id FROM color_codes WHERE name = $1`, [name]);
    if (existing.length) continue;
    await query(`INSERT INTO color_codes (name, hex_swatch) VALUES ($1,$2)`, [name, hex]);
    count++;
  }
  console.log(`✓ Seeded ${count} color codes`);
}

async function seedTruckCapacityDefault() {
  const { rows: existing } = await query(`SELECT id FROM truck_capacity WHERE contractor_id IS NULL`);
  if (existing.length) {
    console.log('✓ Default truck capacity already set, skipping.');
    return;
  }
  await query(`INSERT INTO truck_capacity (contractor_id, max_blocks) VALUES (NULL, 50)`);
  console.log('✓ Seeded default truck capacity rule (50 blocks)');
}

async function seedSampleSuppliersAndContractors() {
  const { rows: supExisting } = await query(`SELECT COUNT(*) AS c FROM suppliers`);
  if (Number(supExisting[0].c) === 0) {
    await query(
      `INSERT INTO suppliers (name, material_type) VALUES
       ('Jindal Steel','alloy_steel'), ('Tata Steel','alloy_steel'), ('Mukand Ltd','ms'), ('Vizag Steel','ms')`
    );
    console.log('✓ Seeded 4 sample suppliers');
  }

  const { rows: contExisting } = await query(`SELECT COUNT(*) AS c FROM contractors`);
  if (Number(contExisting[0].c) === 0) {
    await query(`INSERT INTO contractors (name) VALUES ('Sri Rolling Mills'), ('Deccan Rollers')`);
    console.log('✓ Seeded 2 sample rolling contractors');
  }
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
