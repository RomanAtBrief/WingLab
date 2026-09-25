/* ================= Post: GTAO, temporal anti-aliasing, auto-exposure, bloom, lens flare ================= */
const GPost = (() => {
  let d, frameBuf, RT = null, P = {}, BG = {}, hist = 0, W = 0, H = 0, first = true;
  const on = { taa: true, ao: true, bloom: true, flare: true, auto: true };

  function init(fb) {
    d = G.device; frameBuf = fb;
    const C = G.COMMON;
    // ---- GTAO (half resolution, world-space horizon search) ----
    P.ao = G.compute(`${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var gD: texture_depth_2d;
@group(0) @binding(2) var gN: texture_2d<f32>;
@group(0) @binding(3) var outA: texture_storage_2d<rgba8unorm, write>;
fn wpos(p: vec2i) -> vec3f {
  let dz = textureLoad(gD, p, 0);
  let uv = (vec2f(p) + 0.5) * F.invRes;
  let w = F.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, max(dz, 1e-9), 1.0);
  return w.xyz / w.w;
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let hr = vec2u(F.res) / 2u; if (gid.x >= hr.x || gid.y >= hr.y) { return; }
  let p = vec2i(gid.xy) * 2;
  let dz = textureLoad(gD, p, 0);
  if (dz <= 0.0) { textureStore(outA, gid.xy, vec4f(1.0)); return; }
  let P = wpos(p); let N = normalize(textureLoad(gN, p, 0).xyz);
  let dist = distance(P, F.camPos); let V = (F.camPos - P) / dist;
  let R = clamp(0.035 * dist, 0.35, 250.0);
  let pxPerM = F.res.y / (2.0 * F.tanHalf * dist);
  let rpx = min(R * pxPerM, 48.0);
  if (rpx < 1.5) { textureStore(outA, gid.xy, vec4f(1.0)); return; }
  let right = vec3f(F.view[0][0], F.view[1][0], F.view[2][0]); let up = vec3f(F.view[0][1], F.view[1][1], F.view[2][1]);
  let noise = ignT(vec2f(gid.xy), F.frame); let noise2 = fract(noise * 7.13 + 0.37);
  var vis = 0.0; let SL = 2; let ST = 6;
  for (var s = 0; s < SL; s++) {
    let phi = (f32(s) + noise) * PI / f32(SL);
    let dir2 = vec2f(cos(phi), sin(phi));
    let dir3 = normalize(right * dir2.x + up * dir2.y);
    let axis = normalize(cross(dir3, V));
    let projN = N - axis * dot(N, axis); let pl = length(projN);
    let cosN = sat(dot(projN / max(pl, 1e-4), V));
    let ortho = dir3 - V * dot(dir3, V);
    let n = sign(dot(ortho, projN)) * acos(cosN);
    var hc = vec2f(-1.0, -1.0);
    for (var side = 0; side < 2; side++) {
      let sg = select(-1.0, 1.0, side == 1);
      for (var j = 0; j < ST; j++) {
        let t = (f32(j) + noise2) / f32(ST); let off = dir2 * vec2f(1.0, -1.0) * sg * rpx * t * t * 2.0 + dir2 * vec2f(1.0, -1.0) * sg * 2.0;
        let q = p + vec2i(round(off));
        if (any(q < vec2i(0)) || any(q >= vec2i(F.res))) { break; }
        if (textureLoad(gD, q, 0) <= 0.0) { continue; }
        let S = wpos(q); let dv = S - P; let len = length(dv);
        let c = dot(dv / max(len, 1e-4), V);
        let fall = sat(1.0 - len * len / (R * R));
        hc[side] = max(hc[side], mix(-1.0, c, fall));
      }
    }
    var h0 = -acos(clamp(hc.x, -1.0, 1.0)); var h1 = acos(clamp(hc.y, -1.0, 1.0));
    h0 = n + max(h0 - n, -PI * 0.5); h1 = n + min(h1 - n, PI * 0.5);
    let sn = sin(n);
    vis += pl * ((-cos(2.0 * h0 - n) + cosN + 2.0 * h0 * sn) + (-cos(2.0 * h1 - n) + cosN + 2.0 * h1 * sn)) * 0.25;
  }
  let ao = sat(vis / f32(SL));
  textureStore(outA, gid.xy, vec4f(pow(ao, 1.25), 0.0, 0.0, 1.0));
}`, 'gtao');
    P.aoBlur = G.compute(`${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var gD: texture_depth_2d;
@group(0) @binding(3) var outA: texture_storage_2d<rgba8unorm, write>;
fn lin(dz: f32) -> f32 { return 1.0 / max(dz, 1e-9); }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let hr = vec2u(F.res) / 2u; if (gid.x >= hr.x || gid.y >= hr.y) { return; }
  let c = vec2i(gid.xy); let z0 = lin(textureLoad(gD, c * 2, 0));
  var s = 0.0; var w = 0.0;
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) {
    let q = clamp(c + vec2i(i, j), vec2i(0), vec2i(hr) - 1);
    let z = lin(textureLoad(gD, q * 2, 0));
    let wt = exp(-abs(z - z0) / (z0 * 0.03 + 1e-6)) * (1.0 - 0.1 * f32(abs(i) + abs(j)));
    s += textureLoad(src, q, 0).r * wt; w += wt;
  } }
  textureStore(outA, gid.xy, vec4f(s / max(w, 1e-4), 0.0, 0.0, 1.0));
}`, 'gtao-blur');

    // ---- TAA ----
    P.taa = G.compute(`${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var cur: texture_2d<f32>;
@group(0) @binding(2) var hist: texture_2d<f32>;
@group(0) @binding(3) var gM: texture_2d<f32>;
@group(0) @binding(4) var gD: texture_depth_2d;
@group(0) @binding(5) var smp: sampler;
@group(0) @binding(6) var outC: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var<uniform> TP: vec4f;   // x: reset
fn toY(c: vec3f) -> vec3f { return vec3f(dot(c, vec3f(0.25, 0.5, 0.25)), dot(c, vec3f(0.5, 0.0, -0.5)), dot(c, vec3f(-0.25, 0.5, -0.25))); }
fn fromY(c: vec3f) -> vec3f { return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
fn tm(c: vec3f) -> vec3f { return c / (1.0 + luma(c)); }
fn itm(c: vec3f) -> vec3f { return c / max(1.0 - luma(c), 1e-4); }
fn catmull(uv: vec2f) -> vec3f {
  let sz = vec2f(textureDimensions(hist)); let sp = uv * sz; let tc = floor(sp - 0.5) + 0.5; let f = sp - tc;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f)); let w1 = 1.0 + f * f * (-2.5 + 1.5 * f); let w2 = f * (0.5 + f * (2.0 - 1.5 * f)); let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2; let o12 = w2 / w12;
  let t0 = (tc - 1.0) / sz; let t3 = (tc + 2.0) / sz; let t12 = (tc + o12) / sz;
  var r = textureSampleLevel(hist, smp, vec2f(t12.x, t0.y), 0.0).rgb * (w12.x * w0.y);
  r += textureSampleLevel(hist, smp, vec2f(t0.x, t12.y), 0.0).rgb * (w0.x * w12.y);
  r += textureSampleLevel(hist, smp, vec2f(t12.x, t12.y), 0.0).rgb * (w12.x * w12.y);
  r += textureSampleLevel(hist, smp, vec2f(t3.x, t12.y), 0.0).rgb * (w3.x * w12.y);
  r += textureSampleLevel(hist, smp, vec2f(t12.x, t3.y), 0.0).rgb * (w12.x * w3.y);
  let ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / ws, vec3f(0.0));
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = vec2u(F.res); if (gid.x >= res.x || gid.y >= res.y) { return; }
  let p = vec2i(gid.xy); let uv = (vec2f(gid.xy) + 0.5) * F.invRes;
  let current = textureLoad(cur, p, 0); let c0 = current.rgb;
  let depth = textureLoad(gD, p, 0);
  // Log reverse-depth survives rgba16float even at the horizon.
  let depthKey = log2(1.0 + 1.0 / max(depth, 1e-7));
  // neighbourhood statistics in YCoCg of tonemapped colour; closest depth for the velocity
  var m1 = vec3f(0.0); var m2 = vec3f(0.0); var mn = vec3f(1e9); var mx = vec3f(-1e9);
  var best = -1.0; var bp = p;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let q = clamp(p + vec2i(i, j), vec2i(0), vec2i(res) - 1);
    let y = toY(tm(textureLoad(cur, q, 0).rgb));
    m1 += y; m2 += y * y; mn = min(mn, y); mx = max(mx, y);
    let dz = textureLoad(gD, q, 0); if (dz > best) { best = dz; bp = q; }
  } }
  var vel = vec2f(0.0);
  if (best > 0.0) { vel = textureLoad(gM, bp, 0).xy; }
  else {   // sky: reproject the view direction through last frame's camera
    let w = F.invViewProjNJ * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 1.0, 1.0);
    let dir = normalize(w.xyz / w.w - F.camPos);
    let pc = F.prevViewProjNJ * vec4f(F.camPos + dir * 1e6, 1.0);
    let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
    vel = uv - puv;
  }
  let puv = uv - vel;
  let yc = toY(tm(c0));
  if (TP.x > 0.5 || any(puv < vec2f(0.0)) || any(puv > vec2f(1.0))) { textureStore(outC, p, vec4f(c0, depthKey)); return; }
  let oldDepth = textureSampleLevel(hist, smp, puv, 0.0).a;
  // Reject revealed background instead of retaining the aircraft silhouette.
  if (abs(oldDepth - depthKey) > 0.14) { textureStore(outC, p, vec4f(c0, depthKey)); return; }
  var h = toY(tm(catmull(puv)));
  let mean = m1 / 9.0; let sd = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
  let g = 1.1;
  let bmin = max(mn, mean - sd * g); let bmax = min(mx, mean + sd * g);
  // clip the history toward the box centre
  let ctr = 0.5 * (bmax + bmin); let ext = 0.5 * (bmax - bmin) + 1e-5;
  let v = h - ctr; let a = abs(v / ext); let mxa = max(a.x, max(a.y, a.z));
  if (mxa > 1.0) { h = ctr + v / mxa; }
  let speed = length(vel * F.res);
  var alpha = mix(0.12, 0.85, sat(speed / 8.0));
  // Clouds have their own depth-aware history; do not accumulate them twice.
  alpha = max(alpha, smoothstep(0.0, 0.12, 1.0-current.a)*0.8);
  // Preserve painted markings and glints on the aircraft.
  if (depth > 0.0 && textureLoad(gM,p,0).w < 1.0) { alpha=max(alpha,0.32); }
  let o = fromY(mix(h, yc, alpha));
  textureStore(outC, p, vec4f(max(itm(o), vec3f(0.0)), depthKey));
}`, 'taa');
    P.taaBuf = G.buf(16, GPUBufferUsage.UNIFORM, null, 'taaU');

    // ---- auto-exposure: log-luminance histogram with a centre-weighted mean, smoothed over time ----
    P.hist = G.compute(`${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> bins: array<atomic<u32>, 128>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let q = vec2u(F.res) / 4u; if (gid.x >= q.x || gid.y >= q.y) { return; }
  let p = vec2i(gid.xy) * 4 + vec2i(i32(F.frame % 4u), i32((F.frame / 4u) % 4u));
  let c = textureLoad(src, p, 0).rgb; let l = luma(c);
  let uv = (vec2f(p) + 0.5) * F.invRes; let cw = 1.0 + 2.0 * exp(-dot(uv - vec2f(0.5, 0.55), uv - vec2f(0.5, 0.55)) * 8.0);
  let b = u32(clamp((log2(max(l, 1e-6)) + 14.0) / 22.0 * 126.0 + 1.0, 0.0, 127.0));
  atomicAdd(&bins[b], u32(cw * 4.0));
}`, 'exposure-hist');
    P.expo = G.compute(`${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read_write> bins: array<u32, 128>;
@group(0) @binding(2) var<storage, read_write> EX: array<f32, 8>;
@group(0) @binding(3) var<uniform> EP: vec4f;   // key, min EV, max EV, reset
@group(0) @binding(4) var<uniform> EQ: vec4f;   // exposure from the incident light (like a photographer's hand-held meter), share of scene metering
@compute @workgroup_size(1) fn main() {
  var tot = 0.0;
  for (var i = 0u; i < 128u; i++) { tot += f32(bins[i]); }
  // average of log luminance ignoring the darkest 40% and the brightest 5% of pixels
  var acc = 0.0; var sum = 0.0; var wsum = 0.0;
  for (var i = 0u; i < 128u; i++) {
    let c = f32(bins[i]); let lo = acc; acc += c;
    let a = max(lo, tot * 0.4); let b = min(acc, tot * 0.95);
    if (b > a) { let lg = (f32(i) - 1.0) / 126.0 * 22.0 - 14.0; sum += lg * (b - a); wsum += b - a; }
    bins[i] = 0u;
  }
  let avgL = exp2(select(-2.0, sum / max(wsum, 1.0), wsum > 0.0));
  var tgt = clamp(EP.x / avgL, exp2(EP.y), exp2(EP.z));
  if (EQ.x > 0.0) { tgt = clamp(exp2(mix(log2(EQ.x), log2(tgt), EQ.y)), exp2(EP.y), exp2(EP.z)); }
  var e = EX[0];
  if (EP.w > 0.5 || e <= 0.0 || e != e) { e = tgt; }
  let up = select(1.2, 2.6, tgt < e);
  e = e + (tgt - e) * (1.0 - exp(-F.dt * up));
  EX[0] = e;
}`, 'exposure');
    // ---- bloom: 13-tap downsample chain (Karis average on the first), tent upsample ----
    P.bDown = G.compute(`${G.BASE}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> BP: vec4f;   // x: first level (karis)
fn kw(c: vec3f) -> f32 { return 1.0 / (1.0 + luma(c)); }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = textureDimensions(dst); if (gid.x >= n.x || gid.y >= n.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(n); let t = 1.0 / vec2f(textureDimensions(src));
  let a = textureSampleLevel(src, smp, uv + t * vec2f(-2.0, -2.0), 0.0).rgb; let b = textureSampleLevel(src, smp, uv + t * vec2f(0.0, -2.0), 0.0).rgb; let c = textureSampleLevel(src, smp, uv + t * vec2f(2.0, -2.0), 0.0).rgb;
  let dd = textureSampleLevel(src, smp, uv + t * vec2f(-2.0, 0.0), 0.0).rgb; let e = textureSampleLevel(src, smp, uv, 0.0).rgb; let f = textureSampleLevel(src, smp, uv + t * vec2f(2.0, 0.0), 0.0).rgb;
  let g = textureSampleLevel(src, smp, uv + t * vec2f(-2.0, 2.0), 0.0).rgb; let h = textureSampleLevel(src, smp, uv + t * vec2f(0.0, 2.0), 0.0).rgb; let i = textureSampleLevel(src, smp, uv + t * vec2f(2.0, 2.0), 0.0).rgb;
  let j = textureSampleLevel(src, smp, uv + t * vec2f(-1.0, -1.0), 0.0).rgb; let k = textureSampleLevel(src, smp, uv + t * vec2f(1.0, -1.0), 0.0).rgb;
  let l = textureSampleLevel(src, smp, uv + t * vec2f(-1.0, 1.0), 0.0).rgb; let m = textureSampleLevel(src, smp, uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  var o = vec3f(0.0);
  if (BP.x > 0.5) {
    let g0 = (j + k + l + m) * 0.25; let g1 = (a + b + dd + e) * 0.25; let g2 = (b + c + e + f) * 0.25; let g3 = (dd + e + g + h) * 0.25; let g4 = (e + f + h + i) * 0.25;
    let w0 = kw(g0) * 0.5; let w1 = kw(g1) * 0.125; let w2 = kw(g2) * 0.125; let w3 = kw(g3) * 0.125; let w4 = kw(g4) * 0.125;
    o = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    o = min(o, vec3f(30000.0));
  } else {
    o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + dd + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  textureStore(dst, gid.xy, vec4f(o, 1.0));
}`, 'bloom-down');
    P.bUp = G.compute(`${G.BASE}
@group(0) @binding(0) var low: texture_2d<f32>;
@group(0) @binding(1) var cur: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let n = textureDimensions(dst); if (gid.x >= n.x || gid.y >= n.y) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(n); let t = 1.0 / vec2f(textureDimensions(low));
  var s = textureSampleLevel(low, smp, uv, 0.0).rgb * 4.0;
  s += (textureSampleLevel(low, smp, uv + vec2f(-t.x, 0.0), 0.0).rgb + textureSampleLevel(low, smp, uv + vec2f(t.x, 0.0), 0.0).rgb + textureSampleLevel(low, smp, uv + vec2f(0.0, -t.y), 0.0).rgb + textureSampleLevel(low, smp, uv + vec2f(0.0, t.y), 0.0).rgb) * 2.0;
  s += textureSampleLevel(low, smp, uv - t, 0.0).rgb + textureSampleLevel(low, smp, uv + t, 0.0).rgb + textureSampleLevel(low, smp, uv + vec2f(t.x, -t.y), 0.0).rgb + textureSampleLevel(low, smp, uv + vec2f(-t.x, t.y), 0.0).rgb;
  textureStore(dst, gid.xy, vec4f(textureLoad(cur, vec2i(gid.xy), 0).rgb + s / 16.0 * 0.85, 1.0));
}`, 'bloom-up');
    // ---- how much of the sun disk is visible (depth + clouds), for the lens flare ----
    P.sunVis = G.compute(`${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var gD: texture_depth_2d;
@group(0) @binding(2) var<storage, read_write> VIS: array<f32, 4>;
@group(0) @binding(3) var hdr: texture_2d<f32>;
var<workgroup> acc: array<f32, 64>;
@compute @workgroup_size(64) fn main(@builtin(local_invocation_index) li: u32) {
  let sp = F.sunScreen.xy; var v = 0.0;
  if (F.sunScreen.z > 0.5) {
    let a = f32(li) * 2.39996; let r = sqrt((f32(li) + 0.5) / 64.0) * 0.006;
    let uv = sp + vec2f(cos(a), sin(a)) * r * vec2f(F.res.y / F.res.x, 1.0);
    if (all(uv > vec2f(0.0)) && all(uv < vec2f(1.0))) {
      let p = vec2i(uv * F.res);
      if (textureLoad(gD, p, 0) <= 0.0) { v = sat(luma(textureLoad(hdr, p, 0).rgb) / (F.sunE * 2000.0)); }
    }
  }
  acc[li] = v; workgroupBarrier();
  if (li == 0u) { var s = 0.0; for (var i = 0u; i < 64u; i++) { s += acc[i]; } let target_ = s / 64.0; VIS[0] = mix(VIS[0], target_, 0.35); }
}`, 'sun-visibility');
    P.visBuf = G.buf(16, GPUBufferUsage.STORAGE, null, 'sunVis');
    P.bpBufs = [G.buf(16, GPUBufferUsage.UNIFORM, new Float32Array([1, 0, 0, 0])), G.buf(16, GPUBufferUsage.UNIFORM, new Float32Array([0, 0, 0, 0]))];
    P.binBuf = G.buf(128 * 4, GPUBufferUsage.STORAGE, null, 'bins');
    P.exBuf = G.buf(32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, new Float32Array([1.5, 1, 1, 1, 0, 0, 0, 0]), 'exposure');
    P.epBuf = G.buf(16, GPUBufferUsage.UNIFORM, new Float32Array([0.2, -3, 8, 1]), 'expoParams');
    P.eqBuf = G.buf(16, GPUBufferUsage.UNIFORM, new Float32Array([0, 1, 0, 0]), 'expoIncident');
  }

  function resize(w, h) {
    W = w; H = h;
    if (RT) Object.values(RT).forEach(t => t.destroy && t.destroy());
    const U = GPUTextureUsage, st = U.TEXTURE_BINDING | U.STORAGE_BINDING;
    RT = {
      ao0: d.createTexture({ size: [Math.max(1, w >> 1), Math.max(1, h >> 1)], format: 'rgba8unorm', usage: st }),
      ao1: d.createTexture({ size: [Math.max(1, w >> 1), Math.max(1, h >> 1)], format: 'rgba8unorm', usage: st }),
      t0: d.createTexture({ size: [w, h], format: 'rgba16float', usage: st | U.COPY_SRC }),
      t1: d.createTexture({ size: [w, h], format: 'rgba16float', usage: st | U.COPY_SRC })
    };
    RT.v0 = RT.t0.createView(); RT.v1 = RT.t1.createView();
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1); RT.bl = Math.max(1, Math.min(6, Math.floor(Math.log2(Math.min(bw, bh))) - 2));
    RT.bd = d.createTexture({ size: [bw, bh], format: 'rgba16float', mipLevelCount: RT.bl, usage: st });
    RT.bu = d.createTexture({ size: [bw, bh], format: 'rgba16float', mipLevelCount: RT.bl, usage: st });
    BG.dirty = true; first = true;
    GR.setInput('ao', RT.ao1.createView());
  }
  function bindAll() {
    const rt = GR.RT(), V = rt.V;
    BG.ao = G.bind(P.ao, 0, [frameBuf, V.depth, V.gN, RT.ao0.createView()]);
    BG.aoBlur = G.bind(P.aoBlur, 0, [frameBuf, RT.ao0.createView(), V.depth, RT.ao1.createView()]);
    BG.taa = [0, 1].map(k => G.bind(P.taa, 0, [frameBuf, V.hdr, (k ? RT.t0 : RT.t1).createView(), V.gM, V.depth, G.sampler('linClamp'), (k ? RT.t1 : RT.t0).createView(), P.taaBuf]));
    BG.hist = [0, 1].map(k => G.bind(P.hist, 0, [frameBuf, (k ? RT.t1 : RT.t0).createView(), P.binBuf]));
    BG.expo = G.bind(P.expo, 0, [frameBuf, P.binBuf, P.exBuf, P.epBuf, P.eqBuf]);
    GR.setInput('exposure', P.exBuf);
    const L = G.sampler('linClamp'), mv = (t, m) => t.createView({ baseMipLevel: m, mipLevelCount: 1 });
    BG.bDown = [0, 1].map(k => [G.bind(P.bDown, 0, [k ? RT.v1 : RT.v0, L, mv(RT.bd, 0), P.bpBufs[0]])]);
    for (let m = 1; m < RT.bl; m++) BG.bDown.forEach(a => a.push(G.bind(P.bDown, 0, [mv(RT.bd, m - 1), L, mv(RT.bd, m), P.bpBufs[1]])));
    BG.bUp = [];
    for (let m = RT.bl - 2; m >= 0; m--) BG.bUp.push([m, G.bind(P.bUp, 0, [m === RT.bl - 2 ? mv(RT.bd, m + 1) : mv(RT.bu, m + 1), mv(RT.bd, m), L, mv(RT.bu, m)])]);
    BG.sunVis = G.bind(P.sunVis, 0, [frameBuf, V.depth, P.visBuf, V.hdr]);
    GR.setInput('bloom', mv(RT.bu, 0)); GR.setInput('sunVis', P.visBuf);
    BG.dirty = false;
  }
  let expoKey = 0.2, expoRange = [-3, 8], resetExpo = true;
  function setExposureTarget(key, minEV, maxEV) { expoKey = key; expoRange = [minEV, maxEV]; }
  // incident metering: exposure that renders a sunlit 18% grey card as mid grey; blend = share left to scene metering
  function setIncident(ex, blend) { if (P.eqBuf) d.queue.writeBuffer(P.eqBuf, 0, new Float32Array([ex, blend, 0, 0])); }
  const hook = {
    name: 'post',
    resize,
    preLight(enc) {
      if (BG.dirty) bindAll();
      if (on.ao) { const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2); G.dispatch(enc, P.ao, [BG.ao], hw / 8, hh / 8, 1, 'gtao'); G.dispatch(enc, P.aoBlur, [BG.aoBlur], hw / 8, hh / 8, 1, 'gtao-blur'); }
    },
    post(enc) {
      if (BG.dirty) bindAll();
      hist ^= 1;
      d.queue.writeBuffer(P.taaBuf, 0, new Float32Array([first || !on.taa ? 1 : 0, 0, 0, 0]));
      G.dispatch(enc, P.sunVis, [BG.sunVis], 1, 1, 1, 'sunvis');
      G.dispatch(enc, P.taa, [BG.taa[hist]], W / 8, H / 8, 1, 'taa');
      GR.setInput('post', hist ? RT.v1 : RT.v0);
      d.queue.writeBuffer(P.epBuf, 0, new Float32Array([expoKey, expoRange[0], expoRange[1], resetExpo ? 1 : 0]));
      resetExpo = false;
      if (on.bloom) {
        for (let m = 0; m < RT.bl; m++) { const bw = Math.max(1, (W >> 1) >> m), bh = Math.max(1, (H >> 1) >> m); G.dispatch(enc, P.bDown, [BG.bDown[hist][m]], Math.ceil(bw / 8), Math.ceil(bh / 8)); }
        for (const [m, bg] of BG.bUp) { const bw = Math.max(1, (W >> 1) >> m), bh = Math.max(1, (H >> 1) >> m); G.dispatch(enc, P.bUp, [bg], Math.ceil(bw / 8), Math.ceil(bh / 8)); }
      }
      if (on.auto) { G.dispatch(enc, P.hist, [BG.hist[hist]], W / 32, H / 32, 1, 'hist'); G.dispatch(enc, P.expo, [BG.expo], 1); }
      first = false;
    }
  };
  return { init, hook, on, setExposureTarget, setIncident, resetHistory() { first = true; }, reset() { first = true; resetExpo = true; }, get exBuf() { return P.exBuf; }, RT: () => RT };
})();
