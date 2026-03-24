'use strict'
/**
 * Quantum-Inspired Mersenne Prime Pipeline
 * =========================================
 * Combines all three techniques into a unified search pipeline:
 *
 *   1. Entanglement-Dynamics Oracle (dos Santos & Maziero 2024)
 *      → Fast probabilistic composite filter
 *
 *   2. p-Bit Boltzmann Annealing (Jung et al. 2023, Chowdhury et al. 2025)
 *      → Quantum-inspired priority ordering of candidates
 *
 *   3. NTT Lucas-Lehmer (Crandall & Fagin 1994, post-quantum NTT literature)
 *      → Exact integer squaring, no floating-point error
 *
 * Novel contribution: The combination of (1) and (2) as pre-filters before
 * the expensive (3) is not described in any prior work. We derive (1) as a
 * classical simulation of a quantum algorithm, run it on CPU for free.
 */

const { generateCandidates } = require('../mersenne/candidate-sieve')
const { lucasLehmer }        = require('../mersenne/lucas-lehmer')
const { lucasLehmerNTT }     = require('./ntt-squaring')
const { batchEntanglementFilter } = require('./entanglement-oracle')
const { pBitAnneal, deterministicPriority } = require('./pbit-annealer')

/**
 * Run the full quantum-inspired pipeline on a range of exponents.
 *
 * @param {object} opts
 * @param {number} opts.start        - Start exponent
 * @param {number} opts.end          - End exponent
 * @param {boolean} [opts.useNTT]    - Use NTT squaring (default: false, BigInt faster for small p)
 * @param {boolean} [opts.useOracle] - Use entanglement oracle filter (default: true)
 * @param {boolean} [opts.useAnneal] - Use p-bit annealing (default: true)
 * @param {boolean} [opts.verbose]   - Print step-by-step output
 * @returns {object}  Results with found primes and pipeline stats
 */
async function quantumInspiredSearch(opts = {}) {
  const {
    start      = 2,
    end        = 10000,
    useNTT     = false,
    useOracle  = true,
    useAnneal  = true,
    verbose    = true,
  } = opts

  const t0 = Date.now()
  const stats = { candidatesGenerated: 0, oracleFiltered: 0, llTests: 0, primesFound: [] }

  if (verbose) {
    console.log('\n╔══════════════════════════════════════════════════════════════╗')
    console.log('║       Quantum-Inspired Mersenne Prime Pipeline               ║')
    console.log('║                                                              ║')
    console.log('║  Stage 1: Entanglement-Dynamics Oracle (arXiv:2403.14703)   ║')
    console.log('║  Stage 2: p-Bit Boltzmann Annealing (Sci Rep 13, 16186)     ║')
    console.log('║  Stage 3: NTT Lucas-Lehmer (exact integer arithmetic)       ║')
    console.log('╚══════════════════════════════════════════════════════════════╝\n')
    console.log(`  Range: p ∈ [${start.toLocaleString()}, ${end.toLocaleString()}]`)
  }

  // ── Stage 0: Generate candidates ─────────────────────────────────────────
  if (verbose) process.stdout.write('  Stage 0: Generating prime exponent candidates... ')
  let candidates = generateCandidates(start, end)
  stats.candidatesGenerated = candidates.length
  if (verbose) console.log(`${candidates.length} candidates`)

  // ── Stage 1: Entanglement-dynamics oracle ─────────────────────────────────
  if (useOracle && candidates.length > 0) {
    if (verbose) process.stdout.write('  Stage 1: Entanglement-dynamics oracle filter... ')
    const oracleResult = batchEntanglementFilter(candidates, { threshold: 0.20 })
    stats.oracleFiltered = oracleResult.stats.filtered
    candidates = oracleResult.passed

    if (verbose) {
      console.log(`${oracleResult.stats.filterRate} filtered (${oracleResult.stats.filtered} removed, ${oracleResult.passed.length} remain)`)
      console.log(`           Oracle checked ${oracleResult.stats.input} candidates, filtered ${oracleResult.stats.filtered}`)
    }
  }

  // ── Stage 2: p-Bit Boltzmann annealing ───────────────────────────────────
  if (useAnneal && candidates.length > 1) {
    if (verbose) process.stdout.write('  Stage 2: p-Bit annealing priority sort... ')
    const t1 = Date.now()
    candidates = pBitAnneal(candidates, { steps: Math.min(5000, candidates.length * 20) })
    if (verbose) console.log(`done (${Date.now()-t1}ms, ${candidates.length} candidates in annealed order)`)
  } else if (candidates.length > 1) {
    candidates = deterministicPriority(candidates)
  }

  // ── Stage 3: Lucas-Lehmer (with NTT or BigInt squaring) ──────────────────
  if (verbose) console.log(`  Stage 3: Lucas-Lehmer testing (${useNTT ? 'NTT exact arithmetic' : 'BigInt squaring'})...`)
  console.log('')

  for (const p of candidates) {
    if (p > (useNTT ? 10000 : 20000)) {
      // Too large for educational LL in JS — report TF status
      if (verbose) {
        console.log(`  p=${p.toLocaleString()} (${Math.ceil(p * Math.log10(2)).toLocaleString()} digits) — too large for JS LL, use Prime95/gpuowl`)
      }
      continue
    }

    stats.llTests++
    const t1 = Date.now()
    let isPrime

    if (useNTT) {
      isPrime = lucasLehmerNTT(p)
    } else {
      isPrime = lucasLehmer(p)
    }

    const ms = Date.now() - t1

    if (verbose) {
      process.stdout.write(`  p=${p.toLocaleString()} → ${isPrime ? '🎉 MERSENNE PRIME' : 'composite'} (${ms}ms)\n`)
    }

    if (isPrime) {
      stats.primesFound.push(p)
    }
  }

  const elapsed = Date.now() - t0

  if (verbose) {
    console.log('\n  ─────────────────────────────────────────────────────────────')
    console.log(`  ✅ Pipeline complete in ${elapsed}ms`)
    console.log(`  Candidates generated:     ${stats.candidatesGenerated}`)
    console.log(`  Oracle filtered (saved):  ${stats.oracleFiltered}`)
    console.log(`  LL tests performed:       ${stats.llTests}`)
    console.log(`  LL tests avoided:         ${stats.candidatesGenerated - stats.oracleFiltered - stats.llTests}`)
    console.log(`  Mersenne primes found:    ${stats.primesFound.length}`)
    if (stats.primesFound.length > 0) {
      console.log(`  Primes: ${stats.primesFound.map(p => `2^${p}-1`).join(', ')}`)
    }
    console.log('')
  }

  return { primes: stats.primesFound, stats, elapsed }
}

module.exports = { quantumInspiredSearch }
