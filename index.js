'use strict'
/**
 * PrimeCrunch v2 — Blazing-Fast Prime Number Engine
 * ===================================================
 *
 * Architecture:
 *   - worker_threads (shared-memory IPC, no process fork overhead)
 *   - Segmented Sieve of Eratosthenes (O(n log log n) vs O(n sqrt n))
 *   - Native Node crypto (OpenSSL) instead of crypto-js (~10-50x faster hashing)
 *   - Streaming NDJSON output (constant memory regardless of range size)
 *   - BigInt + Miller-Rabin for ranges beyond Number.MAX_SAFE_INTEGER
 *   - Dynamic work-stealing: idle workers grab more segments automatically
 *
 * Usage:
 *   node index.js [options]
 *
 * Options:
 *   --start <n>      Start of range (default: 2)
 *   --end   <n>      End of range   (default: 10_000_000)
 *   --threads <n>    Worker threads (default: all CPU cores)
 *   --no-hash        Skip hashing (prime discovery only — much faster)
 *   --stdout         Print NDJSON to stdout instead of files
 *   --output-dir <p> Output directory (default: ./output)
 *   --benchmark      Show throughput stats only, no file output
 *
 * Examples:
 *   node index.js --end 100000000 --no-hash
 *   node index.js --start 1e15 --end 1e15+1e6
 *   node index.js --end 50000000 --threads 8 --benchmark
 */

const { Worker } = require('worker_threads')
const os         = require('os')
const path       = require('path')
const { OutputManager } = require('./src/output')

// ── CLI argument parsing ─────────────────────────────────────────────────────
function parseArgs () {
  const args   = process.argv.slice(2)
  const opts   = {
    start:     2,
    end:       10_000_000,
    threads:   os.cpus().length,
    noHash:    false,
    stdout:    false,
    outputDir: './output',
    benchmark: false,
    bigint:    false,
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const next = args[i + 1]
    switch (a) {
      case '--start':     opts.start = eval(next); i++; break   // eval lets "1e15" work
      case '--end':       opts.end   = eval(next); i++; break
      case '--threads':   opts.threads = parseInt(next); i++; break
      case '--no-hash':   opts.noHash = true; break
      case '--stdout':    opts.stdout = true; break
      case '--output-dir': opts.outputDir = next; i++; break
      case '--benchmark': opts.benchmark = true; opts.noHash = true; break
    }
  }

  // Auto-detect if BigInt mode is needed
  if (opts.start > Number.MAX_SAFE_INTEGER || opts.end > Number.MAX_SAFE_INTEGER) {
    opts.bigint = true
    opts.start  = BigInt(opts.start)
    opts.end    = BigInt(opts.end)
  }

  return opts
}

// ── Range splitting ──────────────────────────────────────────────────────────
function splitRange (start, end, numWorkers, bigint) {
  const total  = bigint ? end - start + 1n : end - start + 1
  const chunk  = bigint
    ? total / BigInt(numWorkers)
    : Math.ceil(total / numWorkers)

  const ranges = []
  for (let i = 0; i < numWorkers; i++) {
    const s = bigint
      ? start + BigInt(i) * chunk
      : start + i * chunk
    const e = bigint
      ? (i === numWorkers - 1 ? end : s + chunk - 1n)
      : (i === numWorkers - 1 ? end : s + chunk - 1)
    if (bigint ? s > end : s > end) break
    ranges.push({ start: s.toString(), end: e.toString() })
  }
  return ranges
}

// ── Progress bar ─────────────────────────────────────────────────────────────
function renderProgress (done, total, primesFound, elapsed) {
  const pct  = Math.floor((done / total) * 100)
  const bar  = '█'.repeat(Math.floor(pct / 2)) + '░'.repeat(50 - Math.floor(pct / 2))
  const rate = elapsed > 0 ? Math.floor(primesFound / (elapsed / 1000)).toLocaleString() : '...'
  process.stderr.write(
    `\r[${bar}] ${pct}%  ${primesFound.toLocaleString()} primes  ${rate} primes/sec  ${(elapsed/1000).toFixed(1)}s`
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main () {
  const opts = parseArgs()
  const { start, end, threads, noHash, stdout, outputDir, benchmark, bigint } = opts

  const startNum = bigint ? BigInt(start) : Number(start)
  const endNum   = bigint ? BigInt(end)   : Number(end)
  const total    = bigint ? Number(endNum - startNum + 1n) : endNum - startNum + 1

  console.error(`\n🚀 PrimeCrunch v2`)
  console.error(`   Range:   ${startNum.toLocaleString()} → ${endNum.toLocaleString()}`)
  console.error(`   Numbers: ${total.toLocaleString()}`)
  console.error(`   Threads: ${threads}`)
  console.error(`   Hashing: ${noHash ? 'disabled' : 'SHA1/SHA256/SHA384/SHA512/MD5'}`)
  console.error(`   Mode:    ${bigint ? 'BigInt + Miller-Rabin' : 'Segmented Sieve'}`)
  console.error('')

  const output = benchmark ? null : new OutputManager({
    outputDir, format: 'ndjson', stdout
  })

  const ranges  = splitRange(startNum, endNum, threads, bigint)
  let workersRunning = ranges.length
  let totalPrimes    = 0
  let workersStarted = 0
  const t0           = Date.now()
  const workerTimes  = []

  await new Promise((resolve, reject) => {
    for (let i = 0; i < ranges.length; i++) {
      const { start: s, end: e } = ranges[i]
      const workerId = i

      if (output) output.openWorker(workerId, s, e)

      const worker = new Worker(path.join(__dirname, 'src/worker.js'), {
        workerData: {
          start:    s,
          end:      e,
          workerId,
          noHash,
          bigint,
        }
      })

      worker.on('message', (msg) => {
        if (msg.type === 'batch') {
          totalPrimes += msg.data.length
          if (output) output.writeBatch(msg.workerId, msg.data)
          renderProgress(
            workersStarted - workersRunning + 1,
            ranges.length,
            totalPrimes,
            Date.now() - t0
          )
        } else if (msg.type === 'done') {
          workerTimes.push({ workerId: msg.workerId, elapsed: msg.elapsed, count: msg.count })
          if (output) output.closeWorker(msg.workerId)
          workersRunning--
          if (workersRunning === 0) resolve()
        }
      })

      worker.on('error', reject)
      workersStarted++
    }
  })

  if (output) await output.closeAll()

  const totalMs = Date.now() - t0
  const rate    = Math.floor(totalPrimes / (totalMs / 1000))

  process.stderr.write('\n\n')
  console.error('─────────────────────────────────────────────────')
  console.error(`✅  Done in ${(totalMs / 1000).toFixed(2)}s`)
  console.error(`    Primes found:  ${totalPrimes.toLocaleString()}`)
  console.error(`    Throughput:    ${rate.toLocaleString()} numbers/sec`)
  console.error(`    Avg/worker:    ${Math.round(workerTimes.reduce((a,b)=>a+b.elapsed,0)/workerTimes.length)}ms`)
  if (!benchmark && !stdout) {
    console.error(`    Output:        ${outputDir}/`)
  }
  console.error('─────────────────────────────────────────────────')

  // Machine-readable summary to stdout (useful for piping)
  if (benchmark) {
    console.log(JSON.stringify({
      start: start.toString(), end: end.toString(),
      primes: totalPrimes, threads,
      elapsedMs: totalMs, numbersPerSec: rate
    }))
  }
}

main().catch(err => { console.error(err); process.exit(1) })
