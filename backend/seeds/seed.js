// Seed the database with Edgesmith's initial configuration.
// Idempotent: if the admin user already exists, only top-up the extra users.
import { pool, one, query, tx } from '../src/db/pool.js';
import { hashPassword } from '../src/middleware/auth.js';

// EAT cycle — 27 steps (authoritative: CPCMS Instructions + Design Corrections).
// [step_number, operation_name, workstation_code, from_storage, to_storage, converting, child_marking, qc]
const EAT_STEPS = [
  ['1', 'Band Saw Cutting', 'BSW-01', 'RM', 'RM-Q', false, false, false],
  ['2', 'UID Tagging', 'RCV-01', 'RM-Q', 'RM-D', false, false, false],
  ['3', 'Straightening', 'STR-MAN', 'RM-D', 'MC-Q', false, false, false],
  ['4', 'Bunch Grinding', 'SG-DLT', 'MC-Q', 'MC-Q', false, false, false],
  ['5', 'OP10 Rough Mill', 'MM22', 'MC-Q', 'MC-D', false, false, false],
  ['6', 'Hardening', 'HT70', 'MC-D', 'HT-Q', false, false, false],
  ['7', 'Quenching', 'HT80', 'HT-Q', 'HT-Q', false, false, false],
  ['8', 'Straightening HYD', 'STR-HYD', 'HT-Q', 'HT-Q', false, false, false],
  ['9', 'Tempering 1', 'HT90', 'HT-Q', 'HT-Q', false, false, false],
  ['10', 'Tempering 2', 'HT90', 'HT-Q', 'HT-D', false, false, false],
  ['11', 'Straighten Post-HT', 'STR-HYD', 'HT-D', 'MC-Q', false, false, false],
  ['12', 'Surface Grind 1', 'SG-DLT', 'MC-Q', 'MC-D', false, false, false],
  ['13', 'Anti-rust Coat', 'PRO', 'MC-D', 'MC-D', false, false, false],
  ['14', 'Tempering 3', 'HT90', 'MC-D', 'HT-Q', false, false, false],
  ['15', 'Straighten Manual', 'STR-MAN', 'HT-Q', 'QC-Q', false, false, false],
  ['16', 'Converting', 'BSW-02', 'QC-Q', 'QC-Q', true, false, false],
  ['16B', 'Child UID Marking', 'RCV-01', 'QC-Q', 'QC-Q', false, true, false],
  ['17', 'OP20 Semi-finish Mill', 'MM11', 'QC-Q', 'MC-Q', false, false, false],
  ['18', 'OP30 Finish Mill', 'MM11', 'MC-Q', 'MC-D', false, false, false],
  ['19', 'Straighten Post-OP30', 'STR-MAN', 'MC-D', 'QC-Q', false, false, false],
  ['20', 'Surface Grind 2', 'SG-DLT', 'QC-Q', 'MC-D', false, false, false],
  ['21', 'Anti-rust Coat 2', 'PRO', 'MC-D', 'MC-D', false, false, false],
  ['22', 'Bevel Grinding', 'AG-ALP', 'MC-D', 'MC-D', false, false, false],
  ['23', 'Tempering 4 — Stress Relief', 'HT90', 'MC-D', 'HT-Q', false, false, false],
  ['24', 'Final Anti-rust', 'PRO', 'HT-Q', 'QC-Q', false, false, false],
  ['25', 'Final Straightening', 'STR-MAN', 'QC-Q', 'QC-D', false, false, false],
  ['26', 'QC Inspection', 'HRC-01', 'QC-D', 'QC-D', false, false, true],
  ['27', 'Packing and Dispatch', 'PKG', 'QC-D', 'FG', false, false, false],
];

// Default tempering parameters per EAT tempering step (Admin-configurable later).
// keyed by step_number → [target_temp_c, target_soak_minutes, tol_temp, tol_soak]
const EAT_TEMPERING = {
  9: [560, 120, 10, 10],
  10: [560, 120, 10, 10],
  14: [540, 90, 10, 10],
  23: [520, 90, 10, 10],
};

