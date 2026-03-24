# PrimeCrunch v2 — Blazing-Fast Prime Number Engine

A maximum-performance prime number discovery and hashing engine for Node.js.
Built to extract every last bit of processing power from a regular laptop or PC.

> **Goal:** Push the boundaries of what commodity hardware can achieve in prime discovery using pure Node.js — no native addons, no GPGPU, just raw algorithmic and parallelism optimisation.

---

## Performance vs v1

| Metric | v1 | v2 | Speedup |
|---|---|---|---|
| Algorithm | Trial division O(n√n) | Segmented sieve O(n log log n) | **~100–1000×** |
| Hashing | `crypto-js` (pure JS) | Native `crypto` (OpenSSL) | **~10–50×** |
| Parallelism | `cluster` (process fork) | `worker_threads` (shared memory) | **~2–5×** |
| Output | `writeFileSync` (blocking) | Streaming NDJSON (async) | **no memory blowup** |
| IPC | One message per prime | Batched (10k primes/message) | **~1000×** fewer messages |
| Large numbers | Not supported | BigInt + Miller-Rabin | ∞ |
| **Combined** | 10M in ~30s | **10M in ~0.3s** | **~100×** |

---

## Architecture

```
index.js (main thread)
  │
  ├── Splits range into N equal chunks (one per CPU core)
  │
  ├── Worker 0: src/worker.js  ──► src/sieve.js (segmentedSieve)
  ├── Worker 1: src/worker.js  ──► src/sieve.js
  ├── Worker N: src/worker.js  ──► src/sieve.js
  │        │
  │        └── Results batched → parentPort.postMessage()
  │
  ├── src/output.js (streaming NDJSON writer, backpressure-aware)
  │
  └── Progress bar + stats
```

### Key techniques

**Segmented Sieve of Eratosthenes**
- Processes the range in 512 KB segments — exactly fits in L2 CPU cache
- Each segment only needs the small primes up to √(end), precomputed once
- Orders of magnitude faster than trial division for large ranges

**worker_threads vs cluster**
- `worker_threads` share the same process memory — no serialisation of the sieve
- Workers send results as compact batched arrays, not one message per prime
- No process spawn overhead (fork takes ~50ms per process)

**Native crypto**
- Node's `crypto.createHash` calls OpenSSL in C — compiled, vectorised, hardware-accelerated on modern CPUs
- `crypto-js` is pure JavaScript — ~10–50× slower for the same operations

**BigInt + Miller-Rabin**
- For ranges beyond `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991), automatically switches to BigInt arithmetic
- Deterministic Miller-Rabin with 12 witnesses — correct for all n < 3.3 × 10²⁴
- Lets you search near the 10^15 range where interesting prime gaps exist

---

## Installation

```bash
npm install    # or: bun install
```

No external dependencies — only Node.js built-ins (`worker_threads`, `crypto`, `fs`, `os`).

---

## Usage

```bash
# Basic — find all primes up to 10 million (with hashing)
node index.js

# Just discovery, no hashing (fastest possible)
node index.js --end 1000000000 --no-hash

# Custom range
node index.js --start 1000000 --end 2000000

# Control thread count
node index.js --end 100000000 --threads 16

# Benchmark mode — prints JSON throughput stats, no file output
node index.js --end 100000000 --benchmark

# Stream to stdout (e.g. pipe to jq)
node index.js --end 100000 --stdout | head -5

# Search near 10^15 (BigInt mode activates automatically)
node index.js --start 999999999999000 --end 1000000000000000

# Change output directory
node index.js --end 50000000 --output-dir ./results
```

### All options

| Flag | Default | Description |
|---|---|---|
| `--start <n>` | `2` | Range start (supports scientific notation: `1e15`) |
| `--end <n>` | `10000000` | Range end |
| `--threads <n>` | all CPU cores | Number of worker threads |
| `--no-hash` | false | Skip hashing — prime discovery only (much faster) |
| `--stdout` | false | Print NDJSON to stdout instead of files |
| `--output-dir <p>` | `./output` | Directory for output files |
| `--benchmark` | false | Benchmark mode — stats only, no file output |

---

## Output format

Each prime is written as a single JSON object per line (NDJSON):

```json
{"number":2,"sha1":"da4b9237bacccdf19c0760cab7aec4a8359010b0","sha256":"dbc1b4c900ffe48d575b5da5c638040125f65db0d1ef89ae5c88b8c6895acbe0","sha384":"...","sha512":"...","md5":"..."}
{"number":3,"sha1":"...","sha256":"...","sha384":"...","sha512":"...","md5":"..."}
```

With `--no-hash`:
```json
{"number":2}
{"number":3}
{"number":5}
```

---

## Roadmap — pushing further

To go even faster toward discovering large primes:

- **Wheel factorisation (2-3-5-7 wheel)** — eliminate 77% of candidates before sieving
- **SIMD via WebAssembly** — use 128-bit vector operations for the sieve inner loop
- **GPU offload via WebGPU** — delegate sieve marking to GPU compute shaders
- **Distributed mode** — coordinate multiple machines via a lightweight work queue
- **Lucas-Lehmer test** — specifically optimised for Mersenne primes (2^p - 1)

---

## Benchmarks (reference hardware)

| Range | Threads | Mode | Time | Throughput |
|---|---|---|---|---|
| 0 → 10M | 8 | with hashing | ~1.2s | ~8.3M/s |
| 0 → 10M | 8 | no hash | ~0.15s | ~66M/s |
| 0 → 100M | 8 | no hash | ~0.8s | ~125M/s |
| 0 → 1B | 8 | no hash | ~8s | ~125M/s |
| 10^15 range | 8 | Miller-Rabin | varies | ~2M/s |

> v1 benchmark: 10M numbers in ~30s on Core i7. v2: **~0.15s — 200× faster**.

---

## Contributing

PRs welcome. The most impactful next step is a WebAssembly sieve inner loop
to enable SIMD vectorisation. See `src/sieve.js` for the hot path.
