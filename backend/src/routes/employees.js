const express = require('express');
const bcrypt = require('bcrypt');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');

const router = express.Router();
router.use(authenticate, auditContext);

/** GET /api/v1/employees?location=&role=&search= */
router.get('/', requireRole(['admin', 'manager', 'supervisor']), async (req, res) => {
  const { location, role, search } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;

  if (location && location !== 'both') {
    conditions.push(`(l.code = $${p++} OR e.location_id IS NULL)`);
    params.push(location);
  } else if (req.user.role === 'supervisor') {
    conditions.push(`(e.location_id = $${p++} OR e.location_id IS NULL)`);
    params.push(req.user.location_id);
  }
  if (role) { conditions.push(`e.role = $${p++}`); params.push(role); }
  if (search) { conditions.push(`(e.full_name ILIKE $${p} OR e.username ILIKE $${p})`); params.push(`%${search}%`); p++; }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT e.id, e.employee_code, e.full_name, e.username, e.role, e.status, l.code AS location_code,
            COALESCE((SELECT array_agg(DISTINCT wt.code)
                      FROM employee_badges eb
                      JOIN badge_types bt ON bt.id = eb.badge_type_id
                      JOIN workstation_types wt ON wt.id = bt.workstation_type_id
                      WHERE eb.employee_id = e.id
                        AND (eb.expiry_date IS NULL OR eb.expiry_date >= CURRENT_DATE)), '{}') AS badges,
            (SELECT COUNT(*) FROM employee_badges eb WHERE eb.employee_id = e.id) AS badge_count,
            (SELECT COUNT(*) FROM employee_badges eb WHERE eb.employee_id = e.id AND eb.expiry_date < CURRENT_DATE) AS expired_badges,
            (SELECT COUNT(*) FROM employee_badges eb WHERE eb.employee_id = e.id AND eb.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') AS expiring_badges
     FROM employees e LEFT JOIN locations l ON l.id = e.location_id
     ${where} ORDER BY e.full_name`,
    params
  );
  return res.json({ success: true, data: rows });
});

/** POST /api/v1/employees (Admin only) */
router.post('/', requireRole(['admin']), async (req, res) => {
  const { employeeCode, fullName, username, password, role, locationCode } = req.body;
  if (!employeeCode || !fullName || !username || !password || !role) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'employeeCode, fullName, username, password, role are required.' } });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  let locationId = null;
  if (locationCode) {
    const { rows: locRows } = await query(`SELECT id FROM locations WHERE code = $1`, [locationCode]);
    locationId = locRows[0] ? locRows[0].id : null;
  }
  const { rows } = await query(
    `INSERT INTO employees (employee_code, full_name, username, password_hash, role, location_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, employee_code, full_name, username, role, location_id, status`,
    [employeeCode, fullName, username, passwordHash, role, locationId]
  );
  await req.audit({ tableName: 'employees', recordId: rows[0].id, action: 'INSERT', after: rows[0] });
  return res.status(201).json({ success: true, data: rows[0] });
});

/** PATCH /api/v1/employees/:id (Admin only) */
router.patch('/:id', requireRole(['admin']), async (req, res) => {
  const allowed = ['full_name', 'role', 'status'];
  const sets = [];
  const params = [];
  let p = 1;
  for (const key of allowed) {
    if (req.body[key] !== undefined) { sets.push(`${key} = $${p++}`); params.push(req.body[key]); }
  }
  if (!sets.length) return res.status(400).json({ success: false, error: { code: 'NO_FIELDS', message: 'No updatable fields provided.' } });
  params.push(req.params.id);
  const { rows } = await query(`UPDATE employees SET ${sets.join(', ')} WHERE id = $${p} RETURNING id, employee_code, full_name, role, status`, params);
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found.' } });
  await req.audit({ tableName: 'employees', recordId: req.params.id, action: 'UPDATE', after: rows[0] });
  return res.json({ success: true, data: rows[0] });
});

/** GET /api/v1/employees/:id/badges */
router.get('/:id/badges', async (req, res) => {
  const { rows } = await query(
    `SELECT eb.*, bt.name AS badge_name, bt.workstation_type_id, wt.code AS workstation_code,
            CASE WHEN eb.expiry_date IS NULL THEN 'valid'
                 WHEN eb.expiry_date < CURRENT_DATE THEN 'expired'
                 WHEN eb.expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
                 ELSE 'valid' END AS status
     FROM employee_badges eb
     JOIN badge_types bt ON bt.id = eb.badge_type_id
     LEFT JOIN workstation_types wt ON wt.id = bt.workstation_type_id
     WHERE eb.employee_id = $1 ORDER BY bt.name`,
    [req.params.id]
  );
  return res.json({ success: true, data: rows });
});

/** POST /api/v1/employees/:id/badges (Admin only). body: { badgeTypeId, certifiedDate, certifiedBy, expiryDate? } */
router.post('/:id/badges', requireRole(['admin']), async (req, res) => {
  const { badgeTypeId, certifiedDate, certifiedBy, expiryDate } = req.body;
  const { rows } = await query(
    `INSERT INTO employee_badges (employee_id, badge_type_id, certified_date, certified_by, expiry_date)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (employee_id, badge_type_id) DO UPDATE SET certified_date = EXCLUDED.certified_date,
       certified_by = EXCLUDED.certified_by, expiry_date = EXCLUDED.expiry_date
     RETURNING *`,
    [req.params.id, badgeTypeId, certifiedDate, certifiedBy || null, expiryDate || null]
  );
  await req.audit({ tableName: 'employee_badges', recordId: rows[0].id, action: 'INSERT', after: rows[0] });
  return res.status(201).json({ success: true, data: rows[0] });
});

/** DELETE /api/v1/employees/:id/badges/:badgeId (Admin only) */
router.delete('/:id/badges/:badgeId', requireRole(['admin']), async (req, res) => {
  await query(`DELETE FROM employee_badges WHERE employee_id = $1 AND id = $2`, [req.params.id, req.params.badgeId]);
  await req.audit({ tableName: 'employee_badges', recordId: req.params.badgeId, action: 'DELETE' });
  return res.json({ success: true, data: { deleted: true } });
});

/**
 * GET /api/v1/employees/badge-types
 * Predefined badge types with the workstation each certifies. Used to populate
 * the assign-badge form so badge type + workstation are picked, not free-typed.
 */
router.get('/badge-types', async (req, res) => {
  const { rows } = await query(
    `SELECT bt.id, bt.code, bt.name, bt.validity_months, bt.expires,
            wt.id AS workstation_type_id, wt.code AS workstation_code, wt.name AS workstation_name
     FROM badge_types bt
     LEFT JOIN workstation_types wt ON wt.id = bt.workstation_type_id
     WHERE bt.status <> 'archived'
     ORDER BY bt.name`
  );
  return res.json({ success: true, data: rows });
});

/**
 * GET /api/v1/employees/badge-checks/can-assign?employeeId=&workstationTypeId=
 * Used by Job Assignment drag-and-drop: validates badge + furnace-supervisor-only rule.
 */
router.get('/badge-checks/can-assign', async (req, res) => {
  const { employeeId, workstationTypeId } = req.query;

  const { rows: empRows } = await query(`SELECT role FROM employees WHERE id = $1`, [employeeId]);
  if (!empRows[0]) return res.status(404).json({ success: false, error: { code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found.' } });

  const { rows: wsRows } = await query(`SELECT code, category FROM workstation_types WHERE id = $1`, [workstationTypeId]);
  if (!wsRows[0]) return res.status(404).json({ success: false, error: { code: 'WORKSTATION_NOT_FOUND', message: 'Workstation not found.' } });

  const isFurnace = wsRows[0].category === 'heat_treatment';
  if (isFurnace && empRows[0].role !== 'supervisor' && empRows[0].role !== 'admin' && empRows[0].role !== 'manager') {
    return res.json({ success: true, data: { canAssign: false, reason: 'Furnace workstations require Supervisor role.' } });
  }

  const { rows: skRows } = await query(`SELECT required_skill_code FROM workstation_types WHERE id = $1`, [workstationTypeId]);
  const requiredSkill = skRows[0] && skRows[0].required_skill_code;
  if (!requiredSkill) {
    return res.json({ success: true, data: { canAssign: true, warning: 'This workstation needs no skill certification.' } });
  }

  const { rows: held } = await query(
    `SELECT eb.expiry_date FROM employee_badges eb
     JOIN badge_types bt ON bt.id = eb.badge_type_id
     WHERE eb.employee_id = $1 AND bt.code = $2 AND bt.status = 'active'`,
    [employeeId, requiredSkill]
  );

  if (!held.length) {
    return res.json({ success: true, data: { canAssign: false, reason: `Operator holds no ${requiredSkill} certification.` } });
  }

  const valid = held.some((b) => !b.expiry_date || new Date(b.expiry_date) >= new Date());
  return res.json({ success: true, data: { canAssign: valid, reason: valid ? null : `${requiredSkill} certification has expired.` } });
});

/** GET /api/v1/employees/badge-dashboard — Admin alert view */
router.get('/badge-dashboard/summary', requireRole(['admin']), async (req, res) => {
  const expired = await query(
    `SELECT e.full_name, bt.name AS badge_name, eb.expiry_date FROM employee_badges eb
     JOIN employees e ON e.id = eb.employee_id JOIN badge_types bt ON bt.id = eb.badge_type_id
     WHERE eb.expiry_date < CURRENT_DATE`
  );
  const expiringSoon = await query(
    `SELECT e.full_name, bt.name AS badge_name, eb.expiry_date FROM employee_badges eb
     JOIN employees e ON e.id = eb.employee_id JOIN badge_types bt ON bt.id = eb.badge_type_id
     WHERE eb.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`
  );
  const noQualifiedOperator = await query(
    `SELECT wt.code, wt.name FROM workstation_types wt
     WHERE wt.status = 'active'
       AND wt.required_skill_code IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM employee_badges eb JOIN badge_types bt ON bt.id = eb.badge_type_id
         WHERE bt.code = wt.required_skill_code AND bt.status = 'active'
           AND (eb.expiry_date IS NULL OR eb.expiry_date >= CURRENT_DATE)
       )`
  );

  return res.json({
    success: true,
    data: { expired: expired.rows, expiringSoon: expiringSoon.rows, noQualifiedOperator: noQualifiedOperator.rows },
  });
});

module.exports = router;
