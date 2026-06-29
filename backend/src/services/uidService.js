// Core UID logic: generation (series + 999 rollover), step completion
// (with design-lock enforcement), and Converting (split into child UIDs).
import { tx } from '../db/pool.js';
import { HttpError } from '../middleware/auth.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Next UID code for a cycle type. Uses the given transaction client so codes
// generated earlier in the same bulk insert are visible.
async function nextUidCode(c, cycleType) {
  const latest = await c.one(
    'SELECT code FROM uids WHERE cycle_type_id = $1 ORDER BY id DESC LIMIT 1',
    [cycleType.id]
  );
  if (!latest) return `${cycleType.letter_prefix}001`;

  const lastLetter = latest.code[0];
  const lastNum = parseInt(latest.code.slice(1, 4), 10);
  if (Number.isFinite(lastNum) && lastNum < 999) {
    return `${lastLetter}${String(lastNum + 1).padStart(3, '0')}`;
  }

  const usedRows = await c.query(
    'SELECT letter_prefix FROM cycle_types WHERE is_active = TRUE'
  );
  const used = new Set(usedRows.map((r) => r.letter_prefix));
  const startIdx = LETTERS.indexOf(lastLetter);
  for (let i = startIdx + 1; i < LETTERS.length; i++) {
    if (!used.has(LETTERS[i])) return `${LETTERS[i]}001`;
  }
  throw new HttpError(500, 'UID namespace exhausted — all letters in use');
}

export async function bulkCreateUids(opts) {
  const {
    quantity,
    cycleTypeId,
    factoryLocationId,
    createdById,
    productTypeId = null,
    sizeId = null,
    designId = null,
    priority = 'normal',
    moId = null,
    receivingEventId = null,
  } = opts;

  return tx(async (c) => {
    const cycleType = await c.one('SELECT * FROM cycle_types WHERE id = $1', [cycleTypeId]);
    if (!cycleType) throw new HttpError(404, 'Cycle type not found');

    const version = await c.one(
      'SELECT * FROM cycle_versions WHERE cycle_type_id = $1 AND is_current = TRUE',
      [cycleTypeId]
    );
    if (!version) throw new HttpError(400, 'Cycle type has no current version');

    const firstStep = await c.one(
      'SELECT * FROM cycle_steps WHERE cycle_version_id = $1 ORDER BY step_order LIMIT 1',
      [version.id]
    );

    // ── Material inheritance ───────────────────────────────────────────────
    // Resolve the material chain from the receiving event, degrading gracefully:
    // receiving_event → faridabad_dispatch → joining_operation → alloy/ms intakes.
    // Set what's available, leave the rest null.
    let material = {
      faridabadDispatchId: null,
      receivingEventId: null,
      rollingContractor: null,
      alloySupplier: null,
      alloyGrade: null,
      alloyHeatNumber: null,
      msSupplier: null,
      msGrade: null,
      msHeatNumber: null,
    };
    if (receivingEventId) {
      const event = await c.one('SELECT * FROM receiving_events WHERE id = $1', [receivingEventId]);
      if (event) {
        material.receivingEventId = event.id;
        const dispatch = event.faridabad_dispatch_id
          ? await c.one('SELECT * FROM faridabad_dispatches WHERE id = $1', [event.faridabad_dispatch_id])
          : null;
        if (dispatch) {
          material.faridabadDispatchId = dispatch.id;
          material.rollingContractor = dispatch.rolling_contractor_name;
          const joining = dispatch.joining_operation_id
            ? await c.one('SELECT * FROM joining_operations WHERE id = $1', [dispatch.joining_operation_id])
            : null;
          if (joining) {
            const alloy = joining.alloy_intake_id
              ? await c.one('SELECT * FROM raw_material_intakes WHERE id = $1', [joining.alloy_intake_id])
              : null;
            if (alloy) {
              material.alloySupplier = alloy.supplier_name;
              material.alloyGrade = alloy.steel_grade;
              material.alloyHeatNumber = alloy.heat_number;
            }
            const ms = joining.ms_intake_id
              ? await c.one('SELECT * FROM raw_material_intakes WHERE id = $1', [joining.ms_intake_id])
              : null;
            if (ms) {
              material.msSupplier = ms.supplier_name;
              material.msGrade = ms.steel_grade;
              material.msHeatNumber = ms.heat_number;
            }
          }
        }
      }
    }

    const created = [];
    for (let i = 0; i < quantity; i++) {
      const code = await nextUidCode(c, cycleType);
      const row = await c.one(
        `INSERT INTO uids
           (code, factory_location_id, cycle_type_id, cycle_version_id,
            current_step_id, current_storage_id, product_type_id, size_id,
            design_id, design_confirmed, priority, mo_id, created_by_id,
            faridabad_dispatch_id, receiving_event_id,
            alloy_supplier, alloy_grade, alloy_heat_number,
            ms_supplier, ms_grade, ms_heat_number, rolling_contractor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING id, code`,
        [
          code,
          factoryLocationId,
          cycleTypeId,
          version.id,
          firstStep ? firstStep.id : null,
          firstStep ? firstStep.from_storage_id : null,
          productTypeId,
          sizeId,
          designId,
          !!designId,
          priority,
          moId,
          createdById,
          material.faridabadDispatchId,
          material.receivingEventId,
          material.alloySupplier,
          material.alloyGrade,
          material.alloyHeatNumber,
          material.msSupplier,
          material.msGrade,
          material.msHeatNumber,
          material.rollingContractor,
        ]
      );
      created.push(row);
    }
    return created;
  });
}

