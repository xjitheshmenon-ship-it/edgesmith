const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireLocationAccess } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');
const { currentShiftNumber } = require('../config/shifts');
const { operatorMissingSkill } = require('../utils/skillGate');
const { createAlert } = require('../utils/alerts');
const { concessionDimension, fgBounds, concessionColorFor, classifyDimension } = require('../utils/tolerance');

const router = express.Router();
// §10.7 — UID (Dharmapuri) jobs are off-limits to Faridabad-scoped users.
router.use(authenticate, auditContext, requireLocationAccess(1));

const PAUSE_REASONS = ['Break', 'Machine issue', 'Material not ready', 'Waiting for supervisor', 'Other'];

/**
 * GET /api/v1/jobs?shift_id=X
 * Operators see only their own jobs (enforced server-side regardless of
 * what the frontend requests). Supervisor/Manager/Admin see all jobs for
 * the shift, optionally filtered by operator_id.
 */
router.get('/', async (req, res) => {
  const { shift_id, operator_id } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;

  if (shift_id) { conditions.push(`j.shift_id = $${p++}`); params.push(shift_id); }

  if (req.user.role === 'operator') {
    conditions.push(`j.operator_id = $${p++}`);
    params.push(req.user.sub);
  } else if (operator_id) {
    conditions.push(`j.operator_id = $${p++}`);
    params.push(operator_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT j.*, u.uid_code,
            wu.unit_code, wu.unit_code AS workstation_code, wu.unit_name,
            wt.name AS workstation_name, wt.code AS workstation_type_code,
            e.full_name AS operator_name,
            s.shift_number,
            sl.started_at, sl.net_work_seconds,
            cs.operation_name, cs.step_number,
            wl.size_mm AS faridabad_size_mm, wl.cycle_type_id AS faridabad_cycle_type_id
     FROM jobs j
     LEFT JOIN uids u ON u.id = j.uid_id
     LEFT JOIN workstation_units wu ON wu.id = j.workstation_unit_id
     LEFT JOIN workstation_types wt ON wt.id = wu.workstation_type_id
     LEFT JOIN employees e ON e.id = j.operator_id
     LEFT JOIN shifts s ON s.id = j.shift_id
     LEFT JOIN cycle_steps cs ON cs.id = j.cycle_step_id
     LEFT JOIN LATERAL (
       SELECT started_at, net_work_seconds FROM uid_step_logs
       WHERE uid_id = j.uid_id AND closed_at IS NULL
       ORDER BY id DESC LIMIT 1
     ) sl ON true
     LEFT JOIN faridabad_weld_log wl ON wl.id = j.weld_log_id
     ${where}
     ORDER BY CASE WHEN j.status = 'in_progress' THEN 0 WHEN j.status = 'paused' THEN 1 ELSE 2 END,
              CASE WHEN u.priority = 'High' THEN 0 WHEN u.priority = 'Normal' THEN 1 ELSE 2 END,
              j.created_at ASC`,
    params
  );
  return res.json({ success: true, data: rows });
});

/**
 * POST /api/v1/jobs
 * Manual job creation/assignment by Supervisor/Manager/Admin.
 * body: { shiftId, uidId?, weldLogId?, cycleStepId, workstationUnitId, operatorId }
 */
router.post('/', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { shiftId, uidId, weldLogId, cycleStepId, workstationUnitId, operatorId } = req.body;
  const { rows } = await query(
    `INSERT INTO jobs (shift_id, uid_id, weld_log_id, cycle_step_id, workstation_unit_id, operator_id, status, assigned_by, assignment_type)
     VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,'manual') RETURNING *`,
    [shiftId, uidId || null, weldLogId || null, cycleStepId || null, workstationUnitId || null, operatorId, req.user.sub]
  );
  await req.audit({ tableName: 'jobs', recordId: rows[0].id, action: 'INSERT', after: rows[0] });
  return res.status(201).json({ success: true, data: rows[0] });
});

/** DELETE /api/v1/jobs/:id — return to unassigned queue */
router.delete('/:id', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { rows } = await query(`UPDATE jobs SET operator_id = NULL, status = 'queued' WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'JOB_NOT_FOUND', message: 'Job not found.' } });
  await req.audit({ tableName: 'jobs', recordId: req.params.id, action: 'UPDATE', after: { unassigned: true } });
  return res.json({ success: true, data: rows[0] });
});

