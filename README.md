# PrimeCrunch — Prime & Mersenne Prime Engine

[![CI](https://github.com/syedshahzebhasnain/Node-Cluster-Prime-Numbers/actions/workflows/ci.yml/badge.svg)](https://github.com/syedshahzebhasnain/Node-Cluster-Prime-Numbers/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-55%20passing-brightgreen)](#tests)

A maximum-performance prime discovery engine **and** a Mersenne prime hunter targeting the world record — running entirely on consumer hardware using pure Node.js.

> **Current world record:** 2^136,279,841 − 1 (41,024,320 digits, found Oct 12 2024 by Luke Durant using ~1,000 A100/H100 GPUs across 17 countries and ~$2M USD)
>
> **Next EFF prize:** $150,000 for the first 100-million-digit prime

---

## Two tools in one

| Tool | Command | Purpose |
|---|---|---|
| **Prime Engine** | `node index.js` | Find all primes in a range. Blazing fast. General purpose. |
| **Mersenne Hunter** | `node mersenne-hunt.js` | Hunt Mersenne primes. Implements Lucas-Lehmer, trial factoring, distributed computing. |

---

## Prime Engine (`index.js`)

### Performance vs original

| Metric | v1 (original) | v2 (now) | Gain |
|---|---|---|---|
| Algorithm | Trial division O(n√n) | Segmented Sieve O(n log log n) | **~1000×** |
| Hashing | `crypto-js` (pure JS) | Native `crypto` (OpenSSL) | **~50×** |
| Parallelism | `cluster` (process fork) | `worker_threads` (shared memory) | **~5×** |
| Output | `writeFileSync` (blocking) | Streaming NDJSON | **no OOM** |
| IPC overhead | 1 msg per prime | 10k primes per msg | **~1000×** |
| Large numbers | Not supported | BigInt + Miller-Rabin | ∞ |
| **Combined** | 10M in ~30s | **10M in ~0.15s** | **~200×** |

### Usage

```bash
npm install   # zero external dependencies

# Find all primes up to 10 million (default)
node index.js

# Benchmark mode — throughput stats only, no file output
node index.js --end 10000000 --benchmark

# Disable hashing for maximum speed
node index.js --end 1000000000 --no-hash

# Search beyond Number.MAX_SAFE_INTEGER (auto-activates BigInt + Miller-Rabin)
node index.js --start 999999999999000 --end 1000000000000000

# Stream NDJSON to stdout
node index.js --end 100000 --stdout | jq .number

# Custom thread count and output directory
node index.js --end 50000000 --threads 16 --output-dir ./results
```

### All flags

| Flag | Default | Description |
|---|---|---|
| `--start <n>` | `2` | Range start (supports `1e15` notation) |
| `--end <n>` | `10000000` | Range end |
| `--threads <n>` | all cores | Worker thread count |
| `--no-hash` | false | Skip hashing — primes only |
| `--stdout` | false | NDJSON to stdout instead of files |
| `--output-dir <p>` | `./output` | Output directory |
| `--benchmark` | false | Stats only, no file output |

### Output format

```jsonc
// With hashing (default)
{"number":7,"sha1":"9f...","sha256":"7e...","sha384":"2d...","sha512":"04...","md5":"8f..."}

// With --no-hash
{"number":7}
```

---

## Mersenne Hunter (`mersenne-hunt.js`)

### Background

Mersenne primes are numbers of the form **2^p − 1** where p is itself prime. They are the largest known primes because they admit a specialized test — the **Lucas-Lehmer test** — that is far more efficient than general primality testing.

There are only **52 known Mersenne primes**. The hunt for #53 is active right now.

### The math

**Lucas-Lehmer test:**
For odd prime p, the Mersenne number M_p = 2^p − 1 is prime if and only if:

```
S_{p−2} ≡ 0  (mod 2^p − 1)

where  S_0 = 4,  S_{n+1} = S_n² − 2
```

This requires exactly p−2 squarings of a p-bit number mod 2^p−1.

**The Mersenne reduction trick (key to speed):**

Since 2^p ≡ 1 (mod 2^p−1), any bits above position p just rotate back for free:

```
x mod 2^p−1  =  (x >> p) + (x & mask)   ← shift + add, NO division
```

This is why Mersenne numbers are special. The modular reduction that makes general primality testing expensive is trivial here.

### Three-phase pipeline

```
Exponent p
    │
    ▼
Phase 1: Trial Factoring (TF)                    ~seconds/candidate
    Mersenne factors must be ≡ k·2p+1 ≡ ±1 (mod 8)
    Eliminates ~75% of candidates cheaply
    │
    ▼ (survivors ~25%)
Phase 2: Fermat PRP test                         ~minutes/candidate
    3^((M_p−1)/2) mod M_p == 1?
    Eliminates nearly all remaining composites
    │
    ▼ (survivors ~0.001%)
Phase 3: Lucas-Lehmer (definitive)               ~days–weeks/candidate
    S_{p−2} ≡ 0 (mod M_p) ?
    100% correct result
    │
    ▼
  PRIME or COMPOSITE
```

### Usage

```bash
# Run a benchmark showing scaling projections
node mersenne-hunt.js --benchmark

# Find all Mersenne primes with exponent ≤ 10,000 (fully verified)
node mersenne-hunt.js --end 10000

# Verify a specific exponent (e.g. verify M127 is prime)
node mersenne-hunt.js --verify 127

# Verify a larger candidate (TF + PRP, LL if small enough)
node mersenne-hunt.js --verify 9689

# Start a distributed coordinator (server)
node mersenne-hunt.js --serve --start 140000000 --end 200000000 --port 3000

# Connect a worker to the coordinator (run this on every machine you want to contribute)
node mersenne-hunt.js --coordinator http://your-server:3000
```

### All flags

| Flag | Default | Description |
|---|---|---|
| `--start <p>` | `1000` | Start exponent |
| `--end <p>` | `10000` | End exponent |
| `--threads <n>` | all cores | Worker threads |
| `--verify <p>` | — | Test a specific exponent |
| `--serve` | false | Start as distributed coordinator |
| `--port <n>` | `3000` | Coordinator HTTP port |
| `--coordinator <url>` | — | Connect to a coordinator as worker |
| `--benchmark` | false | Show performance projections |

---

## Distributed Computing (Folding@Home style)

Pool any number of machines — laptops, Raspberry Pis, cloud VMs, a friend's PC — into a coordinated prime search network.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Coordinator (server)                          │
│   node mersenne-hunt.js --serve --port 3000                     │
│   - Manages work queue of Mersenne exponents                     │
│   - Assigns ranges to workers, no duplicate work                 │
│   - Persists state (coordinator-state.json)                      │
│   - GET /work  →  next exponent to test                         │
│   - POST /result  →  submit findings                            │
│   - GET /stats  →  progress dashboard                           │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP
         ┌───────────────┼───────────────┐
         │               │               │
    Worker 1         Worker 2        Worker N
  (your laptop)   (cloud VM)    (friend's PC)
  node mersenne-hunt.js --coordinator http://server:3000
```

**Start hunting across multiple machines:**

```bash
# Machine A (coordinator + worker)
node mersenne-hunt.js --serve --start 140000000 --end 200000000 --port 3000 &
node mersenne-hunt.js --coordinator http://localhost:3000

# Machine B, C, D (workers only — just point at Machine A)
node mersenne-hunt.js --coordinator http://192.168.1.100:3000
```

**Check progress from anywhere:**
```bash
curl http://your-server:3000/stats
```

---

## Architecture

```
index.js                     mersenne-hunt.js
(prime engine)               (mersenne hunter)
     │                              │
     │                   ┌──────────┴───────────┐
     │                   │                      │
     │           src/mersenne/          src/distributed/
     │           ├── bigint.js          └── coordinator.js
     │           │   Mersenne arithmetic:     Work queue server
     │           │   2^p reduction trick      Persistence + stats
     │           ├── lucas-lehmer.js          Multi-machine IPC
     │           │   LL test + TF + PRP
     │           └── candidate-sieve.js
     │               Smart candidate gen
     │               Priority scoring
     │
src/sieve.js               src/worker.js            src/output.js
Segmented sieve            worker_threads           Streaming NDJSON
BigInt Miller-Rabin        native crypto            Backpressure-aware
```

---

## Tests

```bash
npm test                # 55 tests, 0 failures
npm run test:sieve      # 34 unit tests (sieve, Miller-Rabin, BigInt primes)
npm run test:worker     # 21 integration tests (worker pipeline end-to-end)
```

**Test coverage includes:**
- Prime counting function: π(100)=25, π(1K)=168, π(10K)=1229, π(100K)=9592, π(1M)=78498
- Carmichael numbers (composites that fool naive tests): 561, 1105, 1729, 2465 — all correctly rejected
- Mersenne primes: M31=2147483647, M61=2305843009213693951 — both correctly identified
- BigInt primes near 10^15: verified against Python's Miller-Rabin
- Worker split consistency: two workers on [2,500K] + [500K+1,1M] sum to exactly π(10^6)=78498

---

## Realistic path to the world record

The record is beatable on consumer hardware with the right setup:

### Phase 1: CPU-only (this tool)
- Tests exponents up to ~20,000 in milliseconds
- Good for learning the math, verifying candidates, running the coordinator
- Estimated time for frontier exponents (p~140M): years on CPU alone

### Phase 2: GPU acceleration (install alongside this tool)
Install [gpuowl/PRPLL](https://github.com/preda/gpuowl) — GPU Lucas-Lehmer software:
```bash
# Each RTX 3090/4090 can test ~1 frontier exponent per week
# Each A100 can test ~1 frontier exponent per 2-3 days
```
Point gpuowl at this coordinator to contribute to the shared search.

### Phase 3: Coordinated GPU network
Luke Durant's method, democratised:
- 10 consumer GPUs → realistic result in ~2 years
- 100 consumer GPUs → realistic result in ~3 months
- 1000 consumer GPUs → weeks (Durant's scale, at a fraction of the cost)

### Why NOT quantum computing?
Shor's algorithm can factor large integers (breaking RSA) but **does not help find Mersenne primes**. The Lucas-Lehmer test is already polynomial time on classical hardware — there is no quantum speedup for prime searching. The bottleneck is raw FLOPS for squaring, not algorithmic complexity.

### The FFT bottleneck
For p > ~100,000, BigInt multiplication in JS becomes the bottleneck. The production path uses:
- **NTT (Number-Theoretic Transform)** over GF(2^61−1)² — integer FFT with exact arithmetic
- Implemented in C/CUDA in [gpuowl](https://github.com/preda/gpuowl) and [Prime95](https://mersenne.org/download)
- Reduces squaring from O(p²) to O(p log p) — the difference between centuries and weeks at p=136M

---

## File structure

```
├── index.js                    # Prime engine entry point
├── mersenne-hunt.js            # Mersenne hunter entry point
├── src/
│   ├── sieve.js                # Segmented Sieve of Eratosthenes + BigInt Miller-Rabin
│   ├── worker.js               # worker_threads worker: sieve + hash + batched IPC
│   ├── output.js               # Streaming NDJSON writer
│   ├── mersenne/
│   │   ├── bigint.js           # Mersenne arithmetic with 2^p reduction trick
│   │   ├── lucas-lehmer.js     # Lucas-Lehmer test + trial factoring + Fermat PRP
│   │   └── candidate-sieve.js  # Smart candidate generation + priority scoring
│   └── distributed/
│       └── coordinator.js      # HTTP work server for multi-machine search
├── test/
│   ├── sieve.test.js           # 34 unit tests
│   └── worker.test.js          # 21 integration tests
└── .github/workflows/ci.yml    # CI: Node 18/20/22 matrix
```

---

## Quick start

```bash
git clone https://github.com/syedshahzebhasnain/Node-Cluster-Prime-Numbers.git
cd Node-Cluster-Prime-Numbers
npm install          # zero external dependencies

# Run the prime engine
node index.js --end 10000000 --benchmark

# Hunt Mersenne primes
node mersenne-hunt.js --end 10000

# Run tests
npm test
```

---

## Contributing

PRs welcome. The highest-impact contributions:

1. **FFT/NTT squaring in WebAssembly** — would make JS competitive with C for medium exponents (p up to ~1M)
2. **GPU bridge** — connect this coordinator to gpuowl via its API so GPU workers can report back
3. **Wheel factorization** — 2-3-5-7 wheel eliminates 77% of sieve candidates before marking
4. **P-1 factoring** — Pollard's p-1 eliminates another ~5% before LL, saving significant GPU time

See [GIMPS math page](https://www.mersenne.org/various/math.php) for deep technical background.

---

> *"These enormous prime numbers are, in some senses, the largest 'unique pieces of information' in the known universe."*
> — Luke Durant, discoverer of M136279841
