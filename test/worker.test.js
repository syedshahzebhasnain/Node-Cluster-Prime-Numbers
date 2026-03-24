'use strict'
/**
 * Integration tests for the worker thread pipeline.
 * Spawns real workers and verifies end-to-end output.
 * Run: node --test test/worker.test.js
 */
const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const { Worker } = require('worker_threads')
const path = require('path')

const WORKER_PATH = path.join(__dirname, '../src/worker.js')

/**
 * Run a worker and collect all batched results.
 */
function runWorker (workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData })
    const results = []
    let doneMsg = null

    worker.on('message', msg => {
      if (msg.type === 'batch') results.push(...msg.data)
      if (msg.type === 'done')  doneMsg = msg
    })
    worker.on('error', reject)
    worker.on('exit', code => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`))
      else resolve({ results, done: doneMsg })
    })
  })
}

describe('Worker thread — sieve mode (no hash)', () => {
  let output

  before(async () => {
    output = await runWorker({ start: '2', end: '100', workerId: 0, noHash: true, bigint: false })
  })

  it('finds exactly 25 primes up to 100', () => {
    assert.equal(output.results.length, 25)
  })

  it('first prime is 2', () => {
    assert.equal(output.results[0].number, 2)
  })

  it('last prime up to 100 is 97', () => {
    assert.equal(output.results[output.results.length - 1].number, 97)
  })

  it('done message reports correct count', () => {
    assert.equal(output.done.count, 25)
  })

  it('done message reports elapsed time', () => {
    assert.ok(output.done.elapsed >= 0, 'elapsed should be >= 0')
  })

  it('no hash fields present when noHash=true', () => {
    for (const r of output.results) {
      assert.equal(r.sha256, undefined, 'sha256 should not be present')
      assert.equal(r.sha1, undefined, 'sha1 should not be present')
    }
  })
})

describe('Worker thread — sieve mode with hashing', () => {
  let output

  before(async () => {
    output = await runWorker({ start: '2', end: '20', workerId: 0, noHash: false, bigint: false })
  })

  it('finds 8 primes up to 20', () => {
    assert.equal(output.results.length, 8)
  })

  it('each prime has all hash fields', () => {
    const fields = ['sha1', 'sha256', 'sha384', 'sha512', 'md5']
    for (const r of output.results) {
      for (const f of fields) {
        assert.ok(r[f], `Missing field ${f} on prime ${r.number}`)
        assert.ok(typeof r[f] === 'string' && r[f].length > 0, `Empty hash ${f}`)
      }
    }
  })

  it('SHA-256 of 2 is correct', () => {
    const prime2 = output.results.find(r => r.number === 2)
    // SHA-256("2") from Node native crypto
    assert.equal(prime2.sha256, 'd4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35')
  })

  it('MD5 of 2 is correct', () => {
    const prime2 = output.results.find(r => r.number === 2)
    // MD5("2") = c81e728d9d4c2f636f067f89cc14862c
    assert.equal(prime2.md5, 'c81e728d9d4c2f636f067f89cc14862c')
  })
})

describe('Worker thread — BigInt / Miller-Rabin mode', () => {
  let output

  before(async () => {
    // Search near 10^15
    output = await runWorker({
      start: '999999999999940',
      end:   '999999999999999',
      workerId: 0,
      noHash: true,
      bigint: true
    })
  })

  it('finds at least one prime in the range', () => {
    assert.ok(output.results.length > 0, 'Should find at least one prime near 10^15')
  })

  it('contains 999999999999947 (known prime)', () => {
    const nums = output.results.map(r => r.number)
    assert.ok(nums.includes('999999999999947'), 'Should find 999999999999947')
  })

  it('contains 999999999999989 (known prime)', () => {
    const nums = output.results.map(r => r.number)
    assert.ok(nums.includes('999999999999989'), 'Should find 999999999999989')
  })

  it('does NOT contain 999999999999937 (known composite)', () => {
    const nums = output.results.map(r => r.number)
    assert.ok(!nums.includes('999999999999937'), '999999999999937 is composite, should not appear')
  })

  it('results are returned as strings in bigint mode', () => {
    for (const r of output.results) {
      assert.equal(typeof r.number, 'string', 'BigInt results should be serialised as strings')
    }
  })
})

describe('Worker thread — batch sizing', () => {
  it('sends results in batches of at most 10000', async () => {
    // Range with ~78498 primes — should produce at least 7 batches
    let maxBatchSize = 0
    let batchCount   = 0

    await new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_PATH, {
        workerData: { start: '2', end: '1000000', workerId: 0, noHash: true, bigint: false }
      })
      worker.on('message', msg => {
        if (msg.type === 'batch') {
          batchCount++
          maxBatchSize = Math.max(maxBatchSize, msg.data.length)
        }
        if (msg.type === 'done') resolve()
      })
      worker.on('error', reject)
    })

    assert.ok(maxBatchSize <= 10_000, `Batch size ${maxBatchSize} exceeds 10000`)
    assert.ok(batchCount >= 7, `Expected >= 7 batches, got ${batchCount}`)
  })

  it('reports correct total prime count vs π(1,000,000) = 78498', async () => {
    const { done } = await runWorker({
      start: '2', end: '1000000', workerId: 0, noHash: true, bigint: false
    })
    assert.equal(done.count, 78_498)
  })
})

describe('Worker thread — edge cases', () => {
  it('handles range with a single prime', async () => {
    const { results } = await runWorker({ start: '97', end: '97', workerId: 0, noHash: true, bigint: false })
    assert.deepEqual(results.map(r => r.number), [97])
  })

  it('handles range with no primes', async () => {
    const { results } = await runWorker({ start: '24', end: '28', workerId: 0, noHash: true, bigint: false })
    assert.equal(results.length, 0)
  })

  it('handles range starting at 2', async () => {
    const { results } = await runWorker({ start: '2', end: '2', workerId: 0, noHash: true, bigint: false })
    assert.deepEqual(results.map(r => r.number), [2])
  })

  it('multiple workers on non-overlapping ranges produce consistent totals', async () => {
    const [a, b] = await Promise.all([
      runWorker({ start: '2',      end: '500000',  workerId: 0, noHash: true, bigint: false }),
      runWorker({ start: '500001', end: '1000000', workerId: 1, noHash: true, bigint: false }),
    ])
    assert.equal(a.done.count + b.done.count, 78_498,
      'Split workers should produce same total as single worker (π(10^6) = 78498)')
  })
})
