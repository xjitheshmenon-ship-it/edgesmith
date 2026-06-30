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
 * Furnace capacity scaling formula (HT70 Hardening, HT80 Quenching, HT90
 * Tempering x4). Admin sets a base capacity at 1500mm; capacity for other
 * sizes is derived: floor(base * 1500 / bar_length_mm).
 *
 * Worked examples from the instructions:
 *   HT70/HT80 base=6  -> 2750mm: floor(6*1500/2750)  = 3
 *   HT90      base=80 -> 2750mm: floor(80*1500/2750) = 43
 *   1424mm bars: floor(6*1500/1424)=6, floor(80*1500/1424)=84 -> capped at base (see note below)
 *
 * Note: the instructions specify 1424mm capacity equals the 1500mm base
 * (not the raw formula output, which would exceed base for shorter bars).
 * We therefore cap the derived value at the base capacity — a furnace
 * cannot run *more* pieces than its 1500mm baseline regardless of how
 * short the bar is; the formula only ever reduces capacity for longer bars.
 */
function furnaceCapacityForSize(baseCapacity1500, barLengthMm) {
  const raw = Math.floor((baseCapacity1500 * 1500) / barLengthMm);
  return Math.min(raw, baseCapacity1500);
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
  validateGrindingCombination,
  bunchGrindingRunCapacity,
};
