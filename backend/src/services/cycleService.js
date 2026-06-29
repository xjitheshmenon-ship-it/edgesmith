// Cycle versioning: edits create a new version; in-progress UIDs keep theirs.
import { tx, query, one } from '../db/pool.js';
import { HttpError } from '../middleware/auth.js';

export async function createNewVersion(cycleTypeId, stepsData, createdById, changeNotes = null) {
  return tx(async (c) => {
    const cycleType = await c.one('SELECT * FROM cycle_types WHERE id = $1', [cycleTypeId]);
    if (!cycleType) throw new HttpError(404, 'Cycle type not found');

    await c.query(
      'UPDATE cycle_versions SET is_current = FALSE WHERE cycle_type_id = $1 AND is_current = TRUE',
      [cycleTypeId]
    );

    const countRow = await c.one(
      'SELECT COUNT(*)::int AS n FROM cycle_versions WHERE cycle_type_id = $1',
      [cycleTypeId]
    );
    const versionNumber = countRow.n + 1;

    const version = await c.one(
      `INSERT INTO cycle_versions (cycle_type_id, version_number, is_current, created_by_id, change_notes)
       VALUES ($1, $2, TRUE, $3, $4) RETURNING *`,
      [cycleTypeId, versionNumber, createdById, changeNotes]
    );

    for (let order = 0; order < stepsData.length; order++) {
      const s = stepsData[order];
      await c.query(
        `INSERT INTO cycle_steps
           (cycle_version_id, step_number, step_order, operation_name, workstation_id,
            from_storage_id, to_storage_id, is_converting_step, is_child_marking_step, is_qc_step, capacity_per_unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          version.id,
          s.step_number,
          order,
          s.operation_name,
          s.workstation_id,
          s.from_storage_id ?? null,
          s.to_storage_id ?? null,
          !!s.is_converting_step,
          !!s.is_child_marking_step,
          !!s.is_qc_step,
          s.capacity_per_unit ?? null,
        ]
      );
    }

    return version.id;
  });
}

export async function exportCycle(cycleTypeId, versionId = null) {
  const cycleType = await one('SELECT * FROM cycle_types WHERE id = $1', [cycleTypeId]);
  if (!cycleType) throw new HttpError(404, 'Cycle type not found');

  const version = versionId
    ? await one('SELECT * FROM cycle_versions WHERE id = $1 AND cycle_type_id = $2', [versionId, cycleTypeId])
    : await one('SELECT * FROM cycle_versions WHERE cycle_type_id = $1 AND is_current = TRUE', [cycleTypeId]);
  if (!version) throw new HttpError(404, 'Cycle version not found');

  const steps = await query(
    `SELECT cs.step_number, cs.step_order, cs.operation_name,
            w.code AS workstation_code, fs.code AS from_storage_code, ts.code AS to_storage_code,
            cs.is_converting_step, cs.is_child_marking_step, cs.is_qc_step, cs.capacity_per_unit
       FROM cycle_steps cs
       LEFT JOIN workstations w ON w.id = cs.workstation_id
       LEFT JOIN storage_locations fs ON fs.id = cs.from_storage_id
       LEFT JOIN storage_locations ts ON ts.id = cs.to_storage_id
      WHERE cs.cycle_version_id = $1
      ORDER BY cs.step_order`,
    [version.id]
  );

  return {
    schema_version: '1.0',
    cycle_name: cycleType.name,
    cycle_letter_prefix: cycleType.letter_prefix,
    version_number: version.version_number,
    change_notes: version.change_notes,
    steps,
  };
}
