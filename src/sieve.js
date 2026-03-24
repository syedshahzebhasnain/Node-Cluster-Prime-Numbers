'use strict'
/**
 * Segmented Sieve of Eratosthenes
 * --------------------------------
 * Finds all primes in [low, high] using the segmented sieve technique.
 * Time:  O(n log log n)  vs  O(n * sqrt(n)) for naive trial division
 * Space: O(sqrt(high)) for base sieve + O(segmentSize) per segment
 */

const SEGMENT_SIZE = 1 << 19 // 512 KB — fits in L2 cache on most CPUs

/**
 * All primes in the inclusive range [low, high] as regular numbers.
 * Requires low and high to be safe integers.
 */
function segmentedSieve (low, high) {
  if (high < 2) return []
  if (low < 2) low = 2

  const sqrtHigh = Math.ceil(Math.sqrt(high))

  // Simple sieve for small primes up to sqrt(high)
  const smallSieve = new Uint8Array(sqrtHigh + 1)
  smallSieve[0] = smallSieve[1] = 1
  for (let i = 2; i * i <= sqrtHigh; i++) {
    if (!smallSieve[i]) {
      for (let j = i * i; j <= sqrtHigh; j += i) smallSieve[j] = 1
    }
  }
  const smallPrimes = []
  for (let i = 2; i <= sqrtHigh; i++) {
    if (!smallSieve[i]) smallPrimes.push(i)
  }

  const results = []

  // Collect small primes that fall inside [low, high]
  if (low <= sqrtHigh) {
    for (const p of smallPrimes) {
      if (p >= low) results.push(p)
    }
    low = Math.max(low, sqrtHigh + 1)
  }

  // Process remaining range in cache-friendly segments
  for (let segLow = low; segLow <= high; segLow += SEGMENT_SIZE) {
    const segHigh = Math.min(segLow + SEGMENT_SIZE - 1, high)
    const segLen  = segHigh - segLow + 1
    const sieve   = new Uint8Array(segLen)

    for (const p of smallPrimes) {
      let start = Math.ceil(segLow / p) * p
      if (start === p) start += p
      for (let j = start - segLow; j < segLen; j += p) sieve[j] = 1
    }

    for (let i = 0; i < segLen; i++) {
      if (!sieve[i]) results.push(segLow + i)
    }
  }

  return results
}

// ── Miller-Rabin for BigInt / numbers beyond Number.MAX_SAFE_INTEGER ────────
// Deterministic for n < 3.3 * 10^24 with these witnesses
const MR_WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]

function modPow (base, exp, mod) {
  let result = 1n
  base = base % mod
  while (exp > 0n) {
    if (exp & 1n) result = result * base % mod
    exp >>= 1n
    base = base * base % mod
  }
  return result
}

function millerRabinBig (n) {
  if (n < 2n) return false
  if (n === 2n || n === 3n) return true
  if ((n & 1n) === 0n) return false

  let r = 0n
  let d = n - 1n
  while ((d & 1n) === 0n) { d >>= 1n; r++ }

  outer:
  for (const a of MR_WITNESSES) {
    if (a >= n) continue
    let x = modPow(a, d, n)
    if (x === 1n || x === n - 1n) continue
    for (let i = 0n; i < r - 1n; i++) {
      x = x * x % n
      if (x === n - 1n) continue outer
    }
    return false
  }
  return true
}

function bigIntPrimesInRange (low, high) {
  if (high < 2n) return []
  if (low < 2n) low = 2n
  const results = []
  if (low === 2n) { results.push(2n); low = 3n }
  if ((low & 1n) === 0n) low++
  for (let n = low; n <= high; n += 2n) {
    if (millerRabinBig(n)) results.push(n)
  }
  return results
}

module.exports = { segmentedSieve, millerRabinBig, bigIntPrimesInRange }
