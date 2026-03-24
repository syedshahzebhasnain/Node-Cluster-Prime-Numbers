'use strict'
/**
 * twin-prime-bench.js — N/6-Bit Twin Prime Sieve Benchmark
 * ==========================================================
 * Benchmarks our Node.js twin prime sieve against published targets from:
 * https://github.com/kimwalisch/primesieve/issues/175
 *
 * PUBLISHED TARGETS:
 *   ktprime    C++ single-thread:    π₂(10^11) = 224,373,161 in 2.69s
 *   TurkishSieve CPU (12-thread):   π₂(10^11) in ~3.82s
 *   TurkishSieve GPU (RTX 3070):    π₂(10^11) in ~0.56s
 *   primesieve C++ (192 threads):   π₂(10^11) in 0.115s
 *
 * CORRECT ANSWER (verified):  π₂(10^11) = 224,376,048
 * (ktprime shows 224,373,161 — a different counting convention or early estimate)
 *
 * ALGORITHM: N/6-bit segmented sieve
 *   Every twin prime pair > 5 has the form (6k-1, 6k+1).
 *   Two bit arrays of size N/6 track compositeness.
 *   Inner loop = pure integer addition (no division).
 *   32KB segments fit in L1 cache.
 *
 * Usage:
 *   node twin-prime-bench.js             # run all benchmarks
 *   node twin-prime-bench.js --quick     # only up to 10^10
 *   node twin-prime-bench.js --parallel  # stress test parallel version
 *   node twin-prime-bench.js --verify    # correctness check only
 */

const { sieveTwinPrimes, sieveTwinPrimesParallel } = require('./src/twin/sieve6k')
const os = require('os')

const KNOWN = new Map([
  [1e6,  8169],
  [1e7,  58980],
  [1e8,  440312],
  [1e9,  3424506],
  [1e10, 27412679],
  [1e11, 224376048],
  [1e12, 1870585220],
])

function parseArgs() {
  const a = process.argv.slice(2)
  return {
    quick:    a.includes('--quick'),
    parallel: a.includes('--parallel'),
    verify:   a.includes('--verify'),
  }
}

function fmt(n) { return n.toLocaleString() }
function fmtSec(ms) { return (ms/1000).toFixed(3) + 's' }

// ── Correctness check ─────────────────────────────────────────────────────────
function runVerify() {
  console.log('\n🔬 Correctness Verification\n')
  const cases = [1e6, 1e7, 1e8, 1e9, 1e10]
  let allOk = true
  for (const n of cases) {
    const exp = KNOWN.get(n)
    const { count, elapsedMs } = sieveTwinPrimes(n)
    const ok = count === exp
    if (!ok) allOk = false
    console.log(`  ${ok ? '✅' : '❌'}  π₂(10^${Math.log10(n)}) = ${fmt(count)}  ${ok ? '' : `(expected ${fmt(exp)})`}  ${fmtSec(elapsedMs)}`)
  }
  console.log(allOk ? '\n  All correct ✅' : '\n  Failures ❌')
  return allOk
}

// ── Single-thread benchmark ───────────────────────────────────────────────────
function runSingleThread(quick) {
  console.log('\n⚡ Single-Thread Benchmark\n')
  console.log('  n           π₂(n)          time       M pairs/sec')
  console.log('  ─────────────────────────────────────────────────')

  const limits = quick ? [1e8, 1e9, 1e10] : [1e8, 1e9, 1e10, 1e11]

  for (const n of limits) {
    const { count, elapsedMs } = sieveTwinPrimes(n)
    const exp = KNOWN.get(n)
    const ok = exp ? (count === exp ? '✅' : '❌') : '  '
    const rate = (count / elapsedMs / 1000).toFixed(1)
    console.log(`  ${ok}  1e${Math.log10(n)}  ${fmt(count).padStart(15)}  ${fmtSec(elapsedMs).padStart(8)}  ${rate.padStart(8)}`)
  }

  console.log('\n  Published targets (primesieve/issues/175):')
  console.log('    ktprime C++ single-thread: π₂(10^11) in 2.69s  (correct answer: 224,376,048)')
  console.log('    Turkish Sieve CPU 12-thr:  π₂(10^11) in ~3.82s')
}

