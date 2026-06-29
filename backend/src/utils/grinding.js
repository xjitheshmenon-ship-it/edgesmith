// Grinding batch rules (pure functions).
//
// Surface/angle grinding: a batch is a set of bars whose COMBINED length must not
// exceed the machine's maximum bed length; each bar must also individually fit.
// Bunch grinding (SG-DLT, Step 4): bars are bunched side-by-side into same-length
// sets; sets are placed end-to-end along the bed, so the SUM of set lengths must
// fit the bed, and each set holds up to `barsPerSet` bars of identical length.

export function validateGrindingBatch(machineMax, lengths) {
  const combined = lengths.reduce((a, b) => a + b, 0);
  const perBar = lengths.map((l) => ({ length: l, fits: l <= machineMax }));
  const reasons = [];
  for (const b of perBar) {
    if (!b.fits) reasons.push(`Bar ${b.length}mm exceeds machine max ${machineMax}mm`);
  }
  if (combined > machineMax) {
    reasons.push(`Combined ${combined}mm exceeds machine max ${machineMax}mm`);
  }
  return { valid: reasons.length === 0, combined_length: combined, machine_max: machineMax, per_bar: perBar, reasons };
}

// Greedy pairing: fill each group up to machineMax (longest-first), allowing
// multiple bars per group as long as the running total fits.
export function suggestPairings(machineMax, items) {
  const usable = items.filter((it) => it.length <= machineMax).sort((a, b) => b.length - a.length);
  const skipped = items.filter((it) => it.length > machineMax).map((it) => ({ ...it, reason: `exceeds ${machineMax}mm` }));
  const groups = [];
  const remaining = [...usable];
  while (remaining.length) {
    const seed = remaining.shift();
    const group = [seed];
    let total = seed.length;
    for (let i = 0; i < remaining.length; ) {
      if (total + remaining[i].length <= machineMax) {
        total += remaining[i].length;
        group.push(remaining.splice(i, 1)[0]);
      } else {
        i += 1;
      }
    }
    groups.push({ items: group, combined_length: total, machine_max: machineMax });
  }
  return { groups, skipped };
}

// Bunch grinding: group same-length bars into sets of up to barsPerSet, then pack
// sets end-to-end into runs whose summed set-length fits the bed.
export function suggestBunchRuns(barsPerSet, bedMm, items) {
  const byLength = new Map();
  for (const it of items) {
    if (it.length > bedMm) continue; // a single bar longer than the bed can't run
    if (!byLength.has(it.length)) byLength.set(it.length, []);
    byLength.get(it.length).push(it);
  }

  // Build sets (same length, up to barsPerSet bars each).
  const sets = [];
  for (const [length, group] of byLength) {
    for (let i = 0; i < group.length; i += barsPerSet) {
      sets.push({ length, bars: group.slice(i, i + barsPerSet) });
    }
  }

  // Pack sets into runs (sum of set lengths ≤ bed), largest set-length first.
  sets.sort((a, b) => b.length - a.length);
  const runs = [];
  const remaining = [...sets];
  while (remaining.length) {
    const seed = remaining.shift();
    const runSets = [seed];
    let total = seed.length;
    for (let i = 0; i < remaining.length; ) {
      if (total + remaining[i].length <= bedMm) {
        total += remaining[i].length;
        runSets.push(remaining.splice(i, 1)[0]);
      } else {
        i += 1;
      }
    }
    runs.push({
      sets: runSets,
      bed_used_mm: total,
      bed_mm: bedMm,
      total_bars: runSets.reduce((n, s) => n + s.bars.length, 0),
    });
  }
  return { bars_per_set: barsPerSet, bed_mm: bedMm, runs };
}
