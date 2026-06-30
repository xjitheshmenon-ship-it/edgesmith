const { query } = require('../config/database');

/**
 * Write one audit_log row. Call explicitly from controllers around any
 * INSERT/UPDATE/DELETE on a business table — not auto-wired globally,
 * because we want full control over what `before`/`after` actually means
 * per entity (e.g. don't log raw passwords, don't log every polling read).
 *
 * @param {object} client - optional pg client if called inside a transaction
 */
async function writeAudit({ employeeId, tableName, recordId, action, before, after }, client) {
  const runner = client || { query };
  const exec = client ? client.query.bind(client) : query;
  await exec(
    `INSERT INTO audit_log (employee_id, table_name, record_id, action, before_value, after_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [employeeId, tableName, String(recordId), action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
  );
}

/**
 * Express middleware: attaches req.audit(...) as a shorthand bound to the
 * current authenticated user, so controllers can call:
 *   await req.audit({ tableName: 'uids', recordId: uid.id, action: 'UPDATE', before, after });
 */
function auditContext(req, res, next) {
  req.audit = (opts, client) =>
    writeAudit({ employeeId: req.user ? req.user.sub : null, ...opts }, client);
  next();
}

module.exports = { writeAudit, auditContext };
