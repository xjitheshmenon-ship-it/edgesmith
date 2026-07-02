/**
 * HRC outcome engine — pure logic, no DB.
 *
 * Scores a Rockwell-C reading against a cycle type's target band and decides
 * the cycle change. See CPCMS HRC spec:
 *   - within [min, max]           → in_range (continue)
 *   - below min but ≥ very_low    → slightly_low (re-temper at configured step)
 *   - below very_low              → very_low (external annealing — hold)
 *   - above max                   → high (re-temper from Tempering 1)
 *
 * Returns { outcome, isPass, needsRetreat }.
 *   outcome:      'in_range' | 'slightly_low' | 'very_low' | 'high' | 'unknown'
 *   isPass:       true only for in_range
 *   needsRetreat: true when the action increments the re-treatment count
 */
function classifyHrc(value, params) {
  if (value == null || value === '' || Number.isNaN(Number(value)) || !params) {
    return { outcome: 'unknown', isPass: null, needsRetreat: false };
  }
  const v = Number(value);
  const min = Number(params.hrc_target_min);
  const max = Number(params.hrc_target_max);
  const veryLow = Number(params.very_low_hrc);

  if (v > max) return { outcome: 'high', isPass: false, needsRetreat: true };
  if (v >= min) return { outcome: 'in_range', isPass: true, needsRetreat: false };
  if (v >= veryLow) return { outcome: 'slightly_low', isPass: false, needsRetreat: true };
  return { outcome: 'very_low', isPass: false, needsRetreat: true };
}

const OUTCOME_LABEL = {
  in_range: 'Within range',
  slightly_low: 'Slightly low (too soft)',
  very_low: 'Very low (critically soft)',
  high: 'High (too hard)',
  unknown: 'Recorded',
};

module.exports = { classifyHrc, OUTCOME_LABEL };