const WORKSTATIONS = [
  ['BSW-01', 'Band Saw 1', 'Cutting'],
  ['BSW-02', 'Band Saw 2', 'Cutting'],
  ['RCV-01', 'Receiving / Work Table', 'Other'],
  ['HT70', 'Hardening Furnace', 'Heat Treatment'],
  ['HT80', 'Quench Tank', 'Heat Treatment'],
  ['HT90', 'Tempering Furnace', 'Heat Treatment'],
  ['STR-HYD', 'Hydraulic Straightener', 'Machining'],
  ['STR-MAN', 'Manual Straightener', 'Machining'],
  ['SG-DLT', 'Surface Grinder Delta', 'Grinding'],
  ['MM22', 'Milling Machine 22 (OP10)', 'Machining'],
  ['MM11', 'Milling Machine 11 (OP20/30)', 'Machining'],
  ['AG-ALP', 'Angle Grinder Alpha', 'Grinding'],
  ['AG-BTA', 'Angle Grinder Beta', 'Grinding'],
  ['AG-GMM', 'Angle Grinder Gamma', 'Grinding'],
  ['PRO', 'Protective Coating Station', 'Coating'],
  ['HRC-01', 'Hardness Tester / QC Station', 'QC'],
  ['VCL-200', 'VCL 200', 'Machining'],
  ['ISP', 'Inspection Station', 'QC'],
  ['PKG', 'Packing and Dispatch', 'Packing'],
];

const STORAGES = ['RM', 'RM-Q', 'RM-D', 'HT-Q', 'HT-D', 'MC-Q', 'MC-D', 'QC-Q', 'QC-D', 'FG'];

const EXTRA_USERS = [
  ['operator3', 'Muthukumar S', 'op123', 'operator', 1],
  ['operator4', 'Vijayakumar R', 'op123', 'operator', 1],
  ['operator5', 'Balamurugan K', 'op123', 'operator', 2],
  ['operator6', 'Senthilkumar P', 'op123', 'operator', 2],
  ['operator7', 'Arumugam D', 'op123', 'operator', 1],
  ['supervisor3', 'Kannan M', 'super123', 'supervisor', 1],
  ['supervisor4', 'Prakash V', 'super123', 'supervisor', 2],
  ['supervisor5', 'Murugesan T', 'super123', 'supervisor', 1],
];

async function seedExtraUsers() {
  const loc1 = await one("SELECT id FROM factory_locations WHERE code = 'F1'");
  const loc2 = await one("SELECT id FROM factory_locations WHERE code = 'F2'");
  if (!loc1 || !loc2) return;
  const locMap = { 1: loc1.id, 2: loc2.id };
  let added = 0;
  for (const [username, fullName, pwd, role, locIdx] of EXTRA_USERS) {
    const exists = await one('SELECT id FROM users WHERE username = $1', [username]);
    if (!exists) {
      await query(
        'INSERT INTO users (username, full_name, hashed_password, role, primary_location_id) VALUES ($1,$2,$3,$4,$5)',
        [username, fullName, hashPassword(pwd), role, locMap[locIdx]]
      );
      added += 1;
    }
  }
  if (added) console.log(`[seed] Added ${added} extra users.`);
}

