const fs=require('fs'),vm=require('vm');
const A=vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../src/10-physics.js'),'utf8')+';Aero');
let cases=0;
for(const id of Object.keys(A.AIRCRAFT)){
 const ac=A.build(A.defaultCfg(id));
 for(const h of [0,600,3000])for(const V of [0,ac.A.start.V]){
  const trim=A.trim(ac,V,h,.9,false),f=A.flight(ac,V,h,trim.alpha,.9,false);
  for(const key of ['L','D','T','roc','LD'])if(!Number.isFinite(f[key]))throw Error(`${id} ${h} ${V}: ${key}`);
  if(f.D<0||f.T<0)throw Error('negative force');
  const curve=A.curves(ac,h,.9,false,ac.A.vTop,30);
  if(curve.pts.some(p=>!Number.isFinite(p.V)||!Number.isFinite(p.T)))throw Error('invalid chart data');
  cases++;
 }
}
console.log(`${cases} flight/chart scenarios passed across ${Object.keys(A.AIRCRAFT).length} aircraft.`);
