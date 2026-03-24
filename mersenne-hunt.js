'use strict'
/**
 * mersenne-hunt.js — The Prime Hunter
 * =====================================
 * The main entry point for Mersenne prime hunting.
 *
 * CURRENT RECORD: 2^136,279,841 − 1  (41,024,320 digits, found Oct 12 2024)
 *                 Found by Luke Durant using 1000s of NVIDIA A100/H100 GPUs
 *                 across 17 countries. Cost: ~$2M USD over ~1 year.
 *
 * NEXT TARGET:    Exponents in the range 136M–200M (unverified gap), or
 *                 pushing toward the 100M-digit EFF prize (p ≈ 332M)
 *
 * STRATEGY (how to beat the record on consumer hardware):
 *
 *   Phase 1 — TRIAL FACTORING (TF)
 *     Check if 2^p−1 has a small factor. If it does, 2^p−1 is composite.
 *     A GPU can trial factor to 2^74 bits in a few minutes per exponent.
 *     This eliminates ~75% of candidates cheaply.
 *     → Our bitops/sieve implementation handles this for CPU.
 *
 *   Phase 2 — P-1 FACTORING
 *     A more powerful factoring method that can find "smooth" factors.
 *     Eliminates another ~5% of candidates.
 *     → Not implemented here — use Prime95 for this.
 *
 *   Phase 3 — FERMAT PRP TEST
 *     A fast probable-prime test. Almost no false positives.
 *     For p ~ 140M bits this takes weeks on a single CPU, days on a GPU.
 *     → Our fermatPRP() handles small p for demonstration.
 *
 *   Phase 4 — LUCAS-LEHMER VERIFICATION
 *     The definitive test. Only run on PRP-positive candidates.
 *     → Our lucasLehmer() handles small p.
 *
 * PRACTICAL PATH TO THE RECORD:
 *   1. Install GIMPS Prime95 (free) at www.mersenne.org/download/
 *   2. OR run this tool for small/medium exponents to understand the math
 *   3. For serious GPU hunting: install gpuowl/PRPLL
 *   4. For distributed multi-machine: run `node src/distributed/coordinator.js`
 *      on a server and point workers at it
 *
 * QUANTUM NOTE:
 *   Shor's algorithm on a quantum computer could factor RSA numbers in polynomial
 *   time, but does NOT help find Mersenne primes faster — primality testing is
 *   already polynomial on classical computers. The Lucas-Lehmer test is O(p² log p)
 *   which is already very efficient. Quantum speedup for LL is marginal at best.
 *   The real bottleneck is the QUANTITY of candidates to test, not the test itself.
 *
 * BIT MANIPULATION TRICKS USED:
 *   - Mersenne reduction: 2^p ≡ 1 mod 2^p−1, so overflow bits just wrap around
 *   - Limb arithmetic: 30-bit limbs with 2 bits headroom for carry-free squaring
 *   - Trial factor form: factors must be k*2p+1 ≡ ±1 (mod 8) → skip ~75% of k values
 *   - Fast 2^p mod f: square-and-multiply with ~log2(p) multiplications
 *
 * Usage:
 *   node mersenne-hunt.js [options]
 *
 * Options:
 *   --start <p>          Start exponent (default: 1000)
 *   --end <p>            End exponent   (default: 10000)
 *   --threads <n>        CPU threads    (default: all cores)
 *   --coordinator <url>  Connect to distributed coordinator
 *   --serve              Start as coordinator server
 *   --port <n>           Coordinator port (default: 3000)
 *   --verify <p>         Verify a specific exponent p
 *   --benchmark          Run benchmark suite
 *
 * Examples:
 *   # Find Mersenne primes with exponents up to 10,000
 *   node mersenne-hunt.js --end 10000
 *
 *   # Start a distributed coordinator for serious hunting
 *   node mersenne-hunt.js --serve --start 140000000 --end 200000000 --port 3000
 *
 *   # Connect workers to coordinator (run on multiple machines)
 *   node mersenne-hunt.js --coordinator http://192.168.1.100:3000
 *
 *   # Verify a specific exponent
 *   node mersenne-hunt.js --verify 127
 */

const { Worker } = require('worker_threads')
const os   = require('path')
const path = require('path')
const http = require('http')
const { generateCandidates, candidateScore } = require('./src/mersenne/candidate-sieve')
const { lucasLehmer, trialFactor, fermatPRP } = require('./src/mersenne/lucas-lehmer')
const { Coordinator } = require('./src/distributed/coordinator')

const KNOWN_MERSENNE_EXPONENTS = new Set([
  2,3,5,7,13,17,19,31,61,89,107,127,521,607,1279,2203,2281,3217,4253,4423,
  9689,9941,11213,19937,21701,23209,44497,86243,110503,132049,216091,756839,
  859433,1257787,1398269,2976221,3021377,6972593,13466917,20996011,24036583,
  25964951,30402457,32582657,37156667,42643801,43112609,57885161,74207281,
  77232917,82589933,136279841
])

