const { query, withTransaction } = require('../config/database');

/**
 * Cycle versioning rules (from instructions):
 *  - Editing a cycle's steps creates a NEW version, never mutates an
 *    existing one in place.
 *  - UIDs already in production are pinned to the cycle_version_id that
 *    was current at the moment they were created (see uids.cycle_version_id)
 *    and keep following that version's step definitions even after Admin
 *    publishes a newer version.
 *  - New UIDs always pick up whichever version is currently flagged
 *    is_current = true for that cycle_type_id.
 */

async function getCurrentVersion(cycleTypeId) {
  const { rows } = await query(
    `SELECT * FROM cycle_versions WHERE cycle_type_id = $1 AND is_current = true LIMIT 1`,
    [cycleTypeId]
  );
  return rows[0] || null;
}

async function getStepsForVersion(cycleVersionId) {
  const { rows } = await query(
    `SELECT cs.*, wt.code AS workstation_code, wt.name AS workstation_name,
            src.code AS source_storage_code, dst.code AS dest_storage_code
     FROM cycle_steps cs
     JOIN workstation_types wt ON wt.id = cs.workstation_type_id
     LEFT JOIN storage_locations src ON src.id = cs.source_storage_id
     LEFT JOIN storage_locations dst ON dst.id = cs.dest_storage_id
     WHERE cs.cycle_version_id = $1
     ORDER BY cs.sequence_order`,
    [cycleVersionId]
  );
  return rows;
}

/**
 * Create a new version of a cycle from a full step list (used by Cycle
 * Builder "save changes"). Marks the previous current version as no longer
 * current. Does NOT touch any UID — in-progress UIDs keep their existing
 * cycle_version_id reference, which still points at the old (now
 * non-current) version row, which is never deleted.
 *
 * @param {number} cycleTypeId
 * @param {Array}  steps - [{ stepNumber, sequenceOrder, operationName, workstationTypeId, sourceStorageId, destStorageId, stepType, capacity1500, capacityBasis, minQueueThreshold }]
 * @param {number} changedBy - employee id
 * @param {string} changeSummary
 */
async function createNewVersion(cycleTypeId, steps, changedBy, changeSummary) {
  return withTransaction(async (client) => {
    const { rows: maxRows } = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) AS max_v FROM cycle_versions WHERE cycle_type_id = $1`,
      [cycleTypeId]
    );
    const nextVersion = Number(maxRows[0].max_v) + 1;

    await client.query(
      `UPDATE cycle_versions SET is_current = false WHERE cycle_type_id = $1 AND is_current = true`,
      [cycleTypeId]
    );

    const { rows: verRows } = await client.query(
      `INSERT INTO cycle_versions (cycle_type_id, version_number, changed_by, change_summary, is_current)
       VALUES ($1, $2, $3, $4, true) RETURNING *`,
      [cycleTypeId, nextVersion, changedBy, changeSummary || null]
    );
    const newVersion = verRows[0];

    for (const s of steps) {
      const { rows: stepRows } = await client.query(
        `INSERT INTO cycle_steps
           (cycle_version_id, step_number, sequence_order, operation_name, workstation_type_id,
            source_storage_id, dest_storage_id, step_type, capacity_1500, capacity_basis, min_queue_threshold,
            hrc_sample_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          newVersion.id, s.stepNumber, s.sequenceOrder, s.operationName, s.workstationTypeId,
          s.sourceStorageId || null, s.destStorageId || null, s.stepType || 'normal',
          s.capacity1500 || null, s.capacityBasis || 'fixed', s.minQueueThreshold || 1,
          s.hrcSamplePct != null && s.hrcSamplePct !== '' ? Number(s.hrcSamplePct) : null,
        ]
      );
      if (s.batchRules) {
        await client.query(
          `INSERT INTO step_batch_rules
             (cycle_step_id, capacity_type, min_batch_size, selection_rule, cycle_type_mix, trigger_mode, dimension_tolerance_mm)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            stepRows[0].id, s.batchRules.capacityType || 'count', s.batchRules.minBatchSize || 0,
            s.batchRules.selectionRule || 'priority_fifo', s.batchRules.cycleTypeMix || 'any',
            s.batchRules.triggerMode || 'auto', s.batchRules.dimensionToleranceMm || null,
          ]
        );
      }
    }

    return newVersion;
  });
}

module.exports = { getCurrentVersion, getStepsForVersion, createNewVersion };
