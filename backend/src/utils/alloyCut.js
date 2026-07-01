/**
 * Alloy-steel bar cutting — minimum-wastage cut planner.
 *
 * Alloy steel arrives as bars of assorted lengths. At the Alloy Steel Cutting
 * stage each bar is cut into standard Faridabad pieces (default 1250 mm and
 * 850 mm). For a single bar we choose how many of each standard length to cut
 * so the leftover offcut is as small as possible.
 *
 * This is an unbounded knapsack: pack the bar (capacity = bar length) with
 * pieces (each piece "costs" its own length plus one saw kerf, and is "worth"
 * its finished length) to maximise finished length, i.e. minimise wastage.
 * Kerf defaults to 0 so the plain "multiples of 850 & 1250" case is exact.
 */

const DEFAULT_SIZES = [1250, 850];

// How strongly to favour the priority size (1250) over pure minimum-wastage.
// The priority piece is worth its length + this bonus, so the planner will give
// up to ~this many mm of finished length to place one more 1250. Kept below 850
// so it never sacrifices a whole standard piece to force a 1250 in (matches the
// user's "prefer 1250 but stay smart" choice — e.g. 1700 → 2×850, not 1×1250).
const DEFAULT_PRIORITY_BONUS = 400;

/**
 * Best cut plan for one bar.
 * @param {number} barLengthMm  raw bar length in mm
 * @param {object} [opts]
 * @param {number[]} [opts.sizes]        target cut lengths (mm), default [1250, 850]
 * @param {number} [opts.kerf]           saw blade width consumed per cut (mm), default 0
 * @param {number} [opts.prioritySize]   size to favour, default the largest (1250)
 * @param {number} [opts.priorityBonus]  value bonus for the priority size, default 400 (0 = pure min-waste)
 * @returns {{ barLengthMm:number, cuts:Array<{size:number,qty:number}>, totalPieces:number,
 *             usedMm:number, kerfMm:number, wastageMm:number, wastagePct:number }}
 */
function alloyCutPlan(barLengthMm, opts = {}) {
  const L = Math.floor(Number(barLengthMm));
  if (!(L > 0)) throw new Error('Bar length must be a positive number of mm.');

  const sizes = (Array.isArray(opts.sizes) && opts.sizes.length ? opts.sizes : DEFAULT_SIZES)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!sizes.length) throw new Error('At least one positive cut size is required.');

  const kerf = Math.max(0, Number(opts.kerf) || 0);
  const prioritySize = Number(opts.prioritySize) > 0 ? Number(opts.prioritySize) : Math.max(...sizes);
  const priorityBonus = opts.priorityBonus != null ? Math.max(0, Number(opts.priorityBonus) || 0) : DEFAULT_PRIORITY_BONUS;
  // Per-size value: finished length, plus a bonus for the priority size so the
  // planner leans toward it. Wastage below is always computed from real lengths,
  // never from these values, so the bonus only affects *which* plan is chosen.
  const value = sizes.map((s) => s + (s === prioritySize ? priorityBonus : 0));

  // Unbounded knapsack over capacity 0..L.
  //   weight(size) = size + kerf   (bar length consumed to yield one piece)
  //   value(size)  = size (+ priority bonus)
  const best = new Float64Array(L + 1);   // max value reachable at capacity c
  const choice = new Int32Array(L + 1).fill(-1); // index of last size added

  for (let c = 1; c <= L; c++) {
    best[c] = best[c - 1]; // carry the best from a smaller capacity
    choice[c] = choice[c - 1];
    for (let i = 0; i < sizes.length; i++) {
      const w = sizes[i] + kerf;
      if (w <= c) {
        const cand = best[c - w] + value[i];
        if (cand > best[c]) {
          best[c] = cand;
          choice[c] = i;
        }
      }
    }
  }

  // Reconstruct the piece counts by walking the DP back from capacity L.
  const counts = new Array(sizes.length).fill(0);
  let c = L;
  while (c > 0 && choice[c] >= 0) {
    const i = choice[c];
    const w = sizes[i] + kerf;
    if (w > c) break; // safety
    counts[i] += 1;
    c -= w;
  }

  const cuts = sizes
    .map((size, i) => ({ size, qty: counts[i] }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.size - a.size);
  const totalPieces = counts.reduce((s, n) => s + n, 0);
  const usedMm = sizes.reduce((s, size, i) => s + size * counts[i], 0);
  const kerfMm = kerf * totalPieces;
  const wastageMm = Math.max(0, L - usedMm - kerfMm);
  const wastagePct = L > 0 ? Math.round((wastageMm / L) * 1000) / 10 : 0;

  return { barLengthMm: L, cuts, totalPieces, usedMm, kerfMm, wastageMm, wastagePct };
}

/**
 * Plan a batch of bars, each optimised independently, with rolled-up totals.
 * @param {Array<number|{lengthMm:number}>} bars
 * @param {object} [opts] same as alloyCutPlan
 */
function alloyCutBatch(bars, opts = {}) {
  if (!Array.isArray(bars) || !bars.length) throw new Error('At least one bar length is required.');
  const plans = bars.map((b) => alloyCutPlan(typeof b === 'object' ? b.lengthMm ?? b.length_mm : b, opts));

  const bySize = new Map();
  let totalPieces = 0;
  let totalWastageMm = 0;
  let totalBarLengthMm = 0;
  let totalUsedMm = 0;
  for (const p of plans) {
    totalPieces += p.totalPieces;
    totalWastageMm += p.wastageMm;
    totalBarLengthMm += p.barLengthMm;
    totalUsedMm += p.usedMm;
    for (const c of p.cuts) bySize.set(c.size, (bySize.get(c.size) || 0) + c.qty);
  }
  const totalsBySize = Array.from(bySize.entries())
    .map(([size, qty]) => ({ size, qty }))
    .sort((a, b) => b.size - a.size);

  return {
    plans,
    totals: {
      bars: plans.length,
      totalPieces,
      bySize: totalsBySize,
      totalBarLengthMm,
      totalUsedMm,
      totalWastageMm,
      wastagePct: totalBarLengthMm > 0 ? Math.round((totalWastageMm / totalBarLengthMm) * 1000) / 10 : 0,
    },
  };
}

module.exports = { alloyCutPlan, alloyCutBatch, DEFAULT_SIZES };
