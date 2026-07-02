/**
 * Finished-good dimensional tolerance evaluation (rule book §19/§20).
 *
 * Width target 180mm (pass 180–182, below = concession, above = reject).
 * Thickness target 16mm (pass 16–16.5, below = concession, above = reject).
 * Bounds come from dimension_standards (category fg_knife) so Admin can retune
 * them in Master Lists without a code change.
 */

// Which finished-good dimension a check reads (or null if not dimensional).
function concessionDimension(checkType) {
  const t = String(checkType || '').toLowerCase();
  if (t.includes('width')) return 'width';
  if (t.includes('thick')) return 'thickness';
  return null;
}

// FG tolerance bounds { min, max } for a dimension, or null if unconfigured.
async function fgBounds(q, dimension) {
  const minCol = dimension === 'width' ? 'width_tol_min' : 'thickness_tol_min';
  const maxCol = dimension === 'width' ? 'width_tol_max' : 'thickness_tol_max';
  const { rows } = await q(
    `SELECT ${minCol} AS min, ${maxCol} AS max FROM dimension_standards
     WHERE category = 'fg_knife' AND status = 'active' AND ${minCol} IS NOT NULL
     ORDER BY id LIMIT 1`
  );
  if (!rows[0]) return null;
  return {
    min: rows[0].min != null ? Number(rows[0].min) : null,
    max: rows[0].max != null ? Number(rows[0].max) : null,
  };
}

// The concession box-colour id that matches a dimension (Blue=width, Red=thickness).
async function concessionColorFor(q, dimension) {
  const like = dimension === 'width' ? '%width%' : '%thick%';
  const { rows } = await q(
    `SELECT id FROM concession_color_codes WHERE lower(exception_type) LIKE $1 AND status = 'active' ORDER BY id LIMIT 1`,
    [like]
  );
  return rows[0] ? rows[0].id : null;
}

// pass | concession (below min) | reject (above max) | unknown
function classifyDimension(value, bounds) {
  const v = Number(value);
  if (!bounds || !Number.isFinite(v) || bounds.min == null) return 'unknown';
  if (v < bounds.min) return 'concession';
  if (bounds.max != null && v > bounds.max) return 'reject';
  return 'pass';
}

module.exports = { concessionDimension, fgBounds, concessionColorFor, classifyDimension };