// Idempotent: grinding machine length limits, example per-step capacities, and
// one active unit per workstation. Safe to run on every boot. Only present if the
// 002 migration (workstation_units / capacity_per_unit / max_bar_length_mm) ran.
async function seedCapacityGrinding() {
  const hasCol = await one(
    "SELECT 1 FROM information_schema.columns WHERE table_name='workstations' AND column_name='max_bar_length_mm'"
  );
  if (!hasCol) return;

  // Grinding machine maximum bed lengths (mm).
  await query("UPDATE workstations SET max_bar_length_mm = 3000 WHERE code IN ('SG-DLT','AG-GMM') AND max_bar_length_mm IS NULL");
  await query("UPDATE workstations SET max_bar_length_mm = 1500 WHERE code IN ('AG-BTA','AG-ALP') AND max_bar_length_mm IS NULL");

  // Example EAT per-step capacities (Admin can change in the Cycle Builder).
  const caps = { 4: 10, 5: 1, 6: 40, 12: 6 };
  for (const [stepNum, cap] of Object.entries(caps)) {
    await query(
      `UPDATE cycle_steps cs SET capacity_per_unit = $1
         WHERE cs.step_number = $2 AND cs.capacity_per_unit IS NULL
           AND cs.cycle_version_id IN (
             SELECT v.id FROM cycle_versions v JOIN cycle_types ct ON ct.id = v.cycle_type_id
              WHERE ct.name = 'EAT' AND v.is_current = TRUE)`,
      [cap, stepNum]
    );
  }

  // One active unit per workstation at Dharmapuri (so cap × units math works).
  const loc1 = await one("SELECT id FROM factory_locations WHERE code = 'F1'");
  await query(
    `INSERT INTO workstation_units (unit_code, workstation_id, name, factory_location_id, status)
       SELECT w.code || '-1', w.id, w.name || ' #1', $1, 'active'
       FROM workstations w WHERE w.is_active = TRUE
     ON CONFLICT (unit_code) DO NOTHING`,
    [loc1 ? loc1.id : null]
  );
}