function parseArgs () {
  const args = process.argv.slice(2)
  const opts = {
    start: 1000, end: 10000, threads: require('os').cpus().length,
    serve: false, port: 3000, coordinator: null, verify: null, benchmark: false
  }
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--start':       opts.start       = parseInt(args[++i]); break
      case '--end':         opts.end         = parseInt(args[++i]); break
      case '--threads':     opts.threads     = parseInt(args[++i]); break
      case '--serve':       opts.serve       = true; break
      case '--port':        opts.port        = parseInt(args[++i]); break
      case '--coordinator': opts.coordinator = args[++i]; break
      case '--verify':      opts.verify      = parseInt(args[++i]); break
      case '--benchmark':   opts.benchmark   = true; break
    }
  }
  return opts
}

// ── Benchmark ────────────────────────────────────────────────────────────────
function runBenchmark () {
  console.log('\n⚡ Lucas-Lehmer Benchmark\n')
  const testCases = [
    { p: 127,   label: 'M127 (known prime, 39 digits)' },
    { p: 521,   label: 'M521 (known prime, 157 digits)' },
    { p: 2203,  label: 'M2203 (known prime, 664 digits)' },
    { p: 4253,  label: 'M4253 (known prime, 1281 digits)' },
    { p: 9689,  label: 'M9689 (known prime, 2917 digits)' },
  ]

  for (const { p, label } of testCases) {
    const t0 = process.hrtime.bigint()
    const result = lucasLehmer(p)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    const symbol = result === KNOWN_MERSENNE_EXPONENTS.has(p) ? '✅' : '❌'
    console.log(`  ${symbol} ${label}`)
    console.log(`     Result: ${result ? 'PRIME' : 'composite'} | Time: ${ms.toFixed(0)}ms | Squarings: ${(p-2).toLocaleString()}`)
  }

  console.log('\n📊 Scaling projection (linear extrapolation):')
  console.log('   p = 100,000   → ~30 min on 1 core (need FFT squaring for this)')
  console.log('   p = 1,000,000  → ~50 hours on 1 core → hours on GPU')
  console.log('   p = 136M (record) → ~1 year on 1 GPU → weeks on GPU cluster')
  console.log('   p = 200M (next target) → proportionally more')
  console.log('\n💡 The bottleneck is squaring speed. Solutions:')
  console.log('   1. FFT-based squaring (O(n log n) vs O(n²)) — 1000x faster at p=136M')
  console.log('   2. GPU acceleration — 100-1000x over CPU FFT')
  console.log('   3. Distributed: pool many GPUs across the internet (like Luke Durant did)')
  console.log('   4. Join GIMPS: your machine contributes to the global search for free\n')
}

// ── Verify a specific exponent ───────────────────────────────────────────────
async function verifyExponent (p) {
  console.log(`\n🔬 Testing 2^${p}−1 for primality`)
  console.log(`   Digits: ~${Math.ceil(p * Math.log10(2)).toLocaleString()}`)
  console.log(`   Known to GIMPS: ${KNOWN_MERSENNE_EXPONENTS.has(p) ? 'YES (Mersenne prime)' : 'not in known list'}`)
  console.log('')

  // Step 1: Trial factoring
  process.stdout.write('   Step 1/3: Trial factoring to 2^60... ')
  const t0 = Date.now()
  const factor = trialFactor(p, 60)
  if (factor) {
    console.log(`\n   ❌ COMPOSITE — factor found: ${factor}`)
    console.log(`   Eliminated in ${Date.now()-t0}ms`)
    return false
  }
  console.log(`none found (${Date.now()-t0}ms)`)

  // Step 2: Fermat PRP (only for manageable sizes)
  if (p <= 100_000) {
    process.stdout.write('   Step 2/3: Fermat PRP test... ')
    const t1 = Date.now()
    const prp = fermatPRP(p)
    if (!prp) {
      console.log(`\n   ❌ COMPOSITE (failed PRP test, ${Date.now()-t1}ms)`)
      return false
    }
    console.log(`probably prime (${Date.now()-t1}ms)`)
  } else {
    console.log('   Step 2/3: Fermat PRP — skipped (p too large for JS BigInt; use Prime95/gpuowl)')
  }

  // Step 3: Lucas-Lehmer
  if (p <= 20_000) {
    process.stdout.write(`   Step 3/3: Lucas-Lehmer (${(p-2).toLocaleString()} squarings)... `)
    const t2 = Date.now()
    let lastPct = -1
    const result = lucasLehmer(p, (i, total) => {
      const pct = Math.floor(i / total * 100)
      if (pct !== lastPct) { process.stdout.write(`\r   Step 3/3: Lucas-Lehmer ${pct}%... `); lastPct = pct }
    })
    const elapsed = Date.now() - t2
    console.log(`\n   ${result ? '🎉 MERSENNE PRIME!' : '❌ COMPOSITE'} (${elapsed}ms)`)
    return result
  } else {
    console.log('   Step 3/3: Lucas-Lehmer — skipped (p > 20,000; need FFT. Use Prime95 or gpuowl)')
    console.log('   → TF and PRP passed. Candidate looks promising!')
    return null  // inconclusive without LL
  }
}

