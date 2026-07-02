/**
 * Batch HRC sampling logic — pure, no DB.
 *
 * Type-2 checking samples a % of a batch and decides the whole-batch action:
 *   round 1: 10% (min 1). round 2 (only if majority failed): 5% of the
 *   still-unchecked pieces (min 1).
 *
 * Scenarios (by pass rate of the sample):
 *   all_pass       (0 fail)                → continue, no action on the rest
 *   minority_fail  (fail ≤ 50%)            → re-treat only the failed pieces
 *   majority_fail  (fail > 50%, not all)   → round 1 → trigger 2nd sample;
 *                                            round 2 → recall the batch
 *   all_fail       (100% fail)             → recall immediately
 */
function sampleCount(total, pct) {
  if (!total || total <= 0) return 0;
  return Math.max(1, Math.ceil((total * pct) / 100));
}

function classifyScenario(passCount, sampleCount) {
  if (!sampleCount) return 'all_pass';
  const fail = sampleCount - passCount;
  if (fail <= 0) return 'all_pass';
  if (fail >= sampleCount) return 'all_fail';
  if (fail > sampleCount / 2) return 'majority_fail';
  return 'minority_fail';
}

/** What to do given the round + scenario. */
function decideAction(round, scenario) {
  if (scenario === 'all_pass') return 'continue';
  if (scenario === 'minority_fail') return round >= 2 ? 'partial_warning' : 'individual';
  if (scenario === 'all_fail') return 'recall';
  // majority_fail
  return round >= 2 ? 'recall' : 'second_sample';
}

module.exports = { sampleCount, classifyScenario, decideAction };