export async function seed() {
  const admin = await one("SELECT id FROM users WHERE username = 'admin'");
  if (admin) {
    console.log('[seed] Database already seeded.');
    await seedExtraUsers();
    await seedCapacityGrinding();
    return;
  }

  console.log('[seed] Seeding database...');
  await tx(async (c) => {
    // Factory locations
    const loc1 = await c.one("INSERT INTO factory_locations (code, name) VALUES ('F1','Dharmapuri') RETURNING id");
    const loc2 = await c.one("INSERT INTO factory_locations (code, name) VALUES ('F2','Faridabad') RETURNING id");

    // Storage locations
    const storageMap = {};
    for (const code of STORAGES) {
      const s = await c.one('INSERT INTO storage_locations (code, name) VALUES ($1,$1) RETURNING id', [code]);
      storageMap[code] = s.id;
    }

    // Workstations (available at both locations)
    const wsMap = {};
    for (const [code, name, category] of WORKSTATIONS) {
      const w = await c.one('INSERT INTO workstations (code, name, category) VALUES ($1,$2,$3) RETURNING id', [code, name, category]);
      wsMap[code] = w.id;
    }

    // Sizes
    const sizeMap = {};
    for (const mm of [1500, 1424, 2750]) {
      const s = await c.one('INSERT INTO sizes (value_mm) VALUES ($1) RETURNING id', [mm]);
      sizeMap[mm] = s.id;
    }

    // Designs
    const plain = await c.one("INSERT INTO designs (code, description) VALUES ('Plain','Plain profile') RETURNING id");
    const d8534 = await c.one("INSERT INTO designs (code, description) VALUES ('9/8534','Drawing 9/8534') RETURNING id");
    const d5032 = await c.one("INSERT INTO designs (code, description) VALUES ('9/5032','Drawing 9/5032') RETURNING id");

    const validities = [
      [plain.id, sizeMap[1500]], [d8534.id, sizeMap[1500]],
      [plain.id, sizeMap[1424]], [d5032.id, sizeMap[1424]],
      [plain.id, sizeMap[2750]], [d8534.id, sizeMap[2750]], [d5032.id, sizeMap[2750]],
    ];
    for (const [dId, sId] of validities) {
      await c.query('INSERT INTO design_size_validity (design_id, size_id) VALUES ($1,$2)', [dId, sId]);
    }

    // Cycle types
    const eat = await c.one("INSERT INTO cycle_types (name, letter_prefix, description) VALUES ('EAT','E','Primary EAT cycle — 27 steps') RETURNING id");
    const swan = await c.one("INSERT INTO cycle_types (name, letter_prefix, description) VALUES ('SWAN','S','SWAN cycle') RETURNING id");
    const oven = await c.one("INSERT INTO cycle_types (name, letter_prefix, description) VALUES ('OVEN','O','OVEN cycle') RETURNING id");

    // EAT version 1 + steps
    const eatV1 = await c.one(
      "INSERT INTO cycle_versions (cycle_type_id, version_number, is_current, change_notes) VALUES ($1, 1, TRUE, 'Initial EAT cycle from CPCMS spec') RETURNING id",
      [eat.id]
    );
    const stepIdByNumber = {};
    for (let order = 0; order < EAT_STEPS.length; order++) {
      const [num, opName, wsCode, fromS, toS, isConv, isChild, isQc] = EAT_STEPS[order];
      const step = await c.one(
        `INSERT INTO cycle_steps
           (cycle_version_id, step_number, step_order, operation_name, workstation_id, from_storage_id, to_storage_id,
            is_converting_step, is_child_marking_step, is_qc_step)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [eatV1.id, num, order, opName, wsMap[wsCode], storageMap[fromS], storageMap[toS], isConv, isChild, isQc]
      );
      stepIdByNumber[num] = step.id;
    }

    // EAT tempering parameters
    for (const [num, vals] of Object.entries(EAT_TEMPERING)) {
      const [temp, soak, tolT, tolS] = vals;
      await c.query(
        `INSERT INTO tempering_parameters
           (cycle_type_id, cycle_step_id, target_temp_c, target_soak_minutes, tolerance_temp_c, tolerance_soak_minutes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [eat.id, stepIdByNumber[num], temp, soak, tolT, tolS]
      );
    }

    // SWAN / OVEN placeholders (Admin configures real steps)
    for (const ct of [swan, oven]) {
      const v = await c.one(
        "INSERT INTO cycle_versions (cycle_type_id, version_number, is_current, change_notes) VALUES ($1, 1, TRUE, 'Placeholder — Admin must configure steps') RETURNING id",
        [ct.id]
      );
      await c.query(
        "INSERT INTO cycle_steps (cycle_version_id, step_number, step_order, operation_name, workstation_id) VALUES ($1,'1',0,'Configure via Admin panel',$2)",
        [v.id, wsMap['RCV-01']]
      );
    }

    // Conversion patterns
    await c.query("INSERT INTO conversion_patterns (name, input_length_mm, output_lengths_mm, kerf_mm) VALUES ('Pattern A', 4500, '[1500,1500,1424]', 3)");
    await c.query("INSERT INTO conversion_patterns (name, input_length_mm, output_lengths_mm, kerf_mm) VALUES ('Pattern B', 3000, '[1500,1424]', 3)");

    // Default users
    const users = [
      ['admin', 'System Admin', 'admin123', 'admin', null],
      ['manager1', 'Ravi Kumar', 'manager123', 'manager', null],
      ['supervisor1', 'Anand Pillai', 'super123', 'supervisor', loc1.id],
      ['supervisor2', 'Suresh Nair', 'super123', 'supervisor', loc2.id],
      ['operator1', 'Rajesh T', 'op123', 'operator', loc1.id],
      ['operator2', 'Dinesh M', 'op123', 'operator', loc2.id],
      ['service1', 'Field Service', 'svc123', 'service', null],
      ['shopfloor', 'Shopfloor Display', 'floor123', 'shopfloor', null],
    ];
    for (const [username, fullName, pwd, role, locId] of users) {
      await c.query(
        'INSERT INTO users (username, full_name, hashed_password, role, primary_location_id) VALUES ($1,$2,$3,$4,$5)',
        [username, fullName, hashPassword(pwd), role, locId]
      );
    }
  });

  console.log('[seed] Seeding complete.');
  await seedExtraUsers();
  await seedCapacityGrinding();
}

// Allow running directly: `npm run seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
