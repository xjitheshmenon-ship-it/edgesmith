/**
 * Converting (Step 16) scrap calculation.
 * scrap = input_mm - sum(child_lengths_mm) - (cuts * kerf_mm)
 *
 * cuts = number of children (e.g. 3 children = 3 cuts, matching the
 * instructions' worked examples: Pattern A 4500->1500+1500+1424, 3 cuts, 67mm scrap).
 */
function calculateScrap(inputMm, childLengthsMm, kerfMm = 3) {
  const cuts = childLengthsMm.length;
  const sumChildren = childLengthsMm.reduce((a, b) => a + b, 0);
  const kerfTotal = cuts * kerfMm;
  const scrapMm = inputMm - sumChildren - kerfTotal;
  return { cuts, kerfTotal, scrapMm, valid: scrapMm >= 0 };
}

/**
 * Furnace capacity (HT70 Hardening, HT80 Quenching, HT90 Tempering x4).
 *
 * The furnace stacks bars into a fixed number of 1500mm-long slots — `base` slots
 * at 1500mm. A bar up to 1500mm uses one slot; a longer bar spans
 * ceil(length / 1500) slots. So capacity = floor(base / ceil(length / 1500)):
 *
 *   HT90 base=80 -> 1500mm: 80/1 = 80 · 1424mm: 80/1 = 80 · 2750mm: 80/2 = 40
 *   HT70/HT80 base=6 -> 2750mm: 6/2 = 3
 *
 * Shorter-but-still-<=1500mm bars do NOT increase capacity (still one slot each),
 * and bars over 1500mm reduce it in whole-slot steps.
 */
function furnaceSlotsForBar(barLengthMm) {
  return Math.max(1, Math.ceil(Number(barLengthMm) / 1500));
}

function furnaceCapacityForSize(baseCapacity1500, barLengthMm) {
  return Math.floor(baseCapacity1500 / furnaceSlotsForBar(barLengthMm));
}

/**
 * Grinding machine length-pairing validation (SG-DLT / AG-GMM max 3000mm,
 * AG-BTA / AG-ALP max 1500mm). Returns whether a proposed combination of
 * bar lengths is valid for a given machine's max bed length.
 */
function validateGrindingCombination(barLengthsMm, machineMaxLengthMm) {
  const total = barLengthsMm.reduce((a, b) => a + b, 0);
  const anyExceedsAlone = barLengthsMm.some((l) => l > machineMaxLengthMm);
  return {
    valid: !anyExceedsAlone && total <= machineMaxLengthMm,
    totalLengthMm: total,
    remainingMm: machineMaxLengthMm - total,
  };
}

/**
 * Bunch grinding (Step 4, SG-DLT) — how many sets fit on the 3000mm bed
 * given a bar length and the configured bars-per-set.
 *   1500mm -> 2 sets (3000/1500=2) -> 2*barsPerSet bars per run
 *   2750mm -> 1 set (3000/2750=1, floored) -> barsPerSet bars per run
 */
function bunchGrindingRunCapacity(barLengthMm, bedLengthMm, barsPerSet) {
  const setsPerRun = Math.max(1, Math.floor(bedLengthMm / barLengthMm));
  return { setsPerRun, barsPerRun: setsPerRun * barsPerSet };
}

module.exports = {
  calculateScrap,
  furnaceCapacityForSize,
  furnaceSlotsForBar,
  validateGrindingCombination,
  bunchGrindingRunCapacity,
};
