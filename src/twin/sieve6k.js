'use strict'
/**
 * N/6-Bit Segmented Twin Prime Sieve
 * =====================================
 * All twin prime pairs (p, p+2) > 5 have the form (6k-1, 6k+1).
 * Two compact bit arrays track compositeness:
 *   lo[k]=1  →  6k-1 is composite
 *   hi[k]=1  →  6k+1 is composite
 * Twin pair at k  ⟺  lo[k]=0 AND hi[k]=0
 *
 * Sieving: for each prime p ≥ 5:
 *   6k-1 ≡ 0 (mod p)  →  k ≡ 6⁻¹ (mod p),  step p
 *   6k+1 ≡ 0 (mod p)  →  k ≡ -6⁻¹ (mod p), step p
 * Start from p² (skip p itself, which is prime not composite).
 *
 * Optimisations:
 *   - 32KB L1-cache-friendly segments
 *   - No division in inner loop (pure integer addition)
 *   - Typed arrays for tight JIT-compiled loops
 *   - Popcount via parallel bit trick
 *   - worker_threads for multi-core parallelism
 */

const SEG_KSIZE = 262144
const SEG_WORDS = SEG_KSIZE >>> 5

function modInv6(p) {
  let [a,b,x,y]=[6,p,1,0]
  while(b){const q=(a/b)|0;[a,b]=[b,a-q*b];[x,y]=[y,x-q*y]}
  return((x%p)+p)%p
}

function popcount32(x) {
  x=x-((x>>>1)&0x55555555); x=(x&0x33333333)+((x>>>2)&0x33333333)
  x=(x+(x>>>4))&0x0f0f0f0f; return Math.imul(x,0x01010101)>>>24
}

function sieveTwinPrimes(limit) {
  const t0=Date.now()
  if(limit<4) return {count:0,elapsedMs:0}
  let count=(limit>=5)?1:0

  const sqrtN=Math.ceil(Math.sqrt(limit))+1
  const isComp=new Uint8Array(sqrtN)
  isComp[0]=isComp[1]=1
  for(let i=2;i*i<sqrtN;i++) if(!isComp[i]) for(let j=i*i;j<sqrtN;j+=i)isComp[j]=1

  const ps=[],slos=[],shis=[]
  for(let p=5;p<sqrtN;p++){
    if(isComp[p])continue
    const inv6=modInv6(p),neg6=inv6===0?0:p-inv6
    let slo=inv6===0?p:inv6; if(6*slo-1===p)slo+=p
    let shi=neg6===0?p:neg6; if(6*shi+1===p)shi+=p
    ps.push(p);slos.push(slo);shis.push(shi)
  }
  const nP=ps.length,psA=new Int32Array(ps),curL=new Int32Array(slos),curH=new Int32Array(shis)

  const kMax=Math.floor((limit-1)/6)
  const lo=new Uint32Array(SEG_WORDS),hi=new Uint32Array(SEG_WORDS)

  for(let ss=1;ss<=kMax;ss+=SEG_KSIZE){
    const se=Math.min(ss+SEG_KSIZE-1,kMax),sl=se-ss+1,wl=(sl+31)>>>5
    lo.fill(0,0,wl); hi.fill(0,0,wl)

    for(let i=0;i<nP;i++){
      const p=psA[i]
      let kl=curL[i]; while(kl<=se){const pos=kl-ss;lo[pos>>>5]|=1<<(pos&31);kl+=p} curL[i]=kl
      let kh=curH[i]; while(kh<=se){const pos=kh-ss;hi[pos>>>5]|=1<<(pos&31);kh+=p} curH[i]=kh
    }

    const lm=(sl&31)===0?0xFFFFFFFF:((1<<(sl&31))-1)>>>0
    for(let w=0;w<wl-1;w++) count+=popcount32(~(lo[w]|hi[w])>>>0)
    if(wl>0) count+=popcount32((~(lo[wl-1]|hi[wl-1])>>>0)&lm)
  }

  return {count,elapsedMs:Date.now()-t0}
}

