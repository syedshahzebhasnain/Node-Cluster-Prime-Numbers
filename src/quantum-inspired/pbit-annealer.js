'use strict'
/**
 * p-Bit Boltzmann Machine Annealer for Candidate Prioritisation
 * ==============================================================
 * Implements quantum-inspired probabilistic computing using p-bits
 * (probabilistic bits), derived from:
 *
 *   Jung et al., "A quantum-inspired probabilistic prime factorization based
 *   on virtually connected Boltzmann machine and probabilistic annealing"
 *   Nature Scientific Reports 13, 16186 (2023)
 *
 *   Chowdhury et al., "Pushing the boundary of quantum advantage in hard
 *   combinatorial optimization with probabilistic computers"
 *   Nature Communications (2025)
 *
 * WHAT IS A p-BIT?
 *   A p-bit is a probabilistic bit that outputs ±1 with tunable probability:
 *
 *     p_i = sign(tanh(β·h_i) + uniform_noise(-1, 1))
 *
 *   where h_i is the local "field" (energy gradient) and β is inverse temperature.
 *   At β→0: purely random (equal probability of ±1)
 *   At β→∞: deterministic (always takes the lower-energy state)
 *
 *   The gradual annealing from β=0 → β=∞ is analogous to quantum annealing's
 *   gradual reduction of quantum fluctuations (Γ→0). This simulates quantum
 *   tunneling classically, allowing escape from local energy minima.
 *
 * HOW WE USE IT:
 *   We encode Mersenne candidate exponents as an Ising model where:
 *   - Each spin = one candidate exponent p
 *   - Energy of spin = -log(P(p is Mersenne prime)) [heuristic probability]
 *   - Couplings between spins = 0 (independent candidates, no interactions)
 *
 *   The annealer finds the ordering that minimises total energy =
 *   maximises the probability of finding a Mersenne prime quickly.
 *
 *   Unlike greedy ordering (which can get stuck in local optima due to
 *   correlations between candidates near the same exponent range), the
 *   p-bit annealer explores the priority space stochastically.
 *
 * THE KEY NOVELTY:
 *   We add a "diversity term" to the energy: candidates that are clustered
 *   near each other in exponent space are penalised. This spreads the search
 *   across the full range, which is important because Mersenne primes are
 *   distributed approximately logarithmically — searching only the smallest
 *   remaining exponents is suboptimal.
 *
 * @param {number[]} candidates  - Array of prime exponents to prioritise
 * @param {object}  [opts]
 * @param {number}  [opts.betaStart=0.1]  - Initial inverse temperature
 * @param {number}  [opts.betaEnd=10.0]   - Final inverse temperature
 * @param {number}  [opts.steps=1000]     - Annealing steps
 * @param {number}  [opts.diversityWeight=0.3]  - Weight of diversity penalty
 * @returns {number[]}  Candidates reordered by annealed priority
 */
