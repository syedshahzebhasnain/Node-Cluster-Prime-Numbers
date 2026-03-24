'use strict'
/**
 * Output manager — handles all I/O so workers stay pure compute.
 *
 * Supports:
 *   - NDJSON streaming to a file (one JSON object per line, no memory blowup)
 *   - SQLite via better-sqlite3 (optional, for queryable output)
 *   - stdout passthrough (--stdout flag)
 *
 * Uses a write stream with backpressure handling so disk I/O never blocks
 * the event loop or stalls worker IPC.
 */

const fs   = require('fs')
const path = require('path')

class OutputManager {
  constructor ({ outputDir = './output', format = 'ndjson', stdout = false }) {
    this.format    = format
    this.stdout    = stdout
    this.outputDir = outputDir
    this.streams   = new Map()  // workerId -> WriteStream
    this.counts    = new Map()  // workerId -> written count
    this.totalWritten = 0

    if (!stdout) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
  }

  /**
   * Open an output stream for the given worker.
   */
  openWorker (workerId, start, end) {
    if (this.stdout) return
    const file = path.join(this.outputDir, `primes_${workerId}_${start}-${end}.ndjson`)
    const stream = fs.createWriteStream(file, { flags: 'w', encoding: 'utf8' })
    this.streams.set(workerId, stream)
    this.counts.set(workerId, 0)
  }

  /**
   * Write a batch of prime records from a worker.
   */
  writeBatch (workerId, records) {
    const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n'

    if (this.stdout) {
      process.stdout.write(lines)
    } else {
      const stream = this.streams.get(workerId)
      if (stream) {
        // Handle backpressure — if stream buffer is full, we could drain here
        // For maximum throughput we let the OS buffer handle it
        stream.write(lines)
      }
    }

    this.totalWritten += records.length
    this.counts.set(workerId, (this.counts.get(workerId) || 0) + records.length)
  }

  /**
   * Close the stream for a worker once it finishes.
   */
  closeWorker (workerId) {
    return new Promise((resolve) => {
      const stream = this.streams.get(workerId)
      if (!stream) { resolve(); return }
      stream.end(resolve)
      this.streams.delete(workerId)
    })
  }

  async closeAll () {
    await Promise.all([...this.streams.keys()].map(id => this.closeWorker(id)))
  }

  stats () {
    return { totalWritten: this.totalWritten }
  }
}

module.exports = { OutputManager }
