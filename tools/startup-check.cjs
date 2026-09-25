const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const code=fs.readFileSync(path.join(__dirname,'../src/80-facade.js'),'utf8');
(async()=>{
 let destroyed=0,replaced=0,cleared=0,glStarted=0;
 const host={querySelector:()=>({cloneNode:()=>({}),replaceWith:()=>replaced++})},labels={replaceChildren:()=>cleared++};
 const result=await vm.runInNewContext('(async()=>{'+code+';initFlightScene(host,labels,{});return Scene3D===Scene3DGL;})()',{
 G:{probe:async()=>true,S:{device:{destroy:()=>destroyed++}}},Scene3DGPU:{gpu:true,init(){throw new Error('simulated device initialization failure');}},Scene3DGL:{init(){glStarted++;}},EnvGPU:{},EnvGL:{},host,labels,console:{warn(){},info(){}}
 });
 assert(result);assert.equal(destroyed,1);assert.equal(replaced,1);assert.equal(cleared,1);assert.equal(glStarted,1);
 console.log('Startup recovery passed: failed GPU initialization replaces the canvas and starts WebGL without reloading.');
})().catch(e=>{console.error(e);process.exitCode=1;});
