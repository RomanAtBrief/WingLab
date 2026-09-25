/* ================= Clouds: ray-marched volumetrics (Perlin-Worley + weather map), quarter-res with temporal reprojection ================= */
const GClouds = (() => {
  const WSIZE = 65536, BASE_S = 2200, DET_S = 90, WM = 512, SHM = 512, SH_SIZE = 64000;
  let d, frameBuf, R = {}, P = {}, BG = {}, W = 0, H = 0, hist = 0, first = true, on = true, genDone = false;
  const cfg = { base: 900, top: 2400, cover: 0.4, type: 0.9, dens: 1, dark: 0, seed: 1, steps: 64, cirrus: 0.5, cirrusAlt: 10000 };

  const NOISE = `
fn wr3(i: vec3i, per: i32) -> vec3i { return ((i % per) + per) % per; }
fn h33(i: vec3i) -> vec3f { let a = hash3i(i); let b = hash3i(i + vec3i(101, 211, 307)); let c = hash3i(i + vec3i(401, 503, 607)); return vec3f(a, b, c); }
fn worley3(p: vec3f, per: i32) -> f32 {
  let ip = vec3i(floor(p)); let fp = fract(p); var m = 9.0;
  for (var k = -1; k <= 1; k++) { for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let o = vec3i(i, j, k); let c = wr3(ip + o, per);
    let dd = vec3f(o) + h33(c) - fp; m = min(m, dot(dd, dd));
  } } }
  return 1.0 - sqrt(m);
}
fn grad3(i: vec3i, per: i32) -> vec3f { let h = h33(wr3(i, per)) * 2.0 - 1.0; return normalize(h + vec3f(1e-4)); }
fn perlin3(p: vec3f, per: i32) -> f32 {
  let i = vec3i(floor(p)); let f = fract(p); let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var v = array<f32, 8>();
  for (var c = 0; c < 8; c++) { let o = vec3i(c & 1, (c >> 1) & 1, c >> 2); v[c] = dot(grad3(i + o, per), f - vec3f(o)); }
  let x0 = mix(v[0], v[1], u.x); let x1 = mix(v[2], v[3], u.x); let x2 = mix(v[4], v[5], u.x); let x3 = mix(v[6], v[7], u.x);
  return mix(mix(x0, x1, u.y), mix(x2, x3, u.y), u.z);
}
fn wfbm(p: vec3f, f: f32) -> f32 { return worley3(p * f, i32(f)) * 0.625 + worley3(p * f * 2.0, i32(f * 2.0)) * 0.25 + worley3(p * f * 4.0, i32(f * 4.0)) * 0.125; }
`;
  // shared cloud density / lighting (bindings named here must be declared by the including shader)
  const CLOUD = `
struct CU { base: f32, top: f32, cover: f32, ctype: f32, dens: f32, calt: f32, steps: f32, cirrus: f32 };
const CR: f32 = 6371000.0;
const CSIG: f32 = 0.015;      // extinction of the densest cloud (1/m): a 67 m mean free path before density scaling
fn remapc(x: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return c + (x - a) / max(b - a, 1e-5) * (d - c); }
// weather map: r = coverage of a cumulus cell (1 in its middle), g = height of that cell's top as a share of the layer
fn cWeather(xz: vec2f) -> vec4f { return textureSampleLevel(wmap, smpR, (xz + F.cloudOff) / ${WSIZE}.0, 0.0); }
// Local coordinates retain precision next to the aircraft (no subtraction of Earth-sized floats).
fn cAlt(p: vec3f) -> f32 {let d=p.xz-F.camPos.xz;return F.planeAlt+p.y+dot(d,d)/(2.0*CR);}
fn cBase(p: vec3f, alt: f32, lod: f32) -> f32 {
  let h=(alt-CC.base)/(CC.top-CC.base);
  if(h<=0.0||h>=1.0){return 0.0;}
  // A volume envelope with a broad interior, soft base, domed turrets, and three-dimensional erosion.
  let world=vec3f(p.x+F.cloudOff.x,alt,p.z+F.cloudOff.y);
  let cellSize=1800.0;
  let grid=world.xz/cellSize;
  let cell=vec2i(floor(grid));
  var envelope=-1.0;
  // Include every envelope that can reach this cell; omitting a neighbour cuts vertical walls.
  for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){
    let id=cell+vec2i(i,j);
    let seed=hash2i(id);
    let centre=(vec2f(id)+vec2f(.5)+vec2f(hash2i(id+vec2i(17,91))-.5,hash2i(id+vec2i(43,7))-.5)*.45)*cellSize;
    let weather=textureSampleLevel(wmap,smpR,centre/${WSIZE}.0,0.0);
    let presence=smoothstep(.025,.30,weather.r);
    if(presence<.01){continue;}
    let radius=mix(550.0,1100.0,seed)*mix(.65,1.1,presence);
    let rise=mix(.5,1.0,hash2i(id+vec2i(13,59)));
    let verticalRadius=min((CC.top-CC.base)*.43,radius*rise);
    let cy=CC.base+verticalRadius*.80;
    let relative=vec3f((world.x-centre.x)/radius,(alt-cy)/verticalRadius,(world.z-centre.y)/radius);
    var sdf=1.0-length(relative);
    // Overlapping turrets give each cumulus a broad base and irregular crown.
    sdf=max(sdf,(1.0-length((relative-vec3f(.40,.28,.10))/vec3f(.65,.85,.65)))*.65);
    sdf=max(sdf,(1.0-length((relative-vec3f(-.36,.15,-.20))/vec3f(.70,.75,.70)))*.70);
    envelope=max(envelope,sdf-(1.0-presence)*.22);
  }}
  let q=world/${BASE_S}.0;
  let n=textureSampleLevel(nBase,smpR,q,lod);
  let erosion=(1.0-n.g)*.50+(1.0-n.b)*.20+(1.0-n.a)*.10;
  let base=smoothstep(0.0,.045,h);
  return sat((envelope-erosion+.24)*2.2)*base;

}
fn cFull(worldP: vec3f, alt: f32, sb: f32) -> f32 {
  let yaw=F.flight.x;let p=vec3f(cos(yaw)*worldP.x+sin(yaw)*worldP.z,worldP.y,-sin(yaw)*worldP.x+cos(yaw)*worldP.z);
  let h=sat((alt-CC.base)/(CC.top-CC.base));
  var q=vec3f(worldP.x+F.cloudOff.x,alt-F.cloudT*1.2,worldP.z+F.cloudOff.y)/${DET_S}.0;
  // Paired trailing vortices pull and curl wisps behind each wingtip.
  let age=max(-p.x,0.0)/max(F.wake.z,15.0);
  let wake=select(0.0,exp(-age*.65),p.x<0.0&&p.x>-220.0);
  let span=max(F.wake.x,1.0);
  let radius=2.0+age*2.5;
  for(var side=-1;side<=1;side+=2){
    let yz=p.yz-vec2f(-age*1.8,f32(side)*span*.45);
    let swirl=exp(-dot(yz,yz)/(radius*radius))*wake*F.wake.w;
    q+=vec3f(0.0,-yz.y,yz.x)*f32(side)*swirl*.08;
  }
  let dn=textureSampleLevel(nDet,smpR,q,0.0);
  let hf=dn.r*.625+dn.g*.25+dn.b*.125;
  let erosion=mix(hf,1.0-hf,sat(h*8.0))*.30*(1.0-sb*.5);
  let body=sat((sb-erosion)/(1.0-erosion));
  let channel=exp(-dot(p.yz,p.yz)/max(2.0,span*.25))*wake;
  return body*(1.0-channel*.65);
}
fn hgc(c: f32, g: f32) -> f32 { let d = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (4.0 * PI * pow(max(d, 1e-4), 1.5)); }
// two-lobe phase function: strong forward peak (silver linings) plus some back-scatter; k < 1 softens it for multiply scattered light
fn cPhase(c: f32, k: f32) -> f32 { return mix(hgc(c, 0.82 * k), hgc(c, -0.25 * k), 0.25) + 0.04 * hgc(c, 0.98) * k; }
// Solve in altitude coordinates: subtracting two Earth-radius squares in f32
// quantizes the layer intersection, producing horizontal bands as the view turns.
fn rayLayer(rd: vec3f, height: f32) -> vec2f {
  let b=(CR+F.alt)*rd.y;let c=(F.alt-height)*(2.0*CR+F.alt+height);
  let dd=b*b-c;if(dd<0.0){return vec2f(-1.0);}
  let q=-b-select(-sqrt(dd),sqrt(dd),b>=0.0);
  let other=c/select(1e-8,q,abs(q)>1e-8);
  return vec2f(min(q,other),max(q,other));
}
// shell intersection: returns (t0, t1) of the cloud layer along the ray (metres), t1 < t0 when missed
fn cShell(rd: vec3f) -> vec2f {
  let rb = rayLayer(rd, CC.base); let rt = rayLayer(rd, CC.top); let rg = rayLayer(rd, 0.0);
  if (F.alt < CC.base) {
    if (rg.x > 0.0) { return vec2f(1.0, 0.0); }
    return vec2f(rb.y, rt.y);
  } else if (F.alt > CC.top) {
    if (rt.x < 0.0) { return vec2f(1.0, 0.0); }
    return vec2f(rt.x, select(rt.y, rb.x, rb.x > 0.0));
  }
  return vec2f(0.0, select(rt.y, rb.x, rb.x > 0.0));
}
`;

  function init(fb) {
    d = G.device; frameBuf = fb;
    const U = GPUTextureUsage, st = U.TEXTURE_BINDING | U.STORAGE_BINDING;
    R.base = d.createTexture({ size: [64, 64, 64], dimension: '3d', format: 'rgba8unorm', mipLevelCount: 4, usage: st, label: 'cloudBase' });
    R.det = d.createTexture({ size: [32, 32, 32], dimension: '3d', format: 'rgba8unorm', usage: st, label: 'cloudDetail' });
    R.wmap = d.createTexture({ size: [WM, WM], format: 'rgba8unorm', usage: st, label: 'weather' });
    R.shadow = d.createTexture({ size: [SHM, SHM], format: 'rgba8unorm', usage: st, label: 'cloudShadow' });
    R.cu = G.buf(32, GPUBufferUsage.UNIFORM, null, 'cloudU');
    R.wu = G.buf(32, GPUBufferUsage.UNIFORM, null, 'weatherU');
    const C = G.COMMON;
    P.genBase = G.compute(`${G.BASE}${NOISE}
@group(0) @binding(0) var o: texture_storage_3d<rgba8unorm, write>;
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(64u))) { return; }
  let p = (vec3f(id) + 0.5) / 64.0;
  let pf = perlin3(p * 4.0, 4) * 0.55 + perlin3(p * 8.0, 8) * 0.28 + perlin3(p * 16.0, 16) * 0.17;
  let per = sat(pf * 0.9 + 0.5);
  let w = wfbm(p, 4.0);
  let pw = sat(remap(per, 0.0, 1.0, w, 1.0));
  textureStore(o, id, vec4f(pw, wfbm(p, 4.0), wfbm(p, 8.0), wfbm(p, 16.0)));
}`, 'cloud-noise-base');
    P.genDet = G.compute(`${G.BASE}${NOISE}
@group(0) @binding(0) var o: texture_storage_3d<rgba8unorm, write>;
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(32u))) { return; }
  let p = (vec3f(id) + 0.5) / 32.0;
  textureStore(o, id, vec4f(wfbm(p, 2.0), wfbm(p, 4.0), wfbm(p, 8.0), 1.0));
}`, 'cloud-noise-detail');
    P.down3 = G.compute(`
@group(0) @binding(0) var s: texture_3d<f32>;
@group(0) @binding(1) var o: texture_storage_3d<rgba8unorm, write>;
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(o); if (any(id >= n)) { return; }
  var c = vec4f(0.0); let b = vec3i(id) * 2;
  for (var k = 0; k < 8; k++) { c += textureLoad(s, b + vec3i(k & 1, (k >> 1) & 1, k >> 2), 0); }
  textureStore(o, id, c / 8.0);
}`, 'cloud-noise-down');
    P.weather = G.compute(`${G.BASE}
struct WU { cover: f32, ctype: f32, seed: f32, clump: f32, dark: f32, p0: f32, p1: f32, p2: f32 };
@group(0) @binding(0) var<uniform> WP: WU;
@group(0) @binding(1) var o: texture_storage_2d<rgba8unorm, write>;
fn wrapi(i: vec2i, per: i32) -> vec2i { return vec2i(((i.x % per) + per) % per, ((i.y % per) + per) % per); }
fn hs(i: vec2i, k: u32) -> f32 { return hash1((u32(i.x) * 1597334677u) ^ (u32(i.y) * 3812015801u) ^ (u32(WP.seed * 1000.0) * 2654435761u) ^ (k * 2246822519u)); }
fn vn(p: vec2f, per: i32) -> f32 { let i = vec2i(floor(p)); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hs(wrapi(i, per), 7u), hs(wrapi(i + vec2i(1, 0), per), 7u), u.x), mix(hs(wrapi(i + vec2i(0, 1), per), 7u), hs(wrapi(i + vec2i(1, 1), per), 7u), u.x), u.y); }
fn fb(p: vec2f, f0: f32) -> f32 { var v = 0.0; var a = 0.5; var f = f0; for (var k = 0; k < 4; k++) { v += vn(p * f, i32(f)) * a; a *= 0.5; f *= 2.0; } return v; }
// one layer of cumulus cells: (coverage, top height)
fn cells(uv: vec2f, n: f32, prob: f32, rmin: f32, rmax: f32, hmin: f32, hmax: f32, salt: u32) -> vec2f {
  let p = uv * n; let ip = floor(p); var cov = 0.0; var top = 0.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = vec2i(ip) + vec2i(i, j); let wc = wrapi(c, i32(n));
    let fp = vec2f(c) + 0.2 + 0.6 * vec2f(hs(wc, salt + 1u), hs(wc, salt + 2u));
    let clump = sat(0.2 + 2.2 * (fb(fract(fp / n), 3.0) - 0.5) * WP.clump + 0.55 * (1.0 - WP.clump));
    if (hs(wc, salt) > prob * clump * 1.6) { continue; }
    let r = mix(rmin, rmax, hs(wc, salt + 3u));
    let dv = p - fp; let ang = atan2(dv.y, dv.x);
    let lob = 1.0 + 0.2 * sin(ang * 3.0 + hs(wc, salt + 4u) * 6.28) + 0.12 * sin(ang * 5.0 + hs(wc, salt + 5u) * 6.28);
    let cc = sat(1.0 - length(dv) / (r * lob));
    if (cc > 0.0) {
      // a cumulus is roughly as tall as it is wide: top height from the cell radius (metres) against the layer thickness
      let rm = r * ${WSIZE}.0 / n;
      let tp = min(rm * mix(0.9, 1.9, pow(hs(wc, salt + 6u), 1.3)) * mix(hmin, hmax, hs(wc, salt + 7u)) / WP.p0, 1.0);
      if (cc > cov) { top = max(top, tp); }
      cov = max(cov, cc);
    }
  } }
  return vec2f(cov, top);
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ${WM}u || id.y >= ${WM}u) { return; }
  let uv = (vec2f(id.xy) + 0.5) / ${WM}.0;
  let wp = uv + (vec2f(fb(uv + 0.3, 24.0), fb(uv + 0.7, 24.0)) - 0.5) * 0.004;
  let big = cells(wp, 20.0, WP.cover * 1.25, 0.42, 0.72, 0.6, 1.0 + 0.4 * WP.ctype, 10u);
  let mid = cells(wp, 52.0, WP.cover * 0.85, 0.32, 0.52, 0.7, 1.2, 20u);
  let sml = cells(wp, 120.0, WP.cover * 0.45, 0.22, 0.38, 0.6, 1.0, 30u);
  var cov = big.x; var top = big.y;
  if (mid.x > cov) { top = select(max(top, mid.y), mid.y, cov < 0.05); }
  cov = max(cov, mid.x);
  if (sml.x > cov) { top = select(max(top, sml.y), sml.y, cov < 0.05); }
  cov = max(cov, sml.x);
  textureStore(o, id.xy, vec4f(cov, top, WP.dark, 1.0));
}`, 'cloud-weather');

    const DECL = `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> CC: CU;
@group(0) @binding(2) var nBase: texture_3d<f32>;
@group(0) @binding(3) var nDet: texture_3d<f32>;
@group(0) @binding(4) var wmap: texture_2d<f32>;
@group(0) @binding(5) var smpR: sampler;
@group(0) @binding(6) var transLut: texture_2d<f32>;
@group(0) @binding(7) var smpL: sampler;
@group(0) @binding(8) var<storage, read> SH: array<vec4f, 9>;
@group(0) @binding(12) var skyLut: texture_2d<f32>;`;
    const LIGHT = `
fn shEval(n: vec3f) -> vec3f {
  return SH[0].rgb * 0.282095 + SH[1].rgb * 0.488603 * n.y + SH[2].rgb * 0.488603 * n.z + SH[3].rgb * 0.488603 * n.x
    + SH[4].rgb * 1.092548 * n.x * n.y + SH[5].rgb * 1.092548 * n.y * n.z + SH[6].rgb * 0.315392 * (3.0 * n.z * n.z - 1.0)
    + SH[7].rgb * 1.092548 * n.x * n.z + SH[8].rgb * 0.546274 * (n.x * n.x - n.y * n.y);
}
fn sunT(alt: f32) -> vec3f {
  let r = RG + max(alt, 0.0) * 0.001; let uv = transUv(r, F.sunDir.y);
  let muH = -sqrt(max(0.0, 1.0 - (RG * RG) / (r * r)));
  return textureSampleLevel(transLut, smpL, uv, 0.0).rgb * smoothstep(muH - 0.01, muH + 0.01, F.sunDir.y);
}
// march through the layer: coarse steps through clear air, fine steps once inside a cloud (stepping back to catch its edge)
struct CM { L: vec3f, T: f32, dep: f32 };
fn march(rd: vec3f, tLimit: f32, jit: f32, nSteps: i32, detail: bool) -> CM {
  var o: CM; o.L = vec3f(0.0); o.T = 1.0; o.dep = 0.0;
  let sh = cShell(rd);
  let t0 = max(sh.x, 0.0); let t1 = min(min(sh.y, tLimit), t0 + 70000.0);
  if (t1 <= t0) { o.dep = select(1e7, -1.0, tLimit < sh.x); return o; }
  let cosT = dot(rd, F.sunDir);
  let sig = CSIG * CC.dens;
  let E = F.sunE * F.lightTint;
  let rS = RG + max(F.alt, 0.0) * 0.001;
  var skyL = textureSampleLevel(skyLut, smpL, skyLutUv(rS, vec3f(0.0, 1.0, 0.0), F.sunDir), 0.0).rgb;
  for (var k = 0; k < 4; k++) { let a = f32(k) * 1.5708; let dk = normalize(vec3f(cos(a), 0.55, sin(a))); skyL += textureSampleLevel(skyLut, smpL, skyLutUv(rS, dk, F.sunDir), 0.0).rgb; }
  skyL *= E * 0.13;
  let gndL = F.groundAlbedo * E * sunT(0.0) * max(F.sunDir.y, 0.0) / PI * 0.8;
  let p1 = cPhase(cosT, 1.0);
  let powK = sat(0.5 - 0.5 * cosT);
  var wsum = 0.0; var dsum = 0.0;
  // Cover the entire intersected layer. A fixed small step previously exhausted
  // the budget near the camera and truncated distant cloud volumes into walls.
  // World-space steps stay stable when terrain depth or camera direction changes.
  // Empty air uses longer steps; backtrack before entering a cloud surface.
  var t = t0 + jit * 24.0; var lastStep=24.0; var clearCount=0;
  for (var i = 0; i < nSteps*8; i++) {
    let dtF=clamp(18.0+t*.002,18.0,80.0)*88.0/f32(nSteps);
    if (t >= t1) { break; }
    let p = F.camPos + rd * t;
    let alt = cAlt(p);
    let lod = clamp(log2(max(t, 1.0) / 12000.0), 0.0, 2.0);
    var ds = cBase(p, alt, lod);
    if (ds<=0.0){clearCount+=1;lastStep=dtF*select(1.0,4.0,clearCount>3);t+=lastStep;continue;}
    if(lastStep>dtF*1.5){t=max(t0,t-lastStep+dtF);lastStep=dtF;clearCount=0;continue;}
    clearCount=0;lastStep=dtF;
    if (detail) { ds = cFull(p, alt, ds); }
    ds = smoothstep(0.0, 0.45, ds);         // real cumulus have crisp edges: density rises quickly at the surface
    if (ds > 0.003) {
      // optical depth toward the sun (cone of growing steps) plus one far sample
      var tau = 0.0; var ls = 20.0; var lt = 0.0;
      for (var k = 0; k < 6; k++) { let q = p + F.sunDir * (lt + ls * 0.5); tau += cBase(q, cAlt(q), min(lod + f32(k) * 0.4, 3.0)) * ls; lt += ls; ls *= 1.9; }
      let qf = p + F.sunDir * (lt + 900.0); tau += cBase(qf, cAlt(qf), 3.0) * 900.0;
      tau *= sig;
      let h = sat((alt - CC.base) / (CC.top - CC.base));
      // single scattering with the full phase function, then multiply scattered light that gets through far more easily and spreads evenly
      var ms = p1 * exp(-tau);
      var a = 0.28; var b = 0.42;
      for (var k = 0; k < 3; k++) { ms += a * exp(-tau * b) * 0.29; a *= 0.5; b *= 0.33; }
      let powder = mix(1.0, 1.0 - 0.38 * exp(-ds * sig * 120.0), powK);
      let sunL = E * sunT(alt) * ms * powder;
      let pu1 = p + vec3f(0.0, 70.0, 0.0); let pu2 = p + vec3f(0.0, 260.0, 0.0);
      let occ = exp(-sig * (cBase(pu1, alt + 70.0, lod + 0.5) * 90.0 + cBase(pu2, alt + 260.0, lod + 1.0) * 260.0) * 0.35);
      let ambL = skyL * mix(0.32, 1.0, sat(h * 1.6)) * (0.3 + 0.7 * occ) + gndL * mix(0.9, 0.2, h);
      let sE = ds * sig; let sT = exp(-sE * dtF);
      o.L += o.T * (sunL + ambL) * (1.0 - sT);
      let dw = o.T * (1.0 - sT); dsum += t * dw; wsum += dw;
      o.T *= sT;
      if (o.T < 0.008) { break; }
    }
    t += dtF;
  }
  o.dep = select(1e7, dsum / max(wsum, 1e-5), wsum > 0.0005);
  return o;
}`;
    P.march = G.compute(`${C}${G.ATMO}${CLOUD}${DECL}${LIGHT}
@group(0) @binding(9) var gD: texture_depth_2d;
@group(0) @binding(10) var outC: texture_storage_2d<rgba16float, write>;
@group(0) @binding(11) var outD: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let hr = vec2u(textureDimensions(outC)); if (gid.x >= hr.x || gid.y >= hr.y) { return; }
  let fp = vec2i(gid.xy) * 2;
  let fr = vec2i(F.res) - 1;
  let z = max(max(textureLoad(gD, min(fp, fr), 0), textureLoad(gD, min(fp + vec2i(1, 0), fr), 0)), max(textureLoad(gD, min(fp + vec2i(0, 1), fr), 0), textureLoad(gD, min(fp + vec2i(1, 1), fr), 0)));
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(hr);
  let nd = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let w = F.invViewProjNJ * vec4f(nd, 1.0, 1.0); let rd = normalize(w.xyz / w.w - F.camPos);
  var lim = 1e9;
  if (z > 0.0) { let s = F.invViewProjNJ * vec4f(nd, z, 1.0); lim = distance(s.xyz / s.w, F.camPos); }
  // Fixed, decorrelated sample offsets break march bands without frame-to-frame sparkle.
  let jit = hash1(gid.x*1973u+gid.y*9277u+89173u);
  if (F.flags == 32u) {
    let sh = cShell(rd); let p = F.camPos + rd * max(sh.x, 0.0);
    textureStore(outC, gid.xy, vec4f(sh.x / 10000.0, sh.y / 10000.0, cWeather(p.xz).r, cBase(p + rd * 300.0, cAlt(p + rd * 300.0), 0.0))); textureStore(outD, gid.xy, vec4f(1e7)); return;
  }
  let m = march(rd, lim, jit, i32(CC.steps), true);
  textureStore(outC, gid.xy, vec4f(m.L, m.T));
  textureStore(outD, gid.xy, vec4f(m.dep, 0.0, 0.0, 1.0));
}`, 'cloud-march');
    // temporal accumulation at quarter resolution
    P.temporal = G.compute(`${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var curC: texture_2d<f32>;
@group(0) @binding(2) var curD: texture_2d<f32>;
@group(0) @binding(3) var prevC: texture_2d<f32>;
@group(0) @binding(4) var prevD: texture_2d<f32>;
@group(0) @binding(5) var smp: sampler;
@group(0) @binding(6) var outC: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var outD: texture_storage_2d<r32float, write>;
@group(0) @binding(8) var<uniform> TP: vec4f;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let hr = vec2i(textureDimensions(curC)); let p = vec2i(gid.xy); if (p.x >= hr.x || p.y >= hr.y) { return; }
  var c = textureLoad(curC, p, 0); let dd = textureLoad(curD, p, 0).r;
  // Spatially denoise only samples from the same cloud layer. Do not smear
  // cloud colour into the protected aircraft/background boundary.
  var sum=c*2.0;var total=2.0;
  for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){
    if(i==0&&j==0){continue;}
    let q=clamp(p+vec2i(i,j),vec2i(0),hr-1);
    let nd=textureLoad(curD,q,0).r;let nc=textureLoad(curC,q,0);
    if(dd>=0.0&&nd>=0.0&&abs(nd-dd)<max(80.0,dd*.08)){
      let weight=exp(-abs(nc.a-c.a)*12.0)*select(.7,1.0,i==0||j==0);
      sum+=nc*weight;total+=weight;
    }
  }}
  c=sum/total;
  var mn = c; var mx = c;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) { let q = clamp(p + vec2i(i, j), vec2i(0), hr - 1); if (textureLoad(curD, q, 0).r < 0.0) { continue; } let v = textureLoad(curC, q, 0); mn = min(mn, v); mx = max(mx, v); } }
  let uv = (vec2f(p) + 0.5) / vec2f(hr);
  let w = F.invViewProjNJ * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 1.0, 1.0); let rd = normalize(w.xyz / w.w - F.camPos);
  let wp = F.camPos + rd * min(abs(dd), 5e5) + F.shift + vec3f(F.dt*6.0,0.0,0.0);
  let pc = F.prevViewProjNJ * vec4f(wp, 1.0);
  let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
  var o = c; var od = dd;
  // samples blocked by nearby geometry (the aircraft) never take cloud history
  if (dd >= 0.0 && TP.x < 0.5 && pc.w > 0.0 && all(puv > vec2f(0.0)) && all(puv < vec2f(1.0))) {
    let hc = clamp(textureSampleLevel(prevC, smp, puv, 0.0), mn - (mx - mn) * 0.25, mx + (mx - mn) * 0.25);
    let pd = textureSampleLevel(prevD, smp, puv, 0.0).r;
    // Disoccluded pixels and changed cloud boundaries start a fresh history.
    if (pd >= 0.0 && abs(pd-dd) < max(100.0, dd*0.12)) {
      let motion=length((uv-puv)*vec2f(hr));
      o = mix(hc, c, max(select(0.24,0.5,dd<400.0),smoothstep(0.5,5.0,motion)));
    }
  }
  textureStore(outC, p, o); textureStore(outD, p, vec4f(od, 0.0, 0.0, 1.0));
}`, 'cloud-temporal');
    // depth-aware upsample, aerial perspective on the clouds, and composite over the lit scene
    P.comp = G.compute(`${C}${G.ATMO}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var cC: texture_2d<f32>;
@group(0) @binding(2) var cD: texture_2d<f32>;
@group(0) @binding(3) var gD: texture_depth_2d;
@group(0) @binding(4) var hdrIn: texture_2d<f32>;
@group(0) @binding(5) var outH: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var apL: texture_3d<f32>;
@group(0) @binding(7) var apT: texture_3d<f32>;
@group(0) @binding(8) var smpL: sampler;
struct CU { base: f32, top: f32, cover: f32, ctype: f32, dens: f32, calt: f32, steps: f32, cirrus: f32 };
@group(0) @binding(9) var<uniform> CC: CU;
@group(0) @binding(10) var transLut: texture_2d<f32>;
@group(0) @binding(11) var<storage, read> SH: array<vec4f, 9>;
fn hgc(c: f32, g: f32) -> f32 { let d = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (4.0 * PI * pow(max(d, 1e-4), 1.5)); }
fn vn(p: vec2f) -> f32 { return vnoise2(p); }
// high cirrus: a thin sheet of wind-combed ice cloud (density, and how far along the ray it lies)
fn cirrus(rd: vec3f) -> vec2f {
  let camY = F.planeAlt + F.camPos.y;
  let dh = CC.calt - camY;
  if (CC.cirrus <= 0.0 || rd.y * dh <= 0.0 || abs(rd.y) < 0.004) { return vec2f(0.0, 1e9); }
  let t = dh / rd.y;
  if (t > 250000.0) { return vec2f(0.0, 1e9); }
  let w = (F.camPos.xz + rd.xz * t + F.cloudOff * 0.6) / 5200.0;
  let ca = 0.83; let sa = 0.56;
  var q = vec2f(ca * w.x + sa * w.y, -sa * w.x + ca * w.y) * vec2f(0.55, 3.2);
  q += vec2f(vn(q * 0.7) * 1.4, 0.0);
  var n = 0.0; var a = 0.5; var f = 1.0;
  for (var k = 0; k < 4; k++) { n += vn(q * f + f32(k) * 7.1) * a; a *= 0.55; f *= 2.03; }
  let big = vn(w * 0.35 + 3.3);
  let d = sat((n + big * 0.5 - 1.02 + CC.cirrus * 0.55) * 2.6);
  return vec2f(d * d * 0.55, t);
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = vec2i(F.res); let p = vec2i(gid.xy); if (p.x >= res.x || p.y >= res.y) { return; }
  let hr = vec2i(textureDimensions(cC));
  let dz = textureLoad(gD, p, 0);
  let fz = select(1e-7, dz, dz > 0.0);
  // bilateral: 4 nearest quarter-res samples weighted by depth similarity
  let hp = (vec2f(p) + 0.5) * 0.5 - 0.5; let b = vec2i(floor(hp)); let f = fract(hp);
  var acc = vec4f(0.0); var ws = 0.0; var dacc = 0.0; var dws = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1); let q = clamp(b + o, vec2i(0), hr - 1);
    let wb = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
    let qz = max(max(textureLoad(gD, min(q * 2, res - 1), 0), textureLoad(gD, min(q * 2 + vec2i(1, 0), res - 1), 0)), max(textureLoad(gD, min(q * 2 + vec2i(0, 1), res - 1), 0), textureLoad(gD, min(q * 2 + vec2i(1, 1), res - 1), 0)));
    let zq = select(1e-7, qz, qz > 0.0);
    let wd = exp(-min(abs(zq-fz)/max(fz,1e-7),80.0)*32.0);
    let w = wb * wd;
    let cq = textureLoad(cC, q, 0); let dq = textureLoad(cD, q, 0).r;
    acc += cq * w; ws += w;
    let wdep = w * (1.0 - cq.a) * select(0.0, 1.0, dq > 0.0 && dq < 1e6);
    dacc += dq * wdep; dws += wdep;
  }
  let cl = select(vec4f(0.0,0.0,0.0,1.0), acc / max(ws,1e-8), ws>1e-8); let cdep = select(1e7, dacc / max(dws, 1e-6), dws > 1e-5);
  var L = cl.rgb; let Tc = cl.a;
  // aerial perspective between the camera and the clouds
  let uv = (vec2f(p) + 0.5) * F.invRes;
  let s = sqrt(clamp(cdep, 0.0, 4e5) * 0.001 / ${GAtmos.AP_MAX}.0) * ${GAtmos.AP_N}.0;
  let zz = clamp((s - 0.5) / ${GAtmos.AP_N}.0, 0.5 / ${GAtmos.AP_N}.0, 1.0);
  let aL = textureSampleLevel(apL, smpL, vec3f(uv, zz), 0.0).rgb * F.sunE * F.lightTint; let aT = textureSampleLevel(apT, smpL, vec3f(uv, zz), 0.0).rgb;
  L = L * aT + aL * (1.0 - Tc) * sat(s);
  let h = textureLoad(hdrIn, p, 0);
  if (F.flags == 32u) { textureStore(outH, p, vec4f(textureLoad(cC, vec2i(p / 2), 0))); return; }
  if (F.flags == 30u) { textureStore(outH, p, vec4f(vec3f(1.0 - Tc), 1.0)); return; }
  if (F.flags == 31u) { textureStore(outH, p, vec4f(L, 1.0)); return; }
  // cirrus in front of or behind the cumulus, depending on the camera height
  let nd = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let wv = F.invViewProjNJ * vec4f(nd, 1.0, 1.0); let rd = normalize(wv.xyz / wv.w - F.camPos);
  var sceneT = 1e9;
  if (dz > 0.0) { let sp = F.invViewProjNJ * vec4f(nd, dz, 1.0); sceneT = distance(sp.xyz / sp.w, F.camPos); }
  let ci = cirrus(rd);
  var outC = h.rgb * Tc + L;
  if (ci.x > 0.001 && ci.y < sceneT) {
    let r = RG + CC.calt * 0.001;
    let st = textureSampleLevel(transLut, smpL, transUv(r, F.sunDir.y), 0.0).rgb;
    let cosT = dot(rd, F.sunDir);
    let sky = max(SH[0].rgb * 0.282095 + SH[1].rgb * 0.488603, vec3f(0.0));
    var Lc = F.sunE * F.lightTint * st * (mix(hgc(cosT, 0.7), hgc(cosT, -0.2), 0.3) * 0.9 + 0.06) + sky * 0.6;
    let s2 = sqrt(clamp(ci.y, 0.0, 4e5) * 0.001 / ${GAtmos.AP_MAX}.0) * ${GAtmos.AP_N}.0;
    let z2 = clamp((s2 - 0.5) / ${GAtmos.AP_N}.0, 0.5 / ${GAtmos.AP_N}.0, 1.0);
    let a2L = textureSampleLevel(apL, smpL, vec3f(uv, z2), 0.0).rgb * F.sunE * F.lightTint; let a2T = textureSampleLevel(apT, smpL, vec3f(uv, z2), 0.0).rgb;
    let al = ci.x;
    Lc = Lc * al * a2T + a2L * al * 0.0;
    if (ci.y < cdep) { outC = Lc + (1.0 - al) * outC; }
    else { outC = L + Tc * (Lc + (1.0 - al) * h.rgb); }
  }
  textureStore(outH, p, vec4f(outC, Tc));
}`, 'cloud-composite');
    // cloud shadow map: transmittance through the layer along the sun direction, around the camera
    P.shadow = G.compute(`${C}${G.ATMO}${CLOUD}${DECL}
@group(0) @binding(9) var outS: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(10) var<uniform> SO: vec4f;   // origin xz (render space), size
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${SHM}u || gid.y >= ${SHM}u) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / ${SHM}.0;
  let xz = SO.xy + (uv - 0.5) * SO.z;
  let sd = normalize(vec3f(F.sunDir.x, max(F.sunDir.y, 0.08), F.sunDir.z));
  let yB = CC.base - F.planeAlt;
  let span = (CC.top - CC.base) / sd.y;
  var tau = 0.0; let n = 24;
  let jit = hash12(vec2f(gid.xy));
  for (var i = 0; i < n; i++) {
    let t = (f32(i) + jit) / f32(n) * span;
    let p = vec3f(xz.x, yB, xz.y) + sd * t;
    tau += cBase(p, CC.base + sd.y * t, 1.0) * span / f32(n);
  }
  var T = exp(-tau * CSIG * CC.dens * 0.6);
  let edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
  T = mix(T, 1.0 - 0.6 * CC.cover, smoothstep(0.8, 1.0, edge));
  textureStore(outS, gid.xy, vec4f(mix(T, 1.0, 0.04), 0.0, 0.0, 1.0));
}`, 'cloud-shadow');
    R.so = G.buf(16, GPUBufferUsage.UNIFORM, null, 'cloudShadowU');
    R.tp = G.buf(16, GPUBufferUsage.UNIFORM, null, 'cloudTemporalU');
    // generate noise
    const e = d.createCommandEncoder();
    G.dispatch(e, P.genBase, [G.bind(P.genBase, 0, [R.base.createView({ baseMipLevel: 0, mipLevelCount: 1 })])], 16, 16, 16, 'noise');
    G.dispatch(e, P.genDet, [G.bind(P.genDet, 0, [R.det.createView()])], 8, 8, 8);
    for (let m = 1; m < 4; m++) { const n = 64 >> m; G.dispatch(e, P.down3, [G.bind(P.down3, 0, [R.base.createView({ baseMipLevel: m - 1, mipLevelCount: 1 }), R.base.createView({ baseMipLevel: m, mipLevelCount: 1 })])], n / 4, n / 4, n / 4); }
    d.queue.submit([e.finish()]);
    GR.setInput('cloudSh', R.shadow.createView());
  }

  function resize(w, h) {
    W = w; H = h;
    const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2)), U = GPUTextureUsage, st = U.TEXTURE_BINDING | U.STORAGE_BINDING;
    if (R.rt) Object.values(R.rt).forEach(t => t.destroy());
    R.rt = {
      c: d.createTexture({ size: [hw, hh], format: 'rgba16float', usage: st }), dd: d.createTexture({ size: [hw, hh], format: 'r32float', usage: st }),
      c0: d.createTexture({ size: [hw, hh], format: 'rgba16float', usage: st }), d0: d.createTexture({ size: [hw, hh], format: 'r32float', usage: st }),
      c1: d.createTexture({ size: [hw, hh], format: 'rgba16float', usage: st }), d1: d.createTexture({ size: [hw, hh], format: 'r32float', usage: st }),
      out: d.createTexture({ size: [w, h], format: 'rgba16float', usage: st | U.RENDER_ATTACHMENT | U.COPY_SRC })
    };
    BG.dirty = true; first = true;
  }
  function bindAll() {
    const A = GAtmos.R, rt = GR.RT(), V = rt.V, r = R.rt, L = G.sampler('linClamp'), RS = G.sampler('linRepeat');
    const common = [frameBuf, R.cu, R.base.createView(), R.det.createView(), R.wmap.createView(), RS, A.transV, L, A.sh];
    BG.march = G.bind(P.march, 0, [...common.slice(0, 8), null, V.depth, r.c.createView(), r.dd.createView(), A.skyV]);
    BG.temporal = [0, 1].map(k => G.bind(P.temporal, 0, [frameBuf, r.c.createView(), r.dd.createView(), (k ? r.c0 : r.c1).createView(), (k ? r.d0 : r.d1).createView(), G.sampler('linClamp'), (k ? r.c1 : r.c0).createView(), (k ? r.d1 : r.d0).createView(), R.tp]));
    BG.comp = [0, 1].map(k => G.bind(P.comp, 0, [frameBuf, (k ? r.c1 : r.c0).createView(), (k ? r.d1 : r.d0).createView(), V.depth, V.hdr, r.out.createView(), A.apLV, A.apTV, L, R.cu, A.transV, A.sh]));
    BG.shadow = G.bind(P.shadow, 0, [frameBuf, R.cu, R.base.createView(), null, R.wmap.createView(), RS, null, null, null, R.shadow.createView(), R.so]);
    BG.dirty = false;
  }
  function setConfig(c) {
    Object.assign(cfg, c);
    d.queue.writeBuffer(R.wu, 0, new Float32Array([cfg.cover, cfg.type, cfg.seed, cfg.clump ?? 0.6, cfg.dark, Math.max(100, cfg.top - cfg.base), 0, 0]));
    const e = d.createCommandEncoder(); G.dispatch(e, P.weather, [G.bind(P.weather, 0, [R.wu, R.wmap.createView()])], WM / 8, WM / 8); d.queue.submit([e.finish()]);
    first = true; GAtmos.markEnv();
  }
  function writeU() { d.queue.writeBuffer(R.cu, 0, new Float32Array([cfg.base, cfg.top, cfg.cover, cfg.type, cfg.dens, cfg.cirrusAlt, cfg.steps, cfg.cirrus])); }
  const hook = {
    name: 'clouds',
    resize,
    pre(enc, o) {
      if (!on) return;
      if (BG.dirty) bindAll();
      writeU();
      // shadow map follows the camera, snapped to texels
      const cam = o.camera.position, tx = SH_SIZE / SHM, ox = Math.round(cam.x / tx) * tx, oz = Math.round(cam.z / tx) * tx;
      d.queue.writeBuffer(R.so, 0, new Float32Array([ox, oz, SH_SIZE, 0]));
      GShadow.setCloudMap(ox, oz, SH_SIZE, true);
      G.dispatch(enc, P.shadow, [BG.shadow], SHM / 8, SHM / 8, 1, 'cloud-shadow');
    },
    postLight(enc) {
      if (!on) return;
      if (BG.dirty) bindAll();
      const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
      G.dispatch(enc, P.march, [BG.march], hw / 8, hh / 8, 1, 'clouds');
      hist ^= 1;
      d.queue.writeBuffer(R.tp, 0, new Float32Array([first ? 1 : 0, 0, 0, 0])); first = false;
      G.dispatch(enc, P.temporal, [BG.temporal[hist]], hw / 8, hh / 8, 1, 'cloud-temporal');
      G.dispatch(enc, P.comp, [BG.comp[hist]], W / 8, H / 8, 1, 'cloud-composite');
      enc.copyTextureToTexture({ texture: R.rt.out }, { texture: GR.RT().hdr }, [W, H]);
    }
  };
  return { init, hook, resetHistory() { first=true; }, setConfig, cfg, CLOUD, NOISE, R, WSIZE, set on(v) { on = v; if (!v) GShadow.setCloudMap(0, 0, 1, false); }, get on() { return on; } };
})();
