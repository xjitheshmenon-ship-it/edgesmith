const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

/**
 * GET /api/v1/alerts
 * Returns active alerts scoped to the user's role and location:
 *  - alerts targeted at this specific employee (target_employee_id)
 *  - alerts targeted at this role generally (target_role, no specific employee)
 *  - filtered to the user's location unless admin/manager (cross-location)
 */
router.get('/', async (req, res) => {
  const conditions = [`status = 'active'`];
  const params = [];
  let p = 1;

  conditions.push(`(target_employee_id = $${p} OR target_employee_id IS NULL)`);
  params.push(req.user.sub);
  p++;

  conditions.push(`(target_role IS NULL OR target_role = $${p})`);
  params.push(req.user.role);
  p++;

  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    conditions.push(`(location_id = $${p} OR location_id IS NULL)`);
    params.push(req.user.location_id);
    p++;
  }

  const { rows } = await query(
    `SELECT a.*, u.uid_code FROM alerts a LEFT JOIN uids u ON u.id = a.uid_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
     LIMIT 100`,
    params
  );
  return res.json({ success: true, data: rows });
});

/** PATCH /api/v1/alerts/:id/dismiss */
router.patch('/:id/dismiss', async (req, res) => {
  const { rows } = await query(`UPDATE alerts SET status = 'dismissed', dismissed_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ success: false, error: { code: 'ALERT_NOT_FOUND', message: 'Alert not found.' } });
  return res.json({ success: true, data: rows[0] });
});

module.exports = router;