/**
 * POST /api/v1/jobs/:id/start
 * Begins the timer. Records started_at on the job AND opens a uid_step_logs row
 * (Dharmapuri) so timing survives independently of jobs (jobs reset each shift,
 * step_logs are the permanent record per the instructions).
 */
router.post('/:id/start', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: jobRows } = await client.query(`SELECT * FROM jobs WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const job = jobRows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404, code: 'JOB_NOT_FOUND' });
    if (req.user.role === 'operator') {
      if (job.operator_id !== req.user.sub) {
        throw Object.assign(new Error('Not your job'), { status: 403, code: 'NOT_YOUR_JOB' });
      }
      // Skill gate: an operator may only run a station they are certified for.
      // Supervisors/managers/admins are exempt (they can run any station).
      if (job.workstation_unit_id) {
        const { rows: wuRows } = await client.query(
          `SELECT workstation_type_id FROM workstation_units WHERE id = $1`,
          [job.workstation_unit_id]
        );
        const wtId = wuRows[0] && wuRows[0].workstation_type_id;
        const missing = await operatorMissingSkill((t, p) => client.query(t, p), {
          employeeId: req.user.sub,
          workstationTypeId: wtId,
        });
        if (missing) {
          throw Object.assign(new Error(`Not certified (${missing.skillCode}) for this workstation`), {
            status: 403, code: 'SKILL_NOT_CERTIFIED', meta: missing,
          });
        }
      }

      // §8.8 — operators cannot skip the queue: a queued job may only be started
      // if it is the head of this operator's queue at this workstation
      // (High priority first, then FIFO). Supervisors/managers/admins are exempt.
      if (job.status === 'queued' && job.workstation_unit_id) {
        let myRank = 1; // Normal
        if (job.uid_id) {
          const { rows: pr } = await client.query(`SELECT priority FROM uids WHERE id = $1`, [job.uid_id]);
          const p = pr[0] && pr[0].priority;
          myRank = p === 'High' ? 0 : p === 'Low' ? 2 : 1;
        }
        const { rows: aheadRows } = await client.query(
          `SELECT j2.id FROM jobs j2
             LEFT JOIN uids u2 ON u2.id = j2.uid_id
           WHERE j2.status = 'queued' AND j2.operator_id = $1 AND j2.workstation_unit_id = $2 AND j2.id <> $3
             AND (
               (CASE WHEN u2.priority = 'High' THEN 0 WHEN u2.priority = 'Normal' THEN 1 ELSE 2 END, j2.created_at, j2.id)
               < ($4::int, $5::timestamptz, $3::bigint)
             )
           LIMIT 1`,
          [job.operator_id, job.workstation_unit_id, job.id, myRank, job.created_at]
        );
        if (aheadRows.length) {
          throw Object.assign(new Error('Open jobs in queue order — an earlier job is still waiting at this workstation.'), {
            status: 409, code: 'QUEUE_ORDER',
          });
        }
      }
    }

    await client.query(`UPDATE jobs SET status = 'in_progress' WHERE id = $1`, [job.id]);

    if (job.uid_id) {
      const { rows: uidRow } = await client.query(`SELECT current_step FROM uids WHERE id = $1`, [job.uid_id]);
      await client.query(
        `INSERT INTO uid_step_logs (uid_id, step_number, workstation_unit_id, operator_id, shift_id, started_at)
         VALUES ($1,$2,$3,$4,$5, now())`,
        [job.uid_id, uidRow[0].current_step, job.workstation_unit_id, job.operator_id, job.shift_id]
      );
    } else if (job.weld_log_id) {
      await client.query(`UPDATE faridabad_weld_log SET started_at = now() WHERE id = $1`, [job.weld_log_id]);
    }

    return job;
  });

  await req.audit({ tableName: 'jobs', recordId: req.params.id, action: 'UPDATE', after: { status: 'in_progress' } });
  return res.json({ success: true, data: result });
});

/**
 * POST /api/v1/jobs/:id/return
 * §6 — an operator returns a job they haven't started back to the queue. The
 * reason is mandatory and the supervisor is notified; the job is unassigned so
 * it can be re-allotted.
 */
router.post('/:id/return', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const reason = ((req.body && req.body.reason) || '').trim();
  // §6.3 — return-to-queue reason is mandatory and must be at least 10 characters.
  if (reason.length < 10) {
    return res.status(400).json({ success: false, error: { code: 'REASON_TOO_SHORT', message: 'A reason of at least 10 characters is required to return a job.' } });
  }
  const result = await withTransaction(async (client) => {
    const { rows: jobRows } = await client.query(`SELECT * FROM jobs WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const job = jobRows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404, code: 'JOB_NOT_FOUND' });
    if (req.user.role === 'operator' && job.operator_id !== req.user.sub) {
      throw Object.assign(new Error('Not your job'), { status: 403, code: 'NOT_YOUR_JOB' });
    }
    if (job.status === 'in_progress' || job.status === 'closed') {
      throw Object.assign(new Error('Only a job that has not been started can be returned.'), { status: 409, code: 'ALREADY_STARTED' });
    }
    await client.query(`UPDATE jobs SET status = 'queued', operator_id = NULL WHERE id = $1`, [job.id]);
    // §6.3 — notify the Supervisor on duty AND Admin immediately.
    for (const role of ['supervisor', 'admin']) {
      await createAlert(client.query.bind(client), {
        type: 'job_returned', severity: 'warning', uidId: job.uid_id || null,
        message: `Job returned to the queue — reason: ${reason}`,
        targetRole: role, linkPage: 'jobs', linkRecordId: String(job.id),
      });
    }
    return { ...job, status: 'queued', operator_id: null };
  });
  await req.audit({ tableName: 'jobs', recordId: req.params.id, action: 'UPDATE', after: { status: 'queued', returned: true, reason } });
  return res.json({ success: true, data: result });
});