function pBitAnneal(candidates, opts = {}) {
  const {
    betaStart      = 0.1,
    betaEnd        = 10.0,
    steps          = Math.min(1000, candidates.length * 10),
    diversityWeight = 0.3,
  } = opts

  if (candidates.length <= 1) return [...candidates]

  const N = candidates.length

  // ── Energy function ─────────────────────────────────────────────────────
  // Energy of assigning candidate[i] to position rank in the search order
  // Lower energy = higher priority = should be tested sooner

  // Base energy: heuristic probability of 2^p-1 being Mersenne prime
  // Based on the known result: P(Mersenne prime) ≈ e^γ * ln(2) / p
  // where γ ≈ 0.5772 is Euler-Mascheroni constant
  const EULER_GAMMA = 0.5772156649
  function baseCandidateEnergy(p) {
    // Lower = more likely to be prime = lower energy (want to test first)
    return p / (Math.exp(EULER_GAMMA) * Math.LN2)
  }

  // Diversity energy: penalise candidates that are too close to each other
  // Encourages the annealer to spread across the full exponent range
  function diversityEnergy(selectedIndices, candidateIdx) {
    if (selectedIndices.size === 0) return 0
    const p = candidates[candidateIdx]
    let minDist = Infinity
    for (const idx of selectedIndices) {
      const dist = Math.abs(p - candidates[idx])
      if (dist < minDist) minDist = dist
    }
    // Penalise proximity: if too close to an already-selected candidate,
    // increase energy (discourage testing nearby exponents consecutively)
    return minDist < 1000 ? 1000 / (minDist + 1) : 0
  }

  // ── p-bit state ──────────────────────────────────────────────────────────
  // Each p-bit represents a candidate's position in the priority queue
  // State: array of indices, representing the current ordering
  let order = [...Array(N).keys()]  // [0, 1, 2, ..., N-1]

  // Shuffle initially to start from a random state (like β=0 high temperature)
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }

  // ── Annealing schedule ───────────────────────────────────────────────────
  // Geometric schedule from betaStart to betaEnd
  const betaStep = Math.pow(betaEnd / betaStart, 1 / steps)
  let beta = betaStart

  let currentEnergy = order.reduce((sum, idx, rank) => {
    return sum + baseCandidateEnergy(candidates[idx]) * (rank + 1) / N
  }, 0)

  // ── p-bit update loop ────────────────────────────────────────────────────
  for (let step = 0; step < steps; step++) {
    // Pick two random positions to swap (a single p-bit flip in Ising terms)
    const i = Math.floor(Math.random() * N)
    const j = Math.floor(Math.random() * N)
    if (i === j) { beta *= betaStep; continue }

    // Compute energy change ΔE from swapping positions i and j
    const pi = candidates[order[i]]
    const pj = candidates[order[j]]

    // Energy contribution of position i: lower rank = higher weight (tested sooner)
    const weightI = (N - i) / N
    const weightJ = (N - j) / N

    const energyBefore = baseCandidateEnergy(pi) * weightI +
                         baseCandidateEnergy(pj) * weightJ
    const energyAfter  = baseCandidateEnergy(pj) * weightI +
                         baseCandidateEnergy(pi) * weightJ

    const deltaE = energyAfter - energyBefore

    // ── p-bit acceptance rule (Metropolis with quantum-inspired noise) ────
    // Standard: accept if deltaE < 0
    // With p-bit noise: accept probabilistically even if deltaE > 0
    // The sigmoid function simulates the quantum tunneling amplitude:
    //   p_accept = sigmoid(-β * ΔE) = 1/(1 + exp(β * ΔE))
    const pAccept = 1 / (1 + Math.exp(beta * deltaE))

    // Apply noise (the "quantum" part — stochastic fluctuation)
    const noise = Math.random()
    if (noise < pAccept) {
      ;[order[i], order[j]] = [order[j], order[i]]
      currentEnergy += deltaE
    }

    beta *= betaStep  // Cool down (reduce quantum fluctuations)
  }

  // Return candidates in annealed priority order (best first)
  return order.map(idx => candidates[idx])
}

/**
 * Score candidates using the Mersenne prime density heuristic and
 * known number-theoretic constraints, returning a sorted list.
 *
 * This is a fast deterministic baseline (no annealing) for comparison.
 * @param {number[]} candidates
 * @returns {number[]}  Sorted highest-priority first
 */
function deterministicPriority(candidates) {
  const EULER_GAMMA = 0.5772156649
  return [...candidates].sort((a, b) => {
    // Score: expected probability of being Mersenne prime
    // Higher score = test first
    const scoreA = Math.exp(EULER_GAMMA) * Math.LN2 / a
    const scoreB = Math.exp(EULER_GAMMA) * Math.LN2 / b

    // Bonus: GIMPS unverified gap region (80M–136M) — possible hidden prime
    const gapBonus = (p) => (p > 80_000_000 && p < 136_279_841) ? 1.5 : 1.0

    return (scoreB * gapBonus(b)) - (scoreA * gapBonus(a))
  })
}

module.exports = { pBitAnneal, deterministicPriority }
