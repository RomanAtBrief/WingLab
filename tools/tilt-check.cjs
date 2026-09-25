const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const make=()=>vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/66-tilt-input.js'),'utf8')+';TiltInput.create()');
function move(beta,gamma,angle=0){const t=make();t.sample(30,0,angle,0);t.sample(beta,gamma,angle,20);let v;for(let i=0;i<20;i++)v=t.step(.025,20+i*25);return {t,v};}
assert(move(30,20).v.roll>.5,'portrait roll responds');assert(Math.abs(move(30,1).v.roll)<.001,'small hand tremors ignored');assert(move(50,0).v.pull>.6,'pull back climbs');assert(move(10,0).v.pull<-.6,'tip forward dives');
assert(move(50,0,90).v.roll>.5,'landscape maps pitch into roll');assert(move(50,0,-90).v.roll<-.5,'opposite landscape reverses axis');
let {t}=move(50,20);t.recenter();assert.equal(t.step(.1,500).roll,0);assert.equal(t.step(.1,500).pull,0);
t.sample(50,20,90,510);assert.equal(t.step(.1,520).roll,0,'rotation recenters');assert.equal(t.step(.1,1200).fresh,false,'stale sensor levels input');assert.equal(t.step(.1,1200).roll,0);
assert.equal(t.sample(null,10,0,1300),false,'missing sensor values rejected');t.reset();assert.equal(t.step(.1,1400).fresh,false);
const upright=make();upright.sample(90,0,0,0);upright.sample(80,90,0,20);let u;for(let i=0;i<20;i++)u=upright.step(.025,20+i*25);assert(u.roll>.2&&u.roll<.5,'upright phone has proportional roll, not a saturated jump');
console.log('Tilt checks passed: portrait, both landscapes, dead zone, smoothing, recenter, rotation, stale input, absent sensor and reset.');