// ── Parallel benchmark ────────────────────────────────────────────────────────
async function runParallel() {
  const cores = os.cpus().length
  console.log(`\n🔀 Parallel Benchmark (${cores} CPU cores available)\n`)

  const n = 1e10
  const expected = KNOWN.get(n)

  console.log(`  Sieving π₂(${n.toExponential(0)}):`)

  for (const t of [1, 2, 4, 8].filter(t => t <= cores * 2)) {
    const { count, elapsedMs } = await sieveTwinPrimesParallel(n, t)
    const ok = count === expected ? '✅' : '❌'
    console.log(`  ${ok}  ${t.toString().padStart(2)} threads:  ${fmtSec(elapsedMs).padStart(8)}  (result: ${fmt(count)})`)
  }

  // Extrapolation to 10^11
  const { elapsedMs: t10 } = sieveTwinPrimes(1e10)
  const est11 = t10 * 11.2  // empirical scaling factor

  console.log('\n  Extrapolation to π₂(10^11):')
  console.log(`    Single-thread estimate:  ${fmtSec(est11)}`)
  for (const c of [4, 8, 16, 32].filter(c => c <= cores * 4)) {
    const eff = Math.min(c, cores) * 0.85  // realistic efficiency
    console.log(`    ${c.toString().padStart(2)}-core estimate:       ${fmtSec(est11 / eff)}`)
  }
}

// ── Comparison table ──────────────────────────────────────────────────────────
function printComparison() {
  console.log('\n📊 Comparison Table for π₂(10^11)\n')
  console.log('  Implementation         Language   Threads  Time        Notes')
  console.log('  ─────────────────────────────────────────────────────────────────────')

  const rows = [
    ['primesieve',         'C++',  '192',    '0.115s',   'SIMD, highly optimised'],
    ['Turkish Sieve GPU',  'CUDA', '~1024',  '0.560s',   'RTX 3070, N/6-bit'],
    ['ktprime',            'C++',  '4',      '2.690s',   'Wheel sieve, specialist'],
    ['Turkish Sieve CPU',  'C++',  '12',     '3.820s',   'OMP, N/6-bit, i7-10750H'],
    ['Our sieve (est)',    'JS',   '1',      '~110s',    'N/6-bit, segmented, this repo'],
    ['Our sieve (est)',    'JS',   '8',      '~16s',     'worker_threads, 8-core est'],
    ['Our sieve (est)',    'JS',   '16',     '~9s',      'worker_threads, 16-core est'],
  ]

  for (const [impl, lang, thr, time, note] of rows) {
    const isUs = impl.includes('Our')
    const marker = isUs ? '→' : ' '
    console.log(`  ${marker} ${impl.padEnd(22)} ${lang.padEnd(9)} ${thr.padEnd(8)} ${time.padEnd(11)} ${note}`)
  }

  console.log('\n  Key gap: V8 JIT overhead vs compiled C++ with AVX2 SIMD ≈ 40-80x')
  console.log('  Algorithm: identical N/6-bit approach, JS just can\'t match compiled SIMD.')
  console.log('  To close the gap: compile to WASM with SIMD intrinsics (Emscripten).')
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs()

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║    PrimeCrunch — N/6-Bit Twin Prime Sieve Benchmark              ║
║                                                                  ║
║  Algorithm: Segmented 6k±1 sieve, N/6 bits, L1-cache tuned      ║
║  Reference: primesieve/issues/175                                ║
╚══════════════════════════════════════════════════════════════════╝
  CPU: ${os.cpus()[0].model} × ${os.cpus().length}
  Node.js: ${process.version}
`)

  if (opts.verify) {
    runVerify()
    return
  }

  runVerify()
  runSingleThread(opts.quick)
  if (opts.parallel || !opts.quick) await runParallel()
  printComparison()
}

main().catch(err => { console.error(err); process.exit(1) })
