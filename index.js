// Max number to find Primes
let maxNumber = 1000000
require('dotenv').config()
    // Initialize cluster
var cluster = require('cluster')
const numCPU = require('os').cpus().length
    // Set maxNumber to find prime

if (cluster.isWorker) {
    const primeCalc = require('./primeDetails.js')
    primeCalc.begin(process.env.start, process.env.end)
    process.exit()
} else {
    if (maxNumber % 2 === 1) maxNumber++ // Ensuring numbers are always a multiple of 2
        const bracket = maxNumber / numCPU
    for (let i = 0; i < numCPU; i++) {
        let multiplier = i
        var envPass = { start: bracket * multiplier, end: (bracket * ++multiplier) - 1 }
        cluster.fork(envPass)
    }
}