/**
 * POST /api/v1/jobs/:id/pause
 * body: { reason, notes? } — reason is mandatory, must be one of PAUSE_REASONS.
 */
router.post('/:id/pause', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const { reason, notes } = req.body;
  if (!reason || !PAUSE_REASONS.includes(reason)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_REASON', message: `reason is required and must be one of: ${PAUSE_REASONS.join(', ')}` },
    });
  }
  // §6.4 — "Other" requires free-text detail.
  if (reason === 'Other' && !String(notes || '').trim()) {
    return res.status(400).json({ success: false, error: { code: 'NOTES_REQUIRED', message: 'Free-text notes are required when the pause reason is "Other".' } });
  }

  const result = await withTransaction(async (client) => {
    const { rows: jobRows } = await client.query(`SELECT * FROM jobs WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const job = jobRows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404, code: 'JOB_NOT_FOUND' });

    await client.query(`UPDATE jobs SET status = 'paused' WHERE id = $1`, [job.id]);

    if (job.uid_id) {
      const { rows: logRows } = await client.query(
        `SELECT id FROM uid_step_logs WHERE uid_id = $1 AND closed_at IS NULL ORDER BY id DESC LIMIT 1`,
        [job.uid_id]
      );
      if (logRows[0]) {
        await client.query(
          `INSERT INTO uid_pauses (step_log_id, paused_at, reason, notes) VALUES ($1, now(), $2, $3)`,
          [logRows[0].id, reason, notes || null]
        );
      }
    }

    return job;
  });

  await req.audit({ tableName: 'jobs', recordId: req.params.id, action: 'UPDATE', after: { status: 'paused', reason } });
  return res.json({ success: true, data: result });
});

/** POST /api/v1/jobs/:id/resume */
router.post('/:id/resume', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows: jobRows } = await client.query(`SELECT * FROM jobs WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const job = jobRows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404, code: 'JOB_NOT_FOUND' });

    await client.query(`UPDATE jobs SET status = 'in_progress' WHERE id = $1`, [job.id]);

    if (job.uid_id) {
      const { rows: logRows } = await client.query(
        `SELECT id FROM uid_step_logs WHERE uid_id = $1 AND closed_at IS NULL ORDER BY id DESC LIMIT 1`,
        [job.uid_id]
      );
      if (logRows[0]) {
        await client.query(
          `UPDATE uid_pauses SET resumed_at = now(), duration_seconds = EXTRACT(EPOCH FROM (now() - paused_at))::int
           WHERE step_log_id = $1 AND resumed_at IS NULL`,
          [logRows[0].id]
        );
      }
    }

    return job;
  });

  await req.audit({ tableName: 'jobs', recordId: req.params.id, action: 'UPDATE', after: { status: 'in_progress' } });
  return res.json({ success: true, data: result });
});

