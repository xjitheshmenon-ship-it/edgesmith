const { query } = require('../config/database');

/**
 * Rule Book §6 — flag jobs that have stayed paused beyond the step's configured
 * maximum (cycle_steps.max_pause_minutes) and alert the on-duty supervisor.
 * One alert per open pause (deduped on the pause id), refreshed as needed.
 */
async function runPauseThresholdCheck() {
  const { rows } = await query(
    `SELECT p.id AS pause_id, sl.uid_id, sl.step_number, u.uid_code,
            cs.max_pause_minutes, ct.location_id,
            ROUND(EXTRACT(EPOCH FROM (now() - p.paused_at)) / 60)::int AS paused_minutes
       FROM uid_pauses p
       JOIN uid_step_logs sl ON sl.id = p.step_log_id
       JOIN uids u ON u.id = sl.uid_id
       JOIN cycle_versions cv ON cv.id = u.cycle_version_id
       JOIN cycle_types ct ON ct.id = cv.cycle_type_id
       LEFT JOIN cycle_steps cs ON cs.cycle_version_id = u.cycle_version_id AND cs.step_number = sl.step_number
      WHERE p.resumed_at IS NULL
        AND cs.max_pause_minutes IS NOT NULL
        AND now() - p.paused_at > make_interval(mins => cs.max_pause_minutes)`
  );

  for (const r of rows) {
    const { rows: existing } = await query(
      `SELECT id FROM alerts WHERE alert_type = 'pause_threshold' AND status = 'active' AND link_record_id = $1`,
      [String(r.pause_id)]
    );
    if (existing.length) continue;
    await query(
      `INSERT INTO alerts (alert_type, severity, location_id, uid_id, message, target_role, link_page, link_record_id)
       VALUES ('pause_threshold','warning',$1,$2,$3,'supervisor','jobs',$4)`,
      [r.location_id, r.uid_id,
        `${r.uid_code} paused ${r.paused_minutes} min at step ${r.step_number} — over the ${r.max_pause_minutes} min limit`,
        String(r.pause_id)]
    );
  }
  if (rows.length) console.log(`[pauseThreshold] ${rows.length} over-threshold pause(s) checked`);
}

module.exports = { runPauseThresholdCheck };
