'use strict'
/**
 * Lucas-Lehmer Primality Test
 * ===========================
 * Determines whether 2^p − 1 is prime (i.e. a Mersenne prime).
 *
 * Theorem (Lucas-Lehmer):
 *   For odd prime p, the Mersenne number M_p = 2^p − 1 is prime
 *   if and only if S_{p−2} ≡ 0 (mod M_p), where:
 *     S_0 = 4
 *     S_{n+1} = S_n² − 2
 *
 * This requires exactly p−2 squarings of a (p)-bit number mod 2^p−1.
 * Each squaring is O(n²) with schoolbook, O(n log n) with FFT.
 *
 * For the record: 2^136,279,841 − 1 required ~136M squarings each of a
 * ~136M-bit number. That's why you need a GPU.
 *
 * For a consumer machine targeting the NEXT record (exponents ~140-200M),
 * we need:
 *   1. Trial factoring first (TF) to eliminate ~75% of candidates cheaply
 *   2. P-1 factoring to eliminate another ~5%  
 *   3. PRP test (Fermat + Gerbicz error check) on survivors
 *   4. Lucas-Lehmer only on probable primes
 *
 * This module implements steps 1 and 3-4 for moderate exponents (up to ~1M bits)
 * that can be tested on CPU in reasonable time for demonstration purposes.
 */

const { MersenneInt } = require('./bigint')
const { parentPort, workerData } = require('worker_threads')

const CHECKPOINT_INTERVAL = 1000  // Save state every N iterations

/**
 * Trial factoring: check if 2^p − 1 has a small factor.
 * Mersenne factors must be of the form k*2p + 1 where k is a positive integer.
 * This eliminates ~75% of candidates before doing the expensive LL test.
 *
 * @param {number} p  The exponent to trial-factor
 * @param {number} bitsMax  How many bits to trial-factor to (e.g. 60 = 2^60)
 * @returns {BigInt|null}  A factor if found, null if none found up to bitsMax
 */
function trialFactor (p, bitsMax) {
  const pBig = BigInt(p)
  const mp   = (1n << pBig) - 1n
  const limit = 1n << BigInt(bitsMax)
  const two_p = 2n * pBig

  // Factors of 2^p-1 must be ≡ 1 (mod 2p) and ≡ ±1 (mod 8)
  // Start at k=1: factor = 2p+1
  for (let k = 1n; ; k++) {
    const f = k * two_p + 1n
    if (f > limit) return null
    if (mp % f === 0n) return f
  }
}

/**
 * Lucas-Lehmer test for small-to-medium exponents (up to ~20,000 bits).
 * Returns true if 2^p − 1 is prime.
 * Uses our MersenneInt class with schoolbook squaring.
 *
 * For p > 100,000 you'd want FFT-based squaring (see notes in bigint.js).
 *
 * @param {number} p
 * @param {function} [onProgress]  Called every CHECKPOINT_INTERVAL iterations
 * @returns {boolean}
 */
function lucasLehmer (p, onProgress) {
  if (p === 2) return true  // 2^2 - 1 = 3, prime
  if (p % 2 === 0) return false  // even exponent means composite (except p=2)

  const s = MersenneInt.fromNumber(p, 4)
  const total = p - 2

  for (let i = 0; i < total; i++) {
    s.squareMod()
    s.subtractTwo()

    if (onProgress && i % CHECKPOINT_INTERVAL === 0) {
      onProgress(i, total)
    }
  }

  return s.isZero()
}

/**
 * Fermat Probable Prime test (PRP) for 2^p − 1.
 * Faster than LL for first-pass screening.
 * Compute 3^((2^p−2)/2) mod 2^p−1 and check if result == 1 or 2^p−2.
 *
 * This is what GIMPS now uses as the primary test (PRP test with Fermat base 3).
 * @param {number} p
 * @returns {boolean}  true = probably prime
 */
function fermatPRP (p) {
  // For small p we can use native BigInt
  if (p > 200_000) throw new Error('fermatPRP: p too large for BigInt, need FFT')

  const mp  = (1n << BigInt(p)) - 1n
  const exp = (mp - 1n) / 2n

  // Square-and-multiply
  let result = 3n
  let base   = 3n
  let e      = exp

  // We need modular exponentiation: 3^e mod mp
  result = 1n
  base   = 3n % mp
  while (e > 0n) {
    if (e & 1n) result = result * base % mp
    e >>= 1n
    base = base * base % mp
  }

  return result === 1n || result === mp - 1n
}

module.exports = { lucasLehmer, trialFactor, fermatPRP }
