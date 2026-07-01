/**
 * Offline data import.
 *
 * When the factory loses internet or the server is down, staff keep working and
 * record completed operations on paper / a spreadsheet. Once back online they
 * export that to CSV and import it here to back-fill the system. The frontend
 * parses the CSV and posts the rows as JSON.
 *
 * Two factories, same shape:
 *   - Dharmapuri: per-UID job cycle    → advances uids + logs uid_step_logs
 *   - Faridabad:  per-item batch cycle → advances faridabad_items + logs faridabad_item_logs
 *
 * Every import is a two-step, safe flow:
 *   POST /imports/operations/preview  → validates every row, writes nothing
 *   POST /imports/operations/apply    → applies valid rows in one transaction
 * Both share the exact same processor; preview just rolls the transaction back,
 * so the preview reflects real sequencing (multiple steps for one UID in order).
 */
const express = require('express');
const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, auditContext);

const WRITE_ROLES = ['admin', 'manager', 'supervisor'];

// Column templates surfaced to the client for the downloadable CSV samples.
const TEMPLATES = {
  dharmapuri: {
    columns: ['uid_code', 'step_number', 'operator_username', 'started_at', 'closed_at', 'qc_result', 'qc_value', 'notes'],
    sample: ['E00042', '5', 'operator', '2026-07-01 09:05', '2026-07-01 09:35', '', '', 'logged offline'],
  },
  faridabad: {
    columns: ['item_id', 'step_number', 'operator_username', 'started_at', 'closed_at', 'notes'],
    sample: ['12', '3', 'supervisor_far', '2026-07-01 10:00', '2026-07-01 10:20', 'logged offline'],
  },
};

const val = (row, key) => {
  const v = row[key];
  return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
};

function tsOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : v;   // undefined = present but invalid
}

function netSeconds(started, closed) {
  if (!started || !closed) return null;
  const a = new Date(started).getTime();
  const b = new Date(closed).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.floor((b - a) / 1000);
}

function normalizeQc(v) {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s === 'pass') return 'Pass';
  if (s === 'fail') return 'Fail';
  if (s === 'borderline' || s === 'na' || s === 'n/a') return s === 'borderline' ? 'Borderline' : null;
  return v;
}

async function resolveOperator(client, username) {
  if (!username) return { id: null, warn: null };
  const { rows } = await client.query(`SELECT id FROM employees WHERE username = $1`, [username]);
  if (!rows[0]) return { id: null, warn: `unknown operator "${username}" — logged without operator` };
  return { id: rows[0].id, warn: null };
}

