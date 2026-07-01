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
        AND eb.revoked_at IS NULL
        AND (eb.expiry_date IS NULL OR eb.expiry_date >= CURRENT_DATE)
      LIMIT 1`,
    [employeeId, skill]
  );
  return rows.length ? null : { skillCode: skill };
}

/**
 * Does an employee currently hold a valid (active, non-expired, non-revoked)
 * badge for the given skill code? @param q query fn as above.
 */
async function hasSkill(q, employeeId, skillCode) {
  if (!employeeId || !skillCode) return false;
  const { rows } = await q(
    `SELECT 1 FROM employee_badges eb
       JOIN badge_types bt ON bt.id = eb.badge_type_id
      WHERE eb.employee_id = $1 AND bt.code = $2 AND bt.status = 'active'
        AND eb.revoked_at IS NULL
        AND (eb.expiry_date IS NULL OR eb.expiry_date >= CURRENT_DATE)
      LIMIT 1`,
    [employeeId, skillCode]
  );
  return rows.length > 0;
}

/**
 * Rule Book §8.5 — who may see furnace step detail (target/actual temp, soak,
 * deviation): Admin/Manager always; Supervisor/Operator only with a valid HT
 * badge; nobody else.
 */
async function canViewFurnaceDetail(q, user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  if (user.role === 'supervisor' || user.role === 'operator') return hasSkill(q, user.sub, 'HT');
  return false;
}

// Null out furnace temperature/soak/deviation fields on a step-log row, leaving
// step name, date and QC pass/fail intact.
function redactFurnaceFields(row) {
  return {
    ...row,
    target_temp_c: null, target_soak_min: null,
    actual_temp_c: null, actual_soak_min: null, deviation_flag: null,
  };
}

module.exports = { operatorMissingSkill, hasSkill, canViewFurnaceDetail, redactFurnaceFields };
