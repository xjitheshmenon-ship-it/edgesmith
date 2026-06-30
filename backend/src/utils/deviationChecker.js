/**
 * Compares actual furnace run parameters against the Admin-configured
 * target + tolerance for a tempering/hardening/quenching step, and returns
 * whether the run should be flagged for Supervisor review.
 */
function checkDeviation({ targetTempC, toleranceTempC, actualTempC, targetSoakMin, toleranceSoakMin, actualSoakMin }) {
  const tempDeviation = actualTempC != null && targetTempC != null
    ? Math.abs(actualTempC - targetTempC)
    : null;
  const soakDeviation = actualSoakMin != null && targetSoakMin != null
    ? Math.abs(actualSoakMin - targetSoakMin)
    : null;

  const tempOutOfTolerance = tempDeviation != null && toleranceTempC != null && tempDeviation > toleranceTempC;
  const soakOutOfTolerance = soakDeviation != null && toleranceSoakMin != null && soakDeviation > toleranceSoakMin;

  return {
    tempDeviation,
    soakDeviation,
    tempOutOfTolerance,
    soakOutOfTolerance,
    flagged: tempOutOfTolerance || soakOutOfTolerance,
  };
}

module.exports = { checkDeviation };
