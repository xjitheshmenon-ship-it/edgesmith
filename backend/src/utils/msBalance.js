/**
 * MS sheet cutting — balance (leftover / scrap) calculator.
 *
 * The operator never measures leftover material. Given the sheet dimensions and
 * the cut-piece specs, the balance is simply the material that remains after the
 * pieces are cut out:
 *
 *     balance = sheet volume − Σ (piece volume)      (converted to weight)
 *
 * Pieces are cut from the sheet at full sheet thickness, so a piece's volume is
 * length × width × sheet-height × quantity. This is the physically meaningful
 * scrap figure. (The previous version tried to model the leftover as two packed
 * rectangular strips, which badly overestimated it for multi-piece cuts.)
 *
 * Steel density constant: 0.0000079 kg per mm³.
 */

const DENSITY = 0.0000079; // kg per (mm × mm × mm)

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the balance for one MS cutting run.
 * @param {object} sheet  { length_mm, width_mm, height_mm }
 * @param {Array}  pieces [{ length_mm, width_mm, quantity }]
 * @returns {{ sheetWeightKg:number, piecesWeightKg:number, totalBalanceWeightKg:number,
 *             utilizationPct:number, overAllocated:boolean, pieces:Array, strips:Array }}
 */
function calculateMsBalance(sheet, pieces) {
  const W = Number(sheet.width_mm);
  const L = Number(sheet.length_mm);
  const H = Number(sheet.height_mm);
  if (!(W > 0 && L > 0 && H > 0)) throw new Error('Sheet dimensions must be positive.');

  const sheetVol = W * L * H;
  const sheetArea = W * L;

  let piecesVol = 0;
  let piecesArea = 0;
  const breakdown = [];
  for (const p of pieces || []) {
    const pl = Number(p.length_mm);
    const pw = Number(p.width_mm);
    const qty = Number(p.quantity);
    if (!(pl > 0 && pw > 0 && qty > 0)) continue;
    const vol = pl * pw * H * qty;
    piecesVol += vol;
    piecesArea += pl * pw * qty;
    breakdown.push({ length_mm: pl, width_mm: pw, quantity: qty, weight: round2(vol * DENSITY) });
  }

  const balanceVol = sheetVol - piecesVol;
  const overAllocated = balanceVol < 0; // cut pieces exceed the sheet — spec error

  return {
    sheetWeightKg: round2(sheetVol * DENSITY),
    piecesWeightKg: round2(piecesVol * DENSITY),
    totalBalanceWeightKg: round2(Math.max(0, balanceVol) * DENSITY),
    utilizationPct: sheetArea > 0 ? round2((piecesArea / sheetArea) * 100) : 0,
    overAllocated,
    pieces: breakdown,
    strips: [], // deprecated — kept for backward compatibility with stored runs
  };
}

module.exports = { calculateMsBalance, DENSITY };
