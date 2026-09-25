/* ================= Terrain: two places made on the GPU — Philippine karst islands and a Colorado Plateau canyon ================= */
const GTerrain = (() => {
  const T = THREE;
  // tile: size of the repeating world square (m); water: sea / river level (m); track: the flight line runs along +x at this z (fraction of tile)
  const PLACES = {
    islands: { id: 0, tile: 32768, water: 0, hmax: 560, seed: 11, track: 0.5, lodK: 6, waves: 0.45, treeLine: 9000, snowLine: 99999, albedo: [0.05, 0.085, 0.09] },
    canyon:  { id: 1, tile: 24576, water: 0, hmax: 660, seed: 23, track: 0.5, lodK: 7, waves: 0.05, treeLine: 9000, snowLine: 99999, albedo: [0.3, 0.17, 0.1] }
  };
  const GRID = 32, DTN = 1024;
  let d, frameBuf, R = {}, P = {}, BG = {}, place = null, RES = 2048, SHRES = 1024, genDue = false, shadowDue = false, ready = false;
  let cpu = null;                 // CPU copy of the heightmap (for camera clamp, node bounds)
  let nodes = new Float32Array(4 * 4096), nNodes = 0, waterNodes = new Float32Array(4 * 4096), nWater = 0;
  const q = { wx: 0, wz: 0 };     // world position of the render origin (double precision on the CPU)

  /* ---------- canyon rivers: sine-generated meanders and side canyons as distance fields (CPU) ---------- */
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // main river: meanders θ(φ) = ω sin φ − Jf ω³ sin 3φ (Langbein & Leopold, with Kinoshita flattening); the whole curve
  // is scaled so it advances exactly one tile along x, so it repeats seamlessly. One loop is a tight "horseshoe".
  function mainRiver(tile, track, seed) {
    const r = rng(seed), Jf = 0.018;
    const oms = [1.15, 2.12, 0.8, 1.55, 1.25, 1.95, 0.75, 1.45, 1.05, 1.7, 0.9, 1.35, 1.2, 1.8];
    const th = (w, p) => w * Math.sin(p) - Jf * w * w * w * Math.sin(3 * p);
    const mea = []; let X = 0;
    for (let i = 0; X < tile; i++) {
      const w = oms[i % oms.length], lam = 2200 + r() * 1300, n = Math.round(lam / 2);
      let adv = 0; for (let j = 0; j < n; j++) adv += Math.cos(th(w, 2 * Math.PI * (j + 0.5) / n)) * lam / n;
      mea.push({ w, lam, n }); X += adv;
    }
    const k = tile / X, cnt = mea.reduce((a, m) => a + m.n, 0);
    const px = new Float32Array(cnt), pz = new Float32Array(cnt), tx = new Float32Array(cnt), tz = new Float32Array(cnt), cv = new Float32Array(cnt);
    let x = 0, z = 0, o = 0;
    for (const m of mea) {
      const ds = m.lam * k / m.n;
      for (let j = 0; j < m.n; j++, o++) {
        const p = 2 * Math.PI * (j + 0.5) / m.n, a = th(m.w, p);
        const c = Math.cos(a), s = Math.sin(a);
        px[o] = x + c * ds / 2; pz[o] = z + s * ds / 2; tx[o] = c; tz[o] = s;
        cv[o] = (m.w * Math.cos(p) - 3 * Jf * m.w ** 3 * Math.cos(3 * p)) * 2 * Math.PI / (m.lam * k);
        x += c * ds; z += s * ds;
      }
    }
    let mz = 0; for (let i = 0; i < cnt; i++) mz += pz[i]; mz /= cnt;
    for (let i = 0; i < cnt; i++) pz[i] += track * tile - mz;
    return { px, pz, tx, tz, cv, n: cnt };
  }
  // exact-ish Euclidean distance transform on a periodic grid (dead reckoning: nearest seed propagated in two sweeps)
  function distField(N, tile, X, Z, n) {
    const cell = tile / N, NN = N * N, half = tile / 2, idx = new Int32Array(NN).fill(-1), dist = new Float32Array(NN).fill(1e18);
    const wx = new Float32Array(n), wz = new Float32Array(n);
    for (let k = 0; k < n; k++) { wx[k] = ((X[k] % tile) + tile) % tile; wz[k] = ((Z[k] % tile) + tile) % tile; }
    for (let k = 0; k < n; k++) {
      const i = Math.min(N - 1, Math.floor(wx[k] / cell)), j = Math.min(N - 1, Math.floor(wz[k] / cell)), o = j * N + i;
      const dx = (i + 0.5) * cell - wx[k], dz = (j + 0.5) * cell - wz[k], dd = dx * dx + dz * dz;
      if (dd < dist[o]) { dist[o] = dd; idx[o] = k; }
    }
    const test = (o, cx, cz, o2) => {
      const k = idx[o2]; if (k < 0 || k === idx[o]) return;
      let dx = cx - wx[k], dz = cz - wz[k];
      if (dx > half) dx -= tile; else if (dx < -half) dx += tile;
      if (dz > half) dz -= tile; else if (dz < -half) dz += tile;
      const dd = dx * dx + dz * dz; if (dd < dist[o]) { dist[o] = dd; idx[o] = k; }
    };
    for (let it = 0; it < 2; it++) {
      for (let j = 0; j < N; j++) {
        const jm = (j + N - 1) % N, cz = (j + 0.5) * cell;
        for (let i = 0; i < N; i++) {
          const im = (i + N - 1) % N, ip = (i + 1) % N, o = j * N + i, cx = (i + 0.5) * cell;
          test(o, cx, cz, j * N + im); test(o, cx, cz, jm * N + im); test(o, cx, cz, jm * N + i); test(o, cx, cz, jm * N + ip);
        }
      }
      for (let j = N - 1; j >= 0; j--) {
        const jp = (j + 1) % N, cz = (j + 0.5) * cell;
        for (let i = N - 1; i >= 0; i--) {
          const im = (i + N - 1) % N, ip = (i + 1) % N, o = j * N + i, cx = (i + 0.5) * cell;
          test(o, cx, cz, j * N + ip); test(o, cx, cz, jp * N + ip); test(o, cx, cz, jp * N + i); test(o, cx, cz, jp * N + im);
        }
      }
    }
    for (let o = 0; o < NN; o++) dist[o] = Math.sqrt(dist[o]);
    return { idx, dist, wx, wz };
  }
  const h16 = (() => { const f = new Float32Array(1), u = new Uint32Array(f.buffer); return v => { f[0] = v; const x = u[0], s = (x >>> 16) & 0x8000; const e = ((x >>> 23) & 0xff) - 112; if (e <= 0) return s; if (e >= 31) return s | 0x7bff; return s | (e << 10) | ((x & 0x7fffff) >>> 13); }; })();
  // rgba16f field: signed distance to the river (m, + on its left), inside-of-bend weight, distance to a side canyon, its depth factor
  function canyonField(pl) {
    const N = DTN, tile = pl.tile, cell = tile / N, NN = N * N, r = rng(pl.seed * 7 + 3);
    const M = mainRiver(tile, pl.track, pl.seed);
    const A = distField(N, tile, M.px, M.pz, M.n);
    const sd = new Float32Array(NN), ins = new Float32Array(NN);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = j * N + i, k = A.idx[o];
      let dx = (i + 0.5) * cell - A.wx[k], dz = (j + 0.5) * cell - A.wz[k];
      dx -= tile * Math.round(dx / tile); dz -= tile * Math.round(dz / tile);
      const side = M.tx[k] * dz - M.tz[k] * dx >= 0 ? 1 : -1;
      sd[o] = side * A.dist[o];
      ins[o] = Math.max(-1, Math.min(1, side * M.cv[k] * 330));
    }
    // blur the bend weight so it is continuous across the lines where the nearest bank switches
    const tmp = new Float32Array(NN), RB = 4;
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let s = 0; for (let k = -RB; k <= RB; k++) s += ins[j * N + (i + k + N) % N]; tmp[j * N + i] = s / (2 * RB + 1); }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let s = 0; for (let k = -RB; k <= RB; k++) s += tmp[((j + k + N) % N) * N + i]; ins[j * N + i] = s / (2 * RB + 1); }
    }
    // side canyons: short meandering washes that branch off the river, getting shallower toward their heads
    const TX = [], TZ = [], TF = [];
    const mainD = (x, z) => { const i = ((Math.floor(x / cell) % N) + N) % N, j = ((Math.floor(z / cell) % N) + N) % N; return A.dist[j * N + i]; };
    const wash = (x, z, th, L, f0, depth) => {
      const w = 0.3 + r() * 0.55, lam = 450 + r() * 700, ph = r() * 6.283, drift = (r() - 0.5) * 0.0005;
      for (let s = 0; s < L; s += 4) {
        const a = th + w * (Math.sin(2 * Math.PI * s / lam + ph) - Math.sin(ph)) + drift * s;
        x += Math.cos(a) * 4; z += Math.sin(a) * 4;
        if (s > 420 && mainD(x, z) < 280) break;
        const f = f0 * Math.pow(1 - s / L, 0.55);
        TX.push(x); TZ.push(z); TF.push(f);
        if (depth === 0 && s > L * 0.3 && s < L * 0.32 && r() < 0.6) wash(x, z, a + (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.5), L * (0.35 + r() * 0.2), f * 0.9, 1);
      }
    };
    for (let t = 0; t < 16; t++) {
      const k0 = Math.floor(r() * M.n), side = r() < 0.5 ? -1 : 1;
      wash(M.px[k0], M.pz[k0], Math.atan2(M.tz[k0], M.tx[k0]) + side * (Math.PI / 2 + (r() - 0.5) * 0.9), 1600 + r() * 4200, 1, 0);
    }
    const B = TX.length ? distField(N, tile, TX, TZ, TX.length) : null;
    const out = new Uint16Array(NN * 4);
    for (let o = 0; o < NN; o++) {
      out[o * 4] = h16(Math.max(-30000, Math.min(30000, sd[o])));
      out[o * 4 + 1] = h16(ins[o]);
      out[o * 4 + 2] = h16(B ? Math.min(B.dist[o], 30000) : 30000);
      out[o * 4 + 3] = h16(B && B.idx[o] >= 0 ? TF[B.idx[o]] : 0);
    }
    d.queue.writeTexture({ texture: R.dt }, out, { bytesPerRow: N * 8 }, [N, N]);
    R.river = M;
  }

  /* ---------- WGSL: noise and generators ---------- */
  const GEN_WGSL = `
struct Gen { place: u32, res: u32, tile: f32, seed: f32, water: f32, hmax: f32, track: f32, treeLine: f32, snowLine: f32, snow: f32, sunx: f32, suny: f32, sunz: f32, shres: f32, p0: f32, p1: f32 };
fn wrapi(i: vec2i, per: i32) -> vec2i { return vec2i(((i.x % per) + per) % per, ((i.y % per) + per) % per); }
fn hsh(i: vec2i) -> f32 { return hash1((u32(i.x) * 1597334677u) ^ (u32(i.y) * 3812015801u) ^ (u32(GP.seed) * 2654435761u)); }
fn hsh2(i: vec2i) -> vec2f { return vec2f(hsh(i), hsh(i + vec2i(7919, 104729))); }
fn gr(i: vec2i, per: i32) -> vec2f { let h = hsh(wrapi(i, per)) * 6.2831853; return vec2f(cos(h), sin(h)); }
// periodic gradient noise with derivatives: (value, d/dx, d/dy), period in lattice cells
fn gn(p: vec2f, per: i32) -> vec3f {
  let i = vec2i(floor(p)); let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = gr(i, per); let gb = gr(i + vec2i(1, 0), per); let gc = gr(i + vec2i(0, 1), per); let gd = gr(i + vec2i(1, 1), per);
  let va = dot(ga, f); let vb = dot(gb, f - vec2f(1.0, 0.0)); let vc = dot(gc, f - vec2f(0.0, 1.0)); let vd = dot(gd, f - vec2f(1.0, 1.0));
  let v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
  let dd = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (va - vb - vc + vd) + vec2f(vb, vc) - va);
  return vec3f(v, dd);
}
// fBm in tile units (uv 0..1 covers the tile); f0 = base frequency (cells per tile)
fn fbm(uv: vec2f, f0: f32, oct: i32, gain: f32) -> vec3f {
  var n = vec3f(0.0); var a = 0.5; var f = f0;
  for (var k = 0; k < oct; k++) { let g = gn(uv * f + vec2f(f32(k) * 17.3, f32(k) * 9.1), i32(f)); n += vec3f(g.x, g.yz * f) * a; a *= gain; f *= 2.0; }
  return n;
}
// derivative-damped fBm: smoother valleys, sharper ridges (IQ)
fn dfbm(uv: vec2f, f0: f32, oct: i32) -> vec3f {
  var n = vec3f(0.0); var a = 0.5; var f = f0; var dsum = vec2f(0.0);
  for (var k = 0; k < oct; k++) { let g = gn(uv * f + vec2f(f32(k) * 3.7, f32(k) * 11.9), i32(f)); dsum += g.yz; n += vec3f(g.x, g.yz * f) * a / (1.0 + dot(dsum, dsum)); a *= 0.5; f *= 2.0; }
  return n;
}
fn ridged(uv: vec2f, f0: f32, oct: i32) -> f32 {
  var s = 0.0; var a = 0.5; var f = f0; var ws = 0.0;
  for (var k = 0; k < oct; k++) { let g = gn(uv * f + vec2f(f32(k) * 5.3, f32(k) * 2.9), i32(f)); let r = sat(1.0 - abs(g.x) * 1.7); s += r * r * a; ws += a; a *= 0.5; f *= 2.0; }
  return s / ws;
}
// erosion gullies (after C. John): oriented cosine waves that run downhill; returns (value, d/dx, d/dy)
fn eros(p: vec2f, dir: vec2f, per: i32) -> vec3f {
  let ip = floor(p); let fp = fract(p);
  var va = vec3f(0.0); var wt = 0.0;
  for (var i = -2; i <= 1; i++) { for (var j = -2; j <= 1; j++) {
    let o = vec2f(f32(i), f32(j));
    let h = hsh2(wrapi(vec2i(ip - o), per)) * 0.5;
    let pp = fp + o - h;
    let w = exp(-dot(pp, pp) * 2.0); wt += w;
    let m = dot(pp, dir) * 6.2831853;
    va += vec3f(cos(m), -sin(m) * dir) * w;
  } }
  return va / wt;
}
fn erode(uv: vec2f, base: vec3f, f0: f32, oct: i32, slope: f32) -> vec3f {
  var h = vec3f(0.0); var a = 0.5; var f = 1.0;
  let g = base.yz * slope;
  for (var k = 0; k < oct; k++) {
    let dir = vec2f(g.y, -g.x) + vec2f(h.z, -h.y) * 0.8;
    h += eros(uv * f0 * f, dir, i32(f0 * f)) * a * vec3f(1.0, f, f);
    a *= 0.45; f *= 2.0;
  }
  return h;
}
// Worley F1, F2 and cell id, period in cells
fn worley(uv: vec2f, cells: f32) -> vec4f {
  let p = uv * cells; let ip = floor(p); var best = 9.0; var id = vec2i(0); var sec = 9.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = vec2i(ip) + vec2i(i, j); let wc = wrapi(c, i32(cells));
    let fp = vec2f(c) + hsh2(wc) * 0.8 + 0.1;
    let dd = length(p - fp);
    if (dd < best) { sec = best; best = dd; id = wc; } else if (dd < sec) { sec = dd; }
  } }
  return vec4f(best, sec, f32(id.x), f32(id.y));
}
`;
  /* shared by generation, material maps and drawing: canyon wall profiles and surface materials */
  const SURF_WGSL = `
fn lin(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
fn wrapf(c: vec2f, per: f32) -> vec2f { return c - per * floor(c / per); }
// periodic value noise (per = lattice cells per tile, so it repeats with the terrain)
fn vnPa(p: vec2f, per: vec2f) -> f32 {   // periodic value noise with a different period per axis (stretched features)
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(i - per * floor(i / per)); let b = hash12((i + vec2f(1.0, 0.0)) - per * floor((i + vec2f(1.0, 0.0)) / per));
  let c = hash12((i + vec2f(0.0, 1.0)) - per * floor((i + vec2f(0.0, 1.0)) / per)); let e = hash12((i + vec2f(1.0, 1.0)) - per * floor((i + vec2f(1.0, 1.0)) / per));
  return mix(mix(a, b, u.x), mix(c, e, u.x), u.y);
}
fn vnP(p: vec2f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(wrapf(i, per)); let b = hash12(wrapf(i + vec2f(1.0, 0.0), per));
  let c = hash12(wrapf(i + vec2f(0.0, 1.0), per)); let e = hash12(wrapf(i + vec2f(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, e, u.x), u.y);
}
// canyon wall: height above the river (m) at distance d (m) from its centre line; a = 0 outside a bend .. 1 inside (gentler slip-off slope)
// river bed, sandy bank, talus, lower cliff (Kayenta), bench, upper cliff (Navajo sandstone), rounded rim
fn cprof(d: f32, a: f32) -> f32 {
  let w = 96.0; let q = sat(d / w);
  var h = -12.0 + 10.0 * q * q;
  h += 8.0 * smoothstep(w - 8.0, w + 18.0, d);
  let t0 = w + 18.0; let tal = 48.0 + 75.0 * a;
  h += (40.0 + 48.0 * a) * pow(sat((d - t0) / tal), 1.6);
  let c0 = t0 + tal;
  h += (112.0 - 40.0 * a) * smoothstep(c0, c0 + 36.0, d);
  let l0 = c0 + 36.0; let l1 = l0 + 24.0 + 16.0 * a;
  h += 12.0 * smoothstep(l0, l1, d);
  h += (128.0 - 8.0 * a) * smoothstep(l1, l1 + 42.0, d);
  h += 14.0 * smoothstep(l1 + 18.0, l1 + 70.0, d);
  return h;
}
// side canyon: sandy wash floor between two cliff bands
fn cprofT(d: f32) -> f32 {
  var h = 3.0 + 3.0 * smoothstep(0.0, 16.0, d);
  h += 34.0 * pow(sat((d - 16.0) / 30.0), 1.6);
  h += 118.0 * smoothstep(46.0, 72.0, d);
  h += 10.0 * smoothstep(58.0, 76.0, d);
  h += 128.0 * smoothstep(90.0, 117.0, d);
  h += 14.0 * smoothstep(89.0, 130.0, d);
  return h;
}
// A = (distance to the river, bend weight, plateau height, distance to a side canyon), B.x = side-canyon depth factor
fn canyonH(A: vec4f, B: vec4f) -> f32 { return min(min(A.z, cprof(A.x, A.y)), mix(A.z, cprofT(A.w), B.x)); }
// horizontal rock layers of the Colorado Plateau by height above the river
fn strataCol(y: f32) -> vec3f {
  var c = lin(vec3f(0.66, 0.44, 0.32));
  let kb = 0.5 + 0.28 * sin(y * 0.21 + 1.3 * sin(y * 0.13));
  c = mix(c, mix(lin(vec3f(0.6, 0.34, 0.24)), lin(vec3f(0.74, 0.49, 0.37)), kb), smoothstep(40.0, 50.0, y));
  let nb = 0.5 + 0.22 * sin(y * 0.13 + 2.0 * sin(y * .033));
  let nav = mix(mix(lin(vec3f(0.8, 0.48, 0.29)), lin(vec3f(0.84, 0.55, 0.35)), nb), lin(vec3f(0.85, 0.62, 0.44)), smoothstep(215.0, 292.0, y));
  c = mix(c, nav, smoothstep(155.0, 168.0, y));
  c = mix(c, lin(vec3f(0.84, 0.66, 0.5)), smoothstep(290.0, 304.0, y) * 0.75);
  c = mix(c, lin(vec3f(0.62, 0.38, 0.28)), smoothstep(318.0, 324.0, y));
  let eb = 0.5 + 0.5 * sin(y * 0.19);
  c = mix(c, mix(lin(vec3f(0.86, 0.6, 0.46)), lin(vec3f(0.93, 0.84, 0.72)), eb), smoothstep(388.0, 396.0, y));
  c = mix(c, lin(vec3f(0.52, 0.42, 0.36)), smoothstep(540.0, 548.0, y));
  return c;
}
struct Surf { col: vec3f, rough: f32, rock: f32, veg: f32, sand: f32 };
// uv: tile coordinates, y: height (m), N: normal, fine: 0 for the material maps .. 1 for pixels close to the camera
fn canyonSurf(uv: vec2f, y: f32, N: vec3f, A: vec4f, B: vec4f, fine: f32) -> Surf {
  let slope = 1.0 - N.y;
  let n1 = vnP(uv * 512.0, 512.0); let n2 = vnP(uv * 2048.0, 2048.0); let n3 = vnP(uv * 64.0, 64.0);
  var s: Surf;
  var rock = smoothstep(0.2, 0.42, slope + 0.12 * (n1 - 0.5));
  // cliffs: layered rock, fine bedding, desert varnish hanging from rims and ledges
  var rc = strataCol(y + 5.0 * (n3 - 0.5));
  // Individual sediment beds and eroded seams, layered over the scanned stone.
  let bedPhase=y*1.65+1.6*n1+0.65*sin(y*.13+n3*8.0);
  let bedding=pow(.5+.5*sin(bedPhase),12.0);
  let broken=.3+.7*vnP(uv*4096.0+2.7,4096.0);
  rc *= .94+.09*sin(y*.49+n3*3.0)-.18*bedding*broken;
  rc = mix(rc,lin(vec3f(.39,.24,.16)),pow(smoothstep(.55,.85,n2),2.0)*.23);
  let st = 0.55 * vnP(uv * 2048.0, 2048.0) + 0.45 * vnP(uv * 512.0, 512.0);
  let rimY = select(305.0, 166.0, y < 172.0);
  let len = mix(40.0, 150.0, vnP(uv * 256.0 + 9.0, 256.0));
  let varnish = smoothstep(0.56, 0.82, st) * (0.3 + 0.7 * smoothstep(rimY - len, rimY - 4.0, y)) * smoothstep(0.5, 0.8, slope) * smoothstep(60.0, 90.0, y);
  rc = mix(rc, lin(vec3f(0.33, 0.2, 0.14)), varnish * 0.72);
  rc *= 0.82 + 0.35 * n2;
  // flats: pale slickrock crossed by two sets of joints, orange drift sand in wind-stretched sheets, scattered shrubs
  let sn = 0.55 * vnPa(uv * vec2f(1024.0, 256.0), vec2f(1024.0, 256.0)) + 0.45 * vnP(uv * 2048.0 + 3.7, 2048.0);
  let sandy = smoothstep(0.6, 0.85, sn + 0.35 * (n3 - 0.5));
  var fc = mix(lin(vec3f(0.8, 0.6, 0.45)), lin(vec3f(0.82, 0.52, 0.34)), sandy);
  // cross-bedded slickrock seen from above: broad sweeping bands of paler and darker rock
  let xb = fract(dot(vec2f(700.0, 420.0), uv) + 2.2 * vnP(uv * 96.0 + 2.1, 96.0) + 0.8 * vnP(uv * 384.0, 384.0));
  fc *= (0.95 + 0.1 * smoothstep(0.2, 0.5, xb) * (1.0 - smoothstep(0.55, 0.9, xb))) * (0.95 + 0.08 * n1);
  let wj = 5.0 * vnP(uv * 128.0 + 1.3, 128.0) + 1.5 * vnP(uv * 512.0, 512.0);
  let j1 = cos(6.2831853 * dot(vec2f(300.0, 170.0), uv) + wj); let j2 = cos(6.2831853 * dot(vec2f(-110.0, 330.0), uv) + wj * 1.3);
  let jm = smoothstep(0.5, 0.8, vnP(uv * 96.0 + 7.7, 96.0));
  let joint = max(smoothstep(0.97, 0.998, j1) * jm, smoothstep(0.975, 0.998, j2) * 0.7 * jm * jm) * (1.0 - sandy);
  fc = mix(fc, lin(vec3f(0.62, 0.44, 0.3)), joint * (0.35 + 0.35 * fine));
  fc = mix(fc, strataCol(y + 3.0) * 1.04, 0.15 + 0.45 * smoothstep(300.0, 200.0, y));
  var veg = (0.12 * smoothstep(250.0, 295.0, y) + 0.18 * smoothstep(0.5, 0.85, n3) + 0.25 * joint) * (1.0 - rock);
  fc = mix(fc, lin(vec3f(0.35, 0.34, 0.22)), 0.1 * veg);
  if (fine > 0.0) {
    // cross-bedding: fine curved laminae in the bare rock
    let lam = fract(dot(vec2f(2600.0, 1500.0), uv) + 3.0 * vnP(uv * 128.0 + 5.1, 128.0) + 1.5 * vnP(uv * 512.0, 512.0));
    fc *= 1.0 - 0.07 * smoothstep(0.8, 0.95, lam) * (1.0 - sandy) * fine;
    let cp = uv * 8192.0; let ci = wrapf(floor(cp), 8192.0); let fp = fract(cp) - (0.25 + 0.5 * hash22(ci));
    let shrub = step(hash12(ci + 31.7), 0.3 * veg) * smoothstep(0.34, 0.16, length(fp)) * fine;
    fc = mix(fc, lin(vec3f(0.3, 0.33, 0.2)) * (0.8 + 0.4 * hash12(ci + 5.3)), shrub);
  }
  // river banks: sand bars and a ribbon of tamarisk and willow
  let riv = smoothstep(148.0, 111.0, A.x) * smoothstep(13.0, 6.0, y) * step(-0.4, y);
  let rip = riv * smoothstep(0.35, 0.6, n1 + 0.35 * n2);
  fc = mix(fc, lin(vec3f(0.8, 0.69, 0.53)), riv);
  fc = mix(fc, lin(vec3f(0.23, 0.31, 0.12)) * (0.8 + 0.4 * n2), rip);
  rock *= 1.0 - 0.6 * riv;
  veg = max(veg, rip);
  let wet = smoothstep(1.0, 0.1, y) * step(-0.4, y);
  fc *= 1.0 - 0.35 * wet;
  // painted badlands: grey, red, yellow and mauve bands
  if (B.y > 0.01) {
    let bb = fract(y / 11.0 + 0.4 * n3);
    var bc = lin(vec3f(0.7, 0.6, 0.52));
    bc = mix(bc, lin(vec3f(0.78, 0.5, 0.36)), smoothstep(0.2, 0.3, bb));
    bc = mix(bc, lin(vec3f(0.86, 0.74, 0.54)), smoothstep(0.5, 0.6, bb));
    bc = mix(bc, lin(vec3f(0.66, 0.52, 0.5)), smoothstep(0.78, 0.86, bb));
    fc = mix(fc, bc * (0.9 + 0.2 * n2), B.y); rc = mix(rc, bc * 0.95, B.y); veg *= 1.0 - B.y;
  }
  s.col = mix(fc, rc, rock); s.rock = rock; s.veg = veg; s.sand = sandy * (1.0 - rock);
  s.rough = mix(mix(0.9, 0.95, sandy), 0.84, rock) - 0.3 * wet;
  return s;
}
// A = (erosion, ridge sharpness, reef shelf, islet), B = (reef patches, sandbar, cliff coast, 0)
fn islandSurf(uv: vec2f, y: f32, N: vec3f, A: vec4f, B: vec4f, fine: f32) -> Surf {
  let slope = 1.0 - N.y;
  let n1 = vnP(uv * 256.0, 256.0); let n2 = vnP(uv * 2048.0, 2048.0); let n3 = vnP(uv * 32.0, 32.0);
  var s: Surf; s.rock = 0.0; s.veg = 0.0; s.sand = 0.0; s.rough = 0.9;
  if (y < 0.2) {
    // sea floor: white coral sand, darker reef heads and sea grass
    let reefP = smoothstep(0.1, 0.32, B.x + 0.12 * (n1 - 0.5) + 0.2 * (A.z - 0.6)) * smoothstep(-16.0, -1.4, y) * (1.0 - smoothstep(-0.2, 0.5, B.y));
    let grass = smoothstep(0.62, 0.78, n1) * smoothstep(-7.0, -1.8, y) * (1.0 - reefP) * (1.0 - smoothstep(-0.2, 0.4, B.y));
    var c = lin(vec3f(0.95, 0.93, 0.85));
    c = mix(c, mix(lin(vec3f(0.47, 0.41, 0.31)), lin(vec3f(0.3, 0.34, 0.27)), n2), reefP * 0.85);
    c = mix(c, lin(vec3f(0.17, 0.24, 0.14)), grass * 0.8);
    c = mix(c, lin(vec3f(0.62, 0.62, 0.57)), smoothstep(-14.0, -34.0, y) * 0.5);
    s.col = c; s.sand = 1.0; s.rough = 0.95; return s;
  }
  let rock = smoothstep(0.5, 0.74, slope + 0.22 * (n1 - 0.5));
  // limestone: pale grey, dark rain streaks, some rust staining
  var rc = mix(lin(vec3f(0.72, 0.71, 0.66)), lin(vec3f(0.56, 0.55, 0.51)), n2);
  let st = 0.65 * vnP(uv * 4096.0, 4096.0) + 0.35 * vnP(uv * 1024.0, 1024.0);
  rc = mix(rc, lin(vec3f(0.25, 0.25, 0.23)), smoothstep(0.5, 0.78, st) * 0.7);
  rc = mix(rc, lin(vec3f(0.75, 0.63, 0.48)), smoothstep(0.68, 0.9, n1) * 0.35);
  // jungle: deep saturated greens, lighter patches of young growth
  var jc = mix(lin(vec3f(0.2, 0.34, 0.09)), lin(vec3f(0.27, 0.41, 0.1)), n1);
  jc = mix(jc, lin(vec3f(0.37, 0.48, 0.15)), smoothstep(0.62, 0.82, n3) * 0.55);
  jc *= 0.85 + 0.3 * n2;
  let pin = smoothstep(0.78, 0.93, A.y) * smoothstep(70.0, 170.0, y) * 0.85;
  let beach = smoothstep(2.4, 1.1, y + 1.6 * (n2 - 0.5)) * smoothstep(0.4, 0.18, slope);
  let r = max(rock, pin) * (1.0 - beach);
  var c = mix(jc, rc, r);
  c = mix(c, lin(vec3f(0.3, 0.3, 0.27)), smoothstep(3.5, 1.5, y) * smoothstep(0.45, 0.7, slope) * 0.8);   // wet tidal notch
  c = mix(c, lin(vec3f(0.95, 0.92, 0.83)), beach);
  s.col = c; s.rock = r; s.sand = beach; s.veg = (1.0 - r) * (1.0 - beach);
  s.rough = mix(mix(0.82, 0.78, r), 0.92, beach);
  return s;
}
`;
  const GENFN_WGSL = `
struct GenOut { h: f32, a: vec4f, b: vec4f };
fn trackDist(uv: vec2f) -> f32 { var dz = uv.y - GP.track; dz = dz - round(dz); return abs(dz) * GP.tile; }
// crescent-shaped sandbars in the lagoons
fn sandbar(uv: vec2f) -> f32 {
  let cells = 22.0; let p = uv * cells; let ip = floor(p); var best = -9.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = vec2i(ip) + vec2i(i, j); let wc = wrapi(c, i32(cells));
    if (hsh(wc + vec2i(77, 13)) > 0.3) { continue; }
    let fp = vec2f(c) + hsh2(wc + vec2i(5, 5)) * 0.6 + 0.2;
    let ang = hsh(wc + vec2i(9, 2)) * 3.14159;
    let dv = p - fp; let ca = cos(ang); let sa = sin(ang);
    let qv = vec2f(ca * dv.x + sa * dv.y, -sa * dv.x + ca * dv.y);
    let len = mix(0.09, 0.2, hsh(wc + vec2i(1, 44))); let wid = len * mix(0.09, 0.17, hsh(wc + vec2i(8, 8)));
    let qq = vec2f(qv.x / len, (qv.y + 0.4 * qv.x * qv.x / len) / wid);
    best = max(best, 1.0 - dot(qq, qq) * (0.85 + 0.3 * fbm(uv, 90.0, 2, 0.5).x));
  } }
  return best;
}
// one karst islet per kept cell: a warped ellipse with sheer lower walls and a jagged cone or dome above
fn islets(uv: vec2f, cells: f32, keepP: f32, hmin: f32, hmax: f32, dome: f32, rg: f32, salt: i32) -> vec3f {   // (height, shelf, islet)
  let p = uv * cells; let ip = floor(p); var best = -100.0; var shelf = 0.0; var isl = 0.0;
  let wob = fbm(uv + f32(salt) * 0.13, cells * 3.0, 2, 0.5).x;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = vec2i(ip) + vec2i(i, j); let wc = wrapi(c, i32(cells)); let id = wc + vec2i(salt * 1000, salt * 77);
    if (hsh(id + vec2i(11, 5)) > keepP) { continue; }
    let fp = vec2f(c) + 0.25 + 0.5 * hsh2(id + vec2i(3, 3));
    let ang = hsh(id + vec2i(9, 2)) * 3.14159; let asp = mix(1.0, 2.3, hsh(id + vec2i(4, 1)));
    let rad = mix(0.12, 0.28, hsh(id + vec2i(31, 7)));
    let dv = p - fp; let ca = cos(ang); let sa = sin(ang);
    let qv = vec2f(ca * dv.x + sa * dv.y, (-sa * dv.x + ca * dv.y) * asp) / rad;
    // a second, smaller lobe along the long axis makes ridges and twin peaks
    let off = (hsh(id + vec2i(2, 8)) - 0.5) * 1.6;
    let qv2 = (qv - vec2f(off, 0.0)) / mix(0.45, 0.8, hsh(id + vec2i(5, 9)));
    let t1 = 1.0 - length(qv) * (1.0 + 0.35 * wob);
    let t2 = select(-9.0, 1.0 - length(qv2) * (1.0 + 0.35 * wob), hsh(id + vec2i(7, 3)) > 0.4);
    let t = max(t1, t2 * 0.85);
    shelf = max(shelf, smoothstep(-0.5, 0.0, t) * step(0.45, hsh(id + vec2i(6, 6))));
    if (t > 0.0) {
      let H = mix(hmin, hmax, pow(hsh(id + vec2i(3, 17)), 1.3));
      let wf = mix(0.2, 0.7, hsh(id + vec2i(12, 1)));
      let wall = smoothstep(0.0, 0.07, t);
      let top = mix(pow(sat(t), mix(0.3, 0.62, hsh(id + vec2i(1, 12)))), smoothstep(0.0, 0.55, t), max(dome, 0.35 * hsh(id + vec2i(9, 9))));
      let hh = H * (wf * wall + (1.0 - wf) * top) * (0.7 + 0.6 * rg) + 0.5;
      if (hh > best) { best = hh; isl = 1.0; }
    }
  } }
  return vec3f(best, shelf, isl);
}
fn islandsGen(uv: vec2f) -> GenOut {
  let arch = fbm(uv + vec2f(0.61, 0.17), 3.0, 4, 0.5).x;               // island clusters vs open sea
  let wpL = uv + vec2f(fbm(uv + 0.13, 10.0, 3, 0.5).x, fbm(uv + 0.71, 10.0, 3, 0.5).x) * 0.008;
  // large islands: jagged limestone ridges under jungle, cut by gullies; cliffs or coves along the shore
  let b = dfbm(wpL, 5.0, 6);
  let m1 = b.x + 0.55 * arch - 0.14;
  let land = smoothstep(0.0, 0.12, m1);
  let rg = ridged(wpL, 36.0, 4);
  let e = erode(uv, b, 120.0, 4, 0.02);
  let cliffK = smoothstep(-0.1, 0.25, fbm(uv + 0.9, 40.0, 3, 0.5).x);
  var hL = 0.8 + 2.4 * smoothstep(0.0, 0.006, m1) + land * 190.0 + land * land * rg * 290.0 + (e.x - 0.5) * 70.0 * land;
  hL += 30.0 * cliffK * smoothstep(0.0, 0.0025, m1);
  if (m1 < 0.0) { hL = -2.2 + m1 * 600.0; }
  // karst islets around them (none on the big islands themselves)
  let wpS = uv + vec2f(fbm(uv + 0.3, 60.0, 3, 0.5).x, fbm(uv + 0.8, 60.0, 3, 0.5).x) * 0.0018;
  let dens = smoothstep(-0.32, 0.05, arch) * (1.0 - smoothstep(-0.1, 0.0, m1));
  let rgS = ridged(uv + 0.37, 600.0, 3);
  let A0 = islets(wpS, 44.0, 0.55 * dens, 40.0, 260.0, 0.25, rgS, 0);
  let A1 = islets(wpS + 0.21, 120.0, 0.26 * dens * smoothstep(-0.15, 0.12, arch), 14.0, 70.0, 0.85, rgS, 1);
  let hS = max(A0.x, A1.x); let shelfS = max(A0.y, A1.y * 0.8); let isl = max(A0.z, A1.z);
  // sea floor: open sea → drop-off → reef flat; sandbars in the lagoons
  let s1 = smoothstep(-0.1, 0.0, m1);
  let reef = fbm(uv + 0.29, 110.0, 4, 0.5).x;
  let shallow = sat(max(s1, shelfS) + 0.3 * reef - 0.05);
  var hSea = -36.0 + 12.0 * fbm(uv + 0.5, 9.0, 3, 0.5).x;
  hSea = mix(hSea, -10.0 + 3.0 * reef, smoothstep(0.0, 0.35, shallow));
  hSea = mix(hSea, -1.8 + 1.4 * reef, smoothstep(0.5, 0.85, shallow));
  let sb = mix(-9.0, sandbar(uv), smoothstep(0.3, 0.6, shallow) * smoothstep(-0.2, 0.05, arch));
  hSea = max(hSea, mix(hSea, -2.6 + 3.2 * smoothstep(-0.2, 0.8, sb), smoothstep(-1.0, -0.3, sb)));
  var o: GenOut;
  o.h = max(max(hSea, hL), hS);
  o.a = vec4f(e.x, max(rg * land, rgS * isl), shallow, isl);
  o.b = vec4f(reef, sb, cliffK, 0.0);
  return o;
}
fn canyonGen(uv: vec2f, dt: vec4f) -> GenOut {
  let far = abs(dt.x);
  // plateau: slickrock swells and sand sheets
  var base = 304.0 + 7.0 * fbm(uv, 20.0, 4, 0.5).x + 3.0 * fbm(uv + 0.37, 180.0, 3, 0.5).x;
  // slickrock swells: irregular low domes, only in places
  let sw = worley(uv + 0.004 * vec2f(fbm(uv, 40.0, 3, 0.5).x, fbm(uv + 0.3, 40.0, 3, 0.5).x), 110.0);
  base += 7.0 * smoothstep(0.7, 0.0, sw.x) * smoothstep(0.1, 0.35, fbm(uv + 0.55, 12.0, 3, 0.5).x) * smoothstep(260.0, 520.0, far);
  // mesas and buttes far from the river: talus apron, Carmel slope, Entrada cliff, cap rock
  let mzone = smoothstep(1800.0, 3500.0, far);
  let mb = fbm(uv + 0.23, 3.0, 5, 0.5).x + 0.05 * fbm(uv + 0.61, 50.0, 3, 0.5).x - 0.04;
  var mesa = 14.0 * smoothstep(-0.02, 0.06, mb) + 58.0 * smoothstep(0.06, 0.064, mb) + 14.0 * smoothstep(0.064, 0.09, mb);
  mesa += 150.0 * smoothstep(0.12, 0.123, mb) + 90.0 * smoothstep(0.19, 0.193, mb);
  base += mesa * mzone;
  // painted badlands: rounded, gullied mounds
  let bz = smoothstep(0.08, 0.2, fbm(uv + 0.77, 2.0, 3, 0.5).x) * smoothstep(1200.0, 2600.0, far) * (1.0 - smoothstep(0.0, 0.05, mb) * mzone);
  let mnd = 1.0 - abs(fbm(uv + 0.5, 70.0, 4, 0.5).x) * 2.0;
  let e = erode(uv, fbm(uv, 8.0, 3, 0.5), 260.0, 4, 0.01);
  base = mix(base, 290.0 + 44.0 * mnd * mnd + (e.x - 0.5) * 26.0, bz);
  // the canyon: alcoves and buttresses bend the rim line
  // Break up the smooth wall silhouette at several geological scales.
  let eroded=48.0*fbm(uv+.11,155.0,3,.5).x+12.0*fbm(uv+.47,680.0,3,.5).x;
  let pert=eroded*smoothstep(112.0,195.0,far);
  var o: GenOut;
  o.a = vec4f(max(far + pert, 0.0), sat(dt.y), base, max(dt.z + pert * 0.5, 0.0));
  o.b = vec4f(dt.w, bz, 0.0, 0.0);
  o.h = canyonH(o.a, o.b);
  return o;
}
`;

  function init(fb) {
    d = G.device; frameBuf = fb;
    if (G.S.lite || /lite/.test(location.search)) { RES = 1024; SHRES = 512; }
    const U = GPUTextureUsage;
    R.genBuf = G.buf(64, GPUBufferUsage.UNIFORM, null, 'gen');
    R.dt = d.createTexture({ size: [DTN, DTN], format: 'rgba16float', usage: U.TEXTURE_BINDING | U.COPY_DST, label: 'riverField' });
    const C = G.BASE;
    P.gen = G.compute(`${C}${GEN_WGSL}${SURF_WGSL}${GENFN_WGSL}
@group(0) @binding(0) var<uniform> GP: Gen;
@group(0) @binding(1) var oH: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var oA: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var oB: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var dtT: texture_2d<f32>;
@group(0) @binding(5) var dtS: sampler;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= GP.res || id.y >= GP.res) { return; }
  let uv = (vec2f(id.xy) + 0.5) / f32(GP.res);
  var o: GenOut;
  if (GP.place == 1u) { o = canyonGen(uv, textureSampleLevel(dtT, dtS, uv, 0.0)); } else { o = islandsGen(uv); }
  textureStore(oH, id.xy, vec4f(o.h, 0.0, 0.0, 1.0));
  textureStore(oA, id.xy, o.a); textureStore(oB, id.xy, o.b);
}`, 'terrain-gen');
    P.hdown = G.compute(`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(dst).x; if (id.x >= n || id.y >= n) { return; }
  let p = vec2i(id.xy) * 2;
  let h = (textureLoad(src, p, 0).r + textureLoad(src, p + vec2i(1, 0), 0).r + textureLoad(src, p + vec2i(0, 1), 0).r + textureLoad(src, p + vec2i(1, 1), 0).r) * 0.25;
  textureStore(dst, id.xy, vec4f(h, 0.0, 0.0, 1.0));
}`, 'terrain-hdown');
    // exact min/max over 4×4 blocks for the CPU (node bounds, camera clamp)
    P.minmax = G.compute(`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outB: array<vec2f>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(src).x / 4u; if (id.x >= n || id.y >= n) { return; }
  var mn = 1e9; var mx = -1e9;
  for (var j = 0; j < 4; j++) { for (var i = 0; i < 4; i++) { let h = textureLoad(src, vec2i(id.xy) * 4 + vec2i(i, j), 0).r; mn = min(mn, h); mx = max(mx, h); } }
  outB[id.y * n + id.x] = vec2f(mn, mx);
}`, 'terrain-minmax');
    P.maps = G.compute(`${C}${GEN_WGSL}${SURF_WGSL}
@group(0) @binding(0) var<uniform> GP: Gen;
@group(0) @binding(1) var hgt: texture_2d<f32>;
@group(0) @binding(2) var aux: texture_2d<f32>;
@group(0) @binding(3) var aux2: texture_2d<f32>;
@group(0) @binding(4) var oN: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var oC: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(6) var oM: texture_storage_2d<rgba8unorm, write>;
fn H(p: vec2i) -> f32 { let n = i32(GP.res); return textureLoad(hgt, wrapi(p, n), 0).r; }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= GP.res || id.y >= GP.res) { return; }
  let p = vec2i(id.xy); let uv = (vec2f(id.xy) + 0.5) / f32(GP.res);
  let tx = GP.tile / f32(GP.res);
  let h = H(p); let hl = H(p - vec2i(1, 0)); let hr = H(p + vec2i(1, 0)); let hd = H(p - vec2i(0, 1)); let hu = H(p + vec2i(0, 1));
  let n = normalize(vec3f(hl - hr, 2.0 * tx, hd - hu));
  var curv = 0.0;
  for (var k = 1; k <= 3; k++) { let s = i32(k * k); curv += (H(p + vec2i(s, 0)) + H(p - vec2i(s, 0)) + H(p + vec2i(0, s)) + H(p - vec2i(0, s)) - 4.0 * h) / (f32(s) * tx); }
  curv = clamp(curv * 0.02, -1.0, 1.0);       // + in hollows, - on ridges
  let A = textureLoad(aux, p, 0); let B = textureLoad(aux2, p, 0);
  var s: Surf;
  if (GP.place == 1u) { s = canyonSurf(uv, h, n, A, B, 0.0); } else { s = islandSurf(uv, h, n, A, B, 0.0); }
  let col = s.col * (1.0 + 0.12 * sat(-curv) - 0.12 * sat(curv) * step(0.0, h - GP.water));
  textureStore(oN, p, vec4f(n, curv));
  textureStore(oC, p, vec4f(sqrt(sat3(col)), 0.0));
  textureStore(oM, p, vec4f(s.rock, 1.0 - s.sand, s.veg, step(h, GP.water)));
}`, 'terrain-maps');
    // sun visibility (soft horizon test toward the sun) and sky visibility (horizon-based ambient occlusion)
    P.shade = G.compute(`${C}${GEN_WGSL}
@group(0) @binding(0) var<uniform> GP: Gen;
@group(0) @binding(1) var hgt: texture_2d<f32>;
@group(0) @binding(2) var oS: texture_storage_2d<rgba8unorm, write>;
fn Hl(uv: vec2f, lvl: i32) -> f32 {
  let n = i32(textureDimensions(hgt, lvl).x); let x = uv * f32(n) - 0.5; let i = vec2i(floor(x)); let f = fract(x);
  let a = textureLoad(hgt, wrapi(i, n), lvl).r; let b = textureLoad(hgt, wrapi(i + vec2i(1, 0), n), lvl).r;
  let c = textureLoad(hgt, wrapi(i + vec2i(0, 1), n), lvl).r; let e = textureLoad(hgt, wrapi(i + vec2i(1, 1), n), lvl).r;
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = u32(GP.shres); if (id.x >= n || id.y >= n) { return; }
  let uv = (vec2f(id.xy) + 0.5) / f32(n);
  let h0 = max(Hl(uv, 0), GP.water) + 2.0;
  let sun = vec3f(GP.sunx, GP.suny, GP.sunz);
  let hz = length(sun.xz);
  var vis = 1.0;
  if (sun.y < 0.0) { vis = 0.0; }
  else if (hz > 1e-3) {
    let dir = sun.xz / hz; let tanEl = sun.y / hz;
    var t = GP.tile / GP.shres * 0.7;
    for (var i = 0; i < 56; i++) {
      let lvl = clamp(i32(log2(max(t / (GP.tile / f32(GP.res)) * 0.25, 1.0))), 0, 5);
      let hs = Hl(uv + dir * t / GP.tile, lvl);
      let ray = h0 + t * tanEl;
      vis = min(vis, sat((ray - hs) / (t * 0.02) + 0.5));
      t *= 1.11;
      if (t > 25000.0 || vis <= 0.0) { break; }
    }
  }
  var occ = 0.0;
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.785398 + 0.39; let dir = vec2f(cos(a), sin(a));
    var mx = 0.0; var t = GP.tile / f32(GP.res);
    for (var i = 0; i < 12; i++) {
      let lvl = clamp(i32(log2(max(t / (GP.tile / f32(GP.res)) * 0.5, 1.0))), 0, 5);
      let hs = Hl(uv + dir * t / GP.tile, lvl);
      mx = max(mx, (hs - h0) / t);
      t *= 1.6;
    }
    occ += sin(atan(mx));
  }
  let sky = sat(1.0 - occ / 8.0);
  textureStore(oS, id.xy, vec4f(vis, sky * sky * 0.85 + 0.15 * sky, 0.0, 1.0));
}`, 'terrain-shade');
    // tileable detail textures (r: albedo modulation, gb: normal, a: height)
    // 0 rock · 1 scrub · 2 jungle canopy · 3 beach sand · 4 desert ground · 5 water ripples
    P.detail = G.compute(`${C}${GEN_WGSL}
@group(0) @binding(0) var<uniform> GP: Gen;
@group(0) @binding(1) var oD: texture_storage_2d_array<rgba8unorm, write>;
fn layerH(uv: vec2f, l: u32) -> vec2f {   // (height, albedo modulation)
  switch l {
    case 0u: {   // rock: blocky joints and a weathered, pitted surface
      let w = fbm(uv, 4.0, 4, 0.5).x;
      let cr = worley(uv + w * 0.03, 8.0); let edge = smoothstep(0.0, 0.12, cr.y - cr.x);
      let blk = hsh(vec2i(cr.zw) + vec2i(3, 1));
      let h = 0.3 + 0.2 * blk * edge + 0.35 * (fbm(uv, 16.0, 5, 0.5).x + 0.5) * (0.6 + 0.4 * edge);
      return vec2f(h, 0.92 + 0.12 * blk + 0.12 * fbm(uv, 32.0, 3, 0.5).x - 0.16 * (1.0 - edge));
    }
    case 1u: { let n = fbm(uv, 32.0, 5, 0.6).x; let c = fbm(uv + 0.5, 8.0, 3, 0.5).x; return vec2f(0.5 + n * 0.6, 0.95 + 0.2 * c + 0.15 * n); }
    case 2u: {   // jungle canopy seen from above: round crowns with dark gaps
      var hh = 0.0; var alb = 0.0;
      for (var s = 0; s < 2; s++) {
        let w = worley(uv + vec2f(f32(s) * 0.5), select(20.0, 34.0, s == 1));
        let r = select(0.66, 0.58, s == 1) * (0.8 + 0.4 * hsh(vec2i(w.zw)));
        let t = sat(1.0 - w.x / r);
        let crown = sqrt(t) * (0.8 + 0.2 * hsh(vec2i(w.zw) + vec2i(3, 9)));
        if (crown > hh) { hh = crown; alb = 0.8 + 0.4 * hsh(vec2i(w.zw) + vec2i(5, 1)); }
      }
      hh += 0.06 * fbm(uv, 128.0, 2, 0.5).x;
      return vec2f(hh, alb * (0.55 + 0.6 * hh));
    }
    case 3u: {   // sand: soft ripples and grain
      let rip = sin((uv.x + 0.08 * fbm(uv, 4.0, 3, 0.5).x) * 6.2831853 * 24.0) * 0.5 + 0.5;
      let n = fbm(uv, 64.0, 3, 0.5).x;
      return vec2f(rip * 0.25 + n * 0.4 + 0.35, 0.98 + 0.08 * n);
    }
    case 4u: {   // desert ground: pebbles and crust
      let w = worley(uv, 48.0); let peb = smoothstep(0.35, 0.1, w.x) * step(0.55, hsh(vec2i(w.zw)));
      let n = fbm(uv, 24.0, 4, 0.5).x;
      return vec2f(0.4 + 0.3 * n + 0.3 * peb, 0.97 + 0.1 * n - 0.12 * peb + 0.1 * hsh(vec2i(w.zw) + vec2i(4, 4)) * peb);
    }
    default: {   // water ripples: waves in many directions with whole-number wave vectors, so it tiles
      var h = 0.0;
      for (var k = 0; k < 14; k++) {
        let a = f32(k) * 2.39996 + 0.2; let fr = 5.0 + f32(k) * 1.7;
        let kv = round(vec2f(cos(a), sin(a)) * fr);
        h += sin(6.2831853 * dot(kv, uv) + f32(k) * 1.93) / max(length(kv), 1.0);
      }
      return vec2f(0.5 + h * 0.18, 1.0);
    }
  }
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let N = 512u; if (id.x >= N || id.y >= N) { return; }
  let uv = (vec2f(id.xy) + 0.5) / f32(N); let e = 1.0 / f32(N);
  let hc = layerH(uv, id.z);
  let hx = layerH(uv + vec2f(e, 0.0), id.z).x - layerH(uv - vec2f(e, 0.0), id.z).x;
  let hy = layerH(uv + vec2f(0.0, e), id.z).x - layerH(uv - vec2f(0.0, e), id.z).x;
  var ks = array<f32, 6>(4.0, 3.0, 6.0, 2.0, 3.0, 5.0);
  let k = ks[id.z];
  let nn = normalize(vec3f(-hx * k, -hy * k, 1.0));
  textureStore(oD, id.xy, id.z, vec4f(sat(hc.y * 0.5), nn.x * 0.5 + 0.5, nn.y * 0.5 + 0.5, sat(hc.x)));
}`, 'terrain-detail');

    R.detail = d.createTexture({ size: [512, 512, 6], format: 'rgba8unorm', mipLevelCount: 10, usage: U.TEXTURE_BINDING | U.STORAGE_BINDING | U.RENDER_ATTACHMENT | U.COPY_DST, label: 'detail' });
    const e = d.createCommandEncoder();
    d.queue.writeBuffer(R.genBuf, 0, new Float32Array(16));
    G.dispatch(e, P.detail, [G.bind(P.detail, 0, [R.genBuf, R.detail.createView({ dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1 })])], 64, 64, 6);
    d.queue.submit([e.finish()]);
    G.genMips(R.detail, 'rgba8unorm', 6);
    // CC0 scanned stone, packed as luminance / tangent normal XY / roughness.
    // Keep the generated material as a fallback if the local asset cannot load.
    fetch('assets/rock-packed.png').then(r => {if(!r.ok)throw new Error(r.status);return r.blob();})
      .then(b => createImageBitmap(b,{colorSpaceConversion:'none',premultiplyAlpha:'none'}))
      .then(bitmap => {d.queue.copyExternalImageToTexture({source:bitmap},{texture:R.detail,origin:[0,0,0]},[512,512]);bitmap.close();G.genMips(R.detail,'rgba8unorm',6);})
      .catch(e => console.warn('Using procedural rock material:',e.message));

    // grid mesh shared by terrain and water nodes
    const vs = [], ix = [];
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) vs.push(i / GRID, j / GRID);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) { const a = j * (GRID + 1) + i, b = a + GRID + 1; ix.push(a, b, a + 1, a + 1, b, b + 1); }
    R.gridV = G.buf(vs.length * 4, GPUBufferUsage.VERTEX, new Float32Array(vs)); R.gridI = G.buf(ix.length * 2, GPUBufferUsage.INDEX, new Uint16Array(ix)); R.gridN = ix.length;
    R.nodeBuf = G.buf(nodes.byteLength, GPUBufferUsage.STORAGE, null, 'nodes');
    R.waterBuf = G.buf(waterNodes.byteLength, GPUBufferUsage.STORAGE, null, 'waterNodes');
    R.shadowNodeBuf = G.buf(4 * 4096 * 4 * 4, GPUBufferUsage.STORAGE, null, 'shadowNodes');
    R.tBuf = G.buf(64, GPUBufferUsage.UNIFORM, null, 'terrU');
    buildDrawPipes();
  }

  /* ---------- drawing ---------- */
  const DRAW_COMMON = () => `${G.COMMON}${SURF_WGSL}
struct TU { lodK: f32, texel: f32, maxMip: f32, res: f32, detail: f32, time: f32, waveAmp: f32, p1: f32 };
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> TP: TU;
@group(0) @binding(2) var<storage, read> nodes: array<vec4f>;
@group(0) @binding(3) var hgt: texture_2d<f32>;
fn wrapi(i: vec2i, per: i32) -> vec2i { return vec2i(((i.x % per) + per) % per, ((i.y % per) + per) % per); }
fn Hs(uv: vec2f, lvl: i32) -> f32 {
  let n = i32(textureDimensions(hgt, lvl).x); let x = uv * f32(n) - 0.5; let i = vec2i(floor(x)); let f = fract(x);
  let a = textureLoad(hgt, wrapi(i, n), lvl).r; let b = textureLoad(hgt, wrapi(i + vec2i(1, 0), n), lvl).r;
  let c = textureLoad(hgt, wrapi(i + vec2i(0, 1), n), lvl).r; let e = textureLoad(hgt, wrapi(i + vec2i(1, 1), n), lvl).r;
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}
fn Hlod(uv: vec2f, l: f32) -> f32 { let lc = clamp(l, 0.0, TP.maxMip); let l0 = floor(lc); let t = lc - l0; let a = Hs(uv, i32(l0)); if (t < 0.001) { return a; } return mix(a, Hs(uv, i32(min(l0 + 1.0, TP.maxMip))), t); }
fn curveDrop(xz: vec2f) -> f32 { let dd = xz - F.camPos.xz; return dot(dd, dd) / (2.0 * 6371000.0); }
struct NV { xz: vec2f, h: f32, uv: vec2f, k: f32 };
// CDLOD: morph odd grid vertices onto the coarser grid as the node nears the edge of its range
fn morphXZ(g: vec2f, nd: vec4f, h0: f32) -> NV {
  let size = nd.z;
  let xz0 = nd.xy + g * size;
  let dist = distance(vec3f(xz0.x, h0 - F.planeAlt, xz0.y), F.camPos);
  let range = TP.lodK * size;
  let k = sat((dist - range * 0.62) / (range * 0.33));
  let gi = g * ${GRID}.0; let fr = fract(gi * 0.5) * 2.0;
  var o: NV; o.xz = nd.xy + (gi - fr * k) / ${GRID}.0 * size; o.uv = (o.xz + F.terrOff) / F.tile; o.k = k; o.h = F.water;
  return o;
}
fn nodeVertexFlat(g: vec2f, nd: vec4f) -> NV { return morphXZ(g, nd, F.water); }
`;
  // exact canyon walls near the camera (from the distance fields), blending into the prefiltered heightmap further away
  const TERR_H = `
@group(0) @binding(9) var auxT: texture_2d<f32>;
@group(0) @binding(10) var aux2T: texture_2d<f32>;
@group(0) @binding(11) var smpA: sampler;
// cubic B-spline filtering of the distance fields (4 bilinear taps): smooth rim lines instead of texel-sized kinks
fn auxB(uv: vec2f) -> vec4f {
  let n = vec2f(textureDimensions(auxT)); let st = uv * n - 0.5; let i = floor(st); let a = st - i;
  let a2 = a * a; let a3 = a2 * a;
  let w0 = (-a3 + 3.0 * a2 - 3.0 * a + 1.0) / 6.0; let w1 = (3.0 * a3 - 6.0 * a2 + 4.0) / 6.0; let w2 = (-3.0 * a3 + 3.0 * a2 + 3.0 * a + 1.0) / 6.0; let w3 = a3 / 6.0;
  let g0 = w0 + w1; let g1 = w2 + w3;
  let p0 = (i - 0.5 + w1 / g0) / n; let p1 = (i + 1.5 + w3 / g1) / n;
  return g0.y * (g0.x * textureSampleLevel(auxT, smpA, p0, 0.0) + g1.x * textureSampleLevel(auxT, smpA, vec2f(p1.x, p0.y), 0.0))
       + g1.y * (g0.x * textureSampleLevel(auxT, smpA, vec2f(p0.x, p1.y), 0.0) + g1.x * textureSampleLevel(auxT, smpA, p1, 0.0));
}
fn canyonAt(uv: vec2f) -> f32 { return canyonH(auxB(uv), textureSampleLevel(aux2T, smpA, uv, 0.0)); }
fn terrH(uv: vec2f, lf: f32) -> f32 {
  let hc = Hlod(uv, lf);
  if (F.place != 1u) { return hc; }
  let k = smoothstep(0.3, 1.3, lf);
  if (k > 0.999) { return hc; }
  return mix(canyonAt(uv), hc, k);
}
fn nodeVertex(g: vec2f, nd: vec4f) -> NV {
  let spacing = nd.z / ${GRID}.0;
  let h0 = Hlod((nd.xy + g * nd.z + F.terrOff) / F.tile, log2(max(spacing / TP.texel, 1.0)));
  var o = morphXZ(g, nd, h0);
  o.h = terrH(o.uv, log2(spacing * (1.0 + o.k) / TP.texel));
  return o;
}
`;
  function buildDrawPipes() {
    const blank = [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }];
    P.draw = G.render({ label: 'terrain-gbuffer', buffers: blank, depth: {}, targets: [{ format: 'rgba8unorm-srgb' }, { format: 'rgba16float' }, { format: 'rgba16float' }], cull: 'back', code: `${DRAW_COMMON()}${TERR_H}
@group(0) @binding(4) var alb: texture_2d<f32>;
@group(0) @binding(5) var nrm: texture_2d<f32>;
@group(0) @binding(6) var mat: texture_2d<f32>;
@group(0) @binding(7) var det: texture_2d_array<f32>;
@group(0) @binding(8) var smp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) wp: vec3f, @location(2) cur: vec4f, @location(3) prev: vec4f, @location(4) hh: f32 };
@vertex fn vs(@location(0) g: vec2f, @builtin(instance_index) ii: u32) -> VO {
  let v = nodeVertex(g, nodes[ii]);
  let P = vec3f(v.xz.x, v.h - F.planeAlt - curveDrop(v.xz), v.xz.y);
  var o: VO; o.pos = F.viewProj * vec4f(P, 1.0); o.uv = v.uv; o.wp = P; o.hh = v.h;
  o.cur = F.viewProjNJ * vec4f(P, 1.0); o.prev = F.prevViewProjNJ * vec4f(P + F.shift, 1.0);
  return o;
}
struct GO { @location(0) a: vec4f, @location(1) n: vec4f, @location(2) m: vec4f };
@fragment fn fs(i: VO) -> GO {
  let dist = distance(i.wp, F.camPos);
  let w = i.uv * F.tile;
  let c4 = textureSample(alb, smp, i.uv); let mapCol = c4.rgb * c4.rgb;
  let Nm = normalize(textureSample(nrm, smp, i.uv).xyz);
  let m = textureSample(mat, smp, i.uv);
  var A = textureSampleLevel(auxT, smpA, i.uv, 0.0); let B = textureSampleLevel(aux2T, smpA, i.uv, 0.0);
  if (F.place == 1u) { A = auxB(i.uv); }
  // detail textures (sampled up front: implicit derivatives need uniform control flow)
  var tw = pow(abs(Nm), vec3f(4.0)); tw /= (tw.x + tw.y + tw.z);
  let s1 = 1.0 / 6.0; let s2 = 1.0 / 38.0;
  let rX = textureSample(det, smp, vec2f(w.y, i.hh) * s1, 0); let rY = textureSample(det, smp, w * s1, 0); let rZ = textureSample(det, smp, vec2f(w.x, i.hh) * s1, 0);
  let rX2 = textureSample(det, smp, vec2f(w.y, i.hh) * s2, 0); let rZ2 = textureSample(det, smp, vec2f(w.x, i.hh) * s2, 0);
  let cano = textureSample(det, smp, w / 31.0, 2) * 0.6 + textureSample(det, smp, w / 83.0, 2) * 0.4;
  let snd = textureSample(det, smp, w / 11.0, select(3, 4, F.place == 1u)) * 0.6 + textureSample(det, smp, w / 47.0, select(3, 4, F.place == 1u)) * 0.4;
  let near = sat(1.0 - dist / 8000.0);
  // coarse distant geometry averages sea floor and islands: let the water show wherever most of the footprint is under the sea
  if (m.a > 0.5) { discard; }
  var N = Nm; var col = mapCol; var rough = 0.9; var rock = m.r; var veg = m.b; var sand = 1.0 - m.g;
  var y = i.hh;
  if (F.place == 1u) {
    // canyon: the wall profile is evaluated exactly per pixel → crisp rims, cliffs and rock bands
    let pr = cprof(A.x, A.y); let hT = mix(A.z, cprofT(A.w), B.x);
    y = min(min(A.z, pr), hT);
    var g = vec2f(-Nm.x, -Nm.z) / max(Nm.y, 0.08);
    let e = TP.texel; let du = e / F.tile;
    if (pr < min(A.z, hT) - 0.01) {
      let dx = auxB(i.uv + vec2f(du, 0.0)).x - auxB(i.uv - vec2f(du, 0.0)).x;
      let dz = auxB(i.uv + vec2f(0.0, du)).x - auxB(i.uv - vec2f(0.0, du)).x;
      g = (cprof(A.x + 0.25, A.y) - cprof(A.x - 0.25, A.y)) * 2.0 * vec2f(dx, dz) / (2.0 * e);
    } else if (hT < A.z - 0.01) {
      let dx = textureSampleLevel(auxT, smpA, i.uv + vec2f(du, 0.0), 0.0).w - textureSampleLevel(auxT, smpA, i.uv - vec2f(du, 0.0), 0.0).w;
      let dz = textureSampleLevel(auxT, smpA, i.uv + vec2f(0.0, du), 0.0).w - textureSampleLevel(auxT, smpA, i.uv - vec2f(0.0, du), 0.0).w;
      g = mix(g, (cprofT(A.w + 0.25) - cprofT(A.w - 0.25)) * 2.0 * vec2f(dx, dz) / (2.0 * e), B.x);
    }
    let Na = normalize(vec3f(-g.x, 1.0, -g.y));
    let fa = sat(1.0 - dist / 9000.0);
    N = normalize(mix(Nm, Na, fa));
    let s = canyonSurf(i.uv, y, Na, A, B, near);
    col = mix(mapCol, s.col, fa); rough = mix(0.9, s.rough, fa); rock = mix(rock, s.rock, fa); veg = mix(veg, s.veg, fa); sand = mix(sand, s.sand, fa);
  } else {
    let fa = sat(1.0 - dist / 9000.0);
    let s = islandSurf(i.uv, y, Nm, A, B, near);
    col = mix(mapCol, s.col, fa); rough = mix(0.88, s.rough, fa); rock = mix(rock, s.rock, fa); veg = mix(veg, s.veg, fa); sand = mix(sand, s.sand, fa);
  }
  // fine detail, fading with distance: rock (triplanar), canopy crowns, sand
  let fade = sat(1.0 - dist / 4000.0) * TP.detail;
  let rk = (rX * tw.x + rY * tw.y + rZ * tw.z) * 0.6 + (rX2 * tw.x + rY * tw.y + rZ2 * tw.z) * 0.4;
  let nX = (rX.gb * 0.6 + rX2.gb * 0.4) * 2.0 - 1.0; let nY = rY.gb * 2.0 - 1.0; let nZ = (rZ.gb * 0.6 + rZ2.gb * 0.4) * 2.0 - 1.0;
  let dR = vec3f(0.0, nX.y, nX.x) * tw.x + vec3f(nY.x, 0.0, nY.y) * tw.y + vec3f(nZ.x, nZ.y, 0.0) * tw.z;
  let dC = vec3f(cano.g * 2.0 - 1.0, 0.0, cano.b * 2.0 - 1.0);
  let dS = vec3f(snd.g * 2.0 - 1.0, 0.0, snd.b * 2.0 - 1.0);
  let wr = max(rock,select(0.0,.58*(1.0-sand)*(1.0-veg),F.place==1u)); let wv = veg * (1.0 - wr) * select(1.0, 0.4, F.place == 1u); let ws = max(1.0 - wr - wv, 0.0);
  N = normalize(N + (dR * wr * 1.15 + dC * wv * 0.9 + dS * ws * 0.35) * fade);
  let modA = (rk.r * 2.0) * wr + mix(1.0, cano.r * 2.0, 0.75) * wv + (snd.r * 2.0) * ws;
  col *= mix(1.0, modA / max(wr + wv + ws, 1e-3), fade);
  let cav = mix(1.0, sat(0.6 + rk.a * 0.55), wr * fade) * mix(1.0, 0.65 + 0.45 * cano.a, wv * fade);
  rough = mix(rough, clamp(rk.a, 0.5, 1.0), wr * fade * .65);
  var o: GO;
  o.a = vec4f(sat3(col), cav);
  o.n = vec4f(N, clamp(rough, 0.3, 1.0));
  o.m = vec4f((i.cur.xy / i.cur.w - i.prev.xy / i.prev.w) * vec2f(0.5, -0.5), 0.0, 2.0);
  return o;
}` });
    P.shadow = G.render({ label: 'terrain-shadow', buffers: blank, depth: { compare: 'less', bias: 0, slope: 0.6 }, cull: 'none', code: `${DRAW_COMMON()}${TERR_H}
@group(0) @binding(4) var<uniform> SC: mat4x4f;
@vertex fn vs(@location(0) g: vec2f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let v = nodeVertex(g, nodes[ii]);
  return SC * vec4f(v.xz.x, v.h - F.planeAlt - curveDrop(v.xz), v.xz.y, 1.0);
}` });
    // water: Gerstner waves near the camera, colour from the depth over the (terrain) sea floor; Fresnel and glitter in the lighting pass
    P.water = G.render({ label: 'water-gbuffer', buffers: blank, depth: {}, targets: [{ format: 'rgba8unorm-srgb' }, { format: 'rgba16float' }, { format: 'rgba16float' }], cull: 'none', code: `${DRAW_COMMON()}
@group(0) @binding(4) var smp: sampler;
@group(0) @binding(5) var det: texture_2d_array<f32>;
@group(0) @binding(6) var alb: texture_2d<f32>;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) wp: vec3f, @location(2) cur: vec4f, @location(3) prev: vec4f, @location(4) wxz: vec2f };
const NW = 8;
fn wave(i: i32) -> vec4f {   // direction angle, wavelength (m), steepness, phase
  let a = f32(i) * 2.39996 + 0.4; let L = 42.0 * pow(0.68, f32(i)); return vec4f(a * 0.35 - 0.5, L, 0.22 * TP.waveAmp, f32(i) * 1.7);
}
fn gerstner(p: vec2f, t: f32, amp: f32) -> vec3f {
  var o = vec3f(0.0);
  for (var i = 0; i < 5; i++) {
    let w = wave(i); let dir = vec2f(cos(w.x), sin(w.x)); let k = 6.2831853 / w.y; let c = sqrt(9.81 / k);
    let f = k * (dot(dir, p) - c * t) + w.w; let a = w.z / k * amp;
    o += vec3f(dir.x * a * cos(f), a * sin(f), dir.y * a * cos(f));
  }
  return o;
}
@vertex fn vs(@location(0) g: vec2f, @builtin(instance_index) ii: u32) -> VO {
  let v = nodeVertexFlat(g, nodes[ii]);
  let wxz = v.uv * F.tile;
  var P = vec3f(v.xz.x, F.water - F.planeAlt - curveDrop(v.xz), v.xz.y);
  let dist = distance(P, F.camPos);
  let amp = sat(1.0 - dist / 1500.0);
  if (amp > 0.0) { P += gerstner(wxz, TP.time, amp); }
  var o: VO; o.pos = F.viewProj * vec4f(P, 1.0); o.uv = v.uv; o.wp = P; o.wxz = wxz;
  o.cur = F.viewProjNJ * vec4f(P, 1.0); o.prev = F.prevViewProjNJ * vec4f(P + F.shift, 1.0);
  return o;
}
struct GO { @location(0) a: vec4f, @location(1) n: vec4f, @location(2) m: vec4f };
@fragment fn fs(i: VO) -> GO {
  let dist = distance(i.wp, F.camPos);
  // wave slopes: analytic Gerstner derivatives plus two scrolling ripple layers
  var sx = 0.0; var sz = 0.0;
  for (var k = 0; k < NW; k++) {
    let w = wave(k); let dir = vec2f(cos(w.x), sin(w.x)); let kk = 6.2831853 / w.y; let c = sqrt(9.81 / kk);
    let f = kk * (dot(dir, i.wxz) - c * TP.time) + w.w;
    let s = w.z * cos(f) * sat(1.0 - dist / (w.y * 22.0));
    sx += dir.x * s; sz += dir.y * s;
  }
  let r1 = textureSample(det, smp, i.wxz / 13.0 + vec2f(TP.time * 0.021, TP.time * 0.013), 5).gb * 2.0 - 1.0;
  let r2 = textureSample(det, smp, i.wxz / 4.1 - vec2f(TP.time * 0.037, -TP.time * 0.029), 5).gb * 2.0 - 1.0;
  let rip = (r1 * 0.09 + r2 * 0.05) * (0.3 + TP.waveAmp) * sat(1.0 - dist / 2500.0);
  // wind texture that stays visible from altitude: long, slow swell patterns
  let r3 = textureSample(det, smp, i.wxz / 170.0 + vec2f(TP.time * 0.004, TP.time * 0.0025), 5).gb * 2.0 - 1.0;
  let r4 = textureSample(det, smp, i.wxz / 640.0 - vec2f(TP.time * 0.0015, -TP.time * 0.001), 5).gb * 2.0 - 1.0;
  let swell = (r3 * 0.05 + r4 * 0.035) * (0.25 + TP.waveAmp) * sat(dist / 900.0) * sat(1.0 - dist / 60000.0);
  let N = normalize(vec3f(-sx - rip.x - swell.x, 1.0, -sz - rip.y - swell.y));
  // in-water colour: light reflected by the floor, absorbed twice on the way (red first → turquoise shallows), plus scattering in deep water
  let bed4 = textureSample(alb, smp, i.uv); let bed = bed4.rgb * bed4.rgb;
  let depth = max(F.water - Hs(i.uv, 0), 0.0);
  var sig = vec3f(0.25, 0.065, 0.035); var omega = vec3f(0.003, 0.031, 0.045);
  if (F.place == 1u) { sig = vec3f(0.42, 0.12, 0.10); omega = vec3f(0.008, 0.145, 0.155); }
  let tr = exp(-sig * depth * 2.0);
  var col = bed * tr + omega * (1.0 - tr);
  if(F.place==1u){ // emerald shallows into blue-green channel water
    col=mix(vec3f(.075,.24,.13),col,smoothstep(.2,4.0,depth));
  }
  // a thin line of foam where the sea meets the beach
  let foam = smoothstep(0.7, 0.0, depth + 0.5 * (textureSample(det, smp, i.wxz / 6.0 + TP.time * 0.02, 1).r - 0.5)) * smoothstep(0.0, 0.15, depth) * sat(1.0 - dist / 3000.0) * sat(TP.waveAmp * 2.0);
  col = mix(col, vec3f(0.85), foam * 0.7);
  let baseRough = mix(0.12, 0.23, sat(dist / 9000.0)) + 0.08 * TP.waveAmp * sat(dist / 20000.0) + foam * 0.5;
  // Filter subpixel wave-normal variance into roughness, avoiding glitter flicker.
  let nx=dpdx(N);let ny=dpdy(N);
  let rough=clamp(sqrt(baseRough*baseRough+.5*(dot(nx,nx)+dot(ny,ny))),.12,.7);
  var o: GO;
  o.a = vec4f(sat3(col), 1.0);
  o.n = vec4f(N, rough);
  o.m = vec4f((i.cur.xy / i.cur.w - i.prev.xy / i.prev.w) * vec2f(0.5, -0.5), 0.0, select(1.0, 0.0, foam > 0.5));
  return o;
}` });
  }

  /* ---------- reflection probe with the real ground below (replaces the sky-only probe) ---------- */
  function buildEnvPipe() {
    P.env = G.compute(`${G.COMMON}${G.ATMO}${GClouds.CLOUD}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(8) var<uniform> CC: CU;
@group(0) @binding(9) var nBase: texture_3d<f32>;
@group(0) @binding(10) var nDet: texture_3d<f32>;
@group(0) @binding(11) var wmap: texture_2d<f32>;
@group(0) @binding(12) var transLut: texture_2d<f32>;
@group(0) @binding(13) var<storage, read> SH: array<vec4f, 9>;
@group(0) @binding(1) var outE: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var skyLut: texture_2d<f32>;
@group(0) @binding(3) var smpL: sampler;
@group(0) @binding(4) var alb: texture_2d<f32>;
@group(0) @binding(5) var tsh: texture_2d<f32>;
@group(0) @binding(6) var smpR: sampler;
@group(0) @binding(7) var<uniform> EU: vec4f;     // ground height below (m), water level, tile, clouds on
${GAtmos.LL}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(outE); if (id.x >= dim.x || id.y >= dim.y) { return; }
  let dir = llDir((vec2f(id.xy) + 0.5) / vec2f(dim));
  let r = RG + camAltKm();
  var L = textureSampleLevel(skyLut, smpL, skyLutUv(r, dir, F.sunDir), 0.0).rgb * F.sunE * F.lightTint;
  let camY = F.planeAlt + F.camPos.y;
  let gh = max(EU.x, EU.y);
  if (dir.y < -0.002 && camY > gh) {
    let t = (camY - gh) / -dir.y;
    if (t < 150000.0) {
      let wp = F.camPos.xz + dir.xz * t;
      let uv = (wp + F.terrOff) / EU.z;
      let lod = clamp(log2(t * 0.02 / (EU.z / f32(textureDimensions(alb).x)) + 1.0) + 2.0, 0.0, 10.0);
      let a4 = textureSampleLevel(alb, smpR, uv, lod); var albedo = a4.rgb * a4.rgb;
      if (EU.x < EU.y) { albedo = vec3f(0.02, 0.05, 0.07); }
      let ts = textureSampleLevel(tsh, smpR, uv, 2.0);
      let mu = max(F.sunDir.y, 0.0);
      let Eg = F.sunE * F.lightTint * mu * ts.r;
      let ext = (RAY_S * exp(-gh * 0.000125) + vec3f(MIE_E * F.haze * exp(-gh / 1200.0))) * 0.001;
      let T = exp(-ext * t);
      L += T * (albedo - F.groundAlbedo) * Eg / PI * 0.9;
    }
  }
  // clouds in the reflections (cheap march)
  if (EU.w > 0.5) {
    let sh = cShell(dir);
    let t0 = max(sh.x, 0.0); let t1 = min(sh.y, t0 + 60000.0);
    if (t1 > t0) {
      var T = 1.0; var Lc = vec3f(0.0); let n = 20;
      let cosT = dot(dir, F.sunDir); let sig = 0.09 * CC.dens;
      let skyA = max(SH[0].rgb * 0.282095 + SH[1].rgb * 0.488603, vec3f(0.0)) * PI;
      for (var i = 0; i < n; i++) {
        let t = t0 + (t1 - t0) * (f32(i) + 0.5) / f32(n); let dt = (t1 - t0) / f32(n);
        let p = F.camPos + dir * t; let alt = cAlt(p);
        let ds = cBase(p, alt, 2.0);
        if (ds <= 0.0) { continue; }
        var tau = 0.0; var ls = 60.0;
        for (var k = 0; k < 3; k++) { let q = p + F.sunDir * ls; tau += cBase(q, cAlt(q), 2.5) * ls; ls *= 3.0; }
        let hh = sat((alt - CC.base) / (CC.top - CC.base));
        let st = textureSampleLevel(transLut, smpL, transUv(RG + alt * 0.001, F.sunDir.y), 0.0).rgb;
        let sunL = F.sunE * F.lightTint * st * (exp(-sig * tau) + 0.5 * exp(-sig * tau * 0.4)) * min(cPhase(cosT, 1.0), 0.6);
        let amb = skyA * (0.3 + 0.6 * hh) * 0.2;
        let sT = exp(-ds * sig * dt);
        Lc += T * (sunL + amb) * (1.0 - sT); T *= sT;
        if (T < 0.02) { break; }
      }
      let fade = exp(-t0 / 80000.0);
      L = mix(L, L * T + Lc, fade);
    }
  }
  textureStore(outE, id.xy, vec4f(clamp(L, vec3f(0.0), vec3f(60000.0)), 1.0));
}`, 'env-ground');
    R.envU = G.buf(16, GPUBufferUsage.UNIFORM, null, 'envU');
  }
  let envBG = null;
  function envHook(enc) {
    const cl = typeof GClouds !== 'undefined' && GClouds.on;
    if (!envBG) { const CR = GClouds.R; envBG = G.bind(P.env, 0, [frameBuf, GAtmos.R.envRawV0, GAtmos.R.skyV, G.sampler('linClamp'), R.alb.createView(), R.shV, G.sampler('linRepeat'), R.envU,
      CR.cu, CR.base.createView(), null, CR.wmap.createView(), GAtmos.R.transV, GAtmos.R.sh]); }
    const gh = heightAt(q.wx, q.wz);
    d.queue.writeBuffer(R.envU, 0, new Float32Array([gh, place.water, place.tile, cl ? 1 : 0]));
    G.dispatch(enc, P.env, [envBG], GAtmos.EW / 8, GAtmos.EH / 8, 1, 'env-ground');
  }

  /* ---------- per-place generation ---------- */
  function setPlace(id) {
    if (place && place.key === id) return;
    const pl = PLACES[id]; if (!pl) return;
    place = { ...pl, key: id };
    lodK = pl.lodK;
    genDue = true; shadowDue = true; ready = false; cpu = null;
    const U = GPUTextureUsage;
    if (!R.hgt) {
      const mips = G.mipCount(RES, RES);
      R.hgt = d.createTexture({ size: [RES, RES], format: 'r32float', mipLevelCount: mips, usage: U.TEXTURE_BINDING | U.STORAGE_BINDING | U.COPY_SRC, label: 'height' });
      R.aux = d.createTexture({ size: [RES, RES], format: 'rgba16float', usage: U.TEXTURE_BINDING | U.STORAGE_BINDING, label: 'aux' });
      R.aux2 = d.createTexture({ size: [RES, RES], format: 'rgba16float', usage: U.TEXTURE_BINDING | U.STORAGE_BINDING, label: 'aux2' });
      R.nrm = d.createTexture({ size: [RES, RES], format: 'rgba16float', mipLevelCount: mips, usage: U.TEXTURE_BINDING | U.STORAGE_BINDING | U.RENDER_ATTACHMENT, label: 'normals' });
      R.alb = d.createTexture({ size: [RES, RES], format: 'rgba8unorm', mipLevelCount: mips, usage: U.TEXTURE_BINDING | U.STORAGE_BINDING | U.RENDER_ATTACHMENT, label: 'albedo' });
      R.mat = d.createTexture({ size: [RES, RES], format: 'rgba8unorm', mipLevelCount: mips, usage: U.TEXTURE_BINDING | U.STORAGE_BINDING | U.RENDER_ATTACHMENT, label: 'material' });
      R.sh = d.createTexture({ size: [SHRES, SHRES], format: 'rgba8unorm', usage: U.TEXTURE_BINDING | U.STORAGE_BINDING, label: 'terrainShade' });
      R.hgtV = R.hgt.createView(); R.shV = R.sh.createView();
      const nq = RES / 4;
      R.mmBuf = G.buf(nq * nq * 8, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, null, 'minmax');
      R.readBuf = d.createBuffer({ size: nq * nq * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const lr = G.sampler('linRepeat'), auxV = R.aux.createView(), aux2V = R.aux2.createView();
      BG.draw = G.bind(P.draw, 0, [frameBuf, R.tBuf, R.nodeBuf, R.hgtV, R.alb.createView(), R.nrm.createView(), R.mat.createView(), R.detail.createView({ dimension: '2d-array' }), G.sampler('aniso'), auxV, aux2V, lr]);
      BG.water = G.bind(P.water, 0, [frameBuf, R.tBuf, R.waterBuf, R.hgtV, G.sampler('aniso'), R.detail.createView({ dimension: '2d-array' }), R.alb.createView()]);
      GR.setInput('terrSh', R.shV);
      buildEnvPipe();
    }
    if (pl.id === 1) canyonField(pl);
  }
  function genParams(sun) {
    const pl = place;
    return new Float32Array([0, 0, pl.tile, pl.seed, pl.water, pl.hmax, pl.track, pl.treeLine, pl.snowLine, 0, sun ? sun.x : 0.3, sun ? sun.y : 0.5, sun ? sun.z : 0.2, SHRES, 0, 0]);
  }
  function writeGen(sun) {
    const f = genParams(sun), u = new Uint32Array(f.buffer); u[0] = place.id; u[1] = RES;
    d.queue.writeBuffer(R.genBuf, 0, f);
  }
  function generate(enc) {
    writeGen(null);
    G.dispatch(enc, P.gen, [G.bind(P.gen, 0, [R.genBuf, R.hgt.createView({ baseMipLevel: 0, mipLevelCount: 1 }), R.aux.createView(), R.aux2.createView(), R.dt.createView(), G.sampler('linRepeat')])], RES / 8, RES / 8, 1, 'gen');
    for (let m = 1; m < R.hgt.mipLevelCount; m++) {
      const n = RES >> m;
      G.dispatch(enc, P.hdown, [G.bind(P.hdown, 0, [R.hgt.createView({ baseMipLevel: m - 1, mipLevelCount: 1 }), R.hgt.createView({ baseMipLevel: m, mipLevelCount: 1 })])], Math.ceil(n / 8), Math.ceil(n / 8));
    }
    G.dispatch(enc, P.maps, [G.bind(P.maps, 0, [R.genBuf, R.hgt.createView({ baseMipLevel: 0, mipLevelCount: 1 }), R.aux.createView(), R.aux2.createView(),
      R.nrm.createView({ baseMipLevel: 0, mipLevelCount: 1 }), R.alb.createView({ baseMipLevel: 0, mipLevelCount: 1 }), R.mat.createView({ baseMipLevel: 0, mipLevelCount: 1 })])], RES / 8, RES / 8, 1, 'maps');
    const nq = RES / 4;
    G.dispatch(enc, P.minmax, [G.bind(P.minmax, 0, [R.hgt.createView({ baseMipLevel: 0, mipLevelCount: 1 }), R.mmBuf])], nq / 8, nq / 8, 1, 'minmax');
    enc.copyBufferToBuffer(R.mmBuf, 0, R.readBuf, 0, nq * nq * 8);
  }
  function afterGenerate() {
    G.genMips(R.nrm, 'rgba16float'); G.genMips(R.alb, 'rgba8unorm'); G.genMips(R.mat, 'rgba8unorm');
    const key = place.key;
    R.readBuf.mapAsync(GPUMapMode.READ).then(() => {
      const n = RES / 4, ab = new Float32Array(R.readBuf.getMappedRange().slice(0)); R.readBuf.unmap();
      if (!place || place.key !== key) return;
      const mn0 = new Float32Array(n * n), mx0 = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) { mn0[i] = ab[i * 2]; mx0[i] = ab[i * 2 + 1]; }
      // min/max pyramid for node bounds
      const pyr = [{ n, mn: mn0, mx: mx0 }];
      while (pyr[pyr.length - 1].n > 1) {
        const p = pyr[pyr.length - 1], m = p.n / 2, mn = new Float32Array(m * m), mx = new Float32Array(m * m);
        for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
          const i = 2 * y * p.n + 2 * x, j = i + p.n;
          mn[y * m + x] = Math.min(p.mn[i], p.mn[i + 1], p.mn[j], p.mn[j + 1]); mx[y * m + x] = Math.max(p.mx[i], p.mx[i + 1], p.mx[j], p.mx[j + 1]);
        }
        pyr.push({ n: m, mn, mx });
      }
      cpu = { n, h: mx0, pyr, tile: place.tile };
    }).catch(() => {});
  }
  function shade(enc, sun) {
    writeGen(sun);
    G.dispatch(enc, P.shade, [G.bind(P.shade, 0, [R.genBuf, R.hgtV, R.shV])], SHRES / 8, SHRES / 8, 1, 'terrain-shade');
  }

  /* ---------- CPU height queries (block maxima: safe for keeping the aircraft and camera above ground) ---------- */
  function heightAt(wx, wz) {
    if (!cpu) return place ? place.water : 0;
    const n = cpu.n, x = ((wx / cpu.tile) % 1 + 1) % 1 * n - 0.5, z = ((wz / cpu.tile) % 1 + 1) % 1 * n - 0.5;
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, H = (a, b) => cpu.h[((b % n + n) % n) * n + ((a % n + n) % n)];
    return (H(i, j) * (1 - fx) + H(i + 1, j) * fx) * (1 - fz) + (H(i, j + 1) * (1 - fx) + H(i + 1, j + 1) * fx) * fz;
  }
  function bounds(wx, wz, size) {   // min/max height over a world square (conservative)
    if (!cpu) return [Math.min(0, place.water) - 100, place.hmax + 200];
    const n = cpu.n, texel = cpu.tile / n;
    let lvl = Math.max(0, Math.ceil(Math.log2(size / texel)) - 1);
    lvl = Math.min(lvl, cpu.pyr.length - 1);
    const L = cpu.pyr[lvl], ln = L.n, ts = cpu.tile / ln;
    const x0 = Math.floor(wx / ts), z0 = Math.floor(wz / ts), x1 = Math.floor((wx + size) / ts), z1 = Math.floor((wz + size) / ts);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) return [L.mn.reduce((a, b) => Math.min(a, b), 1e9) - 10, L.mx.reduce((a, b) => Math.max(a, b), -1e9) + 10];
    let mn = 1e9, mx = -1e9;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const k = ((z % ln + ln) % ln) * ln + ((x % ln + ln) % ln); mn = Math.min(mn, L.mn[k]); mx = Math.max(mx, L.mx[k]); }
    return [mn - 10, mx + 10];
  }

  /* ---------- CDLOD node selection ---------- */
  const frustum = new T.Frustum(), box = new T.Box3();
  let lodK = 5.5, s0 = 8, levels = 12;
  function select(cam, vp, planeAlt) {
    nNodes = 0; nWater = 0;
    if (!place) return;
    const texel = place.tile / RES;
    s0 = place.id === 1 ? 3 : Math.max(4, texel / 2);
    const cx = cam.position.x + q.wx, cz = cam.position.z + q.wz, cy = cam.position.y + planeAlt;
    frustum.setFromProjectionMatrix(vp, T.WebGPUCoordinateSystem);
    const rootSize = s0 * GRID * (1 << (levels - 1));
    const ranges = []; for (let l = 0; l < levels; l++) ranges.push(lodK * s0 * GRID * (1 << l));
    const reach = ranges[levels - 1];
    const r0x = Math.floor((cx - reach) / rootSize), r1x = Math.floor((cx + reach) / rootSize), r0z = Math.floor((cz - reach) / rootSize), r1z = Math.floor((cz + reach) / rootSize);
    const wl = place.water;
    const add = (x, z, size, lvl, mn, mx) => {
      if (nNodes >= 4096) return;
      const o = nNodes * 4; nodes[o] = x - q.wx; nodes[o + 1] = z - q.wz; nodes[o + 2] = size; nodes[o + 3] = lvl; nNodes++;
      if (mn < wl + 3 && nWater < 4096) { const w = nWater * 4; waterNodes[w] = x - q.wx; waterNodes[w + 1] = z - q.wz; waterNodes[w + 2] = size; waterNodes[w + 3] = lvl; nWater++; }
    };
    const distBox = (x, z, size, mn, mx) => {
      const dx = Math.max(x - cx, 0, cx - (x + size)), dz = Math.max(z - cz, 0, cz - (z + size)), dy = Math.max(mn - cy, 0, cy - mx);
      return Math.hypot(dx, dy, dz);
    };
    const visible = (x, z, size, mn, mx) => {
      box.min.set(x - q.wx, mn - planeAlt - 400 - (size * size) / 12e6, z - q.wz); box.max.set(x + size - q.wx, mx - planeAlt + 60, z + size - q.wz);
      return frustum.intersectsBox(box);
    };
    const rec = (x, z, lvl) => {
      const size = s0 * GRID * (1 << lvl);
      const [mn0, mx0] = bounds(x, z, size), mn = Math.min(mn0, wl), mx = Math.max(mx0, wl + 2);
      const dd = distBox(x, z, size, mn, mx);
      if (dd > ranges[lvl]) return false;
      if (!visible(x, z, size, mn, mx)) return true;
      if (lvl === 0 || dd > ranges[lvl - 1]) { add(x, z, size, lvl, mn0, mx); return true; }
      const h = size / 2;
      for (const [ox, oz] of [[0, 0], [h, 0], [0, h], [h, h]]) {
        if (!rec(x + ox, z + oz, lvl - 1)) {
          const [m2, x2] = bounds(x + ox, z + oz, h);
          if (visible(x + ox, z + oz, h, Math.min(m2, wl), Math.max(x2, wl + 2))) add(x + ox, z + oz, h, lvl, m2, x2);
        }
      }
      return true;
    };
    for (let rz = r0z; rz <= r1z; rz++) for (let rx = r0x; rx <= r1x; rx++) rec(rx * rootSize, rz * rootSize, levels - 1);
    d.queue.writeBuffer(R.nodeBuf, 0, nodes.buffer, 0, nNodes * 16);
    d.queue.writeBuffer(R.waterBuf, 0, waterNodes.buffer, 0, nWater * 16);
    const maxMip = R.hgt.mipLevelCount - 1;
    d.queue.writeBuffer(R.tBuf, 0, new Float32Array([lodK, texel, maxMip, RES, 1, (q.time || 0) % 1000, place.waves, 0]));
  }
  // shadow casters: coarser selection around a cascade's box
  let sNodes = new Float32Array(4 * 4096 * 4), sCount = [0, 0, 0, 0];
  function selectShadow(c, lightVP, planeAlt, center, radius, sun) {
    sCount[c] = 0; if (!place || !lightVP) return;
    frustum.setFromProjectionMatrix(lightVP, T.WebGPUCoordinateSystem);
    const size0 = Math.max(s0 * GRID * 2, radius / 2), lvl = Math.max(0, Math.round(Math.log2(size0 / (s0 * GRID))));
    const size = s0 * GRID * (1 << lvl);
    // casters can only lie between the receivers and the sun: search a box stretched toward it
    const hz = Math.hypot(sun.x, sun.z) || 1, reach = Math.min(20000, (place.hmax + 300) / Math.max(sun.y / hz, 0.05));
    const cx = center.x + q.wx + sun.x / hz * reach * 0.5, cz = center.z + q.wz + sun.z / hz * reach * 0.5, R2 = radius + reach * 0.5 + size;
    const x0 = Math.floor((cx - R2) / size), x1 = Math.floor((cx + R2) / size), z0 = Math.floor((cz - R2) / size), z1 = Math.floor((cz + R2) / size);
    let n = 0; const base = c * 4096 * 4, cap = 900;
    for (let z = z0; z <= z1 && n < cap; z++) for (let x = x0; x <= x1 && n < cap; x++) {
      const [mn, mx] = bounds(x * size, z * size, size);
      box.min.set(x * size - q.wx, mn - planeAlt - 50, z * size - q.wz); box.max.set((x + 1) * size - q.wx, mx - planeAlt + 50, (z + 1) * size - q.wz);
      if (!frustum.intersectsBox(box)) continue;
      const o = base + n * 4; sNodes[o] = x * size - q.wx; sNodes[o + 1] = z * size - q.wz; sNodes[o + 2] = size; sNodes[o + 3] = lvl; n++;
    }
    sCount[c] = n;
    if (n) d.queue.writeBuffer(R.shadowNodeBuf, c * 4096 * 16, sNodes.buffer, base * 4, n * 16);
  }
  const shadowBG = [];
  function drawShadow(pass, c, camBuf) {
    if (!ready || !sCount[c]) return;
    if (!shadowBG[c]) shadowBG[c] = G.bind(P.shadow, 0, [frameBuf, R.tBuf, { buffer: R.shadowNodeBuf, offset: c * 4096 * 16, size: 4096 * 16 }, R.hgtV, { buffer: camBuf, offset: c * 256, size: 64 }, null, null, null, null, R.aux.createView(), R.aux2.createView(), G.sampler('linRepeat')]);
    pass.setPipeline(P.shadow); pass.setBindGroup(0, shadowBG[c]);
    pass.setVertexBuffer(0, R.gridV); pass.setIndexBuffer(R.gridI, 'uint16'); pass.drawIndexed(R.gridN, sCount[c]);
  }

  /* ---------- frame hooks ---------- */
  let lastSun = '';
  const hook = {
    name: 'terrain',
    pre(enc, o) {
      if (!place) return;
      if (genDue) { generate(enc); genDue = false; hook._after = true; }
      const s = o.env.sunDir, key = s.x.toFixed(3) + s.y.toFixed(3) + s.z.toFixed(3) + place.key;
      if (key !== lastSun || shadowDue) { lastSun = key; shadowDue = false; hook._shade = s.clone(); }
    },
    gbuffer(pass) {
      if (!ready) return;
      if (nNodes) { pass.setPipeline(P.draw); pass.setBindGroup(0, BG.draw); pass.setVertexBuffer(0, R.gridV); pass.setIndexBuffer(R.gridI, 'uint16'); pass.drawIndexed(R.gridN, nNodes); }
      if (nWater && place.water > -1000) { pass.setPipeline(P.water); pass.setBindGroup(0, BG.water); pass.setVertexBuffer(0, R.gridV); pass.setIndexBuffer(R.gridI, 'uint16'); pass.drawIndexed(R.gridN, nWater); }
    }
  };
  // called by the scene before GR.frame: world origin, node selection, deferred generation work
  function update(o, cam, vp) {
    if (!place) return;
    q.wx = o.worldX; q.wz = o.worldZ;
    if (hook._after) {
      hook._after = false;
      d.queue.onSubmittedWorkDone().then(() => { afterGenerate(); ready = true; GAtmos.setEnvHook(envHook); GAtmos.markEnv(); });
    }
    if (hook._shade && R.hgt && !genDue) { const e = d.createCommandEncoder(); shade(e, hook._shade); d.queue.submit([e.finish()]); hook._shade = null; }
    q.time=o.env.cloudT;select(cam, vp, o.env.planeAlt);
  }
  // where a flight should start: over the islands anywhere; in the canyon a little before the tightest bend (Horseshoe Bend)
  function startPoint() {
    if (!place) return [0, 0];
    const M = R.river;
    if (place.id !== 1 || !M) return [0, place.track * place.tile];
    let bi = 0; for (let i = 0; i < M.n; i++) if (Math.abs(M.cv[i]) > Math.abs(M.cv[bi])) bi = i;
    const r = 1 / Math.abs(M.cv[bi]), sg = Math.sign(M.cv[bi]);
    return [M.px[bi] - 250, M.pz[bi] - 100];
  }

  // Routes use the generated geography. The canyon continues into the repeating
  // river tile, so there is no teleport or shortcut across the plateau at the end.
  function scenicRoute(){
    if(place?.id===1&&R.river){const m=R.river,out=[];let bi=0;for(let i=0;i<m.n;i++)if(Math.abs(m.cv[i])>Math.abs(m.cv[bi]))bi=i;
      const start=Math.max(0,bi-350);
      for(let i=start;i<m.n;i+=22)out.push({x:m.px[i],z:m.pz[i]});
      for(let i=0;i<start;i+=22)out.push({x:m.px[i]+place.tile,z:m.pz[i]});
      out.periodX=place.tile;return out;
    }
    // Search laterally around a broad loop for navigable sea channels. Penalise
    // cliffs along each segment as well as at its ends, then fair the waypoints.
    const out=[],tile=place?.tile||32768,base=tile*.5;
    for(let i=0;i<160;i++){const a=i/160*Math.PI*2,bx=2600+4800*Math.sin(a),bz=base+2300*Math.cos(a)+500*Math.sin(a*3);let best=Infinity,point;
      for(let offset=-1050;offset<=1050;offset+=75){const x=bx+Math.sin(a)*offset,z=bz+Math.cos(a)*offset,prev=out.at(-1);let score=Math.max(0,heightAt(x,z))*10+Math.abs(offset)*.04;
        if(prev){for(let f=.25;f<1;f+=.25)score+=Math.max(0,heightAt(prev.x+(x-prev.x)*f,prev.z+(z-prev.z)*f))*5;score+=Math.hypot(x-prev.x,z-prev.z)*.15;}
        if(score<best){best=score;point={x,z};}
      }out.push(point);
    }
    for(let pass=0;pass<3;pass++){const old=out.map(p=>({...p}));for(let i=0;i<out.length;i++){const a=old[(i+159)%160],b=old[i],c=old[(i+1)%160];out[i]={x:(a.x+b.x*4+c.x)/6,z:(a.z+b.z*4+c.z)/6};}}
    return out;
  }
  return { init, setPlace, update, heightAt, hook, startPoint, scenicRoute, selectShadow, drawShadow, PLACES, get place() { return place; }, get ready() { return ready; }, get cpuReady() { return !!cpu; }, R, q, set lodK(v) { lodK = v; }, get lodK() { return lodK; }, get nNodes() { return nNodes; } };
})();
