'use strict'
/**
 * Mersenne arithmetic: s = s² − 2 mod 2^p − 1
 *
 * We use native JS BigInt for correctness up to moderate p (~100k),
 * with the Mersenne reduction trick baked in: since 2^p ≡ 1 (mod 2^p−1),
 * any bits above position p simply rotate back to the bottom at no cost.
 *
 * For production (p > 1M) this would use an FFT-based number-theoretic
 * transform (NTT) over GF(2^61−1)² — the same approach used by gpuowl.
 * That takes this from O(p²) to O(p log p), which is the difference between
 * months and hours at p = 136M.
 */

class MersenneInt {
  constructor (p, value = 0n) {
    this.p    = p
    this.mp   = (1n << BigInt(p)) - 1n  // 2^p - 1
    this.val  = BigInt(value) % this.mp
  }

  static fromNumber (p, n) {
    return new MersenneInt(p, BigInt(n))
  }

  /**
   * Mersenne reduction: x mod 2^p − 1
   * Uses the identity: x = hi * 2^p + lo → hi + lo (mod 2^p − 1)
   * Applied repeatedly until x < 2^p − 1.
   *
   * This is the core magic: reduction is just a right-shift + add,
   * not a full division. O(1) vs O(n) for general modular reduction.
   */
  static mersenneReduce (x, p, mp) {
    const pBig = BigInt(p)
    const mask = mp  // 2^p - 1, all 1s in binary
    while (x > mp) {
      // Split: hi = x >> p, lo = x & mask
      // x ≡ hi + lo (mod 2^p - 1)
      x = (x >> pBig) + (x & mask)
    }
    // Handle the case x == mp (which equals 0 in this ring)
    if (x === mp) x = 0n
    return x
  }

  /**
   * Square in place: val = val² mod 2^p − 1
   * The Mersenne reduction makes this extremely fast —
   * no expensive division needed, just shifts and adds.
   */
  squareMod () {
    const sq = this.val * this.val
    this.val = MersenneInt.mersenneReduce(sq, this.p, this.mp)
  }

  /**
   * Subtract 2 in place: val = (val - 2) mod 2^p − 1
   */
  subtractTwo () {
    this.val = this.val < 2n
      ? this.val - 2n + this.mp + 1n  // wrap around (adding 2^p - 1)
      : this.val - 2n
  }

  /**
   * Check if value is 0 mod 2^p−1 (Lucas-Lehmer pass condition).
   * In this ring, 0 and 2^p−1 are the same element.
   */
  isZero () {
    return this.val === 0n || this.val === this.mp
  }
}

module.exports = { MersenneInt }
