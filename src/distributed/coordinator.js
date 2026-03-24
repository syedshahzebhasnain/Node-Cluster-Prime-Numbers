'use strict'
/**
 * Distributed Work Coordinator
 * =============================
 * Implements a Folding@Home-style work distribution server.
 *
 * Architecture:
 *   - HTTP server hands out "work units" (Mersenne exponents to test)
 *   - Clients (local workers OR remote machines) POST results back
 *   - Coordinator tracks progress, avoids duplicate work, aggregates results
 *   - Supports WebSocket for real-time progress from long-running tests
 *
 * This lets you pool multiple machines — laptops, Raspberry Pis, cloud VMs —
 * all contributing to the same prime search.
 *
 * Usage (server):
 *   node src/distributed/coordinator.js --port 3000 --start 140000000 --end 200000000
 *
 * Usage (client connecting to a coordinator):
 *   node mersenne-hunt.js --coordinator http://yourserver:3000
 */

const http    = require('http')
const fs      = require('fs')
const path    = require('path')
const os      = require('os')
const { generateCandidates, candidateScore } = require('../mersenne/candidate-sieve')

const STATE_FILE = path.join(process.cwd(), 'coordinator-state.json')

class Coordinator {
  constructor ({ port = 3000, pStart = 140_000_000, pEnd = 200_000_000 } = {}) {
    this.port   = port
    this.pStart = pStart
    this.pEnd   = pEnd

    // Work queue state
    this.pending    = new Map()  // exponent → { assignedAt, clientId }
    this.completed  = new Map()  // exponent → { result, clientId, elapsed }
    this.queue      = []         // sorted candidate exponents
    this.found      = []         // confirmed Mersenne primes

    this.loadState()
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  saveState () {
    const state = {
      pStart:    this.pStart,
      pEnd:      this.pEnd,
      completed: [...this.completed.entries()],
      found:     this.found,
      savedAt:   new Date().toISOString(),
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  }

  loadState () {
    if (!fs.existsSync(STATE_FILE)) {
      this.buildQueue()
      return
    }
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
      this.completed = new Map(state.completed)
      this.found     = state.found || []
      this.buildQueue()
      console.log(`Loaded state: ${this.completed.size} completed, ${this.queue.length} remaining`)
    } catch {
      this.buildQueue()
    }
  }

  buildQueue () {
    console.log(`Building candidate queue for exponents ${this.pStart.toLocaleString()} to ${this.pEnd.toLocaleString()}...`)
    // Generate in batches to avoid blocking (large ranges take a while)
    const BATCH = 1_000_000
    const allCandidates = []
    for (let lo = this.pStart; lo < this.pEnd; lo += BATCH) {
      const hi = Math.min(lo + BATCH - 1, this.pEnd)
      const batch = generateCandidates(lo, hi)
      allCandidates.push(...batch)
    }

    // Sort by priority (most promising first)
    allCandidates.sort((a, b) => candidateScore(b) - candidateScore(a))

    // Remove already completed
    this.queue = allCandidates.filter(p => !this.completed.has(p))
    console.log(`Queue built: ${allCandidates.length} candidates, ${this.queue.length} remaining`)
  }

  // ── Work assignment ───────────────────────────────────────────────────────

  getNextWork (clientId) {
    // Expire stale assignments (> 7 days) and re-queue them
    const EXPIRE_MS = 7 * 24 * 3600 * 1000
    const now = Date.now()
    for (const [exp, info] of this.pending) {
      if (now - info.assignedAt > EXPIRE_MS) {
        this.pending.delete(exp)
        this.queue.unshift(exp)  // put back at front
      }
    }

    const p = this.queue.shift()
    if (p === undefined) return null

    this.pending.set(p, { assignedAt: now, clientId })
    return {
      exponent:    p,
      description: `Test 2^${p}−1 for primality`,
      digits:      Math.ceil(p * Math.log10(2)),
      trialFactor: 74,  // TF to 2^74 bits first
    }
  }

  // ── Result submission ─────────────────────────────────────────────────────

  submitResult ({ exponent, isPrime, residue, elapsed, clientId }) {
    this.pending.delete(exponent)
    this.completed.set(exponent, { isPrime, residue, elapsed, clientId, at: Date.now() })

    if (isPrime) {
      this.found.push({ exponent, digits: Math.ceil(exponent * Math.log10(2)), foundAt: Date.now() })
      console.log(`\n🎉🎉🎉 MERSENNE PRIME FOUND: 2^${exponent}−1 🎉🎉🎉`)
      console.log(`   Digits: ${Math.ceil(exponent * Math.log10(2)).toLocaleString()}`)
    }

    this.saveState()
    return { ack: true, queueSize: this.queue.length }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  stats () {
    return {
      queue:       this.queue.length,
      pending:     this.pending.size,
      completed:   this.completed.size,
      found:       this.found.length,
      primes:      this.found,
      searchRange: `${this.pStart.toLocaleString()} – ${this.pEnd.toLocaleString()}`,
      host:        os.hostname(),
    }
  }

  // ── HTTP Server ───────────────────────────────────────────────────────────

  start () {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

      if (req.method === 'GET' && req.url === '/work') {
        const clientId = req.headers['x-client-id'] || 'unknown'
        const work = this.getNextWork(clientId)
        if (!work) {
          res.writeHead(204)  // No content — queue exhausted
          res.end()
          return
        }
        res.writeHead(200)
        res.end(JSON.stringify(work))
        return
      }

      if (req.method === 'GET' && req.url === '/stats') {
        res.writeHead(200)
        res.end(JSON.stringify(this.stats(), null, 2))
        return
      }

      if (req.method === 'POST' && req.url === '/result') {
        let body = ''
        req.on('data', d => { body += d })
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            const ack  = this.submitResult(data)
            res.writeHead(200)
            res.end(JSON.stringify(ack))
          } catch (e) {
            res.writeHead(400)
            res.end(JSON.stringify({ error: e.message }))
          }
        })
        return
      }

      res.writeHead(404)
      res.end(JSON.stringify({ error: 'not found' }))
    })

    server.listen(this.port, () => {
      console.log(`\n🌐 Coordinator running on port ${this.port}`)
      console.log(`   GET  http://localhost:${this.port}/work   — fetch next work unit`)
      console.log(`   POST http://localhost:${this.port}/result — submit result`)
      console.log(`   GET  http://localhost:${this.port}/stats  — view progress\n`)
    })

    return server
  }
}

// Run as standalone coordinator if called directly
if (require.main === module) {
  const args = process.argv.slice(2)
  const opts = {}
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--port')  opts.port  = parseInt(args[i+1])
    if (args[i] === '--start') opts.pStart = parseInt(args[i+1])
    if (args[i] === '--end')   opts.pEnd   = parseInt(args[i+1])
  }
  new Coordinator(opts).start()
}

module.exports = { Coordinator }
