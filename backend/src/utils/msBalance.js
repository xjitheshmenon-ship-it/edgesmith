/**
 * MS sheet cutting — balance (leftover) calculator.
 *
 * The operator never measures leftover material. Given the sheet dimensions and
 * the cut piece specs, the system grid-fits each piece type and computes the
 * remaining L-shape as two rectangular strips, then reports their weight.
 *
 * Per the spec:
 *   - 5mm cutting margin added to each piece's length and width
 *   - rows filled before starting new columns (largest contiguous strips)
 *   - steel density constant 0.0000079 kg per mm³ (width × length × thickness)
 */

const MARGIN_MM = 5;
const DENSITY = 0.0000079; // kg per (mm × mm × mm)

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Grid-fit one piece type into a rectangular region.
 * @returns { fit, used_width, used_length } — `fit` is how many pieces were placed.
 */
function fitPieceType(regionW, regionL, pieceW, pieceL, qty) {
  const cellW = pieceW + MARGIN_MM;
  const cellL = pieceL + MARGIN_MM;
  const perRow = Math.floor(regionW / cellW);
  const perCol = Math.floor(regionL / cellL);
  if (perRow < 1 || perCol < 1) return { fit: 0, used_width: 0, used_length: 0 };

  const maxFit = perRow * perCol;
  const placed = Math.min(qty, maxFit);
  if (placed === 0) return { fit: 0, used_width: 0, used_length: 0 };

  // Fill rows before columns: rows actually consumed for `placed` pieces.
  const rowsNeeded = Math.ceil(placed / perRow);
  const piecesInWidest = rowsNeeded === 1 ? placed : perRow;
  const used_width = piecesInWidest * cellW;
  const used_length = rowsNeeded * cellL;
  return { fit: placed, used_width, used_length };
}

function stripWeight(widthMm, lengthMm, thicknessMm) {
  if (widthMm <= 0 || lengthMm <= 0) return 0;
  return DENSITY * widthMm * lengthMm * thicknessMm;
}

/**
 * Compute the balance for one MS cutting run.
 * @param {object} sheet  { length_mm, width_mm, height_mm }
 * @param {Array}  pieces [{ length_mm, width_mm, quantity }]
 * @returns {{ strips: Array, totalBalanceWeightKg: number, placements: Array, shortfall: Array }}
 */
function calculateMsBalance(sheet, pieces) {
  const W = Number(sheet.width_mm);
  const L = Number(sheet.length_mm);
  const H = Number(sheet.height_mm);
  if (!(W > 0 && L > 0 && H > 0)) throw new Error('Sheet dimensions must be positive.');

  // Sequential allocation against the largest remaining strip. We track the
  // current working region (starts as the full sheet) and accumulate used
  // footprint; each piece type grid-fits against the region, then the region
  // is reduced to the larger of the two leftover strips for the next type.
  let regionW = W;
  let regionL = L;
  let usedWidthInRegion = 0; // for Strip B width on the final region
  const placements = [];
  const shortfall = [];

  for (const p of pieces) {
    const pw = Number(p.width_mm);
    const pl = Number(p.length_mm);
    const qty = Number(p.quantity);
    if (!(pw > 0 && pl > 0 && qty > 0)) continue;

    const r = fitPieceType(regionW, regionL, pw, pl, qty);
    placements.push({ length_mm: pl, width_mm: pw, quantity: qty, placed: r.fit, used_width: r.used_width, used_length: r.used_length });
    if (r.fit < qty) shortfall.push({ length_mm: pl, width_mm: pw, required: qty, placed: r.fit });

    // Strip A (remaining width edge) keeps full region length; Strip B (remaining
    // length edge) keeps the consumed width. Continue allocating into the larger.
    const stripA = { width: regionW - r.used_width, length: regionL };
    const stripB = { width: r.used_width, length: regionL - r.used_length };
    usedWidthInRegion = r.used_width;
    const areaA = stripA.width * stripA.length;
    const areaB = stripB.width * stripB.length;
    if (areaA >= areaB) { regionW = stripA.width; regionL = stripA.length; }
    else { regionW = stripB.width; regionL = stripB.length; }
  }

  // Final balance = the two leftover strips from the last allocation, recomputed
  // against the original region of the last placed piece type.
  const last = placements[placements.length - 1] || { used_width: 0, used_length: 0 };
  // Reconstruct against the region as it was BEFORE the last reduction:
  // simplest faithful model — report the two strips of the final placement.
  const stripA = { width: 0, length: 0, weight: 0 };
  const stripB = { width: 0, length: 0, weight: 0 };

  // For the common single-piece-type case (and the spec's worked example) the
  // two strips are taken directly against the full sheet.
  if (placements.length === 1) {
    stripA.width = round2(W - last.used_width);
    stripA.length = round2(L);
    stripB.width = round2(last.used_width);
    stripB.length = round2(L - last.used_length);
  } else {
    // Multi-type: the leftover is whatever the working region collapsed to,
    // plus the last placement's secondary strip.
    stripA.width = round2(regionW);
    stripA.length = round2(regionL);
    stripB.width = round2(usedWidthInRegion);
    stripB.length = round2(Math.max(0, L - last.used_length));
  }

  stripA.weight = round2(stripWeight(stripA.width, stripA.length, H));
  stripB.weight = round2(stripWeight(stripB.width, stripB.length, H));
  const totalBalanceWeightKg = round2(stripA.weight + stripB.weight);

  return { strips: [stripA, stripB], totalBalanceWeightKg, placements, shortfall };
}

module.exports = { calculateMsBalance, MARGIN_MM, DENSITY };
