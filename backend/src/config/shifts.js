/**
 * Shift configuration. Mirrors the shifts_config table for in-memory access
 * without a DB round-trip on every request. Loaded fresh on server boot;
 * background job re-syncs hourly in case Admin changes shift times.
 */
const SHIFTS = [
  { number: 1, start: '06:00', end: '14:00' },
  { number: 2, start: '14:00', end: '22:00' },
  { number: 3, start: '22:00', end: '06:00' }, // crosses midnight
];

/**
 * Determine which shift number is active right now, given a Date object.
 */
function currentShiftNumber(date = new Date()) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  for (const s of SHIFTS) {
    const [sh, sm] = s.start.split(':').map(Number);
    const [eh, em] = s.end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (startMin < endMin) {
      if (minutes >= startMin && minutes < endMin) return s.number;
    } else {
      // crosses midnight (Shift 3: 22:00 -> 06:00)
      if (minutes >= startMin || minutes < endMin) return s.number;
    }
  }
  return SHIFTS[0].number;
}

module.exports = { SHIFTS, currentShiftNumber };