export async function completeStep(opts) {
  const { uidId, performedById, workstationId, qcResult = null, qcValues = null, notes = null } = opts;

  return tx(async (c) => {
    const uid = await c.one('SELECT * FROM uids WHERE id = $1', [uidId]);
    if (!uid) throw new HttpError(404, 'UID not found');
    if (uid.status !== 'active') {
      throw new HttpError(400, `UID is not active (status: ${uid.status})`);
    }

    const step = uid.current_step_id
      ? await c.one('SELECT * FROM cycle_steps WHERE id = $1', [uid.current_step_id])
      : null;
    if (!step) throw new HttpError(400, 'UID has no current step');

    // Design lock at Converting (Step 16)
    if (step.is_converting_step && !uid.design_confirmed) {
      await c.query("UPDATE uids SET status = 'on_hold' WHERE id = $1", [uidId]);
      throw new HttpError(400, 'Design must be confirmed before Converting (Step 16)');
    }

    await c.query(
      `INSERT INTO uid_step_history
         (uid_id, cycle_step_id, workstation_id, factory_location_id, performed_by_id, qc_result, qc_values, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uidId, step.id, workstationId, uid.factory_location_id, performedById, qcResult,
        qcValues ? JSON.stringify(qcValues) : null, notes]
    );

    const nextStep = await c.one(
      'SELECT * FROM cycle_steps WHERE cycle_version_id = $1 AND step_order > $2 ORDER BY step_order LIMIT 1',
      [uid.cycle_version_id, step.step_order]
    );

    if (nextStep) {
      const lockDesign = nextStep.step_number === '17';
      await c.query(
        `UPDATE uids SET current_step_id = $1, current_storage_id = $2
           ${lockDesign ? ', design_locked = TRUE' : ''}
         WHERE id = $3`,
        [nextStep.id, nextStep.from_storage_id, uidId]
      );
    } else {
      await c.query("UPDATE uids SET status = 'dispatched', current_step_id = NULL WHERE id = $1", [uidId]);
    }

    return c.one('SELECT * FROM uids WHERE id = $1', [uidId]);
  });
}

// QC sign-off on a UID's current step. Records a uid_step_history row carrying
// the QC verdict, then:
//   pass       → advance the UID to the next step (mirrors completeStep advance)
//   fail       → set status='on_hold', do not advance
//   borderline → keep the UID at its current step, do not advance
export async function qcSignoff(opts) {
  const { uidId, performedById, result, values = null, notes = null, workstationId = null } = opts;
  if (!['pass', 'fail', 'borderline'].includes(result)) {
    throw new HttpError(400, "result must be 'pass', 'fail', or 'borderline'");
  }

  return tx(async (c) => {
    const uid = await c.one('SELECT * FROM uids WHERE id = $1', [uidId]);
    if (!uid) throw new HttpError(404, 'UID not found');
    if (uid.status !== 'active') {
      throw new HttpError(400, `UID is not active (status: ${uid.status})`);
    }

    const step = uid.current_step_id
      ? await c.one('SELECT * FROM cycle_steps WHERE id = $1', [uid.current_step_id])
      : null;
    if (!step) throw new HttpError(400, 'UID has no current step');

    await c.query(
      `INSERT INTO uid_step_history
         (uid_id, cycle_step_id, workstation_id, factory_location_id, performed_by_id, qc_result, qc_values, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uidId, step.id, workstationId ?? step.workstation_id, uid.factory_location_id, performedById,
        result, values ? JSON.stringify(values) : null, notes]
    );

    if (result === 'pass') {
      const nextStep = await c.one(
        'SELECT * FROM cycle_steps WHERE cycle_version_id = $1 AND step_order > $2 ORDER BY step_order LIMIT 1',
        [uid.cycle_version_id, step.step_order]
      );
      if (nextStep) {
        const lockDesign = nextStep.step_number === '17';
        await c.query(
          `UPDATE uids SET current_step_id = $1, current_storage_id = $2
             ${lockDesign ? ', design_locked = TRUE' : ''}
           WHERE id = $3`,
          [nextStep.id, nextStep.from_storage_id, uidId]
        );
      } else {
        await c.query("UPDATE uids SET status = 'dispatched', current_step_id = NULL WHERE id = $1", [uidId]);
      }
    } else if (result === 'fail') {
      await c.query("UPDATE uids SET status = 'on_hold' WHERE id = $1", [uidId]);
    }
    // borderline: no UID change — verdict captured in history only.

    return c.one('SELECT * FROM uids WHERE id = $1', [uidId]);
  });
}

