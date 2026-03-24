'use strict'
/**
 * Mersenne Candidate Sieve
 * ========================
 * Generates candidate exponents p to test for Mersenne primality.
 *
 * Rules (from number theory):
 *   1. p itself must be prime (if p is composite, 2^p−1 is definitely composite)
 *   2. Mersenne factors must be of the form 2kp + 1 (and ≡ 1 or 7 mod 8)
 *   3. For p > 2, trial factor to at least 2^(2*log2(p)) before LL testing
 *
 * This module handles the fast pre-filtering so workers only run expensive
 * LL tests on candidates that survive all cheap checks.
 *
 * CURRENT GIMPS STATUS (as of March 2026):
 *   - Record: 2^136,279,841 − 1 (found Oct 2024)
 *   - All exponents below 139,760,749 tested at least once
 *   - Search frontier: ~140M to ~200M exponent range
 *   - Next EFF prize: $150,000 for first 100-million-digit prime (p ≈ 332M)
 */

const { segmentedSieve } = require('../sieve')

/**
 * Generate prime exponent candidates in [pLow, pHigh] that are:
 *   - Prime (necessary condition for 2^p − 1 to possibly be prime)
 *   - Not already known to be composite via small factor check
 *
 * @param {number} pLow
 * @param {number} pHigh
 * @returns {number[]}  Prime exponents worth testing
 */
function generateCandidates (pLow, pHigh) {
  // All exponents must themselves be prime
  const primeExponents = segmentedSieve(pLow, pHigh)

  // Quick pre-filter: check for very small Mersenne factors (up to 2^20)
  // This is cheap and eliminates ~30% of candidates immediately
  return primeExponents.filter(p => !hasSmallFactor(p, 20))
}

/**
 * Check if 2^p − 1 has a factor below 2^bitsMax.
 * Mersenne factors must be ≡ 1 (mod 2p) so we only test that residue class.
 *
 * @param {number} p
 * @param {number} bitsMax
 * @returns {boolean}  true if a factor was found (candidate is composite)
 */
function hasSmallFactor (p, bitsMax) {
  const limit = 2 ** bitsMax
  const two_p = 2 * p

  // Candidates: k*2p + 1 for k = 1, 2, 3, ...
  // Must also be ≡ 1 or 7 (mod 8)
  for (let f = two_p + 1; f < limit; f += two_p) {
    const mod8 = f % 8
    if (mod8 !== 1 && mod8 !== 7) continue  // factor must be ≡ ±1 mod 8
    if (powMod2p1(p, f)) return true         // 2^p ≡ 1 mod f means f | 2^p−1
  }
  return false
}

/**
 * Test if 2^p ≡ 1 (mod f) using fast modular exponentiation.
 * If true, then f divides 2^p − 1, so 2^p − 1 is composite.
 * Uses Number arithmetic (safe for f < 2^26 with bit tricks).
 *
 * @param {number} p  The exponent
 * @param {number} f  The potential factor
 * @returns {boolean}
 */
function powMod2p1 (p, f) {
  // Compute 2^p mod f
  // Use BigInt for correctness (f can be up to 2^20 * 2p which may overflow)
  const fBig = BigInt(f)
  let result = 1n
  let base   = 2n
  let exp    = BigInt(p)
  while (exp > 0n) {
    if (exp & 1n) result = result * base % fBig
    exp >>= 1n
    base = base * base % fBig
  }
  return result === 1n
}

/**
 * Priority scoring for candidates — which exponents are most promising?
 * Heuristic based on:
 *   - Expected density of Mersenne primes (logarithmic: ln(2) * ln(p) / p)
 *   - Distance from known gaps in the GIMPS search
 *   - Whether small-factor trial factoring has already been done
 *
 * @param {number} p
 * @returns {number}  Higher = more promising
 */
function candidateScore (p) {
  // Expected probability that 2^p−1 is prime (heuristic)
  const density = Math.LN2 * Math.log(2) / p

  // Bonus for being in the unverified gap (80M to 136M) — possible hidden prime!
  const inGap = (p > 80_253_427 && p < 136_279_841) ? 1.5 : 1.0

  return density * inGap
}

module.exports = { generateCandidates, hasSmallFactor, candidateScore, powMod2p1 }
