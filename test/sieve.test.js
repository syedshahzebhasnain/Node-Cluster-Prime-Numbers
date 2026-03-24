'use strict'
/**
 * Test suite for src/sieve.js
 * Run: node --test test/sieve.test.js
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { segmentedSieve, millerRabinBig, bigIntPrimesInRange } = require('../src/sieve')

// ── Known reference data ─────────────────────────────────────────────────────
// Primes up to 100 (25 total)
const PRIMES_TO_100 = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97]

// π(n) — prime counting function reference values
const PI = {
  100:         25,
  1_000:      168,
  10_000:    1229,
  100_000:   9592,
  1_000_000: 78498,
}

// ── segmentedSieve ────────────────────────────────────────────────────────────
describe('segmentedSieve', () => {

  it('returns empty for range below 2', () => {
    assert.deepEqual(segmentedSieve(0, 1), [])
    assert.deepEqual(segmentedSieve(-100, 1), [])
  })

  it('returns [2] for range [2,2]', () => {
    assert.deepEqual(segmentedSieve(2, 2), [2])
  })

  it('returns correct primes up to 100', () => {
    assert.deepEqual(segmentedSieve(2, 100), PRIMES_TO_100)
  })

  it('returns correct primes in a mid-range window [50, 100]', () => {
    const expected = PRIMES_TO_100.filter(p => p >= 50)
    assert.deepEqual(segmentedSieve(50, 100), expected)
  })

  it('correctly handles even low bound', () => {
    assert.deepEqual(segmentedSieve(10, 20), [11, 13, 17, 19])
  })

  it('correctly handles odd low bound', () => {
    assert.deepEqual(segmentedSieve(11, 20), [11, 13, 17, 19])
  })

  it('returns empty when low > high', () => {
    assert.deepEqual(segmentedSieve(100, 50), [])
  })

  it('returns empty range with no primes (e.g. [24,28])', () => {
    assert.deepEqual(segmentedSieve(24, 28), [])
  })

  it('handles single prime correctly', () => {
    assert.deepEqual(segmentedSieve(97, 97), [97])
  })

  it('handles single non-prime correctly', () => {
    assert.deepEqual(segmentedSieve(98, 98), [])
  })

  // Prime counting function checks — the gold standard for sieve correctness
  for (const [limit, expected] of Object.entries(PI)) {
    it(`π(${Number(limit).toLocaleString()}) = ${expected}`, () => {
      const primes = segmentedSieve(2, Number(limit))
      assert.equal(primes.length, expected,
        `Expected ${expected} primes up to ${limit}, got ${primes.length}`)
    })
  }

  it('all results are actually prime (spot check up to 10000)', () => {
    const primes = new Set(segmentedSieve(2, 10_000))
    // Verify no composites slipped through (check all even numbers > 2)
    for (let n = 4; n <= 1000; n += 2) {
      assert.ok(!primes.has(n), `${n} is composite but was returned as prime`)
    }
    // Verify known primes are present
    for (const p of PRIMES_TO_100) {
      assert.ok(primes.has(p), `Known prime ${p} missing from results`)
    }
  })

  it('handles a large segment boundary correctly (crosses 512KB segment)', () => {
    // SEGMENT_SIZE = 1<<19 = 524288, so test a range that crosses it
    const low  = 524_280
    const high = 524_300
    const result = segmentedSieve(low, high)
    // All results must be prime (Miller-Rabin check)
    for (const p of result) {
      assert.ok(millerRabinBig(BigInt(p)), `${p} is not prime`)
    }
  })

  it('returns sorted results', () => {
    const result = segmentedSieve(2, 10_000)
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i] > result[i-1], `Results not sorted at index ${i}`)
    }
  })

  it('contains no duplicates', () => {
    const result = segmentedSieve(2, 10_000)
    const set = new Set(result)
    assert.equal(set.size, result.length, 'Duplicates found in sieve output')
  })
})

// ── millerRabinBig ────────────────────────────────────────────────────────────
describe('millerRabinBig', () => {

  it('returns false for 0 and 1', () => {
    assert.equal(millerRabinBig(0n), false)
    assert.equal(millerRabinBig(1n), false)
  })

  it('returns true for 2 and 3', () => {
    assert.equal(millerRabinBig(2n), true)
    assert.equal(millerRabinBig(3n), true)
  })

  it('returns false for even numbers > 2', () => {
    assert.equal(millerRabinBig(4n), false)
    assert.equal(millerRabinBig(100n), false)
    assert.equal(millerRabinBig(1_000_000n), false)
  })

  it('correctly identifies all primes up to 100', () => {
    const primeSet = new Set(PRIMES_TO_100)
    for (let n = 0; n <= 100; n++) {
      assert.equal(
        millerRabinBig(BigInt(n)), primeSet.has(n),
        `millerRabinBig(${n}) should be ${primeSet.has(n)}`
      )
    }
  })

  it('correctly handles known large primes near 10^15', () => {
    // These are verified primes
    const knownLargePrimes = [
      999_999_999_999_947n,
      999_999_999_999_989n,
      1_000_000_000_000_037n,
    ]
    for (const p of knownLargePrimes) {
      assert.equal(millerRabinBig(p), true, `${p} should be prime`)
    }
  })

  it('correctly handles known large composites near 10^15', () => {
    const knownComposites = [
      999_999_999_999_937n, // = 3 × 333333333333312 + 1, composite
      1_000_000_000_000_000n, // 10^15 = 2^15 × 5^15
    ]
    for (const n of knownComposites) {
      assert.equal(millerRabinBig(n), false, `${n} should be composite`)
    }
  })

  it('handles Carmichael numbers (tricky composites) correctly', () => {
    // These fool naive primality tests but not Miller-Rabin
    const carmichael = [561n, 1105n, 1729n, 2465n, 2821n, 6601n, 8911n]
    for (const n of carmichael) {
      assert.equal(millerRabinBig(n), false, `Carmichael number ${n} should be composite`)
    }
  })

  it('handles Mersenne primes correctly', () => {
    // M31 = 2^31 - 1 = 2147483647 (prime)
    assert.equal(millerRabinBig(2_147_483_647n), true)
    // M61 = 2^61 - 1 = 2305843009213693951 (prime)
    assert.equal(millerRabinBig(2_305_843_009_213_693_951n), true)
  })
})

// ── bigIntPrimesInRange ───────────────────────────────────────────────────────
describe('bigIntPrimesInRange', () => {

  it('returns empty for range below 2', () => {
    assert.deepEqual(bigIntPrimesInRange(0n, 1n), [])
  })

  it('returns [2n] for range [2n,2n]', () => {
    assert.deepEqual(bigIntPrimesInRange(2n, 2n), [2n])
  })

  it('returns correct primes up to 100 as BigInt', () => {
    const result = bigIntPrimesInRange(2n, 100n)
    assert.deepEqual(result, PRIMES_TO_100.map(BigInt))
  })

  it('finds known primes near 10^15', () => {
    const result = bigIntPrimesInRange(999_999_999_999_940n, 999_999_999_999_999n)
    assert.ok(result.includes(999_999_999_999_947n), 'Should find 999999999999947')
    assert.ok(result.includes(999_999_999_999_989n), 'Should find 999999999999989')
  })

  it('returns results in ascending order', () => {
    const result = bigIntPrimesInRange(2n, 200n)
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i] > result[i-1], `Not sorted at index ${i}`)
    }
  })

  it('handles range starting at an even number', () => {
    const result = bigIntPrimesInRange(10n, 20n)
    assert.deepEqual(result, [11n, 13n, 17n, 19n])
  })

  it('handles range with no primes', () => {
    // 24,25,26,27,28 — all composite
    assert.deepEqual(bigIntPrimesInRange(24n, 28n), [])
  })
})