export async function doConverting(opts) {
  const { parentUidId, supervisorId, children, patternId = null } = opts;
  const SUFFIXES = ['A', 'B', 'C', 'D'];

  return tx(async (c) => {
    const parent = await c.one('SELECT * FROM uids WHERE id = $1', [parentUidId]);
    if (!parent) throw new HttpError(404, 'Parent UID not found');
    if (!parent.design_confirmed) throw new HttpError(400, 'Design must be confirmed before Converting');
    if (children.length < 2 || children.length > 4) throw new HttpError(400, 'Converting produces 2–4 children');

    const currentStep = parent.current_step_id
      ? await c.one('SELECT * FROM cycle_steps WHERE id = $1', [parent.current_step_id])
      : null;

    await c.query("UPDATE uids SET status = 'converted' WHERE id = $1", [parentUidId]);

    const childCodes = [];
    const createdChildren = [];

    for (let i = 0; i < children.length; i++) {
      const cd = children[i];
      const childCycle = await c.one('SELECT * FROM cycle_types WHERE id = $1', [cd.cycle_type_id]);
      if (!childCycle) throw new HttpError(404, `Cycle type ${cd.cycle_type_id} not found`);

      const childVersion = await c.one(
        'SELECT * FROM cycle_versions WHERE cycle_type_id = $1 AND is_current = TRUE',
        [childCycle.id]
      );

      // Children start at Step 17 (OP20). Fall back to the first step if a cycle
      // has no explicit "17" (e.g. unconfigured SWAN/OVEN placeholders).
      let startStep = childVersion
        ? await c.one(
            "SELECT * FROM cycle_steps WHERE cycle_version_id = $1 AND step_number = '17' ORDER BY step_order LIMIT 1",
            [childVersion.id]
          )
        : null;
      if (!startStep && childVersion) {
        startStep = await c.one(
          'SELECT * FROM cycle_steps WHERE cycle_version_id = $1 ORDER BY step_order LIMIT 1',
          [childVersion.id]
        );
      }

      const suffix = SUFFIXES[i];
      const childCode = `${parent.code}-${suffix}`;
      childCodes.push(childCode);

      const child = await c.one(
        `INSERT INTO uids
           (code, factory_location_id, cycle_type_id, cycle_version_id,
            current_step_id, current_storage_id, product_type_id, size_id,
            design_id, design_confirmed, priority, mo_id, parent_uid_id, child_suffix, created_by_id,
            alloy_supplier, alloy_grade, alloy_heat_number, ms_supplier, ms_grade, ms_heat_number,
            rolling_contractor, faridabad_dispatch_id, receiving_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING id`,
        [
          childCode,
          parent.factory_location_id,
          childCycle.id,
          childVersion ? childVersion.id : parent.cycle_version_id,
          startStep ? startStep.id : null,
          startStep ? startStep.from_storage_id : null,
          parent.product_type_id,
          cd.length_mm ? null : null, // child size comes from the cut; tracked via length on history, not a Size row
          parent.design_id,
          parent.design_confirmed,
          parent.priority,
          parent.mo_id,
          parent.id,
          suffix,
          supervisorId,
          parent.alloy_supplier,
          parent.alloy_grade,
          parent.alloy_heat_number,
          parent.ms_supplier,
          parent.ms_grade,
          parent.ms_heat_number,
          parent.rolling_contractor,
          parent.faridabad_dispatch_id,
          parent.receiving_event_id,
        ]
      );
      createdChildren.push(child.id);
    }

    if (currentStep) {
      await c.query(
        `INSERT INTO uid_step_history
           (uid_id, cycle_step_id, workstation_id, factory_location_id, performed_by_id, notes, conversion_pattern_id, child_uids_created)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          parentUidId,
          currentStep.id,
          currentStep.workstation_id,
          parent.factory_location_id,
          supervisorId,
          `Converting: produced ${children.length} children`,
          patternId,
          JSON.stringify(childCodes),
        ]
      );
    }

    return createdChildren;
  });
}
