const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');
const { getCurrentVersion, getStepsForVersion, createNewVersion } = require('../utils/cycleVersioning');

const router = express.Router();
router.use(authenticate, auditContext);

/** GET /api/v1/cycles — list all cycle types with current version summary */
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT ct.id, ct.code, ct.name, ct.location_id, l.name AS location_name, ct.status,
            cv.id AS current_version_id, cv.version_number,
            (SELECT COUNT(*) FROM cycle_steps cs WHERE cs.cycle_version_id = cv.id) AS step_count
     FROM cycle_types ct
     LEFT JOIN locations l ON l.id = ct.location_id
     LEFT JOIN cycle_versions cv ON cv.cycle_type_id = ct.id AND cv.is_current = true
     ORDER BY ct.id`
  );
  return res.json({ success: true, data: rows });
});

/** POST /api/v1/cycles — create a new cycle type (Admin only) */
router.post('/', requireRole(['admin']), async (req, res) => {
  const { code, name, locationId, letter } = req.body;
  if (!code || !name) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'code and name are required.' } });
  }
  const { rows } = await query(
    `INSERT INTO cycle_types (code, name, location_id, letter) VALUES ($1,$2,$3,$4) RETURNING *`,
    [code, name, locationId || null, letter || code[0]]
  );
  await req.audit({ tableName: 'cycle_types', recordId: rows[0].id, action: 'INSERT', after: rows[0] });
  return res.status(201).json({ success: true, data: rows[0] });
});

/** GET /api/v1/cycles/:id/steps — current version's steps */
router.get('/:id/steps', async (req, res) => {
  const version = await getCurrentVersion(req.params.id);
  if (!version) return res.status(404).json({ success: false, error: { code: 'NO_VERSION', message: 'No current version for this cycle.' } });
  const steps = await getStepsForVersion(version.id);
  return res.json({ success: true, data: { version, steps } });
});

/** PUT /api/v1/cycles/:id/steps — replace steps, creates a new version (Admin only) */
router.put('/:id/steps', requireRole(['admin']), async (req, res) => {
  const { steps, changeSummary } = req.body;
  if (!Array.isArray(steps) || !steps.length) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_STEPS', message: 'steps array is required.' } });
  }
  const newVersion = await createNewVersion(req.params.id, steps, req.user.sub, changeSummary);
  await req.audit({ tableName: 'cycle_versions', recordId: newVersion.id, action: 'INSERT', after: { stepCount: steps.length, changeSummary } });
  return res.status(201).json({ success: true, data: newVersion });
});

/** GET /api/v1/cycles/:id/versions — full version history */
router.get('/:id/versions', async (req, res) => {
  const { rows } = await query(
    `SELECT cv.*, e.full_name AS changed_by_name,
            (SELECT COUNT(*) FROM cycle_steps cs WHERE cs.cycle_version_id = cv.id) AS step_count
     FROM cycle_versions cv LEFT JOIN employees e ON e.id = cv.changed_by
     WHERE cv.cycle_type_id = $1 ORDER BY cv.version_number DESC`,
    [req.params.id]
  );
  return res.json({ success: true, data: rows });
});

/** GET /api/v1/cycles/:id/export — export cycle definition as JSON */
router.get('/:id/export', requireRole(['admin']), async (req, res) => {
  const version = await getCurrentVersion(req.params.id);
  if (!version) return res.status(404).json({ success: false, error: { code: 'NO_VERSION', message: 'No current version to export.' } });
  const steps = await getStepsForVersion(version.id);
  const { rows: cycleRows } = await query(`SELECT * FROM cycle_types WHERE id = $1`, [req.params.id]);

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    cycle: cycleRows[0],
    version: { versionNumber: version.version_number },
    steps: steps.map((s) => ({
      stepNumber: s.step_number, sequenceOrder: s.sequence_order, operationName: s.operation_name,
      workstationCode: s.workstation_code, sourceStorageCode: s.source_storage_code,
      destStorageCode: s.dest_storage_code, stepType: s.step_type, capacity1500: s.capacity_1500,
      capacityBasis: s.capacity_basis, minQueueThreshold: s.min_queue_threshold,
    })),
  };
  res.setHeader('Content-Disposition', `attachment; filename="cycle-${cycleRows[0].code}-v${version.version_number}.json"`);
  return res.json(exportPayload);
});

/** POST /api/v1/cycles/import — import a cycle definition (Admin only) */
router.post('/import', requireRole(['admin']), async (req, res) => {
  const payload = req.body;
  if (!payload || !payload.cycle || !Array.isArray(payload.steps)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid cycle export file.' } });
  }

  // Resolve workstation/storage codes back to IDs
  const wsRows = await query(`SELECT id, code FROM workstation_types`);
  const wsMap = Object.fromEntries(wsRows.rows.map((r) => [r.code, r.id]));
  const storRows = await query(`SELECT id, code FROM storage_locations`);
  const storMap = Object.fromEntries(storRows.rows.map((r) => [r.code, r.id]));

  const steps = payload.steps.map((s) => ({
    stepNumber: s.stepNumber, sequenceOrder: s.sequenceOrder, operationName: s.operationName,
    workstationTypeId: wsMap[s.workstationCode], sourceStorageId: storMap[s.sourceStorageCode],
    destStorageId: storMap[s.destStorageCode], stepType: s.stepType, capacity1500: s.capacity1500,
    capacityBasis: s.capacityBasis, minQueueThreshold: s.minQueueThreshold,
  }));

  // Find or create the cycle type by code
  let { rows: cycleRows } = await query(`SELECT id FROM cycle_types WHERE code = $1`, [payload.cycle.code]);
  let cycleTypeId;
  if (cycleRows[0]) {
    cycleTypeId = cycleRows[0].id;
  } else {
    const { rows: newCycle } = await query(
      `INSERT INTO cycle_types (code, name, location_id, letter) VALUES ($1,$2,$3,$4) RETURNING id`,
      [payload.cycle.code, payload.cycle.name, payload.cycle.location_id || null, payload.cycle.letter || payload.cycle.code[0]]
    );
    cycleTypeId = newCycle[0].id;
  }

  const newVersion = await createNewVersion(cycleTypeId, steps, req.user.sub, 'Imported from file');
  await req.audit({ tableName: 'cycle_versions', recordId: newVersion.id, action: 'INSERT', after: { imported: true, stepCount: steps.length } });

  return res.status(201).json({ success: true, data: newVersion });
});

module.exports = router;