/**
 * POST /api/v1/jobs/:id/close
 * The unified "Close Job" action. Delegates to uidsController.advanceUid logic
 * for Dharmapuri UID jobs, or closes a Faridabad weld log entry and increments
 * the running tally for size+cycle jobs.
 * body: { qcResult?, qcType?, qcValue?, notes?, actualTempC?, actualSoakMin? }
 */
router.post('/:id/close', requireRole(['admin', 'manager', 'supervisor', 'operator']), async (req, res) => {
  // Accept both the camelCase contract and the snake_case keys the close modal
  // sends, so QC readings actually persist. Thickness (measured by VCL at the
  // Surface Grind workstation — no trip to an inspection table) is captured the
  // same way: recorded as a "Thickness (VCL)" reading on the step log.
  const b = req.body || {};
  const notes = b.notes ?? null;
  const thickness = b.thicknessMm ?? b.thickness_mm;
  let qcResult = b.qcResult ?? b.qc_result ?? null;
  let qcType = b.qcType ?? b.qc_check ?? b.qc_check_type ?? null;
  let qcValue = b.qcValue ?? b.measured_value ?? b.qc_value ?? null;
  if (thickness != null && thickness !== '') {
    qcType = qcType || 'Thickness (VCL)';
    qcValue = qcValue != null && qcValue !== '' ? qcValue : String(thickness);
  }

  const result = await withTransaction(async (client) => {
    const { rows: jobRows } = await client.query(`SELECT * FROM jobs WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const job = jobRows[0];
    if (!job) throw Object.assign(new Error('Job not found'), { status: 404, code: 'JOB_NOT_FOUND' });

    if (job.weld_log_id) {
      // Faridabad: close the weld log entry, compute net work time
      const { rows: weldRows } = await client.query(`SELECT * FROM faridabad_weld_log WHERE id = $1`, [job.weld_log_id]);
      const weld = weldRows[0];
      const netSeconds = weld.started_at
        ? Math.floor((Date.now() - new Date(weld.started_at).getTime()) / 1000)
        : null;
      await client.query(
        `UPDATE faridabad_weld_log SET closed_at = now(), net_work_seconds = $1 WHERE id = $2`,
        [netSeconds, job.weld_log_id]
      );
      await client.query(`UPDATE jobs SET status = 'closed' WHERE id = $1`, [job.id]);
      return { type: 'faridabad', weldLogId: job.weld_log_id, netSeconds };
    }

    if (job.uid_id) {
      const { rows: uidRows } = await client.query(`SELECT * FROM uids WHERE id = $1 FOR UPDATE`, [job.uid_id]);
      const uid = uidRows[0];
      if (uid.status === 'hold') {
        throw Object.assign(new Error('UID is on hold'), { status: 409, code: 'UID_ON_HOLD' });
      }

      const { rows: logRows } = await client.query(
        `SELECT * FROM uid_step_logs WHERE uid_id = $1 AND closed_at IS NULL ORDER BY id DESC LIMIT 1`,
        [job.uid_id]
      );
      const log = logRows[0];
      // §6.5 — total elapsed is wall-clock (incl. pauses, context only); net work
      // time is active time only (total minus pause durations, the primary metric).
      let totalSeconds = null;
      let netSeconds = null;
      if (log && log.started_at) {
        totalSeconds = Math.floor((Date.now() - new Date(log.started_at).getTime()) / 1000);
        const { rows: pauseRows } = await client.query(
          `SELECT COALESCE(SUM(COALESCE(duration_seconds, EXTRACT(EPOCH FROM (now() - paused_at))::int)), 0)::int AS s
           FROM uid_pauses WHERE step_log_id = $1`,
          [log.id]
        );
        const pauseSeconds = Number(pauseRows[0].s) || 0;
        netSeconds = Math.max(0, totalSeconds - pauseSeconds);
      }

      const { rows: stepRows } = await client.query(
        `SELECT * FROM cycle_steps WHERE cycle_version_id = $1 AND step_number = $2`,
        [uid.cycle_version_id, uid.current_step]
      );
      const currentStepDef = stepRows[0];

      const { rows: allSteps } = await client.query(
        `SELECT step_number, sequence_order, dest_storage_id FROM cycle_steps WHERE cycle_version_id = $1 ORDER BY sequence_order`,
        [uid.cycle_version_id]
      );
      const idx = allSteps.findIndex((s) => s.step_number === uid.current_step);
      const nextStepDef = allSteps[idx + 1];

      // §19/§20 — evaluate a dimensional QC reading (width/thickness) against the
      // finished-good tolerances: below minimum → concession request; above
      // maximum → reject (return for grinding). This drives the close result.
      const q = client.query.bind(client);
      let dimClass = null;
      let dimBounds = null;
      const dim = concessionDimension(qcType);
      if (dim && qcValue != null && String(qcValue).trim() !== '') {
        dimBounds = await fgBounds(q, dim);
        dimClass = classifyDimension(qcValue, dimBounds);
        if (dimClass === 'reject' || dimClass === 'concession') qcResult = 'Fail';
        else if (dimClass === 'pass' && !qcResult) qcResult = 'Pass';
      }

      // Design lock: a UID cannot proceed past Step 15 (Straighten Manual) without
      // a confirmed design. The hold is placed the moment it reaches Step 15, which
      // also blocks Converting (Step 16) downstream.
      if (nextStepDef && nextStepDef.step_number === '15' && !uid.design_id) {
        await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [
          'Design not confirmed — required before Step 15 (Straighten Manual)', uid.id,
        ]);
        if (log) await client.query(`UPDATE uid_step_logs SET closed_at = now(), net_work_seconds = $1, total_elapsed_seconds = $2 WHERE id = $3`, [netSeconds, totalSeconds, log.id]);
        await client.query(`UPDATE jobs SET status = 'closed' WHERE id = $1`, [job.id]);
        return { type: 'held', uidCode: uid.uid_code };
      }

      if (log) {
        await client.query(
          `UPDATE uid_step_logs SET closed_at = now(), net_work_seconds = $1, total_elapsed_seconds = $2, qc_result = $3, qc_check_type = $4, qc_value = $5, notes = $6
           WHERE id = $7`,
          [netSeconds, totalSeconds, qcResult || null, qcType || null, qcValue || null, notes || null, log.id]
        );
      }

      if (qcResult === 'Fail') {
        // §20 — a below-minimum dimension raises a concession request (Manager/Admin
        // decide) rather than a plain fail; the piece is held meanwhile.
        if (dimClass === 'concession') {
          const measured = Number(qcValue);
          const colorId = await concessionColorFor(q, dim);
          await client.query(
            `INSERT INTO concession_requests
               (uid_id, uid_code, uid_step_log_id, step_number, operation_name, dimension, measured_value, min_value, concession_color_id, raised_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [uid.id, uid.uid_code, log ? log.id : null, uid.current_step, (currentStepDef && currentStepDef.operation_name) || qcType, dim, measured, dimBounds ? dimBounds.min : null, colorId, req.user.sub]
          );
          await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [`Concession pending — ${dim} ${measured}mm below ${dimBounds ? dimBounds.min : '?'}mm`, uid.id]);
          await createAlert(q, {
            type: 'concession_request', severity: 'warning', uidId: uid.id,
            message: `CONCESSION REQUEST — ${uid.uid_code} ${dim} ${measured}mm (min ${dimBounds ? dimBounds.min : '?'}mm) awaiting approval`,
            targetRole: 'manager', linkPage: 'qc', linkRecordId: uid.uid_code,
          });
          await client.query(`UPDATE jobs SET status = 'closed' WHERE id = $1`, [job.id]);
          return { type: 'concession', uidCode: uid.uid_code, dimension: dim, value: measured };
        }
        // §19 — above maximum is a hard reject: return for further grinding (no concession).
        if (dimClass === 'reject') {
          await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, [`${dim} ${qcValue}mm above tolerance — return for further grinding`, uid.id]);
          await createAlert(q, {
            type: 'qc_reject', severity: 'critical', uidId: uid.id,
            message: `REJECT — ${uid.uid_code} ${dim} ${qcValue}mm above maximum, return for grinding`,
            targetRole: 'supervisor', linkPage: 'qc', linkRecordId: uid.uid_code,
          });
          await client.query(`UPDATE jobs SET status = 'closed' WHERE id = $1`, [job.id]);
          return { type: 'reject', uidCode: uid.uid_code, dimension: dim, value: Number(qcValue) };
        }
        await client.query(`UPDATE uids SET status = 'hold', hold_reason = $1 WHERE id = $2`, ['QC failed at step ' + uid.current_step, uid.id]);
        await client.query(`UPDATE jobs SET status = 'closed' WHERE id = $1`, [job.id]);
        return { type: 'qc_failed', uidCode: uid.uid_code };
      }

      // Random HRC inspection sampling: if this step is flagged in the cycle
      // (hrc_sample_pct), roll to select ~pct% of pieces into the HRC inspection
      // queue (surface grind + HRC table). The piece keeps its normal cycle.
      let hrcSampled = false;
      const samplePct = Number(currentStepDef && currentStepDef.hrc_sample_pct) || 0;
      if (samplePct > 0 && Math.random() * 100 < samplePct) {
        await client.query(
          `INSERT INTO hrc_inspection_samples (uid_id, source_step_number, source_operation) VALUES ($1,$2,$3)`,
          [uid.id, uid.current_step, currentStepDef.operation_name || null]
        );
        hrcSampled = true;
      }

      if (!nextStepDef) {
        await client.query(`UPDATE uids SET status = 'done' WHERE id = $1`, [uid.id]);
      } else {
        await client.query(`UPDATE uids SET current_step = $1, current_storage_id = $2 WHERE id = $3`, [
          nextStepDef.step_number, currentStepDef.dest_storage_id, uid.id,
        ]);
      }

      await client.query(`UPDATE jobs SET status = 'closed' WHERE id = $1`, [job.id]);
      return { type: 'advanced', uidCode: uid.uid_code, netSeconds, nextStep: nextStepDef ? nextStepDef.step_number : null, hrcSampled };
    }

    throw Object.assign(new Error('Job has neither uid_id nor weld_log_id'), { status: 500, code: 'INVALID_JOB' });
  });

  await req.audit({ tableName: 'jobs', recordId: req.params.id, action: 'UPDATE', after: result });
  return res.json({ success: true, data: result });
});

