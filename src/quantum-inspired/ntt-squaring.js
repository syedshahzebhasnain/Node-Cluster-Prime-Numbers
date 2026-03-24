'use strict'
/**
 * NTT-Based Exact Integer Squaring for Lucas-Lehmer
 * ==================================================
 * Uses the Number-Theoretic Transform (NTT) over GF(q) for exact polynomial
 * multiplication with zero floating-point error.
 *
 * DESIGN NOTES (from debugging & research):
 *
 *   1. CORRECT MODULUS CHOICE
 *      NTT requires a "NTT-friendly prime" q where (q-1) is divisible by a
 *      large power of 2 (at least the transform length). The initial choice of
 *      q = 2^61-1 was WRONG — its q-1 = 2*(odd) only supports length-2 NTT.
 *      We use four proven NTT-friendly primes:
 *        q₁ = 998244353 = 119·2²³+1   (primitive root g=3)
 *        q₂ = 985661441 = 235·2²²+1   (primitive root g=3)
 *        q₃ = 754974721 = 45·2²⁴+1    (primitive root g=11)
 *        q₄ = 469762049 = 7·2²⁶+1     (primitive root g=3)
 *
 *   2. CHINESE REMAINDER THEOREM (CRT) for exact reconstruction
 *      We compute the polynomial product mod each of the 4 primes separately,
 *      then reconstruct the exact integer coefficient via CRT.
 *      With 15-bit limbs, max convolution coefficient ≤ n·(2¹⁵)² << product
 *      of 4 primes (~2¹¹⁹), so reconstruction is always exact.
 *
 *   3. WHY NTT MATTERS (vs just using BigInt * directly)
 *      In JavaScript, BigInt multiplication IS already exact. The NTT value
 *      here is primarily educational and as a reference implementation.
 *      In compiled C/CUDA/WASM with SIMD, NTT achieves O(n log n) vs O(n²)
 *      for schoolbook multiplication — at p = 136M bits, this is the
 *      difference between feasible and not.
 *
 * References:
 *   Crandall & Fagin (1994); eprint.iacr.org/2024/585.pdf; gpuowl source
 */

// Four NTT-friendly primes (all c·2^k + 1, verified primitive roots)
const P1 = 998244353n,  G1 = 3n   // 119 · 2^23 + 1
const P2 = 985661441n,  G2 = 3n   // 235 · 2^22 + 1
const P3 = 754974721n,  G3 = 11n  // 45  · 2^24 + 1
const P4 = 469762049n,  G4 = 3n   // 7   · 2^26 + 1

// 15-bit limbs: small enough that conv coefficients stay within CRT product
const LIMB_BITS = 15n
const LIMB_MASK = (1n << LIMB_BITS) - 1n

// ── Core arithmetic ───────────────────────────────────────────────────────────
function powMod(b, e, m) {
  let r = 1n; b %= m
  while (e > 0n) {
    if (e & 1n) r = r * b % m
    e >>= 1n; b = b * b % m
  }
  return r
}

// ── Single-prime NTT (Cooley-Tukey, iterative) ────────────────────────────────
function nttInPlace(a, inv, q, g) {
  const n = a.length

  // Bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const t = a[i]; a[i] = a[j]; a[j] = t }
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const lenB = BigInt(len)
    let w = powMod(g, (q - 1n) / lenB, q)
    if (inv) w = powMod(w, q - 2n, q)

    for (let i = 0; i < n; i += len) {
      let wn = 1n
      for (let j = 0; j < (len >> 1); j++) {
        const u = a[i + j]
        const v = a[i + j + (len >> 1)] * wn % q
        a[i + j]              = (u + v) % q
        a[i + j + (len >> 1)] = (u - v + q) % q
        wn = wn * w % q
      }
    }
  }

  if (inv) {
    const ni = powMod(BigInt(n), q - 2n, q)
    for (let i = 0; i < n; i++) a[i] = a[i] * ni % q
  }
}

// Single-prime polynomial product
function polyMulSingle(a, b, q, g) {
  let n = 1
  while (n < a.length + b.length) n <<= 1
  const fa = [...a.map(x => x % q), ...Array(n - a.length).fill(0n)]
  const fb = [...b.map(x => x % q), ...Array(n - b.length).fill(0n)]
  nttInPlace(fa, false, q, g)
  nttInPlace(fb, false, q, g)
  const fc = fa.map((x, i) => x * fb[i] % q)
  nttInPlace(fc, true, q, g)
  return fc.slice(0, a.length + b.length - 1)
}

