const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../src/65-flight-director.js'),'utf8');
const fresh=()=>vm.runInNewContext(src+';FlightDirector');
const route=Array.from({length:100},(_,i)=>({x:i*100,z:0}));route.periodX=10000;
let f=fresh();f.configure('canyon',route,180);
for(let i=0;i<3600*30;i++)f.step(1/30,105,12);
assert(f.state.x>100000,'continuous river wraps advance through the next tile');assert(Math.abs(f.state.z)<.01);assert(Math.abs(f.state.heading)<.01);
const before={...f.state};f.setMode('manual');assert.equal(f.state.x,before.x);assert.equal(f.state.alt,before.alt);
f.key('ArrowRight',true);f.key('ArrowUp',true);for(let i=0;i<60;i++)f.step(1/30,105,12);assert(f.state.heading>.2,'banking builds a coordinated right turn');assert(f.state.bank>.6,'right turn banks right');assert(f.state.alt>before.alt+10);
f.clearKeys();const h=f.state.heading;for(let i=0;i<240;i++)f.step(1/30,105,12);assert(Math.abs(f.state.heading-h)<.5,'released controls coast into a stable heading');assert(Math.abs(f.state.bank)<.002&&Math.abs(f.state.pitch)<.002,'level assist settles smoothly');
const stopped=JSON.stringify(f.state);f.step(0,105,12);assert.equal(JSON.stringify(f.state),stopped,'pause freezes navigation');
f.setMode('auto');assert(Math.hypot(f.state.x-before.x,f.state.z-before.z)<900,'mode switch never teleports');
f=fresh();f.configure('islands',route,1500);let min=Infinity,max=0,phases=new Set();for(let i=0;i<360*30;i++){f.step(1/30,105,12);min=Math.min(min,f.state.alt);max=Math.max(max,f.state.alt);phases.add(f.state.phase);}assert(min<200&&max>1400);assert(phases.has('Island channels')&&phases.has('Through the clouds'));
f.configure('islands',route,550);f.setMode('manual');f.setAltitude(30);let assisted=false;for(let i=0;i<900;i++){f.step(1/30,105,12,()=>500);assisted ||= f.state.clearance;assert(f.state.alt>=535,'terrain floor is maintained throughout descent');}assert(assisted,'terrain assistance engages during descent');
f.key('ArrowLeft',true);f.key('ArrowDown',true);f.setMode('auto');const alt=f.state.alt;for(let i=0;i<600;i++){f.step(1/30,105,60,()=>400);assert(Object.values(f.state).filter(v=>typeof v==='number').every(Number.isFinite));assert(f.state.alt>=451);assert(Math.abs(f.state.bank)<=.44);}
console.log('Navigation checks passed: 60-minute river loop, smooth mode switch, manual turn/climb, key release, pause, island descent/cloud cycle, terrain clearance.');
// Verify the actual generated canyon path, including its periodic seam.
const terrain=fs.readFileSync(path.join(__dirname,'../src/74-gpu-terrain.js'),'utf8');
const riverCode=terrain.slice(terrain.indexOf('  function rng('),terrain.indexOf('  // exact-ish Euclidean'));
const routeCode=terrain.slice(terrain.indexOf('  function scenicRoute()'),terrain.indexOf('  return { init, setPlace'));
const actual=vm.runInNewContext(riverCode+'\nconst place={id:1,tile:24576};const R={river:mainRiver(24576,.5,23)};'+routeCode+';scenicRoute()');
f=fresh();f.configure('canyon',actual,180);let maxError=0;
for(let i=0;i<1200*30;i++){f.step(1/30,105,12);if(i%30===0){let best=Infinity;for(const p of actual){const dx=f.state.x-p.x;const periodic=dx-Math.round(dx/24576)*24576;best=Math.min(best,Math.hypot(periodic,f.state.z-p.z));}maxError=Math.max(maxError,best);}}
assert(maxError<100,`river tracking deviation ${maxError}m`);console.log(`20-minute generated-river test: maximum distance to sampled centreline ${maxError.toFixed(1)} m.`);

// Input inertia, throttle response, dives, opposite inputs, and frame-rate independence.
function manoeuvre(hz){const f=fresh();f.configure('islands',route,1500);f.setMode('manual');f.setThrottle(.5);f.key('ArrowRight',true);f.key('ArrowUp',true);for(let i=0;i<hz*3;i++)f.step(1/hz,105,12);return {...f.state};}
const s30=manoeuvre(30),s60=manoeuvre(60);assert(Math.abs(s30.heading-s60.heading)<.025);assert(Math.abs(s30.alt-s60.alt)<1.5);
f=fresh();f.configure('islands',route,1500);f.setMode('manual');f.setThrottle(.2);f.key('w',true);for(let i=0;i<150;i++)f.step(1/30,105,12);assert.equal(f.state.throttle,1);assert(f.state.speed>50);f.clearKeys();
f.key('ArrowDown',true);const high=f.state.alt;for(let i=0;i<90;i++)f.step(1/30,105,12);assert(f.state.alt<high-20);assert(f.state.pitch<-.3);assert(f.state.elevator<0);
f.clearKeys();f.key('ArrowLeft',true);f.key('ArrowRight',true);for(let i=0;i<180;i++)f.step(1/30,105,12);assert(Math.abs(f.state.bank)<.01,'opposite roll inputs cancel');
const unchanged={...f.state};f.setMode('auto');for(const k of ['x','z','alt','heading','bank','pitch'])assert.equal(f.state[k],unchanged[k],'switch preserves pose');
console.log('Game controls passed: roll/pitch inertia, coordinated turns, throttle, dives, release-to-level, opposing keys, 30/60 Hz consistency.');
// A tight bend with real cliffs: clearance must follow the river, not a ray into its outer wall.
const bend=Array.from({length:160},(_,i)=>({x:120*Math.cos(i/160*Math.PI*2),z:120*Math.sin(i/160*Math.PI*2)}));
f=fresh();f.configure('canyon',bend,125);let highest=0;
for(let i=0;i<120*30;i++){f.step(1/30,105,12,(x,z)=>Math.abs(Math.hypot(x,z)-120)>65?300:-12);highest=Math.max(highest,f.state.alt);}
assert(highest<150,'river-following clearance stays inside a tight canyon instead of climbing over its walls');
f=fresh();f.configure('islands',route,1500);f.setMode('manual');f.key('ArrowDown',true);for(let i=0;i<10*30;i++)f.step(1/30,105,12);assert(f.state.alt<1200,'held dive loses at least 300m in 10 seconds');
f.clearKeys();f.setStick(.7,-.5);for(let i=0;i<90;i++)f.step(1/30,105,12);assert(f.state.bank>.4&&f.state.pitch<-.2,'analog tilt controls bank and pitch');f.clearKeys();for(let i=0;i<180;i++)f.step(1/30,105,12);assert(Math.abs(f.state.bank)<.01,'clearing input also releases the stick');
console.log(`Tight canyon clearance passed (max altitude ${highest.toFixed(1)}m), faster descent and analog stick release passed.`);