// ── Dharmapuri (per-UID) ──────────────────────────────────────────────────────
async function processDharmapuriRow(client, row) {
  const uidCode = val(row, 'uid_code');
  const stepNumber = val(row, 'step_number');
  if (!uidCode) return { status: 'error', message: 'uid_code is required' };
  if (!stepNumber) return { status: 'error', ref: uidCode, message: 'step_number is required' };

  const { rows: uidRows } = await client.query(`SELECT * FROM uids WHERE uid_code = $1 FOR UPDATE`, [uidCode]);
  const uid = uidRows[0];
  if (!uid) return { status: 'error', ref: uidCode, message: 'UID not found' };
  if (uid.status === 'done') return { status: 'error', ref: uidCode, message: 'UID already completed' };
  if (uid.status === 'hold') return { status: 'error', ref: uidCode, message: `UID on hold (${uid.hold_reason || 'held'}) — resolve before importing` };
  if (String(uid.current_step) !== String(stepNumber)) {
    return { status: 'error', ref: uidCode, message: `UID is at step ${uid.current_step}, not ${stepNumber}` };
  }

  const started = tsOrNull(val(row, 'started_at'));
  const closed = tsOrNull(val(row, 'closed_at'));
  if (started === undefined) return { status: 'error', ref: uidCode, message: 'started_at is not a valid date/time' };
  if (closed === undefined) return { status: 'error', ref: uidCode, message: 'closed_at is not a valid date/time' };

  const op = await resolveOperator(client, val(row, 'operator_username'));
  const qcResult = normalizeQc(val(row, 'qc_result'));

  const { rows: allSteps } = await client.query(
    `SELECT step_number, sequence_order, operation_name, dest_storage_id
     FROM cycle_steps WHERE cycle_version_id = $1 ORDER BY sequence_order`, [uid.cycle_version_id]
  );
  const idx = allSteps.findIndex((s) => String(s.step_number) === String(uid.current_step));
  if (idx === -1) return { status: 'error', ref: uidCode, message: `step ${uid.current_step} not in this UID's cycle` };
  const currentStep = allSteps[idx];
  const nextStep = allSteps[idx + 1];

  const net = netSeconds(started, closed);
  await client.query(
    `INSERT INTO uid_step_logs
       (uid_id, step_number, operation_name, operator_id, started_at, closed_at, net_work_seconds, qc_check_type, qc_value, qc_result, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [uid.id, currentStep.step_number, currentStep.operation_name, op.id, started, closed, net,
     val(row, 'qc_type'), val(row, 'qc_value'), qcResult, val(row, 'notes')]
  );

  // Design lock before Converting (step 16).
  if (nextStep && String(nextStep.step_number) === '16' && !uid.design_id) {
    await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`,
      ['Design not confirmed — required before Converting (Step 16)', uid.id]);
    return { status: 'ok', ref: uidCode, action: 'held', message: 'logged; held — design required before step 16', warn: op.warn };
  }
  if (qcResult === 'Fail') {
    await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`,
      ['QC failed at step ' + uid.current_step, uid.id]);
    return { status: 'ok', ref: uidCode, action: 'qc_failed', message: `logged; held — QC fail at step ${uid.current_step}`, warn: op.warn };
  }
  if (!nextStep) {
    await client.query(`UPDATE uids SET status = 'done' WHERE id = $1`, [uid.id]);
    return { status: 'ok', ref: uidCode, action: 'done', message: 'logged; UID completed (dispatched)', warn: op.warn };
  }
  await client.query(`UPDATE uids SET current_step = $1, current_storage_id = $2 WHERE id = $3`,
    [nextStep.step_number, currentStep.dest_storage_id, uid.id]);
  return { status: 'ok', ref: uidCode, action: 'advanced', message: `logged; advanced to step ${nextStep.step_number}`, warn: op.warn };
}

// ── Faridabad (per-item) ──────────────────────────────────────────────────────
async function farSteps(client) {
  const { rows } = await client.query(
    `SELECT cs.step_number, cs.sequence_order, cs.operation_name
     FROM cycle_steps cs
     JOIN cycle_versions cv ON cv.id = cs.cycle_version_id
     JOIN cycle_types ct ON ct.id = cv.cycle_type_id
     WHERE ct.code = 'FAR' AND cv.is_current ORDER BY cs.sequence_order`
  );
  return rows;
}

async function processFaridabadRow(client, row, steps) {
  const itemId = val(row, 'item_id');
  const stepNumber = val(row, 'step_number');
  if (!itemId) return { status: 'error', message: 'item_id is required' };
  if (!/^\d+$/.test(itemId)) return { status: 'error', ref: itemId, message: 'item_id must be a number' };
  if (!stepNumber) return { status: 'error', ref: itemId, message: 'step_number is required' };

  const { rows: itRows } = await client.query(`SELECT * FROM faridabad_items WHERE id = $1 FOR UPDATE`, [itemId]);
  const item = itRows[0];
  if (!item) return { status: 'error', ref: itemId, message: 'item not found' };
  if (item.status === 'done') return { status: 'error', ref: itemId, message: 'item already completed' };
  if (String(item.current_step) !== String(stepNumber)) {
    return { status: 'error', ref: itemId, message: `item is at step ${item.current_step}, not ${stepNumber}` };
  }

  const started = tsOrNull(val(row, 'started_at'));
  const closed = tsOrNull(val(row, 'closed_at'));
  if (started === undefined) return { status: 'error', ref: itemId, message: 'started_at is not a valid date/time' };
  if (closed === undefined) return { status: 'error', ref: itemId, message: 'closed_at is not a valid date/time' };

  const op = await resolveOperator(client, val(row, 'operator_username'));
  const idx = steps.findIndex((s) => String(s.step_number) === String(item.current_step));
  if (idx === -1) return { status: 'error', ref: itemId, message: `step ${item.current_step} not in the FAR cycle` };
  const currentStep = steps[idx];
  const nextStep = steps[idx + 1];

  await client.query(
    `INSERT INTO faridabad_item_logs (item_id, step_number, operation_name, operator_id, started_at, closed_at, net_work_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [item.id, currentStep.step_number, currentStep.operation_name, op.id, started, closed, netSeconds(started, closed)]
  );

  if (!nextStep) {
    await client.query(`UPDATE faridabad_items SET status = 'done', started_at = NULL, updated_at = now() WHERE id = $1`, [item.id]);
    return { status: 'ok', ref: itemId, action: 'done', message: 'logged; item completed', warn: op.warn };
  }
  await client.query(
    `UPDATE faridabad_items SET current_step = $1, status = 'queued', started_at = NULL, current_operator_id = NULL, updated_at = now() WHERE id = $2`,
    [nextStep.step_number, item.id]
  );
  return { status: 'ok', ref: itemId, action: 'advanced', message: `logged; advanced to step ${nextStep.step_number}`, warn: op.warn };
}

