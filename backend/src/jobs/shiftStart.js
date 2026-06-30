const { query } = require('../config/database');
const { currentShiftNumber } = require('../config/shifts');

/**
 * Runs every minute. Ensures a `shifts` row exists for the current shift
 * number at every location, auto-creating it (and pulling the supervisor
 * from shift_schedule if one was published) the moment a new shift begins.
 * This is the proactive version of the on-demand creation in
 * routes/shifts.js GET /current — keeps shift records consistent even if
 * nobody opens the Shift Management page right when a shift starts.
 */
async function runShiftAutoStart() {
  const shiftNumber = currentShiftNumber();
  const today = new Date().toISOString().slice(0, 10);

  const { rows: locations } = await query(`SELECT id, code FROM locations`);

  for (const loc of locations) {
    const { rows: existing } = await query(
      `SELECT id FROM shifts WHERE shift_date = $1 AND shift_number = $2 AND location_id = $3`,
      [today, shiftNumber, loc.id]
    );
    if (existing.length) continue;

    const { rows: sched } = await query(
      `SELECT supervisor_id FROM shift_schedule WHERE shift_date = $1 AND shift_number = $2 AND location_id = $3`,
      [today, shiftNumber, loc.id]
    );

    await query(
      `INSERT INTO shifts (shift_date, shift_number, location_id, supervisor_id, started_at) VALUES ($1,$2,$3,$4, now())`,
      [today, shiftNumber, loc.id, sched[0] ? sched[0].supervisor_id : null]
    );
    // eslint-disable-next-line no-console
    console.log(`[shiftStart] Created shift ${shiftNumber} for ${loc.code} on ${today}`);
  }
}

module.exports = { runShiftAutoStart };
