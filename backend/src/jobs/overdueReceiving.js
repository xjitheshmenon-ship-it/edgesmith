const { query } = require('../config/database');

/**
 * Runs every 5 minutes. Flags any contractor_dispatches that have passed
 * their expected_delivery_date and are still pending/partially_received —
 * alerts Manager so they can chase the rolling contractor.
 */
async function runOverdueReceivingCheck() {
  const { rows: overdue } = await query(
    `SELECT cd.id, cd.batch_reference, cd.expected_delivery_date, cont.name AS contractor_name
     FROM contractor_dispatches cd
     JOIN contractors cont ON cont.id = cd.contractor_id
     WHERE cd.status != 'fully_received'
       AND cd.expected_delivery_date IS NOT NULL
       AND cd.expected_delivery_date < CURRENT_DATE`
  );

  for (const d of overdue) {
    const { rows: existingAlert } = await query(
      `SELECT id FROM alerts WHERE alert_type = 'receiving_overdue' AND status = 'active' AND link_record_id = $1`,
      [String(d.id)]
    );
    if (existingAlert.length) continue;

    await query(
      `INSERT INTO alerts (alert_type, severity, message, target_role, link_page, link_record_id)
       VALUES ('receiving_overdue','warning',$1,'manager','receiving',$2)`,
      [`Dispatch ${d.batch_reference} from ${d.contractor_name} was expected ${d.expected_delivery_date.toISOString().slice(0, 10)} and has not been fully received.`, String(d.id)]
    );
  }

  // eslint-disable-next-line no-console
  if (overdue.length) console.log(`[overdueReceiving] Found ${overdue.length} overdue dispatches`);
}

module.exports = { runOverdueReceivingCheck };
