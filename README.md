# Node-Cluster-Prime-Numbers
This project was built with an intent to generate Prime numbers and their hashes for further analysis
It currently utilizes node cluster to segregate tasks between different CPU Cores

## Start Project
1. npm install
2. npm start

## Parameters
Set the variable "maxNumber" in index.js to set the max number for finding primes and then calculating their hashes
Please provide whole numbers only.

## Performance
On a Core i7 machine with 4 Physical and 4 Virtual Cores, this code was able to scan(generate multiple hashes) upto 10,000,000 numbers in around 30 seconds 
