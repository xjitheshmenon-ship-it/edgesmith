/**
 * Small helper for raising operational alerts (Rule Book §6/§7 — supervisors are
 * notified of QC fails, auto-holds and returned jobs). Accepts a query function
 * so it can run inside a transaction (client.query) or standalone (query).
 */
async function createAlert(q, opts) {
  const {
    type, severity = 'warning', locationId = null, uidId = null,
    message, targetRole = 'supervisor', linkPage = null, linkRecordId = null,
  } = opts;
  await q(
    `INSERT INTO alerts (alert_type, severity, location_id, uid_id, message, target_role, link_page, link_record_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [type, severity, locationId, uidId, message, targetRole, linkPage, linkRecordId]
  );
}

module.exports = { createAlert };