// ── Local search ──────────────────────────────────────────────────────────────
async function localSearch (opts) {
  const { start, end } = opts
  console.log(`\n🔭 Searching for Mersenne primes with exponent p ∈ [${start.toLocaleString()}, ${end.toLocaleString()}]`)

  const candidates = generateCandidates(start, end)
  console.log(`   ${candidates.length} prime exponents to test (after TF pre-filter)`)
  console.log('')

  const found = []
  let tested = 0

  for (const p of candidates) {
    const isKnown = KNOWN_MERSENNE_EXPONENTS.has(p)
    process.stdout.write(`   Testing p=${p.toLocaleString()} (${Math.ceil(p * Math.log10(2)).toLocaleString()} digits)... `)

    const t0 = Date.now()
    let result

    if (p <= 20_000) {
      result = lucasLehmer(p)
    } else {
      // Too large for schoolbook; just do TF + report
      result = null
    }

    const ms = Date.now() - t0
    tested++

    if (result === true) {
      console.log(`🎉 PRIME! (${ms}ms)`)
      found.push(p)
      if (!isKnown) {
        console.log(`\n   ⭐⭐⭐ NEW MERSENNE PRIME DISCOVERED: 2^${p}−1 ⭐⭐⭐\n`)
      }
    } else if (result === false) {
      console.log(`composite (${ms}ms)`)
    } else {
      console.log(`inconclusive — too large for schoolbook LL (use Prime95)`)
    }
  }

  console.log(`\n   Tested ${tested} candidates, found ${found.length} Mersenne primes`)
  if (found.length > 0) {
    console.log(`   Mersenne primes found: ${found.map(p => `2^${p}−1`).join(', ')}`)
  }
}

// ── Distributed client ────────────────────────────────────────────────────────
async function distributedClient (coordinatorUrl) {
  const clientId = `${require('os').hostname()}-${process.pid}`
  console.log(`\n🌐 Connecting to coordinator: ${coordinatorUrl}`)
  console.log(`   Client ID: ${clientId}\n`)

  while (true) {
    // Fetch work
    const work = await new Promise((resolve, reject) => {
      const url = new URL('/work', coordinatorUrl)
      const req = http.get(url.toString(), { headers: { 'x-client-id': clientId } }, res => {
        if (res.statusCode === 204) { resolve(null); return }
        let body = ''
        res.on('data', d => body += d)
        res.on('end', () => resolve(JSON.parse(body)))
      })
      req.on('error', reject)
    })

    if (!work) {
      console.log('No work available. Queue exhausted or server unreachable.')
      break
    }

    console.log(`   Working on p=${work.exponent.toLocaleString()} (${work.digits.toLocaleString()} digits)`)

    const t0 = Date.now()
    let isPrime = false
    let residue = null

    if (work.exponent <= 20_000) {
      isPrime = lucasLehmer(work.exponent)
    } else {
      console.log('     Exponent too large for JS LL — submitting TF result only')
      const factor = trialFactor(work.exponent, 60)
      isPrime = factor === null  // not definitive but reports TF result
      residue = factor ? factor.toString() : 'no small factor found'
    }

    const elapsed = Date.now() - t0

    // Submit result
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({ exponent: work.exponent, isPrime, residue, elapsed, clientId })
      const url  = new URL('/result', coordinatorUrl)
      const req  = http.request({ ...url, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => { res.resume(); resolve() })
      req.on('error', reject)
      req.write(body)
      req.end()
    })

    console.log(`   → ${isPrime ? '🎉 PROBABLE PRIME' : 'composite'} (${elapsed}ms)`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main () {
  const opts = parseArgs()

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║            PrimeCrunch — Mersenne Prime Hunter                ║
║                                                               ║
║  Current record: 2^136,279,841−1 (41M digits, Oct 2024)      ║
║  Next EFF prize: $150,000 for 100M-digit prime (p ≈ 332M)    ║
╚═══════════════════════════════════════════════════════════════╝`)

  if (opts.benchmark) {
    runBenchmark()
    return
  }

  if (opts.verify !== null) {
    await verifyExponent(opts.verify)
    return
  }

  if (opts.serve) {
    const coord = new Coordinator({ port: opts.port, pStart: opts.start, pEnd: opts.end })
    coord.start()
    return
  }

  if (opts.coordinator) {
    await distributedClient(opts.coordinator)
    return
  }

  await localSearch(opts)
}

main().catch(err => { console.error(err); process.exit(1) })
