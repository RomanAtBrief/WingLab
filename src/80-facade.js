/* ================= Pick the renderer: WebGPU when the browser has it, otherwise the WebGL version ================= */
const GPU_OK = await G.probe();
let Scene3D = GPU_OK ? Scene3DGPU : Scene3DGL;
let Env = GPU_OK ? EnvGPU : EnvGL;
if (!GPU_OK) console.info('Wing Lab: WebGPU not available — using the WebGL renderer.');

function useWebGLFallback(host,labels,mods){
  console.warn('Wing Lab: recovering with the compatibility renderer.');
  G.S.device?.destroy();labels.replaceChildren();
  const old=host.querySelector('canvas'),canvas=old.cloneNode(false);old.replaceWith(canvas);
  Scene3D=Scene3DGL;Env=EnvGL;Scene3D.init(host,labels,mods);
}
function initFlightScene(host,labels,mods){
  try{Scene3D.init(host,labels,mods);}catch(error){if(!Scene3D.gpu)throw error;console.warn('WebGPU startup failed:',error);useWebGLFallback(host,labels,mods);}
}
