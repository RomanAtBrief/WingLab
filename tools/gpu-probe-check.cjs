const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const code=fs.readFileSync(path.join(__dirname,'../src/70-gpu-core.js'),'utf8');
const never=new Promise(()=>{});
const run=gpu=>vm.runInNewContext('(async()=>{'+code+';return G.probe();})()',{
 navigator:{gpu},location:{hash:''},setTimeout:fn=>setTimeout(fn,5),clearTimeout,console:{warn(){}},screen:{width:1200,height:800}
});
(async()=>{
 assert.equal(await run({requestAdapter:()=>never}),false,'hung adapter must use fallback');
 let destroyed=0;const adapter={features:new Set(),limits:{},requestDevice:()=>new Promise(resolve=>setTimeout(()=>resolve({destroy(){destroyed++;}}),20))};
 assert.equal(await run({requestAdapter:async()=>adapter}),false,'hung device must use fallback');
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(destroyed,1,'late GPU device must be released');
 console.log('GPU probe checks passed: bounded adapter/device waits and late-device cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;});
