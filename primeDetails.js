// Load libraries
const CryptoJS = require('crypto-js')
const fs = require('fs-extra')

module.exports = {

    // Main function to start the process.
    async GetPrimeAndWriteToFile(start, end) {
        try {
            var startTime = new Date().getTime();
            let primeNumDetails = []
            for (let i = +start; i <= +end; i++) {
                if (this.IsPrime(i) === true) {
                    primeNumDetails.push(this.GenerateHashes(i))
                }
            }
            this.WriteTofile(primeNumDetails);
            this.CheckExecutionTime(startTime, start, end)
        } catch (err) {
            console.log(err)
        }
    },

    // Generate hashes for the provided number
    GenerateHashes(i) {
        let sstring = i.toString()
        let hashes = {
            Number: i,
            sha1: CryptoJS.SHA1(sstring).toString().replace(/\D/g, '').toString(),
            sha2: CryptoJS.SHA3(sstring).toString().replace(/\D/g, '').toString(),
            sha256: CryptoJS.SHA256(sstring).toString().replace(/\D/g, '').toString(),
            sha384: CryptoJS.SHA384(sstring).toString().replace(/\D/g, '').toString(),
            sha512: CryptoJS.SHA512(sstring).toString().replace(/\D/g, '').toString(),
            md5: CryptoJS.MD5(sstring).toString().replace(/\D/g, '').toString()
        }
        return hashes;
    },

    // Check for prime number
    IsPrime(num) {
        for (let i = 2, s = Math.sqrt(num); i <= s; i++)
            if (num % i === 0) return false;
        return num !== 1 && num !== 0;
    },

    // Write to file
    WriteTofile(primeNumDetails) {
        fs.writeFileSync(process.env.start + '.txt', JSON.stringify(primeNumDetails))
    },

    // Check execution time
    CheckExecutionTime(startTime, startNumber, endNumber) {
        var endTime = new Date().getTime();
        var time = endTime - startTime;
        console.log('Execution time: ' + startNumber + '  --  ' + endNumber + ': ' + time);
    }
}