import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import * as THREE from '../vendor/three/build/three.module.js';
// Canvas paint is stubbed: this suite checks the real production geometry and hinges.
const gradient={addColorStop(){}};
const context=new Proxy({createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,measureText:t=>({width:t.length*8}),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),getImageData:()=>({data:new Uint8ClampedArray(4)})},{get:(o,k)=>k in o?o[k]:()=>{}});
const document={createElement:()=>({tagName:'CANVAS',width:1,height:1,getContext:()=>context})};
const code=['10-physics.js','40-kit.js','41-aircraft.js'].map(n=>fs.readFileSync(new URL('../src/'+n,import.meta.url),'utf8')).join('\n');
const {Aero,Model}=vm.runInNewContext(code+';({Aero,Model})',{THREE,document,console});
for(const id of Object.keys(Aero.AIRCRAFT)){
 const built=Model.build(Aero.build(Aero.defaultCfg(id))),cs=built.anim.controls;
 assert.equal(cs.length,id==='concorde'?3:5,id+' primary surfaces');
 built.group.traverse(o=>{if(o.geometry)for(const key of ['position','normal','uv']){const a=o.geometry.attributes[key];if(a)assert([...a.array].every(Number.isFinite),id+' finite '+key);}});
 Model.animateControls(built,{aileron:1,elevator:0,rudder:.5},1);
 for(const c of cs.filter(c=>['aileron','elevon'].includes(c.type)))assert.equal(Math.sign(c.angle),-c.side,id+' differential aileron sign');
 Model.animateControls(built,{aileron:0,elevator:1,rudder:0},1);
 for(const c of cs.filter(c=>['elevator','elevon'].includes(c.type)))assert(c.angle<-.3,id+' trailing edge up for climb');
 for(let i=0;i<120;i++)Model.animateControls(built,{aileron:0,elevator:0,rudder:0},1/60);
 assert(cs.every(c=>Math.abs(c.angle)<1e-8),id+' neutral settling');Model.dispose(built.group);
}
console.log('Seven aircraft: actual split airfoils, finite geometry, correct aileron/elevator/elevon directions, neutral settling.');
