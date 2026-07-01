/**
 * Skill gate — enforces that an operator holds the required skill certification
 * (badge) to work a given workstation type.
 *
 * A workstation type may carry `required_skill_code` (e.g. GRIND, HT, MILL).
 * An operator is cleared for it only if they hold an active, non-expired badge
 * whose code matches. Stations with no required_skill_code are open to anyone.
 *
 * Supervisors/managers/admins are never gated by this — they may run any
 * station (mirroring the furnace rule). The caller decides whether to invoke
 * the check based on role.
 */

/**
 * @param q      a query fn with signature (text, params) => Promise<{ rows }>
 *               — pass `query` for a plain call, or `client.query.bind(client)`
 *               inside a transaction.
 * @param opts   { employeeId, workstationTypeId }
 * @returns      null when cleared, or { skillCode } when the operator lacks it.
 */
async function operatorMissingSkill(q, { employeeId, workstationTypeId }) {
  if (!workstationTypeId) return null;
  const { rows: wtRows } = await q(
    `SELECT required_skill_code FROM workstation_types WHERE id = $1`,
    [workstationTypeId]
  );
  const skill = wtRows[0] && wtRows[0].required_skill_code;
  if (!skill) return null; // station needs no certification

  const { rows } = await q(
    `SELECT 1 FROM employee_badges eb
       JOIN badge_types bt ON bt.id = eb.badge_type_id
      WHERE eb.employee_id = $1
        AND bt.code = $2
        AND bt.status = 'active'
        AND (eb.expiry_date IS NULL OR eb.expiry_date >= CURRENT_DATE)
      LIMIT 1`,
    [employeeId, skill]
  );
  return rows.length ? null : { skillCode: skill };
}

module.exports = { operatorMissingSkill };
