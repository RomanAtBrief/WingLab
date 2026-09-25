const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const read=f=>fs.readFileSync(path.join(__dirname,'../src',f),'utf8');
const content=vm.runInNewContext('const Aero={};'+read('55-content.js')+';Content');
const html=read('02-body.html'),ui=read('60-ui.js');
const keys=[...html.concat(ui).matchAll(/data-info="([a-z]+)"/g)].map(m=>m[1]);
for(const m of ui.matchAll(/stat\('[^']+', '([^']+)'/g))keys.push(m[1]);
for(const key of new Set(keys)){assert(content.INFO[key],`missing help: ${key}`);assert(content.INFO[key].t&&content.INFO[key].w&&content.INFO[key].y,`incomplete help: ${key}`);}
const ids=[...html.matchAll(/\bid="([^"\s]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'IDs are unique');
for(const file of ['50-scene.js','79-gpu-scene.js'])assert(read(file).includes('forces: false'));
assert(ui.includes('fly: false, drawer: false'));assert(html.includes('id="forcesBtn" aria-pressed="false"'));
console.log(`UI content checks passed: ${new Set(keys).size} complete help topics, unique IDs, hidden panels and force arrows in both renderers.`);
