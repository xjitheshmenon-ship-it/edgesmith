/**
 * Raw-material intake weight math.
 *
 * Steel density ≈ 7.9 g/cm³ = 0.0000079 kg/mm³, so a rectangular bar or sheet
 * weighs: 0.0000079 × width_mm × length_mm × thickness_mm × quantity  (kg).
 * The frontend previews this per entry; the server recomputes it authoritatively
 * on save so a tampered/rounded client value can never diverge from the record.
 */
const STEEL_DENSITY_KG_PER_MM3 = 0.0000079;

function entryWeightKg({ width_mm, length_mm, thickness_mm, quantity }) {
  const w = Number(width_mm) || 0;
  const l = Number(length_mm) || 0;
  const t = Number(thickness_mm) || 0;
  const q = Number(quantity) || 0;
  return STEEL_DENSITY_KG_PER_MM3 * w * l * t * q;
}

/**
 * Normalise + weigh a list of intake entries.
 * Each entry: { length_mm, width_mm, thickness_mm/height_mm, quantity }.
 * Returns { entries: [...with weight_kg], totalWeightKg, totalCount }.
 */
function computeEntries(rawEntries) {
  const entries = (Array.isArray(rawEntries) ? rawEntries : []).map((e) => {
    const length_mm = e.length_mm != null ? Number(e.length_mm) : (e.lengthMm != null ? Number(e.lengthMm) : null);
    const width_mm = e.width_mm != null ? Number(e.width_mm) : (e.widthMm != null ? Number(e.widthMm) : null);
    // thickness and height are the same physical dimension (sheet height = its thickness)
    const thickness_mm = e.thickness_mm != null ? Number(e.thickness_mm)
      : e.thicknessMm != null ? Number(e.thicknessMm)
        : e.height_mm != null ? Number(e.height_mm)
          : e.heightMm != null ? Number(e.heightMm) : null;
    const quantity = Number(e.quantity ?? e.qty ?? 0);
    const weight_kg = Number(entryWeightKg({ width_mm, length_mm, thickness_mm, quantity }).toFixed(4));
    return { length_mm, width_mm, height_mm: thickness_mm, thickness_mm, quantity, weight_kg };
  }).filter((e) => e.quantity > 0);

  const totalWeightKg = Number(entries.reduce((s, e) => s + e.weight_kg, 0).toFixed(2));
  const totalCount = entries.reduce((s, e) => s + e.quantity, 0);
  return { entries, totalWeightKg, totalCount };
}

module.exports = { STEEL_DENSITY_KG_PER_MM3, entryWeightKg, computeEntries };
