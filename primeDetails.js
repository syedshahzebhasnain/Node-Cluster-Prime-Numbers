const CryptoJS = require('crypto-js')
const fs = require('fs-extra')
module.exports = {
    async begin(start, end) {
        try {
            var startTime = new Date().getTime();
            let primeNumDetails = []
            for (let i = +start; i <= +end; i++) {
                if (this.isPrime(i) === true) {
                    let sstring = i.toString()
                    let add = {
                        Number: i,
                        sha1: CryptoJS.SHA1(sstring).toString().replace(/\D/g, '').toString(),
                        sha2: CryptoJS.SHA3(sstring).toString().replace(/\D/g, '').toString(),
                        sha256: CryptoJS.SHA256(sstring).toString().replace(/\D/g, '').toString(),
                        sha384: CryptoJS.SHA384(sstring).toString().replace(/\D/g, '').toString(),
                        sha512: CryptoJS.SHA512(sstring).toString().replace(/\D/g, '').toString(),
                        md5: CryptoJS.MD5(sstring).toString().replace(/\D/g, '').toString()
                    }
                    primeNumDetails.push(add)
                }
            }
            fs.writeFileSync(process.env.start + '.txt', JSON.stringify(primeNumDetails))
            var endTime = new Date().getTime();
            var time = endTime - startTime;
            console.log('Execution time: ' + start + '  --  ' + end + ': ' + time);
        } catch (err) {
            console.log(err)
        }
    },
    isPrime(num) {
        for (let i = 2, s = Math.sqrt(num); i <= s; i++)
            if (num % i === 0) return false;
        return num !== 1 && num !== 0;
    }
}