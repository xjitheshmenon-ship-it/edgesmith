/**
 * CPCMS — Optional DEMO data (NOT real production data)
 * Run on boot only when SEED_DEMO=true (see docker-entrypoint.sh).
 *
 * Creates ONE coherent Faridabad→Dharmapuri chain so the Dharmapuri pages
 * (UID Creation in particular) have something to work with on a fresh install:
 *   - 2 raw-material intakes (one alloy heat, one MS heat)
 *   - 1 contractor dispatch (with the two heats as the possible-heats arrays)
 *   - 1 receiving event (status awaiting_cut) → appears in UID Creation
 *
 * Idempotent: keyed on the demo dispatch reference, so re-running does nothing.
 * To remove the demo data later, archive/delete the DEMO records from Master/UI.
 */

require('dotenv').config();
const { pool, query, withTransaction } = require('../src/config/database');

const DEMO_DISPATCH_REF = 'FAR-DISP-DEMO-001';

async function lookupId(sql, label) {
  const { rows } = await query(sql);
  if (!rows[0]) throw new Error(`Demo seed needs ${label} but none exists — run the base seed first.`);
  return rows[0].id;
}

async function main() {
  console.log('Seeding DEMO data (SEED_DEMO=true)...\n');

  const { rows: existing } = await query(`SELECT id FROM contractor_dispatches WHERE batch_reference = $1`, [DEMO_DISPATCH_REF]);
  if (existing[0]) {
    console.log('✓ Demo data already present, skipping.');
    await pool.end();
    return;
  }

  const cycleTypeId = await lookupId(`SELECT id FROM cycle_types WHERE code = 'EAT'`, 'the EAT cycle type');
  const colorCodeId = await lookupId(`SELECT id FROM color_codes ORDER BY id LIMIT 1`, 'a color code');
  const contractorId = await lookupId(`SELECT id FROM contractors ORDER BY id LIMIT 1`, 'a rolling contractor');
  const alloySupplierId = await lookupId(`SELECT id FROM suppliers WHERE material_type IN ('alloy_steel','both') ORDER BY id LIMIT 1`, 'an alloy-steel supplier');
  const msSupplierId = await lookupId(`SELECT id FROM suppliers WHERE material_type IN ('ms','both') ORDER BY id LIMIT 1`, 'an MS supplier');
  const adminId = await lookupId(`SELECT id FROM employees WHERE username = 'admin'`, 'the admin user');

  const today = new Date().toISOString().slice(0, 10);
  const alloyHeat = 'DEMO-ALLOY-H1';
  const msHeat = 'DEMO-MS-H1';

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO raw_material_intakes
         (material_type, supplier_id, heat_number, grade, cycle_type_id, steel_grade, weight_kg, bar_count, dimensions_mm, date_received, po_reference, notes, created_by)
       VALUES ('alloy_steel',$1,$2,'EN8',$3,'EN8',1500,30,'Ø32',$4,'DEMO-PO-A','Demo data',$5)`,
      [alloySupplierId, alloyHeat, cycleTypeId, today, adminId]
    );
    await client.query(
      `INSERT INTO raw_material_intakes
         (material_type, supplier_id, heat_number, weight_kg, bar_count, dimensions_mm, date_received, po_reference, notes, created_by)
       VALUES ('ms',$1,$2,800,16,'Ø20',$3,'DEMO-PO-M','Demo data',$4)`,
      [msSupplierId, msHeat, today, adminId]
    );

    const { rows: dispRows } = await client.query(
      `INSERT INTO contractor_dispatches
         (batch_reference, cycle_type_id, color_code_id, block_count, contractor_id,
          possible_alloy_heats, possible_ms_heats, date_dispatched, expected_delivery_date, challan_reference, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DEMO-CHALLAN','fully_received',$10) RETURNING id`,
      [DEMO_DISPATCH_REF, cycleTypeId, colorCodeId, 20, contractorId, [alloyHeat], [msHeat], today, today, adminId]
    );
    const dispatchId = dispRows[0].id;

    await client.query(
      `INSERT INTO receiving_events
         (receiving_reference, dispatch_batch_id, block_count, color_code_on_arrival_id, color_match,
          condition, condition_notes, received_by, date_received, status, blocks_cut)
       VALUES ($1,$2,$3,$4,true,'good','Demo receiving event',$5,$6,'awaiting_cut',0)`,
      ['DHR-RCV-DEMO-001', dispatchId, 20, colorCodeId, adminId, today]
    );
  });

  console.log(`✓ Demo data created: 2 intakes, 1 dispatch (${DEMO_DISPATCH_REF}), 1 receiving event (DHR-RCV-DEMO-001).`);
  console.log('  UID Creation can now select the demo receiving event.');
  await pool.end();
}

main().catch((err) => {
  console.error('DEMO SEED FAILED:', err);
  process.exit(1);
});
