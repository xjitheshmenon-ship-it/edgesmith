/**
 * UID Generator
 * Format: 1 letter + 3 digits, e.g. E043.
 * Each cycle type has its own letter series. When a series exhausts 999,
 * it advances to the next available letter in A-Z not currently in use by
 * any other active cycle type's series.
 *
 * This module is pure logic — no DB access — so it's easily unit-testable.
 * Callers pass in the current series state for ALL cycle types (so we can
 * check letter collisions) and get back updated state + generated codes.
 */

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function usedLetters(allSeries) {
  // allSeries: [{ cycleTypeId, currentLetter, nextNumber }, ...]
  return allSeries.map((s) => s.currentLetter);
}

function nextAvailableLetter(currentLetter, excludeLetters) {
  let i = ALPHA.indexOf(currentLetter) + 1;
  while (i < ALPHA.length) {
    if (!excludeLetters.includes(ALPHA[i])) return ALPHA[i];
    i++;
  }
  return null; // exhausted A-Z — extremely unlikely, caller should alert Admin
}

function formatUid(letter, num) {
  return `${letter}${String(num).padStart(3, '0')}`;
}

/**
 * Preview N UIDs for a cycle type WITHOUT mutating state. Used for the
 * live preview panel on the Generate UIDs page before the user confirms.
 *
 * @param {object} mySeries - { currentLetter, nextNumber } for this cycle type
 * @param {Array}  allSeries - full list of series across all cycle types (for letter collision checks)
 * @param {number} qty
 * @returns {string[]} array of UID codes (or '—' for any that hit exhaustion)
 */
function previewUids(mySeries, allSeries, qty) {
  let letter = mySeries.currentLetter;
  let next = mySeries.nextNumber;
  const others = usedLetters(allSeries).filter((l) => l !== mySeries.currentLetter);
  const out = [];

  for (let i = 0; i < qty; i++) {
    if (next > 999) {
      const nl = nextAvailableLetter(letter, others);
      if (!nl) {
        out.push('—');
        continue;
      }
      letter = nl;
      next = 1;
    }
    out.push(formatUid(letter, next));
    next++;
  }
  return out;
}

/**
 * Generate N UIDs for a cycle type and return both the codes AND the new
 * series state to persist. Caller is responsible for writing the new state
 * back to uid_series inside a transaction with row-level locking
 * (`SELECT ... FOR UPDATE`) to avoid races between concurrent bulk-creates.
 *
 * @returns {{ codes: string[], newState: { currentLetter, nextNumber } }}
 */
function generateUids(mySeries, allSeries, qty) {
  let letter = mySeries.currentLetter;
  let next = mySeries.nextNumber;
  const others = usedLetters(allSeries).filter((l) => l !== mySeries.currentLetter);
  const codes = [];

  for (let i = 0; i < qty; i++) {
    if (next > 999) {
      const nl = nextAvailableLetter(letter, others);
      if (!nl) {
        codes.push('ERR');
        continue;
      }
      letter = nl;
      next = 1;
    }
    codes.push(formatUid(letter, next));
    next++;
  }

  return { codes, newState: { currentLetter: letter, nextNumber: next } };
}

/**
 * Will this generation cross a 999 boundary? Used to show the rollover
 * warning in the live preview UI before the user commits.
 */
function willRollover(mySeries, qty) {
  return mySeries.nextNumber + qty - 1 > 999;
}

module.exports = { previewUids, generateUids, willRollover, formatUid, nextAvailableLetter, ALPHA };
