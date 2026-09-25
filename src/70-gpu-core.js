/* ================= GPU engine core: WebGPU device, resources, frame uniforms, shared WGSL ================= */
const G = (() => {
  const S = { device: null, adapter: null, ok: false, features: new Set(), errors: [] };

  async function probe() {
    try {
      if (!navigator.gpu || /(^|[#&])gl($|&)/.test(location.hash.slice(1))) return false;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return false;
      const want = ['float32-filterable', 'rg11b10ufloat-renderable'].filter(f => adapter.features.has(f));
      const L = adapter.limits, req = {};
      for (const [k, v] of Object.entries({ maxStorageTexturesPerShaderStage: 8, maxSampledTexturesPerShaderStage: 16, maxColorAttachmentBytesPerSample: 32,
        maxComputeWorkgroupStorageSize: 16384, maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456 })) if (L[k] !== undefined) req[k] = Math.min(v, L[k]);
      const device = await adapter.requestDevice({ requiredFeatures: want, requiredLimits: req });
      device.lost.then(info => { console.warn('WebGPU device lost:', info.message); S.lost = true; });
      device.addEventListener('uncapturederror', e => { if (S.errors.length < 20) { S.errors.push(e.error.message); console.error('WebGPU:', e.error.message); } });
      // smaller textures on phones and tablets (memory), or when asked for with #lite
      const touch = (navigator.maxTouchPoints || 0) > 0 && Math.min(screen.width, screen.height) < 900;
      Object.assign(S, { adapter, device, ok: true, features: new Set(want), lite: /lite/.test(location.hash) || touch || (navigator.deviceMemory && navigator.deviceMemory < 6) });
      return true;
    } catch (e) { console.warn('WebGPU unavailable:', e); return false; }
  }

  /* ---------- resources ---------- */
  const U = () => GPUTextureUsage, B = () => GPUBufferUsage;
  function tex(o) {
    return S.device.createTexture({ size: o.size, format: o.format || 'rgba16float', dimension: o.dim || '2d', mipLevelCount: o.mips || 1, sampleCount: o.samples || 1,
      usage: o.usage ?? (U().TEXTURE_BINDING | U().STORAGE_BINDING), label: o.label });
  }
  function buf(size, usage, data, label) {
    const b = S.device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage: usage | B().COPY_DST, label });
    if (data) S.device.queue.writeBuffer(b, 0, data);
    return b;
  }
  const mipCount = (w, h) => Math.floor(Math.log2(Math.max(w, h))) + 1;

  /* ---------- shaders and pipelines ---------- */
  function shader(code, label) {
    const m = S.device.createShaderModule({ code, label });
    if (m.getCompilationInfo) m.getCompilationInfo().then(info => {
      for (const msg of info.messages) if (msg.type === 'error') {
        const lines = code.split('\n'), l = msg.lineNum;
        const ctx = lines.slice(Math.max(0, l - 3), l + 1).map((s, i) => `${l - 2 + i}: ${s}`).join('\n');
        const t = `WGSL ${label} ${l}:${msg.linePos} ${msg.message}\n${ctx}`; S.errors.push(t); console.error(t);
      }
    });
    return m;
  }
  function compute(code, label, entry = 'main') {
    return S.device.createComputePipeline({ label, layout: 'auto', compute: { module: shader(code, label), entryPoint: entry } });
  }
  function render(o) {
    const m = shader(o.code, o.label);
    return S.device.createRenderPipeline({
      label: o.label, layout: 'auto',
      vertex: { module: m, entryPoint: o.vs || 'vs', buffers: o.buffers || [] },
      fragment: o.targets ? { module: m, entryPoint: o.fs || 'fs', targets: o.targets } : undefined,
      primitive: { topology: o.topology || 'triangle-list', cullMode: o.cull || 'none', frontFace: 'ccw' },
      depthStencil: o.depth ? { format: o.depth.format || 'depth32float', depthWriteEnabled: o.depth.write !== false, depthCompare: o.depth.compare || 'greater',
        depthBias: o.depth.bias || 0, depthBiasSlopeScale: o.depth.slope || 0 } : undefined,
      multisample: o.samples ? { count: o.samples } : undefined
    });
  }
  // bind group from an ordered list: GPUBuffer | {buffer,offset,size} | GPUTextureView | GPUSampler; null entries are skipped (binding index still advances)
  function bind(pipe, group, list, label) {
    const entries = [];
    list.forEach((r, i) => {
      if (r == null) return;
      let res = r;
      if (r instanceof GPUBuffer) res = { buffer: r };
      else if (r.buffer instanceof GPUBuffer) res = r;
      entries.push({ binding: i, resource: res });
    });
    return S.device.createBindGroup({ layout: pipe.getBindGroupLayout(group), entries, label });
  }
  function dispatch(enc, pipe, groups, x, y = 1, z = 1, label) {
    const p = enc.beginComputePass(label ? { label } : undefined); p.setPipeline(pipe);
    groups.forEach((g, i) => g && p.setBindGroup(i, g));
    p.dispatchWorkgroups(Math.ceil(x), Math.ceil(y), Math.ceil(z)); p.end();
  }
  let samplers = null;
  function sampler(name) {
    if (!samplers) {
      const d = S.device, mk = o => d.createSampler(o);
      samplers = {
        linClamp: mk({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' }),
        linRepeat: mk({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' }),
        aniso: mk({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 }),
        anisoClamp: mk({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', maxAnisotropy: 8 }),
        latlong: mk({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' }),
        nearClamp: mk({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }),
        shadow: mk({ compare: 'greater', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }),
        shadowLess: mk({ compare: 'less', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
      };
    }
    return samplers[name];
  }

  /* ---------- mipmaps for 2D colour textures (render-pass box filter) ---------- */
  const mipPipes = {};
  function genMips(texture, format, layers = 1) {
    const d = S.device;
    if (!mipPipes[format]) mipPipes[format] = render({ label: 'mip ' + format, code: `
      @group(0) @binding(0) var src: texture_2d<f32>; @group(0) @binding(1) var smp: sampler;
      struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> O { var o: O; let x = f32((i << 1u) & 2u); let y = f32(i & 2u); o.p = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0); o.uv = vec2f(x, y); return o; }
      @fragment fn fs(i: O) -> @location(0) vec4f { return textureSampleLevel(src, smp, i.uv, 0.0); }`, targets: [{ format }] });
    const pipe = mipPipes[format], enc = d.createCommandEncoder();
    for (let l = 0; l < layers; l++) for (let m = 1; m < texture.mipLevelCount; m++) {
      const src = texture.createView({ dimension: '2d', baseMipLevel: m - 1, mipLevelCount: 1, baseArrayLayer: l, arrayLayerCount: 1 });
      const dst = texture.createView({ dimension: '2d', baseMipLevel: m, mipLevelCount: 1, baseArrayLayer: l, arrayLayerCount: 1 });
      const p = enc.beginRenderPass({ colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      p.setPipeline(pipe); p.setBindGroup(0, bind(pipe, 0, [src, sampler('linClamp')])); p.draw(3); p.end();
    }
    d.queue.submit([enc.finish()]);
  }

  /* ---------- per-frame uniform block (WGSL struct generated from this list so JS and GPU agree) ---------- */
  const FRAME = [
    ['viewProj', 'm4'], ['invViewProj', 'm4'], ['viewProjNJ', 'm4'], ['prevViewProjNJ', 'm4'], ['invViewProjNJ', 'm4'], ['view', 'm4'],
    ['camPos', 'v3'], ['time', 'f'],
    ['sunDir', 'v3'], ['sunE', 'f'],          // main light (sun by day, moon by night), direction towards it; illuminance scale
    ['lightTint', 'v3'], ['night', 'f'],
    ['realSun', 'v3'], ['overcast', 'f'],
    ['groundAlbedo', 'v3'], ['haze', 'f'],
    ['shift', 'v3'], ['fog', 'f'],             // world movement since last frame in render space
    ['res', 'v2'], ['invRes', 'v2'],
    ['jitter', 'v2'], ['frame', 'u'], ['alt', 'f'],   // camera altitude above sea (m)
    ['terrOff', 'v2'], ['tile', 'f'], ['water', 'f'],
    ['cloudOff', 'v2'], ['cloudBase', 'f'], ['cloudTop', 'f'],
    ['cover', 'f'], ['cdens', 'f'], ['ctype', 'f'], ['cscale', 'f'],
    ['planeAlt', 'f'], ['wet', 'f'], ['snow', 'f'], ['quality', 'f'],
    ['hmax', 'f'], ['place', 'u'], ['exposure', 'f'], ['dt', 'f'],
    ['camFwd', 'v3'], ['tanHalf', 'f'],
    ['sunScreen', 'v4'],
    ['windDir', 'v2'], ['cloudT', 'f'], ['snowLine', 'f'],
    ['treeLine', 'f'], ['seaRough', 'f'], ['flags', 'u'], ['pad0', 'f'],
    ['wb', 'v3'], ['exComp', 'f'], ['wake','v4'], ['flight','v4']
  ];
  const TYPES = { f: ['f32', 4, 4], u: ['u32', 4, 4], v2: ['vec2f', 8, 8], v3: ['vec3f', 16, 12], v4: ['vec4f', 16, 16], m4: ['mat4x4f', 16, 64] };
  const layout = {}; let off = 0;
  for (const [n, t] of FRAME) { const [, al, sz] = TYPES[t]; off = Math.ceil(off / al) * al; layout[n] = [off / 4, t]; off += sz; }
  const FRAME_SIZE = Math.ceil(off / 16) * 16;
  const FRAME_WGSL = `struct Frame {\n${FRAME.map(([n, t]) => `  ${n}: ${TYPES[t][0]},`).join('\n')}\n};\n`;
  const frameData = new ArrayBuffer(FRAME_SIZE), fF = new Float32Array(frameData), fU = new Uint32Array(frameData);
  function setF(name, v) {
    const [o, t] = layout[name];
    if (t === 'u') fU[o] = v;
    else if (t === 'f') fF[o] = v;
    else if (v.elements) fF.set(v.elements, o);
    else if (v.isVector3) { fF[o] = v.x; fF[o + 1] = v.y; fF[o + 2] = v.z; }
    else if (v.isColor) { fF[o] = v.r; fF[o + 1] = v.g; fF[o + 2] = v.b; }
    else fF.set(v, o);
  }

  /* ---------- shared WGSL ---------- */
  const COMMON = `
const PI: f32 = 3.14159265;
const RG: f32 = 6360.0;
const RT: f32 = 6460.0;
${FRAME_WGSL}
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.0), vec3f(1.0)); }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn remap(x: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return c + (x - a) / (b - a) * (d - c); }
fn pcg(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
fn hash1(n: u32) -> f32 { return f32(pcg(n)) / 4294967296.0; }
fn hash2i(p: vec2i) -> f32 { return hash1((u32(p.x) * 1597334677u) ^ (u32(p.y) * 3812015801u)); }
fn hash3i(p: vec3i) -> f32 { return hash1((u32(p.x) * 1597334677u) ^ (u32(p.y) * 3812015801u) ^ (u32(p.z) * 2798796415u)); }
fn hash22(p: vec2f) -> vec2f { var q = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
fn hash12(p: vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn ignT(p: vec2f, f: u32) -> f32 { return ign(p + 5.588238 * f32(f & 63u)); }
fn octEnc(n: vec3f) -> vec2f { var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z)); if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); } return p; }
fn octDec(e: vec2f) -> vec3f { var n = vec3f(e.x, 1.0 - abs(e.x) - abs(e.y), e.y); let t = max(-n.y, 0.0); n.x += select(t, -t, n.x >= 0.0); n.z += select(t, -t, n.z >= 0.0); return normalize(n); }
// value noise and gradient noise
fn vnoise2(p: vec2f) -> f32 { let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(i); let b = hash12(i + vec2f(1.0, 0.0)); let c = hash12(i + vec2f(0.0, 1.0)); let d = hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }
`;

  /* atmosphere (Hillaire 2020); units are kilometres. Shaders using sunTrans/msLookup must bind transLut, msLut and smpL */
  const FRAMEFN = `
fn camAltKm() -> f32 { return max(F.alt, 1.0) * 0.001; }
// planet-space position (km) of a render-space point
fn planetPos(p: vec3f) -> vec3f { return vec3f(0.0, RG + camAltKm(), 0.0) + (p - F.camPos) * 0.001; }
`;
  const ATMO = `
const RAY_S = vec3f(5.802e-3, 13.558e-3, 33.1e-3);
const MIE_S: f32 = 3.996e-3;
const MIE_E: f32 = 4.40e-3;
const OZO_A = vec3f(0.650e-3, 1.881e-3, 0.085e-3);
struct Med { sr: vec3f, sm: f32, ext: vec3f };
fn medium(h: f32) -> Med {
  let hh = max(h, 0.0);
  let rd = exp(-hh / 8.0);
  let md = exp(-hh / 1.2) * F.haze + F.fog * 400.0 * exp(-max(hh - F.water * 0.001, 0.0) / 0.22);
  let od = max(0.0, 1.0 - abs(hh - 25.0) / 15.0);
  var m: Med; m.sr = RAY_S * rd; m.sm = MIE_S * md; m.ext = m.sr + vec3f(MIE_E * md) + OZO_A * od; return m;
}
fn phaseR(c: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
fn phaseCS(c: f32, g: f32) -> f32 { let k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g); return k * (1.0 + c * c) / pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5); }
fn phaseHG(c: f32, g: f32) -> f32 { let d = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (4.0 * PI * pow(max(d, 1e-4), 1.5)); }
fn raySphere(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
  let b = dot(ro, rd); let c = dot(ro, ro) - r * r; let d = b * b - c;
  if (d < 0.0) { return vec2f(-1.0, -1.0); }
  let s = sqrt(d); return vec2f(-b - s, -b + s);
}
fn transUv(r: f32, mu: f32) -> vec2f {
  let H = sqrt(RT * RT - RG * RG); let rho = sqrt(max(0.0, r * r - RG * RG));
  let disc = r * r * (mu * mu - 1.0) + RT * RT; let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  let dmin = RT - r; let dmax = rho + H;
  return vec2f((d - dmin) / max(dmax - dmin, 1e-4), rho / H);
}
fn transParams(uv: vec2f) -> vec2f {
  let H = sqrt(RT * RT - RG * RG); let rho = H * uv.y; let r = sqrt(rho * rho + RG * RG);
  let dmin = RT - r; let dmax = rho + H; let d = dmin + uv.x * (dmax - dmin);
  var mu = 1.0; if (d > 0.0) { mu = (H * H - rho * rho - d * d) / (2.0 * r * d); }
  return vec2f(r, clamp(mu, -1.0, 1.0));
}
// sky-view LUT mapping (192x108)
fn skyLutUv(r: f32, dir: vec3f, sun: vec3f) -> vec2f {
  let vH = sqrt(max(r * r - RG * RG, 0.0)); let beta = acos(clamp(vH / r, -1.0, 1.0)); let zha = PI - beta;
  let vz = acos(clamp(dir.y, -1.0, 1.0));
  var y = 0.0;
  if (vz > zha) { var cc = (vz - zha) / beta; cc = sqrt(max(cc, 0.0)); y = 0.5 - 0.5 * cc; }
  else { var cc = vz / zha; cc = 1.0 - cc; cc = sqrt(max(cc, 0.0)); y = 0.5 + 0.5 * cc; }
  let hd = normalize(vec2f(dir.x, dir.z) + vec2f(1e-6, 0.0)); let hs = normalize(vec2f(sun.x, sun.z) + vec2f(1e-6, 0.0));
  let lc = dot(hd, hs);
  let x = sqrt(clamp(-lc * 0.5 + 0.5, 0.0, 1.0));
  return vec2f((x * 191.0 + 0.5) / 192.0, (y * 107.0 + 0.5) / 108.0);
}
fn skyLutDir(uv: vec2f, r: f32) -> vec2f {   // texel uv -> (cos view zenith, cos angle to sun azimuth)
  let u = (uv * vec2f(192.0, 108.0) - 0.5) / vec2f(191.0, 107.0);
  let vH = sqrt(max(r * r - RG * RG, 0.0)); let beta = acos(clamp(vH / r, -1.0, 1.0)); let zha = PI - beta;
  var vz = 0.0;
  if (u.y >= 0.5) { let s = (u.y - 0.5) * 2.0; vz = zha * (1.0 - s * s); }
  else { let s = (0.5 - u.y) * 2.0; vz = zha + beta * s * s; }
  return vec2f(cos(vz), 1.0 - 2.0 * u.x * u.x);
}
`;

  const ATMO_T = `
fn sunTrans(r: f32, mu: f32) -> vec3f {
  let rr = clamp(r, RG + 0.001, RT - 0.001);
  let t = textureSampleLevel(transLut, smpL, transUv(rr, mu), 0.0).rgb;
  let muH = -sqrt(max(0.0, 1.0 - (RG * RG) / (rr * rr)));
  return t * smoothstep(muH - 0.004, muH + 0.004, mu);
}
fn msLookup(r: f32, mu: f32) -> vec3f {
  let uv = vec2f(clamp(mu * 0.5 + 0.5, 0.0, 1.0), clamp((r - RG) / (RT - RG), 0.0, 1.0));
  return textureSampleLevel(msLut, smpL, uv * (31.0 / 32.0) + 0.5 / 32.0, 0.0).rgb;
}
// single + multiple scattering along a ray; returns in-scatter (per unit sun illuminance) and transmittance
struct Scat { L: vec3f, T: vec3f };
fn integrate(ro: vec3f, rd: vec3f, sun: vec3f, tMax: f32, n: i32, ground: bool, albedo: vec3f) -> Scat {
  let c = dot(rd, sun); let pR = phaseR(c); let pM = phaseCS(c, 0.8);
  var L = vec3f(0.0); var T = vec3f(1.0); var tp = 0.0;
  let fn_ = f32(n);
  for (var i = 0; i < n; i++) {
    var t0 = f32(i) / fn_; var t1 = f32(i + 1) / fn_;
    t0 = t0 * t0 * tMax; t1 = t1 * t1 * tMax;
    let t = mix(t0, t1, 0.3); let dt = t1 - t0;
    let P = ro + rd * t; let r = length(P); let up = P / r; let mu = dot(sun, up);
    let m = medium(r - RG);
    let st = sunTrans(r, mu);
    let ms = msLookup(r, mu);
    let S = st * (m.sr * pR + m.sm * pM) + ms * (m.sr + vec3f(m.sm));
    let e = max(m.ext, vec3f(1e-7));
    let sT = exp(-m.ext * dt);
    L += T * (S - S * sT) / e; T *= sT;
  }
  if (ground) {
    let P = ro + rd * tMax; let r = length(P); let up = P / r; let mu = dot(sun, up);
    L += T * sunTrans(r, mu) * max(mu, 0.0) * albedo / PI;
  }
  var o: Scat; o.L = L; o.T = T; return o;
}
`;
  return { S, probe, tex, buf, mipCount, shader, compute, render, bind, dispatch, sampler, genMips, setF, frameData, FRAME_SIZE, COMMON: COMMON + FRAMEFN, BASE: COMMON, ATMO, ATMO_T, get device() { return S.device; } };
})();
