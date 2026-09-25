/* ================= Pick the renderer: WebGPU when the browser has it, otherwise the WebGL version ================= */
const GPU_OK = await G.probe();
const Scene3D = GPU_OK ? Scene3DGPU : Scene3DGL;
const Env = GPU_OK ? EnvGPU : EnvGL;
if (!GPU_OK) console.info('Wing Lab: WebGPU not available — using the WebGL renderer.');
