/* ================= Atmosphere: Hillaire LUTs, aerial perspective, reflection probe, sky SH ================= */
const GAtmos = (() => {
  const W = () => G.device;
  let R = null, P = null, frameBuf = null, dirty = true, envDirty = true;
  const EW = 512, EH = 256, ENV_RAW_MIPS = 9, ENV_MIPS = 6, AP_N = 32, AP_MAX = 400;
  const LL = `
fn llDir(uv: vec2f) -> vec3f { let ph = (uv.x - 0.5) * 6.2831853; let th = uv.y * 3.14159265; return vec3f(sin(th) * cos(ph), cos(th), sin(th) * sin(ph)); }
fn llUv(d: vec3f) -> vec2f { return vec2f(atan2(d.z, d.x) * 0.15915494 + 0.5, acos(clamp(d.y, -1.0, 1.0)) * 0.31830989); }`;

  const TEXDECL = (b0) => `
@group(0) @binding(${b0}) var transLut: texture_2d<f32>;
@group(0) @binding(${b0 + 1}) var msLut: texture_2d<f32>;
@group(0) @binding(${b0 + 2}) var smpL: sampler;`;
  const CUBEDIR = `
fn cubeDir(face: u32, uv: vec2f) -> vec3f {
  let s = uv.x * 2.0 - 1.0; let t = uv.y * 2.0 - 1.0;
  var d = vec3f(0.0);
  switch face { case 0u: { d = vec3f(1.0, -t, -s); } case 1u: { d = vec3f(-1.0, -t, s); } case 2u: { d = vec3f(s, 1.0, t); }
    case 3u: { d = vec3f(s, -1.0, -t); } case 4u: { d = vec3f(s, -t, 1.0); } default: { d = vec3f(-s, -t, -1.0); } }
  return normalize(d);
}`;

  function init(fb) {
    frameBuf = fb;
    const T = GPUTextureUsage, st = T.TEXTURE_BINDING | T.STORAGE_BINDING;
    R = {
      trans: G.tex({ size: [256, 64], usage: st, label: 'transLut' }),
      ms: G.tex({ size: [32, 32], usage: st, label: 'msLut' }),
      sky: G.tex({ size: [192, 108], usage: st, label: 'skyLut' }),
      apL: G.tex({ size: [AP_N, AP_N, AP_N], dim: '3d', usage: st, label: 'apL' }),
      apT: G.tex({ size: [AP_N, AP_N, AP_N], dim: '3d', usage: st, label: 'apT' }),
      envRaw: G.tex({ size: [EW, EH], mips: ENV_RAW_MIPS, usage: st | GPUTextureUsage.COPY_SRC, label: 'envRaw' }),
      envPref: G.tex({ size: [EW, EH], mips: ENV_MIPS, usage: st, label: 'envPref' }),
      sh: G.buf(9 * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC, null, 'sh')
    };
    R.transV = R.trans.createView(); R.msV = R.ms.createView(); R.skyV = R.sky.createView();
    R.apLV = R.apL.createView(); R.apTV = R.apT.createView();
    R.envRawV = R.envRaw.createView(); R.envPrefV = R.envPref.createView();
    const L = G.sampler('linClamp');
    const C = G.COMMON, A = G.ATMO, AT = G.ATMO_T;

    P = {};
    P.trans = G.compute(`${C}${A}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var outT: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= 256u || id.y >= 64u) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(256.0, 64.0);
  let rm = transParams(uv); let r = rm.x; let mu = rm.y;
  let ro = vec3f(0.0, r, 0.0); let rd = vec3f(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  let tt = raySphere(ro, rd, RT).y;
  var od = vec3f(0.0); let n = 40; let dt = tt / f32(n);
  for (var i = 0; i < n; i++) { let t = (f32(i) + 0.5) * dt; od += medium(length(ro + rd * t) - RG).ext * dt; }
  textureStore(outT, id.xy, vec4f(exp(-od), 1.0));
}`, 'atmo-trans');
    R.bTrans = G.bind(P.trans, 0, [frameBuf, R.transV]);

    P.ms = G.compute(`${C}${A}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var outM: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var transLut: texture_2d<f32>;
@group(0) @binding(3) var smpL: sampler;
fn sunTrans(r: f32, mu: f32) -> vec3f {
  let rr = clamp(r, RG + 0.001, RT - 0.001);
  let t = textureSampleLevel(transLut, smpL, transUv(rr, mu), 0.0).rgb;
  let muH = -sqrt(max(0.0, 1.0 - (RG * RG) / (rr * rr)));
  return t * smoothstep(muH - 0.004, muH + 0.004, mu);
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= 32u || id.y >= 32u) { return; }
  let u = vec2f(id.xy) / 31.0;
  let mu = u.x * 2.0 - 1.0; let r = RG + max(u.y, 0.002) * (RT - RG);
  let sun = vec3f(0.0, mu, sqrt(max(0.0, 1.0 - mu * mu)));
  let ro = vec3f(0.0, r, 0.0);
  var Ls = vec3f(0.0); var fms = vec3f(0.0);
  let up = 1.0 / (4.0 * PI);
  for (var i = 0; i < 8; i++) { for (var j = 0; j < 8; j++) {
    let th = 2.0 * PI * (f32(i) + 0.5) / 8.0; let ph = acos(1.0 - 2.0 * (f32(j) + 0.5) / 8.0);
    let rd = vec3f(cos(th) * sin(ph), cos(ph), sin(th) * sin(ph));
    let g = raySphere(ro, rd, RG); let hitG = g.x > 0.0;
    let tMax = select(raySphere(ro, rd, RT).y, g.x, hitG);
    var T = vec3f(1.0); let n = 20;
    for (var s = 0; s < n; s++) {
      var t0 = f32(s) / f32(n); var t1 = f32(s + 1) / f32(n); t0 = t0 * t0 * tMax; t1 = t1 * t1 * tMax;
      let t = mix(t0, t1, 0.3); let dt = t1 - t0;
      let P = ro + rd * t; let rr = length(P); let m = medium(rr - RG);
      let st = sunTrans(rr, dot(sun, P / rr));
      let sc = m.sr + vec3f(m.sm); let e = max(m.ext, vec3f(1e-7)); let sT = exp(-m.ext * dt);
      Ls += T * (st * sc * up - st * sc * up * sT) / e;
      fms += T * (sc - sc * sT) / e;
      T *= sT;
    }
    if (hitG) { let P = ro + rd * tMax; let n2 = normalize(P); Ls += T * sunTrans(RG + 0.001, dot(n2, sun)) * max(dot(n2, sun), 0.0) * F.groundAlbedo / PI; }
  } }
  Ls /= 64.0; fms /= 64.0;
  textureStore(outM, id.xy, vec4f(Ls / max(vec3f(1.0) - fms, vec3f(0.05)), 1.0));
}`, 'atmo-ms');
    R.bMs = G.bind(P.ms, 0, [frameBuf, R.msV, R.transV, L]);

    P.sky = G.compute(`${C}${A}${AT}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var outS: texture_storage_2d<rgba16float, write>;
${TEXDECL(2)}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= 192u || id.y >= 108u) { return; }
  let r = min(RG + camAltKm(), RT - 0.01);
  let d = skyLutDir((vec2f(id.xy) + 0.5) / vec2f(192.0, 108.0), r);
  let sz = sqrt(max(0.0, 1.0 - d.x * d.x));
  let dir = vec3f(sz * d.y, d.x, sz * sqrt(max(0.0, 1.0 - d.y * d.y)));
  let sun = vec3f(sqrt(max(0.0, 1.0 - F.sunDir.y * F.sunDir.y)), F.sunDir.y, 0.0);
  let ro = vec3f(0.0, r, 0.0);
  let g = raySphere(ro, dir, RG); let hitG = g.x > 0.0;
  let tMax = select(raySphere(ro, dir, RT).y, g.x, hitG);
  let s = integrate(ro, dir, sun, tMax, 40, hitG, F.groundAlbedo);
  textureStore(outS, id.xy, vec4f(s.L, 1.0));
}`, 'atmo-sky');
    R.bSky = G.bind(P.sky, 0, [frameBuf, R.skyV, R.transV, R.msV, L]);

    P.ap = G.compute(`${C}${A}${AT}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var outL: texture_storage_3d<rgba16float, write>;
@group(0) @binding(5) var outT: texture_storage_3d<rgba16float, write>;
${TEXDECL(2)}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ${AP_N}u || id.y >= ${AP_N}u) { return; }
  let uv = (vec2f(id.xy) + 0.5) / ${AP_N}.0;
  let wp = F.invViewProjNJ * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 1.0, 1.0);
  let rd = normalize(wp.xyz / wp.w - F.camPos);
  let ro = vec3f(0.0, RG + camAltKm(), 0.0);
  let sun = F.sunDir; let c = dot(rd, sun); let pR = phaseR(c); let pM = phaseCS(c, 0.8);
  var L = vec3f(0.0); var T = vec3f(1.0); var tp = 0.0;
  for (var k = 0; k < ${AP_N}; k++) {
    let f = f32(k + 1) / ${AP_N}.0; let tk = ${AP_MAX}.0 * f * f;
    for (var s = 0; s < 2; s++) {
      let dt = (tk - tp) * 0.5; let t = tp + dt * (f32(s) + 0.5);
      let P = ro + rd * t; let r = max(length(P), RG + 0.0005); let up = P / r; let mu = dot(sun, up);
      let m = medium(r - RG);
      let S = sunTrans(r, mu) * (m.sr * pR + m.sm * pM) + msLookup(r, mu) * (m.sr + vec3f(m.sm));
      let e = max(m.ext, vec3f(1e-7)); let sT = exp(-m.ext * dt);
      L += T * (S - S * sT) / e; T *= sT;
    }
    tp = tk;
    textureStore(outL, vec3u(id.x, id.y, u32(k)), vec4f(L, 1.0));
    textureStore(outT, vec3u(id.x, id.y, u32(k)), vec4f(T, 1.0));
  }
}`, 'atmo-ap');
    R.bAp = G.bind(P.ap, 0, [frameBuf, R.apLV, R.transV, R.msV, L, R.apTV]);

    // reflection probe: sky (and later clouds and ground) in a latitude-longitude map with GGX-prefiltered mips
    P.envSky = G.compute(`${C}${A}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var outE: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var skyLut: texture_2d<f32>;
@group(0) @binding(3) var smpL: sampler;
${LL}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ${EW}u || id.y >= ${EH}u) { return; }
  let dir = llDir((vec2f(id.xy) + 0.5) / vec2f(${EW}.0, ${EH}.0));
  let r = RG + camAltKm();
  let L = textureSampleLevel(skyLut, smpL, skyLutUv(r, dir, F.sunDir), 0.0).rgb * F.sunE * F.lightTint;
  textureStore(outE, id.xy, vec4f(min(L, vec3f(60000.0)), 1.0));
}`, 'env-sky');
    R.envRawV0 = R.envRaw.createView({ baseMipLevel: 0, mipLevelCount: 1 });
    R.bEnvSky = G.bind(P.envSky, 0, [frameBuf, R.envRawV0, R.skyV, L]);

    P.envDown = G.compute(`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(dst); if (id.x >= n.x || id.y >= n.y) { return; }
  let p = vec2i(id.xy) * 2;
  let c = textureLoad(src, p, 0) + textureLoad(src, p + vec2i(1, 0), 0) + textureLoad(src, p + vec2i(0, 1), 0) + textureLoad(src, p + vec2i(1, 1), 0);
  textureStore(dst, id.xy, c * 0.25);
}`, 'env-down');
    R.bEnvDown = [];
    for (let m = 1; m < ENV_RAW_MIPS; m++) R.bEnvDown.push(G.bind(P.envDown, 0, [R.envRaw.createView({ baseMipLevel: m - 1, mipLevelCount: 1 }), R.envRaw.createView({ baseMipLevel: m, mipLevelCount: 1 })]));

    P.envPref = G.compute(`
const PI: f32 = 3.14159265;
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> rough: vec4f;
${LL}
fn hammersley(i: u32, n: u32) -> vec2f { var b = i; b = (b << 16u) | (b >> 16u); b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u); b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u); b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u); b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u); return vec2f(f32(i) / f32(n), f32(b) * 2.3283064365386963e-10); }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(dst); if (id.x >= n.x || id.y >= n.y) { return; }
  let N = llDir((vec2f(id.xy) + 0.5) / vec2f(n));
  if (rough.x <= 0.0) { textureStore(dst, id.xy, textureSampleLevel(src, smp, llUv(N), 0.0)); return; }
  let a = max(rough.x * rough.x, 0.002);
  let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(N.y) < 0.999);
  let tx = normalize(cross(up, N)); let ty = cross(N, tx);
  var sum = vec3f(0.0); var w = 0.0; let cnt = 64u;
  let saTexel = 4.0 * PI / (${EW}.0 * ${EH}.0);
  for (var i = 0u; i < cnt; i++) {
    let xi = hammersley(i, cnt);
    let phi = 2.0 * PI * xi.x; let ct = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y)); let st = sqrt(1.0 - ct * ct);
    let H = tx * (st * cos(phi)) + ty * (st * sin(phi)) + N * ct;
    let L = 2.0 * dot(N, H) * H - N; let nl = dot(N, L);
    if (nl > 0.0) {
      let a2 = a * a; let d = (ct * a2 - ct) * ct + 1.0; let D = a2 / (PI * d * d);
      let saS = 1.0 / (f32(cnt) * D * 0.25 + 1e-4);
      let lod = clamp(0.5 * log2(saS / saTexel) + 1.0, 0.0, ${ENV_RAW_MIPS - 1}.0);
      sum += textureSampleLevel(src, smp, llUv(L), lod).rgb * nl; w += nl;
    }
  }
  textureStore(dst, id.xy, vec4f(sum / max(w, 1e-4), 1.0));
}`, 'env-pref');
    R.roughBufs = []; R.bEnvPref = [];
    const LLS = G.sampler('latlong');
    for (let m = 0; m < ENV_MIPS; m++) {
      const rb = G.buf(16, GPUBufferUsage.UNIFORM, new Float32Array([m / (ENV_MIPS - 1), 0, 0, 0]));
      R.roughBufs.push(rb);
      R.bEnvPref.push(G.bind(P.envPref, 0, [R.envRawV, LLS, R.envPref.createView({ baseMipLevel: m, mipLevelCount: 1 }), rb]));
    }

    P.sh = G.compute(`
const PI: f32 = 3.14159265;
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> sh: array<vec4f, 9>;
@group(0) @binding(2) var smp: sampler;
${LL}
var<workgroup> acc: array<vec4f, 576>;
@compute @workgroup_size(64) fn main(@builtin(local_invocation_index) li: u32) {
  var c0 = vec4f(0.0); var c1 = vec4f(0.0); var c2 = vec4f(0.0); var c3 = vec4f(0.0); var c4 = vec4f(0.0);
  var c5 = vec4f(0.0); var c6 = vec4f(0.0); var c7 = vec4f(0.0); var c8 = vec4f(0.0);
  for (var k = 0u; k < 8u; k++) {
    let idx = li * 8u + k; let px = idx % 32u; let py = idx / 32u;
    let uv = (vec2f(f32(px), f32(py)) + 0.5) / vec2f(32.0, 16.0);
    let d = llDir(uv);
    let wgt = sin(uv.y * PI) * (PI / 16.0) * (2.0 * PI / 32.0);
    let Ls = vec4f(textureSampleLevel(src, smp, uv, 4.0).rgb, 0.0) * wgt;
    c0 += Ls * 0.282095;
    c1 += Ls * (0.488603 * d.y); c2 += Ls * (0.488603 * d.z); c3 += Ls * (0.488603 * d.x);
    c4 += Ls * (1.092548 * d.x * d.y); c5 += Ls * (1.092548 * d.y * d.z); c6 += Ls * (0.315392 * (3.0 * d.z * d.z - 1.0));
    c7 += Ls * (1.092548 * d.x * d.z); c8 += Ls * (0.546274 * (d.x * d.x - d.y * d.y));
  }
  let b = li * 9u;
  acc[b] = c0; acc[b + 1u] = c1; acc[b + 2u] = c2; acc[b + 3u] = c3; acc[b + 4u] = c4; acc[b + 5u] = c5; acc[b + 6u] = c6; acc[b + 7u] = c7; acc[b + 8u] = c8;
  workgroupBarrier();
  if (li < 9u) {
    var t = vec4f(0.0);
    for (var i = 0u; i < 64u; i++) { t += acc[i * 9u + li]; }
    // fold in the cosine-lobe convolution and 1/pi so that diffuse = albedo * sum(c_i Y_i(n))
    let a = select(select(0.25, 2.0 / 3.0, li < 4u), 1.0, li == 0u);
    sh[li] = vec4f(t.rgb * a, 0.0);
  }
}`, 'env-sh');
    R.bSh = G.bind(P.sh, 0, [R.envRawV, R.sh, LLS]);
  }

  function markDirty() { dirty = true; envDirty = true; }
  function markEnv() { envDirty = true; }
  // hook so that other modules (clouds, terrain) can supply a richer reflection probe
  let envHook = null;
  function setEnvHook(fn) { envHook = fn; envDirty = true; }

  function run(enc, alsoEnv) {
    if (dirty) {
      G.dispatch(enc, P.trans, [R.bTrans], 256 / 8, 64 / 8, 1, 'trans');
      G.dispatch(enc, P.ms, [R.bMs], 4, 4, 1, 'ms');
      dirty = false;
    }
    G.dispatch(enc, P.sky, [R.bSky], 192 / 8, Math.ceil(108 / 8), 1, 'skyview');
    G.dispatch(enc, P.ap, [R.bAp], AP_N / 8, AP_N / 8, 1, 'ap');
    if (envDirty || alsoEnv) { envDirty = false; env(enc); return true; }
    return false;
  }
  function env(enc) {
    if (envHook) envHook(enc); else G.dispatch(enc, P.envSky, [R.bEnvSky], EW / 8, EH / 8, 1, 'env');
    for (let m = 1; m < ENV_RAW_MIPS; m++) G.dispatch(enc, P.envDown, [R.bEnvDown[m - 1]], Math.ceil((EW >> m) / 8), Math.ceil((EH >> m) / 8));
    for (let m = 0; m < ENV_MIPS; m++) G.dispatch(enc, P.envPref, [R.bEnvPref[m]], Math.ceil((EW >> m) / 8), Math.ceil((EH >> m) / 8));
    G.dispatch(enc, P.sh, [R.bSh], 1);
  }
  function shNow() { const e = G.device.createCommandEncoder(); G.dispatch(e, P.sh, [R.bSh], 1); G.device.queue.submit([e.finish()]); }
  return { shNow, init, run, markDirty, markEnv, setEnvHook, get R() { return R; }, EW, EH, ENV_MIPS, AP_N, AP_MAX, TEXDECL, LL };
})();