// ── Shared runner (preview = rollback, apply = commit) ────────────────────────
async function run(factory, rows, dryRun) {
  const client = await pool.connect();
  const results = [];
  try {
    await client.query('BEGIN');
    const steps = factory === 'faridabad' ? await farSteps(client) : null;
    for (let i = 0; i < rows.length; i++) {
      const line = i + 1;
      await client.query('SAVEPOINT r');
      try {
        const r = factory === 'faridabad'
          ? await processFaridabadRow(client, rows[i], steps)
          : await processDharmapuriRow(client, rows[i]);
        if (r.status === 'error') await client.query('ROLLBACK TO SAVEPOINT r');
        else await client.query('RELEASE SAVEPOINT r');
        results.push({ line, ...r });
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT r');
        results.push({ line, status: 'error', message: e.message });
      }
    }
    if (dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const warnings = results.filter((r) => r.warn).length;
  return { factory, dryRun, applied: dryRun ? 0 : ok, summary: { total: results.length, ok, errors, warnings }, rows: results };
}

function handler(dryRun) {
  return async (req, res) => {
    const { factory, rows } = req.body || {};
    if (!TEMPLATES[factory]) {
      return res.status(400).json({ success: false, error: { code: 'BAD_FACTORY', message: "factory must be 'dharmapuri' or 'faridabad'." } });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'NO_ROWS', message: 'rows array is required.' } });
    }
    if (rows.length > 5000) {
      return res.status(400).json({ success: false, error: { code: 'TOO_MANY_ROWS', message: 'Import is capped at 5000 rows per file.' } });
    }
    const data = await run(factory, rows, dryRun);
    if (!dryRun) {
      await req.audit({ tableName: `import_${factory}`, recordId: null, action: 'INSERT', after: { applied: data.applied, total: data.summary.total, errors: data.summary.errors } });
    }
    return res.json({ success: true, data });
  };
}

/** GET /imports/templates — CSV column templates for both factories. */
router.get('/templates', (req, res) => res.json({ success: true, data: TEMPLATES }));

/** POST /imports/operations/preview — validate rows, write nothing. */
router.post('/operations/preview', requireRole(WRITE_ROLES), handler(true));

/** POST /imports/operations/apply — apply valid rows in one transaction. */
router.post('/operations/apply', requireRole(WRITE_ROLES), handler(false));

module.exports = router;
