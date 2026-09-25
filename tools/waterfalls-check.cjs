const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const mod=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/76-waterfalls.js'),'utf8')+';GWaterfalls');
const n=36000,river={n,px:new Float32Array(n),pz:new Float32Array(n),tx:new Float32Array(n).fill(1),tz:new Float32Array(n),cv:new Float32Array(n)};
for(let i=0;i<n;i++)river.px[i]=i*2;
const height=(x,z)=>Math.abs(z)<96?-8:Math.abs(z)<150?6:Math.abs(z)<185?(Math.abs(z)-150)*4:146;
const falls=mod.buildCascades(river,height);assert(falls.length>0);for(const f of falls){assert(f.points[0].y>80);assert(f.points.at(-1).y<3);for(const p of f.points){assert(Object.values(p).every(Number.isFinite));assert(p.y>=height(p.x,p.z),'water ribbon stays above terrain');}}
assert.equal(mod.buildCascades(river,()=>0).length,0,'no floating waterfalls over flat water');
console.log(`Waterfall checks passed: ${falls.length} grounded cascades, river endpoints, finite geometry and flat-terrain rejection.`);