async function sieveTwinPrimesParallel(limit, threads) {
  const {Worker}=require('worker_threads'), os=require('os')
  const nT=Math.min(threads||os.cpus().length,64)
  if(limit<=5e7||nT===1) return sieveTwinPrimes(limit)

  const t0=Date.now()
  const sqrtN=Math.ceil(Math.sqrt(limit))+1
  const isComp=new Uint8Array(sqrtN)
  isComp[0]=isComp[1]=1
  for(let i=2;i*i<sqrtN;i++) if(!isComp[i]) for(let j=i*i;j<sqrtN;j+=i)isComp[j]=1

  const primes=[],iLo=[],iHi=[]
  for(let p=5;p<sqrtN;p++){
    if(isComp[p])continue
    const inv6=modInv6(p),neg6=inv6===0?0:p-inv6
    let slo=inv6===0?p:inv6; if(6*slo-1===p)slo+=p
    let shi=neg6===0?p:neg6; if(6*shi+1===p)shi+=p
    primes.push(p);iLo.push(slo);iHi.push(shi)
  }

  const kMax=Math.floor((limit-1)/6),chunk=Math.ceil(kMax/nT)
  const wsrc=`
const{workerData:d,parentPort:P}=require('worker_threads')
const S=${SEG_KSIZE},W=${SEG_WORDS}
function i6(p){let[a,b,x,y]=[6,p,1,0];while(b){const q=(a/b)|0;[a,b]=[b,a-q*b];[x,y]=[y,x-q*y];}return((x%p)+p)%p}
function pop(x){x=x-((x>>>1)&0x55555555);x=(x&0x33333333)+((x>>>2)&0x33333333);x=(x+(x>>>4))&0x0f0f0f0f;return Math.imul(x,0x01010101)>>>24}
const{kLo,kHi,ps,kL,kH}=d,nP=ps.length,cL=new Int32Array(kL),cH=new Int32Array(kH)
const lo=new Uint32Array(W),hi=new Uint32Array(W)
let c=0
for(let ss=kLo;ss<=kHi;ss+=S){
  const se=Math.min(ss+S-1,kHi),sl=se-ss+1,wl=(sl+31)>>>5
  lo.fill(0,0,wl);hi.fill(0,0,wl)
  for(let i=0;i<nP;i++){const p=ps[i];let kl=cL[i];while(kl<=se){const pos=kl-ss;lo[pos>>>5]|=1<<(pos&31);kl+=p}cL[i]=kl;let kh=cH[i];while(kh<=se){const pos=kh-ss;hi[pos>>>5]|=1<<(pos&31);kh+=p}cH[i]=kh}
  const lm=(sl&31)===0?0xFFFFFFFF:((1<<(sl&31))-1)>>>0
  for(let w=0;w<wl-1;w++)c+=pop(~(lo[w]|hi[w])>>>0)
  if(wl>0)c+=pop((~(lo[wl-1]|hi[wl-1])>>>0)&lm)
}
P.postMessage(c)
`

  const workers=[]
  for(let t=0;t<nT;t++){
    const kLo=t*chunk+1,kHi=Math.min((t+1)*chunk,kMax)
    if(kLo>kMax)break
    const kL=new Int32Array(primes.length),kH=new Int32Array(primes.length)
    for(let i=0;i<primes.length;i++){
      const p=primes[i]
      let sl=iLo[i]; if(sl<kLo)sl+=Math.ceil((kLo-sl)/p)*p
      let sh=iHi[i]; if(sh<kLo)sh+=Math.ceil((kLo-sh)/p)*p
      kL[i]=sl;kH[i]=sh
    }
    workers.push(new Promise((res,rej)=>{
      const w=new Worker(wsrc,{eval:true,workerData:{kLo,kHi,ps:new Int32Array(primes),kL,kH}})
      w.on('message',res);w.on('error',rej)
    }))
  }

  const results=await Promise.all(workers)
  return{count:results.reduce((a,b)=>a+b,(limit>=5)?1:0),elapsedMs:Date.now()-t0}
}

module.exports={sieveTwinPrimes,sieveTwinPrimesParallel,modInv6,popcount32}
