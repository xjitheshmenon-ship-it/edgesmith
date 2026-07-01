const { query } = require('../config/database');

/**
 * Runs hourly. Creates an alert for any employee badge expiring within 30
 * days, targeted at Admin. Avoids duplicate alerts by checking if an
 * active alert for the same employee+badge already exists.
 */
async function runBadgeExpiryCheck() {
  const { rows: expiring } = await query(
    `SELECT eb.id, eb.employee_id, e.full_name, bt.name AS badge_name, eb.expiry_date
     FROM employee_badges eb
     JOIN employees e ON e.id = eb.employee_id
     JOIN badge_types bt ON bt.id = eb.badge_type_id
     WHERE eb.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
       AND eb.revoked_at IS NULL`
  );

  for (const badge of expiring) {
    const { rows: existingAlert } = await query(
      `SELECT id FROM alerts WHERE alert_type = 'badge_expiring' AND status = 'active' AND link_record_id = $1`,
      [String(badge.id)]
    );
    if (existingAlert.length) continue;

    await query(
      `INSERT INTO alerts (alert_type, severity, message, target_role, link_page, link_record_id)
       VALUES ('badge_expiring','warning',$1,'admin','employees',$2)`,
      [`${badge.full_name}'s "${badge.badge_name}" badge expires ${badge.expiry_date.toISOString().slice(0, 10)}`, String(badge.id)]
    );
  }

  // eslint-disable-next-line no-console
  if (expiring.length) console.log(`[badgeExpiry] Checked ${expiring.length} expiring badges`);
}

module.exports = { runBadgeExpiryCheck };