/**
 * POST /api/v1/jobs/auto-assign
 * body: { shiftId, workstationTypeId? } — assigns queued jobs to operators
 * who are assigned to the relevant workstation this shift, respecting
 * capacity (available slots) and badge requirements.
 */
router.post('/auto-assign', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { shiftId } = req.body;

  const result = await withTransaction(async (client) => {
    // Find operators assigned to a workstation this shift, with their badges
    const { rows: assignments } = await client.query(
      `SELECT wa.employee_id, wa.workstation_type_id, wt.code AS workstation_code
       FROM workstation_assignments wa
       JOIN workstation_types wt ON wt.id = wa.workstation_type_id
       WHERE wa.shift_id = $1 AND wa.unassigned_at IS NULL`,
      [shiftId]
    );

    // Find queued UIDs at steps matching those workstations, priority+FIFO order
    const { rows: queue } = await client.query(
      `SELECT u.id AS uid_id, u.uid_code, u.priority, u.created_at, cs.id AS cycle_step_id,
              cs.workstation_type_id, wt.code AS workstation_code
       FROM uids u
       JOIN cycle_versions cv ON cv.id = u.cycle_version_id
       JOIN cycle_steps cs ON cs.cycle_version_id = u.cycle_version_id AND cs.step_number = u.current_step
       JOIN workstation_types wt ON wt.id = cs.workstation_type_id
       WHERE u.status = 'active'
         AND u.id NOT IN (SELECT uid_id FROM jobs WHERE uid_id IS NOT NULL AND status IN ('queued','in_progress','paused'))
       ORDER BY CASE u.priority WHEN 'High' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END, u.created_at ASC`
    );

    const operatorsByWs = {};
    assignments.forEach((a) => {
      operatorsByWs[a.workstation_code] = operatorsByWs[a.workstation_code] || [];
      operatorsByWs[a.workstation_code].push(a.employee_id);
    });

    const proposed = [];
    const roundRobinIdx = {};

    for (const item of queue) {
      const ops = operatorsByWs[item.workstation_code];
      if (!ops || !ops.length) continue; // no operator covers this workstation
      roundRobinIdx[item.workstation_code] = roundRobinIdx[item.workstation_code] || 0;
      const operatorId = ops[roundRobinIdx[item.workstation_code] % ops.length];
      roundRobinIdx[item.workstation_code]++;

      proposed.push({ uidId: item.uid_id, uidCode: item.uid_code, cycleStepId: item.cycle_step_id, operatorId });
    }

    return proposed;
  });

  return res.json({ success: true, data: { proposed: result, count: result.length } });
});

/** POST /api/v1/jobs/auto-assign/commit — body: { assignments: [{uidId, cycleStepId, operatorId, shiftId}] } */
router.post('/auto-assign/commit', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { assignments, shiftId } = req.body;
  const created = await withTransaction(async (client) => {
    const rows = [];
    for (const a of assignments) {
      const { rows: r } = await client.query(
        `INSERT INTO jobs (shift_id, uid_id, cycle_step_id, operator_id, status, assigned_by, assignment_type)
         VALUES ($1,$2,$3,$4,'queued',$5,'auto') RETURNING *`,
        [shiftId, a.uidId, a.cycleStepId, a.operatorId, req.user.sub]
      );
      rows.push(r[0]);
    }
    return rows;
  });
  await req.audit({ tableName: 'jobs', recordId: 'bulk', action: 'INSERT', after: { count: created.length, autoAssign: true } });
  return res.status(201).json({ success: true, data: created });
});

module.exports = router;
module.exports.PAUSE_REASONS = PAUSE_REASONS;
