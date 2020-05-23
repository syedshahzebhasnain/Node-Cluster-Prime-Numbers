// Max number to find Primes
let maxNumber = 1000000
require('dotenv').config()

// Initialize cluster
var cluster = require('cluster')
const numCPU = require('os').cpus().length

if (cluster.isWorker) {
  // Load prime library
  const primeCalc = require('./primeDetails.js')
  primeCalc.GetPrimeAndWriteToFile(process.env.start, process.env.end)
  process.exit()
} else {
  // Ensuring numbers are always a multiple of 2
  // Split into workers based on the max number
  if (maxNumber % 2 === 1) maxNumber++
  const bracket = maxNumber / numCPU
  for (let i = 0; i < numCPU; i++) {
    let multiplier = i
    var envPass = { start: bracket * multiplier, end: (bracket * ++multiplier) - 1 }
    cluster.fork(envPass)
  }
}
