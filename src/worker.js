'use strict'
/**
 * Worker thread — one per CPU core.
 *
 * Receives a range [start, end] via workerData, sieves it, hashes each prime
 * using Node's native crypto (OpenSSL — much faster than crypto-js), then
 * streams results back to the main thread as batched messages to minimise IPC.
 *
 * For ranges beyond Number.MAX_SAFE_INTEGER the worker uses BigInt + Miller-Rabin.
 */

const { workerData, parentPort } = require('worker_threads')
const { createHash } = require('crypto') // native OpenSSL, not crypto-js
const { segmentedSieve, bigIntPrimesInRange } = require('./sieve')

const { start, end, workerId, noHash, bigint } = workerData
const BATCH_SIZE = 10_000 // send results in batches to reduce IPC overhead

function hashPrime (n) {
  const s = n.toString()
  // Use native crypto — all hashes computed in a single pass per algorithm
  const h = (algo) => createHash(algo).update(s).digest('hex')
  return {
    number: n,
    sha1:   h('sha1'),
    sha256: h('sha256'),
    sha384: h('sha384'),
    sha512: h('sha512'),
    md5:    h('md5'),
  }
}

function run () {
  const t0 = process.hrtime.bigint()
  let count = 0
  let batch = []

  function flush () {
    if (batch.length === 0) return
    parentPort.postMessage({ type: 'batch', workerId, data: batch })
    batch = []
  }

  if (bigint) {
    // Large number path — BigInt + Miller-Rabin
    const primes = bigIntPrimesInRange(BigInt(start), BigInt(end))
    for (const p of primes) {
      count++
      const entry = noHash ? { number: p.toString() } : hashPrime(p.toString())
      batch.push(entry)
      if (batch.length >= BATCH_SIZE) flush()
    }
  } else {
    // Fast path — segmented sieve (safe integers only)
    const primes = segmentedSieve(Number(start), Number(end))
    for (const p of primes) {
      count++
      const entry = noHash ? { number: p } : hashPrime(p)
      batch.push(entry)
      if (batch.length >= BATCH_SIZE) flush()
    }
  }

  flush()

  const elapsed = Number(process.hrtime.bigint() - t0) / 1e6 // ms
  parentPort.postMessage({ type: 'done', workerId, count, elapsed })
}

run()