// ── Four-prime NTT + CRT reconstruction ──────────────────────────────────────
function nttSquare(x) {
  if (x === 0n) return 0n
  if (x < (1n << 30n)) return x * x   // fast path for small values

  // Split into 15-bit limbs
  const limbs = []
  let tmp = x
  while (tmp > 0n) { limbs.push(tmp & LIMB_MASK); tmp >>= LIMB_BITS }

  // NTT under 4 primes in parallel
  const c1 = polyMulSingle(limbs, limbs, P1, G1)
  const c2 = polyMulSingle(limbs, limbs, P2, G2)
  const c3 = polyMulSingle(limbs, limbs, P3, G3)
  const c4 = polyMulSingle(limbs, limbs, P4, G4)

  // CRT: reconstruct each coefficient exactly using Garner's algorithm
  // inv_p1_p2 = P1^{-1} mod P2, etc.
  const inv12 = powMod(P1, P2 - 2n, P2)
  const inv23 = powMod(P1 * P2 % P3, P3 - 2n, P3)
  const inv34 = powMod(P1 * P2 % P4 * P3 % P4, P4 - 2n, P4)

  const nCoeffs = c1.length
  const coeffs  = new Array(nCoeffs)

  for (let i = 0; i < nCoeffs; i++) {
    // Garner's algorithm (4-prime)
    let a1 = c1[i]
    let a2 = (c2[i] - a1 % P2 + P2) % P2 * inv12 % P2
    let a3 = (c3[i] - a1 % P3 - P1 * a2 % P3 + 2n * P3) % P3 * inv23 % P3
    let a4 = (c4[i] - a1 % P4 - P1 * a2 % P4 - P1 * P2 % P4 * a3 % P4 + 4n * P4) % P4 * inv34 % P4

    coeffs[i] = a1 + P1 * a2 + P1 * P2 * a3 + P1 * P2 * P3 * a4
  }

  // Reconstruct BigInt with carry
  let result = 0n
  let carry  = 0n
  for (let i = 0; i < coeffs.length; i++) {
    const val  = coeffs[i] + carry
    result    += (val & LIMB_MASK) << (BigInt(i) * LIMB_BITS)
    carry      = val >> LIMB_BITS
  }
  // Propagate any remaining carry
  let pos = BigInt(coeffs.length)
  while (carry > 0n) {
    result += (carry & LIMB_MASK) << (pos * LIMB_BITS)
    carry >>= LIMB_BITS
    pos++
  }

  return result
}

/**
 * x² mod (2^p − 1) — Mersenne reduction (exact).
 */
function mersenneSquareMod(x, p) {
  const pBig = BigInt(p)
  const mp   = (1n << pBig) - 1n
  const sq   = nttSquare(x)
  let r = sq
  while (r > mp) r = (r >> pBig) + (r & mp)
  return r === mp ? 0n : r
}

/**
 * Full NTT Lucas-Lehmer test (exact integer arithmetic).
 */
function lucasLehmerNTT(p, onProgress) {
  if (p === 2) return true
  if (p % 2 === 0) return false

  const pBig = BigInt(p)
  const mp   = (1n << pBig) - 1n
  let s = 4n

  for (let i = 0; i < p - 2; i++) {
    s = mersenneSquareMod(s, p)
    s = s < 2n ? s - 2n + mp + 1n : s - 2n
    if (onProgress && i % 100 === 0) onProgress(i, p - 2)
  }

  return s === 0n || s === mp
}

/**
 * Benchmark NTT vs direct BigInt squaring.
 */
function benchmark(p = 89) {
  const pBig = BigInt(p)
  const mp   = (1n << pBig) - 1n
  const x    = (mp >> 1n)
  const ITERS = 3

  let t0 = process.hrtime.bigint()
  for (let i = 0; i < ITERS; i++) {
    let r = x * x
    while (r > mp) r = (r >> pBig) + (r & mp)
  }
  const directMs = Number(process.hrtime.bigint() - t0) / 1e6 / ITERS

  t0 = process.hrtime.bigint()
  for (let i = 0; i < ITERS; i++) mersenneSquareMod(x, p)
  const nttMs = Number(process.hrtime.bigint() - t0) / 1e6 / ITERS

  return {
    p,
    directMs: directMs.toFixed(2),
    nttMs:    nttMs.toFixed(2),
    ratio:    (nttMs / directMs).toFixed(1),
    note:     'NTT/direct ratio (>1 = NTT slower in JS BigInt — expected; NTT value is EXACT arithmetic & SIMD-ready for compiled code)'
  }
}

module.exports = { nttSquare, mersenneSquareMod, lucasLehmerNTT, benchmark }
