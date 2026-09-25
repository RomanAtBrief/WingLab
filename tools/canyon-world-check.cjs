const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const read=n=>fs.readFileSync(path.join(__dirname,'../src/',n),'utf8');
const Empty=class{};
const ctx=vm.createContext({innerWidth:1280,THREE:{Group:Empty,MeshDepthMaterial:Empty,PerspectiveCamera:Empty,Matrix4:Empty}});
vm.runInContext(read('44-waterfall-field.js')+read('46-canyon-world.js')+read('65-flight-director.js')+';this.CW=CanyonWorld;this.FD=FlightDirector;this.WF=WaterfallField;',ctx);
const {CW,FD,WF}=ctx;
for(const f of CW.falls){
 const h=CW.height(f.x+f.nx*338,f.z+f.nz*338);assert(h>220,'brink must be attached to a tall cliff');
 assert(CW.height(f.x+f.nx*f.end,f.z+f.nz*f.end)<0,'impact falls into a real water basin');
 for(let t=.08;t<1;t+=.04){const y=(h+3)*(1-t*t),d=338+(f.end-338)*t;assert(y>CW.height(f.x+f.nx*d,f.z+f.nz*d),'curtain clears the rock behind it');}
}
const route=[];for(let i=0;i<180;i++){const x=i/180*14000+250,p={x,z:CW.river(x)};for(const f of CW.falls){const a=255*Math.exp(-(((x-f.x)/360)**2));p.x+=f.nx*a;p.z+=f.nz*a;}route.push(p);}route.periodX=14000;
let encounters=0;
for(const size of [10,13,36,61]){
 FD.configure('canyon',route,180);FD.setMode('auto');let entered=false;
 for(let n=0;n<6000;n++){
  const p=FD.step(1/30,120,size,CW.height);assert(Number.isFinite(p.alt));assert(p.alt>=Math.max(0,CW.height(p.x,p.z))+Math.max(35,size*.85)-.1,'terrain clearance');
  const f=CW.falls[0],dx=p.x-f.x,dz=p.z-f.z,along=dx*f.nz-dz*f.nx,across=dx*f.nx+dz*f.nz,H=CW.height(f.x+f.nx*338,f.z+f.nz*338)+3,curve=338+(f.end-338)*Math.sqrt(Math.max(0,1-p.alt/H));
  if(Math.abs(along)<f.width&&Math.abs(across-curve)<18)entered=true;
 }
 assert(entered,'scenic route passes through the first waterfall spray');encounters++;
}
assert(!/\bfloat\b|\bvec3\b/.test(WF.wgsl()),'shared kernel compiles to WGSL types');
console.log(`Canyon checks passed: three grounded falls, carved plunge basins, clear falling trajectories and ${encounters} aircraft sizes through the spray.`);
