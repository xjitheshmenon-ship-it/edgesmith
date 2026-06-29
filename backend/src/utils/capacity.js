// Step capacity rules (authoritative: CPCMS "STEP CAPACITY — COMPLETE RULES").
//
// Most steps process 1 bar at a time. Furnace steps (HT70/HT80/HT90) have a base
// capacity defined at 1500mm and scale by bar length; shorter bars never exceed
// the base, longer bars reduce it: capacity(size) = min(base, floor(base*1500/size)).
// Grinding steps are length-based (no fixed count); bunch grinding (Step 4) is
// set-based. capacity_per_unit stores the base/fixed count, or NULL when the step
// is length/set-based.

export const BASE_LENGTH_MM = 1500;
export const FURNACE_CODES = ['HT70', 'HT80', 'HT90'];
export const GRINDING_CODES = ['SG-DLT', 'AG-ALP', 'AG-BTA', 'AG-GMM'];
export const STANDARD_SIZES_MM = [1500, 1424, 2750];

// Furnace capacity for a given bar length. Capped at the base (a shorter bar
// can't push capacity above the configured 1500mm base).
export function furnaceCapacity(base, sizeMm) {
  if (base == null || !sizeMm) return null;
  return Math.min(base, Math.floor((base * BASE_LENGTH_MM) / sizeMm));
}

// Classify a step's capacity behaviour.
export function capacityType(workstationCode, stepNumber) {
  if (FURNACE_CODES.includes(workstationCode)) return 'furnace';
  if (String(stepNumber) === '4') return 'set_based'; // bunch grinding
  if (GRINDING_CODES.includes(workstationCode)) return 'length_based';
  return 'fixed';
}

// Per-size capacities for a furnace step (keyed by mm).
export function capacityBySize(base, sizes = STANDARD_SIZES_MM) {
  const out = {};
  for (const s of sizes) out[s] = furnaceCapacity(base, s);
  return out;
}

// Enrich a cycle-step row (with workstation_code, step_number, capacity_per_unit,
// active_units) with capacity_type, capacity_by_size, and total_capacity.
export function enrichStepCapacity(row) {
  const type = capacityType(row.workstation_code, row.step_number);
  const base = row.capacity_per_unit;
  const units = row.active_units != null ? row.active_units : 0;
  return {
    ...row,
    capacity_type: type,
    capacity_by_size: type === 'furnace' && base != null ? capacityBySize(base) : null,
    total_capacity:
      (type === 'fixed' || type === 'furnace') && base != null ? base * units : null,
  };
}
