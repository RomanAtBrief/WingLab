/* ================= WebGPU scene: environment presets, camera, aircraft, airflow, forces, weather — same API as Scene3DGL ================= */
const EnvGPU = (() => {
  const T = THREE;
  // two places, always fair weather: tropical cumulus over the Philippine islands, big desert cumulus over the canyon
  const PLACES = {
    islands: { name: 'Philippine islands', haze: 1.5, clouds: { base: 850, top: 2800, cover: 0.58, type: 0.8, dens: 0.85, clump: 0.7, cirrus: 0.45, cirrusAlt: 10500 } },
    canyon:  { name: 'Grand Canyon', haze: 1.6, clouds: { base: 2000, top: 4800, cover: 0.35, type: 0.95, dens: 0.85, clump: 0.6, cirrus: 0.35, cirrusAlt: 11000 } }
  };
  // light presets: sun elevation and azimuth (degrees)
  const TIMES = { morning: { name: 'Morning', el: 27, az: 38 }, midday: { name: 'Midday', el: 62, az: -18 }, golden: { name: 'Golden hour', el: 10, az: -32 } };
  const WEATHER = {};
  const state = { place: 'islands', time: 'morning', weather: 'clear', dirty: true, alt: 2000, altKey: null };
  const out = { night: 0, precip: 'none', overcast: 0, sunDir: new T.Vector3(), lightDir: new T.Vector3(), lightColor: new T.Color(1, 1, 1), exposure: 1 };
  const env = { sunDir: new T.Vector3(), realSun: new T.Vector3(), lightTint: new T.Color(1, 1, 1), groundAlbedo: new T.Color(), shift: new T.Vector3(), sunE: 3, night: 0 };
  const dirFrom = (el, az) => { const e = el * Math.PI / 180, a = az * Math.PI / 180; return new T.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)); };
  function set(k, v) { if (k === 'place' && !PLACES[v]) return; if (k === 'time' && !TIMES[v]) return; state[k] = v; state.dirty = true; }
  // everything that depends on place / light / (coarse) altitude
  function setup(planeAlt) {
    const P = PLACES[state.place], tm = TIMES[state.time], TP = GTerrain.PLACES[state.place];
    const c = { dark: 0, ...P.clouds, seed: 1 + Object.keys(PLACES).indexOf(state.place) };
    const sun = dirFrom(tm.el, tm.az);
    env.realSun.copy(sun); env.sunDir.copy(sun);
    env.sunE = 3; env.lightTint.setRGB(1, 1, 1); env.night = 0;
    env.groundAlbedo.setRGB(TP.albedo[0], TP.albedo[1], TP.albedo[2]);
    Object.assign(env, { haze: P.haze, fog: 0, snow: 0, wet: 0, overcast: 0, placeId: TP.id, water: TP.water, tile: TP.tile, hmax: TP.hmax, snowLine: TP.snowLine, treeLine: TP.treeLine,
      cloudBase: c.base, cloudTop: c.top, cover: c.cover, cdens: c.dens, ctype: c.type, cscale: 1, quality: 1, seaRough: 1 });
    GTerrain.setPlace(state.place); GTrees.setPlace(state.place);
    GClouds.setConfig(c);
    GAtmos.markDirty();
    GR.setWhiteBalance(Math.min(planeAlt, c.base), P.haze, sun.y);
    GPost.setExposureTarget(0.19, -3, 8); meter(planeAlt);
    GPost.reset();
    Object.assign(out, { night: 0, precip: 'none', overcast: 0 });
    out.sunDir.copy(sun); out.lightDir.copy(sun); out.lightColor.copy(env.lightTint);
    state.dirty = false;
  }
  // exposure like a photographer's incident-light meter: a sunlit grey card comes out mid grey, so bright sand looks bright and deep water dark
  function meter(planeAlt) {
    const s = env.realSun, T = GR.sunT(planeAlt, env.haze, s.y), Tl = 0.2126 * T[0] + 0.7152 * T[1] + 0.0722 * T[2];
    const E = env.sunE * Tl * Math.max(s.y, 0.36) + env.sunE * (0.1 + 0.05 * s.y);
    GPost.setIncident(1.12 * Math.PI / E, 0.12);
  }
  function update(planeAlt) {
    const k = Math.round(planeAlt / 250);
    if (state.dirty) setup(planeAlt);
    if (k !== state.altKey) { state.altKey = k; GR.setWhiteBalance(Math.min(planeAlt, env.cloudBase || planeAlt), env.haze || 2, env.realSun.y); meter(planeAlt); }
  }
  return { PLACES, TIMES, WEATHER, state, out, env, set, update };
})();

const Scene3DGPU = (() => {
  const T = THREE;
  let host, canvas, camera, air = null, mods = null;
  const holder = new T.Group(), pitch = new T.Group(), flowGroup = new T.Group(), arrowGroup = new T.Group();
  holder.add(pitch); pitch.add(flowGroup);
  const cam = { az: -2.1, el: 0.48, d: 1, taz: -2.1, tel: 0.48, td: 1 };
  const vis = { alpha: 0, CL: 0.4, stalled: false, sepX: 1, V: 50, h: 1000, thr: 0.8, ab: false, L: 1, W: 1, T: 0, D: 0.1, extended: true };
  const show = { forces: false, flow: true, weather: true };
  let arrows = {}, labels = {}, time = 0, viewName = '34', size = 10, paused = false;
  let insets = { l: 16, r: 16, b: 88, t: 136 };
  const framing={l:16,r:16,b:88,t:136};
  const world = { x: 0, z: 0, alt: 1000, lastAlt: null };
  const perf = { acc: 0, n: 0, scale: 1, level: 2, cool: 5 };
  const d = () => G.device;

  /* ---------- geometry helpers ---------- */
  const kN = () => 10 / air.L;
  function wingWorld(e, side, frac) {
    const w = air.wing, c = Math.max(w.chord(e), w.cr * 0.02), k = kN();
    return new T.Vector3(w.rootX - w.xle(e) - frac * c, w.rootY + w.z(e) * w.s, side * e * w.s).multiplyScalar(k).applyAxisAngle(new T.Vector3(0, 0, 1), vis.alpha * Math.PI / 180);
  }
  /* ---------- air trails: wing-tip vortices and contrails, drawn as lit, soft ribbons in the HDR pass ----------
     The aircraft sits still while the air streams past at the true airspeed, so each trail is a ribbon laid back along −x from
     its source. Wing-tip vortices sink (downwash from the lift) and only show when the air is humid and the lift is high;
     contrails form behind the engines in the cold air above about 8 km. Their texture drifts back at the airspeed. */
  const TR = { max: 8, data: new Float32Array(8 * 16), n: 0, buf: null, u: null, pipe: null, bg: null, SEG: 72 };
  function initTrails() {
    TR.buf = G.buf(TR.max * 64, GPUBufferUsage.STORAGE, null, 'trails');
    TR.u = G.buf(32, GPUBufferUsage.UNIFORM, null, 'trailU');
    const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
    TR.pipe = G.render({ label: 'trails', targets: [{ format: 'rgba16float', blend }], depth: { compare: 'greater', write: false }, code: `${G.COMMON}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> TD: array<vec4f>;
@group(0) @binding(2) var<uniform> TU: array<vec4f, 2>;     // sun colour at the aircraft, sky light
const SEG = ${TR.SEG}u;
struct VO { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) @interpolate(flat) k: u32, @location(2) wp: vec3f };
fn trailPos(k: u32, s: f32) -> vec3f {
  let a = TD[k * 4u]; let c = TD[k * 4u + 2u];
  let side = sign(a.z + 1e-4);
  // sinking and slow drift toward the centre line (vortex pair), plus a gentle wobble
  let q=vec3f(a.x-s,a.y-c.x*s+0.4*sin(s*.013+c.w)*sat(s/200.0),a.z-side*c.y*s);let h=F.flight.x;return vec3f(cos(h)*q.x-sin(h)*q.z,q.y,sin(h)*q.x+cos(h)*q.z);
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var ks = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u); let kq = ks[vi];
  let k = ii / SEG; let j = ii % SEG;
  let b = TD[k * 4u + 1u];
  let f0 = pow(f32(j) / f32(SEG), 1.7); let f1 = pow(f32(j + 1u) / f32(SEG), 1.7);
  let s = mix(f0, f1, f32(kq & 1u)) * b.w;
  let P = trailPos(k, s);
  let T = normalize(trailPos(k, s + 1.0) - P);
  let toC = normalize(F.camPos - P);
  var sd = cross(T, toC); let l = length(sd); sd = select(vec3f(0.0, 1.0, 0.0), sd / l, l > 1e-4);
  let w = b.y + b.z * s;
  let across = f32(kq >> 1u) * 2.0 - 1.0;
  let wp = P + sd * across * w * 0.5;
  var o: VO; o.pos = F.viewProj * vec4f(wp, 1.0); o.q = vec2f(s, across); o.k = k; o.wp = wp;
  return o;
}
fn nz(x: f32, y: f32) -> f32 { return vnoise2(vec2f(x, y)); }
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let a = TD[i.k * 4u]; let b = TD[i.k * 4u + 1u]; let c = TD[i.k * 4u + 2u]; let d = TD[i.k * 4u + 3u];
  let s = i.q.x; let w = b.y + b.z * s;
  // texture scrolls back with the air: sample it in air-mass coordinates (distance travelled by that bit of air)
  let m = s - d.x * F.time + d.y * 97.0;
  let turb = nz(m / (4.0 + w * 1.5), i.q.y * 1.3 + d.y) * 0.6 + nz(m / (1.5 + w * 0.5), i.q.y * 2.7 + 5.0) * 0.4;
  let prof = exp(-i.q.y * i.q.y * mix(2.5, 4.5, a.w));
  var dens = b.x * prof * smoothstep(c.z, c.z + max(8.0 * b.y, 6.0), s) * (1.0 - smoothstep(b.w * 0.55, b.w, s));
  dens *= mix(0.55 + 0.9 * turb, 0.35 + 1.1 * turb * turb, a.w);
  dens *= 1.0 / (1.0 + b.z * s * 0.15);
  let al = sat(dens);
  if (al < 0.003) { discard; }
  let V = normalize(i.wp - F.camPos);
  let ct = dot(V, F.sunDir);
  let g = 0.72; let hg = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * ct, 1.5));
  let col = TU[0].rgb * (hg * 2.0 + 0.22) + TU[1].rgb * 0.9;
  return vec4f(col * al, al);
}` });
    GR.addHook({ name: 'trails', forward(pass) {
      if (!TR.n) return;
      if (!TR.bg) TR.bg = G.bind(TR.pipe, 0, [GR.frameBuf, TR.buf, TR.u]);
      pass.setPipeline(TR.pipe); pass.setBindGroup(0, TR.bg); pass.draw(6, TR.n * TR.SEG);
    } });
  }
  const _v = new T.Vector3();
  function updateTrails(alt, env) {
    TR.n = 0;
    if (!air || !show.flow || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    const f = vis, w = air.wing, place = EnvGPU.state.place;
    const rho = 1.225 * Math.exp(-alt / 9000), V = Math.max(f.V, 5), b = w.b || 2 * w.s, b0 = Math.PI / 4 * b;
    const sink = Math.max(0, f.L) / (2 * Math.PI * rho * V * b0 * b0) / V;   // vortex descent per metre flown
    const humid = place === 'islands' ? 1 : 0.35;
    const push = (p, type, strength, w0, grow, len, drift, gap) => {
      if (TR.n >= TR.max || strength < 0.004) return;
      const o = TR.n * 16, D = TR.data;
      _v.copy(p).applyMatrix4(air.group.matrixWorld);
      D.set([_v.x, _v.y, _v.z, type, strength, w0, grow, len, sink, drift, gap, TR.n * 2.39996, V, TR.n * 0.37 + 0.1, 0, 0], o);
      TR.n++;
    };
    // wing-tip vortices: condensation in the low pressure of the vortex core, strongest at high lift in humid air
    const CL = f.CL || 0, low = Math.exp(-Math.max(0, alt - 1500) / 2500);
    const vx = Math.max(0, CL - 0.35) * 1.6 * humid * low * (f.stalled ? 0.5 : 1);
    const tipX = w.rootX - w.xle(1) - w.chord(1) * 0.7, tipY = w.rootY + w.z(1) * w.s;
    if (vx > 0.01) [1, -1].forEach(sd => push(_v.set(tipX, tipY, sd * w.s * 0.99).clone(), 0, Math.min(0.22, vx * 0.22), 0.04 + 0.003 * w.s, 0.0012, Math.min(180, 14 * size), 0.0006, 0));
    // contrails: water vapour from the exhaust freezes in air colder than about -40 °C
    const cold = Math.min(1, Math.max(0, (alt - 7800) / 1500));
    if (cold > 0 && air.anim.exhausts) air.anim.exhausts.slice(0, 4).forEach(e => push(e.clone(), 1, 0.9 * cold * (0.55 + 0.45 * Math.min(1, f.thr + 0.2)), 0.9 + 0.25 * size / 30, 0.028, Math.min(3000, 140 * size), 0.012, 1.1 * size));
    if (TR.n) d().queue.writeBuffer(TR.buf, 0, TR.data.buffer, 0, TR.n * 64);
    const s = env.realSun, Tt = GR.sunT(alt, env.haze || 2, s.y), E = env.sunE;
    d().queue.writeBuffer(TR.u, 0, new Float32Array([E * Tt[0], E * Tt[1], E * Tt[2], 0, E * 0.018, E * 0.03, E * 0.052, 0]));
  }

  /* ---------- overlay renderer: thick lines (airflow, rain, snow) and force arrows, drawn after tone mapping with 4× MSAA ---------- */
  const OV = { max: 4096, data: null, buf: null, n: 0, pipeA: null, pipeN: null, arrowPipe: null, arrowBuf: null, bg: null };
  const seg = {
    n: 0, add: 0,
    push(a, b, wpx, r, g, bl, mode) {
      if (this.n >= OV.max) return;
      const o = this.n * 12, D = OV.data;
      D[o] = a.x; D[o + 1] = a.y; D[o + 2] = a.z; D[o + 3] = wpx; D[o + 4] = b.x; D[o + 5] = b.y; D[o + 6] = b.z; D[o + 7] = mode; D[o + 8] = r; D[o + 9] = g; D[o + 10] = bl; D[o + 11] = 1;
      this.n++;
    }
  };
  function initOverlay() {
    const dev = d(), fmt = GR.format;
    OV.data = new Float32Array(OV.max * 12);
    OV.buf = G.buf(OV.max * 48, GPUBufferUsage.STORAGE, null, 'overlaySegs');
    const code = `${G.COMMON}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> S: array<vec4f>;
@group(0) @binding(2) var gD: texture_depth_2d;
@group(0) @binding(3) var<uniform> OU: vec4f;   // canvas size, dpr
struct VO { @builtin(position) pos: vec4f, @location(0) c: vec4f, @location(1) q: vec2f, @location(2) z: f32, @location(3) @interpolate(flat) mode: f32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var ks = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u); let k = ks[vi];
  let a = S[ii * 3u]; let b = S[ii * 3u + 1u]; let col = S[ii * 3u + 2u];
  let ca = F.viewProjNJ * vec4f(a.xyz, 1.0); let cb = F.viewProjNJ * vec4f(b.xyz, 1.0);
  var o: VO;
  if (ca.w < 0.05 || cb.w < 0.05) { o.pos = vec4f(0.0, 0.0, -2.0, 1.0); return o; }
  let sa = ca.xy / ca.w; let sb = cb.xy / cb.w;
  let px = OU.xy * 0.5;
  var dir = (sb - sa) * px; let len = length(dir);
  dir = select(vec2f(1.0, 0.0), dir / len, len > 0.01);
  let nrm = vec2f(-dir.y, dir.x);
  let wpx = a.w * OU.z;
  let t = f32(k & 1u); let s = f32(k >> 1u) * 2.0 - 1.0;
  let base = mix(sa, sb, t) * px + dir * (t * 2.0 - 1.0) * wpx * 0.5;
  let p = base + nrm * s * wpx * 0.5;
  let cw = mix(ca.w, cb.w, t); let cz = mix(ca.z, cb.z, t);
  o.pos = vec4f(p / px * cw, 0.0, cw); o.c = col; o.q = vec2f(t, s); o.z = cz / cw; o.mode = b.w;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let uv = i.pos.xy / OU.xy;
  let dz = textureLoad(gD, vec2i(uv * vec2f(textureDimensions(gD))), 0);
  if (dz > i.z * 1.002 + 1e-7) { discard; }
  let a = 1.0 - smoothstep(0.35, 1.0, abs(i.q.y));
  if (i.mode > 0.5) { return vec4f(i.c.rgb * a * 0.6, a * 0.6); }
  return vec4f(i.c.rgb * a, 0.0);
}`;
    const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    OV.pipe = G.render({ label: 'overlay-lines', code, targets: [{ format: fmt, blend }], samples: 4 });
    OV.u = G.buf(16, GPUBufferUsage.UNIFORM, null, 'overlayU');
    // arrows: shaded solid meshes, always on top
    OV.arrowPipe = dev.createRenderPipeline({ label: 'overlay-arrows', layout: dev.createPipelineLayout({ bindGroupLayouts: [GMesh.layouts.frame, GMesh.layouts.draw] }),
      vertex: { module: G.shader(`${G.COMMON}
@group(0) @binding(0) var<uniform> F: Frame;
struct Draw { model: mat4x4f, prevModel: mat4x4f, n0: vec4f, n1: vec4f, n2: vec4f, color: vec4f, pbr: vec4f, emis: vec4f, flags: vec4f };
@group(1) @binding(0) var<uniform> D: Draw;
struct VO { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) v: vec3f };
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f) -> VO { let w = D.model * vec4f(p, 1.0); var o: VO; o.pos = F.viewProjNJ * w; o.n = mat3x3f(D.n0.xyz, D.n1.xyz, D.n2.xyz) * n; o.v = F.camPos - w.xyz; return o; }
@fragment fn fs(i: VO) -> @location(0) vec4f { let k = 0.72 + 0.28 * abs(dot(normalize(i.n), normalize(i.v))); return vec4f(D.color.rgb * k * D.color.a, D.color.a); }`, 'arrows'), entryPoint: 'vs',
        buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }, { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }] },
      fragment: { module: G.shader(`
struct Draw { model: mat4x4f, prevModel: mat4x4f, n0: vec4f, n1: vec4f, n2: vec4f, color: vec4f, pbr: vec4f, emis: vec4f, flags: vec4f };
@group(1) @binding(0) var<uniform> D: Draw;
@fragment fn fs(@location(0) n: vec3f, @location(1) v: vec3f) -> @location(0) vec4f { let k = 0.72 + 0.28 * abs(dot(normalize(n), normalize(v))); return vec4f(D.color.rgb * k * D.color.a, D.color.a); }`, 'arrows-fs'), entryPoint: 'fs', targets: [{ format: fmt, blend }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' }, multisample: { count: 4 } });
    OV.arrowBuf = G.buf(256 * 16, GPUBufferUsage.UNIFORM, null, 'arrowDraws');
    OV.arrowBG = dev.createBindGroup({ layout: GMesh.layouts.draw, entries: [{ binding: 0, resource: { buffer: OV.arrowBuf, offset: 0, size: 240 } }] });
    OV.frameBG = dev.createBindGroup({ layout: GMesh.layouts.frame, entries: [{ binding: 0, resource: { buffer: GR.frameBuf } }] });
    GR.addHook({ name: 'overlay', resize() { OV.bg = null; }, overlay: drawOverlay });
  }
  const arrowParts = [];
  function prepareArrows() {
    arrowParts.length = 0;
    const data = new Float32Array(64 * 16), nm = new T.Matrix3(); let i = 0;
    arrowGroup.updateMatrixWorld(true);
    for (const a of Object.values(arrows)) {
      if (!a.visible) continue;
      for (const m of [a.userData.shaft, a.userData.head]) {
        const o = i * 64; data.set(m.matrixWorld.elements, o); nm.getNormalMatrix(m.matrixWorld); const e = nm.elements;
        data.set([e[0], e[1], e[2], 0, e[3], e[4], e[5], 0, e[6], e[7], e[8], 0], o + 32);
        const c = a.userData.col.clone().convertLinearToSRGB(); data.set([c.r, c.g, c.b, 0.96], o + 44);
        arrowParts.push({ m, slot: i }); i++;
      }
    }
    if (i) d().queue.writeBuffer(OV.arrowBuf, 0, data.buffer, 0, i * 256);
  }
  function drawOverlay(pass) {
    const rt = GR.RT(); if (!rt) return;
    if (!OV.bg) OV.bg = G.bind(OV.pipe, 0, [GR.frameBuf, OV.buf, rt.V.depth, OV.u]);
    if (seg.n) {
      d().queue.writeBuffer(OV.buf, 0, OV.data.buffer, 0, seg.n * 48);
      d().queue.writeBuffer(OV.u, 0, new Float32Array([GR.st.CW, GR.st.CH, GR.st.CW / Math.max(1, host.clientWidth), 0]));
      pass.setPipeline(OV.pipe); pass.setBindGroup(0, OV.bg); pass.draw(6, seg.n);
    }
    if (arrowParts.length) {
      pass.setPipeline(OV.arrowPipe); pass.setBindGroup(0, OV.frameBG);
      for (const p of arrowParts) {
        const g = GMesh.gpuGeo(p.m.geometry);
        pass.setBindGroup(1, OV.arrowBG, [p.slot * 256]); pass.setVertexBuffer(0, g.pos); pass.setVertexBuffer(1, g.nrm);
        if (g.idx) { pass.setIndexBuffer(g.idx, g.fmt); pass.drawIndexed(g.count); } else pass.draw(g.count);
      }
    }
  }
  function makeArrow(color) {
    const mat = new T.MeshBasicMaterial({ color });
    const g = new T.Group(), shaft = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 1, 14), mat), head = new T.Mesh(new T.ConeGeometry(0.22, 0.55, 20), mat);
    g.add(shaft, head); g.userData = { shaft, head, col: new T.Color(color) }; return g;
  }
  function setArrow(a, dir, len) {
    const { shaft, head } = a.userData;
    a.visible = len > 0.05 && show.forces;
    a.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
    const sh = Math.max(0.001, len - 0.5); shaft.scale.set(1, sh, 1); shaft.position.y = sh / 2; head.position.y = sh + 0.27;
    a.userData.tip = dir.clone().multiplyScalar(len + 0.35);
  }

  // Sunlit aerosol motes advect past the aircraft, curl into a vortex pair and
  // part around the fuselage. This is an analytic educational wake, not CFD.
  let aerosolOn=true;
  function initAerosols(){
    const blend={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}};
    const pipe=G.render({label:'air-mass-particles',targets:[{format:'rgba16float',blend}],depth:{compare:'greater',write:false},code:`${G.COMMON}
@group(0) @binding(0) var<uniform> F: Frame;
struct AO{@builtin(position) pos:vec4f,@location(0) uv:vec2f,@location(1) opacity:f32};
@vertex fn vs(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->AO{
  var corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let seed=f32(ii);let span=max(F.wake.x,8.0);
  let x=(fract(hash1(ii*17u)+F.time*max(F.wake.z,5.0)/220.0)*-220.0)+45.0;
  var y=(hash1(ii*31u+7u)-.5)*span*2.0;var z=(hash1(ii*47u+11u)-.5)*span*2.8;
  let age=max(-x,0.0)/max(F.wake.z,5.0);let side=sign(z);
  let centre=side*span*.46;let dy=y+age*1.8;let dz=z-centre;let r=sqrt(dy*dy+dz*dz);
  let angle=side*age*3.0*exp(-r*r/(span*span*.12));
  y=dy*cos(angle)-dz*sin(angle)-age*1.8;z=centre+dy*sin(angle)+dz*cos(angle);
  let obstacle=exp(-x*x/(F.wake.y*F.wake.y*.4))*exp(-(y*y+z*z)/8.0);
  y+=sign(y)*obstacle*1.8;z+=sign(z)*obstacle*1.8;
  let h=F.flight.x;let wp=vec3f(cos(h)*x-sin(h)*z,y,sin(h)*x+cos(h)*z);let right=vec3f(F.view[0][0],F.view[1][0],F.view[2][0]);let up=vec3f(F.view[0][1],F.view[1][1],F.view[2][1]);
  let uv=corners[vi];let rad=.018+hash1(ii+91u)*.045;var o:AO;o.pos=F.viewProj*vec4f(wp+(right*uv.x+up*uv.y)*rad,1);o.uv=uv;
  let layer=smoothstep(F.cloudBase-150.0,F.cloudBase+200.0,F.planeAlt)*(1.0-smoothstep(F.cloudTop-200.0,F.cloudTop+100.0,F.planeAlt));
  o.opacity=(.025+.07*layer)*smoothstep(-175.0,-90.0,x)*(1.0-smoothstep(25.0,45.0,x));return o;
}
@fragment fn fs(i:AO)->@location(0) vec4f{let a=exp(-dot(i.uv,i.uv)*3.0)*i.opacity;let forward=pow(max(dot(F.camFwd,F.sunDir),0.0),8.0);let col=vec3f(.55,.65,.75)+F.lightTint*F.sunE*(.25+forward*1.5);return vec4f(col*a,a);}`});
    const bg=G.bind(pipe,0,[GR.frameBuf]);
    GR.addHook({name:'aerosols',forward(pass){if(!aerosolOn)return;pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.draw(6,480);}});
  }

  /* ---------- setup ---------- */
  function init(el, lab, m) {
    host = el; mods = m; canvas = el.querySelector('canvas');
    camera = new T.PerspectiveCamera(36, 1, 0.1, 1e7);
    const rb = /readback/.test(location.hash);
    GR.init(canvas, { readback: rb });
    if (rb) {   // headless testing: show read-back frames in a 2D canvas on top
      const c2 = document.createElement('canvas'); c2.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'; canvas.parentElement.insertBefore(c2, canvas.nextSibling);
      window.WL_SNAP = async () => { await G.device.queue.onSubmittedWorkDone(); const img = await GR.readPixels(); c2.width = img.width; c2.height = img.height; c2.getContext('2d').putImageData(img, 0, 0); return G.S.errors.slice(); };
    }
    GTerrain.init(GR.frameBuf); GR.addHook(GTerrain.hook);
    GShadow.init(); GR.addHook(GShadow.hook);
    GTrees.init(GR.frameBuf); GR.addHook(GTrees.hook);
    GWaterfalls.init();GR.addHook(GWaterfalls.hook);
    GClouds.init(GR.frameBuf); GR.addHook(GClouds.hook);
    GPost.init(GR.frameBuf); GR.addHook(GPost.hook);
    initOverlay(); initTrails(); initAerosols();
    const css = getComputedStyle(document.documentElement), cv = (k, f) => (css.getPropertyValue(k).trim() || f);
    [['lift', cv('--lift', '#3B82F6')], ['weight', '#8E8E93'], ['thrust', cv('--thrust', '#FF9500')], ['drag', cv('--drag', '#CB30E0')]].forEach(([n, c]) => {
      arrows[n] = makeArrow(new T.Color(c)); arrowGroup.add(arrows[n]);
      const dv = document.createElement('div'); dv.className = 'flabel ' + n; lab.appendChild(dv); labels[n] = dv;
    });
    if (/lite/.test(location.hash)) perf.level = 0; else if (G.S.lite) perf.level = 1;
    applyLevel();
    // orbit with pointer, wheel and pinch
    const ptrs = new Map(); let pinch = 0;
    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (viewName !== 'free') { viewName = 'free'; host.dispatchEvent(new CustomEvent('viewchange')); } });
    canvas.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      const [px, py] = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 1) { cam.taz += (e.clientX - px) * 0.007; cam.tel = Math.max(-1.2, Math.min(1.52, cam.tel + (e.clientY - py) * 0.005)); }
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) cam.td = Math.max(0.5, Math.min(6, cam.td * pinch / dd)); pinch = dd; }
    });
    const up = e => { ptrs.delete(e.pointerId); pinch = 0; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { e.preventDefault(); cam.td = Math.max(0.5, Math.min(6, cam.td * Math.exp(e.deltaY * 0.001))); }, { passive: false });
    canvas.addEventListener('keydown',e=>{const key=e.key;if((FlightDirector.state.mode!=='manual'||e.altKey)&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(key)){e.preventDefault();if(key==='ArrowLeft')cam.taz-=.12;if(key==='ArrowRight')cam.taz+=.12;if(key==='ArrowUp')cam.tel=Math.min(1.5,cam.tel+.1);if(key==='ArrowDown')cam.tel=Math.max(-1.2,cam.tel-.1);if(key==='+'||key==='=')cam.td=Math.max(.5,cam.td*.9);if(key==='-')cam.td=Math.min(6,cam.td*1.1);viewName='free';host.dispatchEvent(new CustomEvent('viewchange'));}});
    new ResizeObserver(resize).observe(host); resize();
  }
  // quality levels: render scale, cloud steps, trees
  // Keep geometry at native CSS resolution; shed cloud samples before sharpness.
  const LEVELS = [{ s: .85, c: 64, t: true }, { s: 1, c: 80, t: true }, { s: 1, c: 88, t: true }, { s: 1.15, c: 104, t: true }, { s: 1.35, c: 128, t: true }];
  function applyLevel() {
    const L = LEVELS[perf.level]; perf.scale = L.s;
    GClouds.cfg.steps = L.c; GTrees.on = true;GTrees.quality=perf.level===0?.65:perf.level===1?.8:1;
    resize();
  }
  function resize() {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    GR.resize(r.width, r.height, dpr, Math.min(dpr, perf.scale, Math.sqrt(2400000/(r.width*r.height))));
    camera.aspect = r.width / r.height;
    camera.setViewOffset(r.width,r.height,(framing.r-framing.l)/2,(framing.b-framing.t)/2,r.width,r.height);
    camera.updateProjectionMatrix();
    GPost.reset();
  }
  function setInsets(l,r,b,t=136){insets={l,r,b,t};}
  function setAircraft(built) {
    if (air) { pitch.remove(air.group); Model.dispose(air.group); }
    air = built; pitch.add(built.group);
    size = Math.max(built.L, built.span);
    flowGroup.scale.setScalar(built.L / 10); arrowGroup.scale.setScalar(built.L / 10);
    camera.near = Math.max(0.05, size * 0.004); camera.updateProjectionMatrix();
    built.group.traverse(o => { if (o.material && o.material.isMeshBasicMaterial && !o.material.transparent) o.userData.glow = 3; });
    GPost.reset(); GAtmos.markEnv();
  }
  function setView(name) {
    viewName = name;
    const v = { '34': [-2.1, 0.48], side: [-Math.PI / 2, 0.02], front: [0, 0.05], top: [-Math.PI / 2, 1.5], rear: [Math.PI, 0.20] }[name];
    if (!v) return;
    let az = v[0]; while (az - cam.taz > Math.PI) az -= 2 * Math.PI; while (cam.taz - az > Math.PI) az += 2 * Math.PI;
    cam.taz = az; cam.tel = v[1]; cam.td = 1;
  }
  const set = v => Object.assign(vis, v);
  const toggle = (n, on) => { show[n] = on; };

  let envTimer = 0, frameCount = 0;
  const maxFrames = +((location.hash.match(/frames=(\d+)/) || [])[1] || 0);
  let failed = false, gpuBusy = false, lastRender = 0, presented = false;
  function frame(dt) {
    // if this GPU cannot run the WebGPU renderer, reload once with the WebGL renderer
    if (!failed && (G.S.lost || G.S.errors.length > 0)) { failed = true; console.warn('Wing Lab: WebGPU renderer failed — switching to WebGL.', G.S.errors.slice(0, 3)); host.dispatchEvent(new CustomEvent('rendererfailure')); return; }
    if (!air || G.S.lost || gpuBusy || document.hidden || (lastRender && performance.now()-lastRender<1000/30)) return;
    if (maxFrames && ++frameCount > maxFrames) return;
    const now=performance.now(), elapsed=lastRender?Math.min(.15,(now-lastRender)/1000):dt;lastRender=now;dt=elapsed;
    if (paused || matchMedia('(prefers-reduced-motion:reduce)').matches) dt = 0;
    time += dt;
    const e = 1 - Math.exp(-Math.min(dt || 0.016, 0.05) * 5);
    const cameraMotion=Math.abs(cam.taz-cam.az)*e+Math.abs(cam.tel-cam.el)*e+Math.abs(cam.td-cam.d)*e;
    if(cameraMotion>.008){GPost.resetHistory();GClouds.resetHistory();}
    cam.az += (cam.taz - cam.az) * e; cam.el += (cam.tel - cam.el) * e; cam.d += (cam.td - cam.d) * e;
    const bounds=host.getBoundingClientRect();
    const easing=matchMedia('(prefers-reduced-motion:reduce)').matches?1:1-Math.exp(-Math.max(dt,.016)*12);
    for(const key of ['l','r','b','t'])framing[key]+=(insets[key]-framing[key])*easing;
    const safeW=Math.max(120,bounds.width-framing.l-framing.r-64),safeH=Math.max(100,bounds.height-framing.t-framing.b-56);
    camera.setViewOffset(bounds.width,bounds.height,(framing.r-framing.l)/2,(framing.b-framing.t)/2,bounds.width,bounds.height);
    const vf=Math.tan(camera.fov*Math.PI/360),fit=Math.max(bounds.height/safeH,bounds.width/(safeW*camera.aspect));
    const D=size*(bounds.width<600?.43:.52)/vf*fit*cam.d*(viewName==='rear'?1.18:1);
    camera.position.set(D * Math.cos(cam.el) * Math.cos(cam.az), D * Math.sin(cam.el), D * Math.cos(cam.el) * Math.sin(cam.az));
    // world: the aircraft flies along +x; the ground scrolls underneath
    const TP = GTerrain.PLACES[EnvGPU.state.place];
    if (world.place !== EnvGPU.state.place && GTerrain.place && GTerrain.place.key === EnvGPU.state.place) { world.place = EnvGPU.state.place; [world.x, world.z] = GTerrain.startPoint(); world.lastAlt = null; GPost.reset(); }
    if(world.routePlace!==EnvGPU.state.place&&GTerrain.cpuReady&&GTerrain.place?.key===EnvGPU.state.place){world.routePlace=EnvGPU.state.place;const requested=Number(new URLSearchParams(location.hash.slice(1)).get('h'));FlightDirector.configure(world.routePlace,GTerrain.scenicRoute(),requested>0?Math.min(requested,16000):world.routePlace==='canyon'?180:3000);GPost.reset();}
    const previousX=world.x,previousZ=world.z;
    const nav=FlightDirector.step(dt,vis.V,size,GTerrain.heightAt);
    if(FlightDirector.ready){world.x=nav.x;world.z=nav.z;}else world.x+=vis.V*dt;
    const heading=FlightDirector.ready?nav.heading:0;
    camera.position.applyAxisAngle(new T.Vector3(0,1,0),-heading);
    holder.rotation.y=-heading;arrowGroup.rotation.y=-heading;
    const ground = GTerrain.heightAt(world.x, world.z);
    const minAlt = Math.max(ground, TP.water) + size * 0.8 + 25;
    const alt = Math.max(FlightDirector.ready?nav.alt:vis.h, minAlt);
    const dAlt = world.lastAlt === null ? 0 : alt - world.lastAlt; world.lastAlt = alt;
    // Retract the orbit along its sight line when a cliff blocks it. Raising the
    // camera over a wall made the aircraft disappear behind that wall.
    const desired=camera.position.clone();let allowed=1;
    for(let k=1;k<=40;k++){const t=k/40,x=world.x+desired.x*t,z=world.z+desired.z*t;let g=TP.water;for(const [ox,oz] of [[0,0],[16,0],[-16,0],[0,16],[0,-16]])g=Math.max(g,GTerrain.heightAt(x+ox,z+oz));if(alt+desired.y*t<g+12){allowed=Math.max(.08,(k-1)/40);break;}}
    world.cameraFraction=Math.min(allowed,(world.cameraFraction??allowed)+(1-Math.exp(-Math.max(dt,.016)*2))*.15);
    camera.position.copy(desired).multiplyScalar(world.cameraFraction);
    camera.lookAt(0, size * 0.02, 0);
    const a = vis.alpha * Math.PI / 180, buf = vis.stalled ? 0.012 : 0.0025;
    pitch.rotation.set(nav.bank+Math.sin(time * 1.3) * buf * 1.5 + (vis.stalled && dt ? (Math.random() - 0.5) * buf : 0), 0, a + nav.pitch + Math.sin(time * 0.9) * buf);
    holder.position.y = Math.sin(time * 0.7) * size * 0.004;
    Model.animateControls(air,nav,dt);
    const an = air.anim;
    // a running propeller is a blur: blades hidden, soft disc shown (it turns far too fast for the eye or a camera shutter)
    an.props.forEach(p => { const run = vis.thr > 0.04, u = p.userData; u.spin.rotation.x += dt * (run ? 40 : 3);
      (u.blades || []).forEach(b => { b.visible = !run; }); u.disc.visible = run; u.disc.material.opacity = Math.min(1, 0.55 + 0.6 * vis.thr); u.disc.rotation.x += dt * 0.7; });
    an.fans.forEach(f => { f.userData.fan.rotation.x += dt * (4 + 22 * vis.thr); });
    an.flames.forEach(f => { f.visible = vis.ab; if (vis.ab) f.scale.set(1 + 0.08 * Math.sin(time * 40) + 0.05 * Math.random(), 1, 1); });
    if (an.mast) { const tgt = vis.extended ? 0 : 1; an.mast.userData.k = (an.mast.userData.k ?? tgt) + (tgt - (an.mast.userData.k ?? tgt)) * e * 0.6;
      const k = an.mast.userData.k; an.mast.rotation.z = -k * Math.PI / 2 * 0.96; an.mast.visible = k < 0.97; an.mast.scale.setScalar(1 - 0.4 * k); }
    if (an.droop) { const tgt = vis.V < 110 ? 12.5 : vis.V < 165 ? 5 : 0; an.droop.userData.a = (an.droop.userData.a ?? tgt) + (tgt - (an.droop.userData.a ?? tgt)) * e * 0.5; an.droop.rotation.z = -an.droop.userData.a * Math.PI / 180; }
    const night = EnvGPU.out.night, strobe = (time % 1.2) < 0.06, ls = 0.6 + size / 60;
    an.lights.forEach(l => { l.userData.spr.material.opacity = 0.3 + 0.7 * night; l.userData.spr.scale.setScalar(ls * (0.15 + 0.25 * night)); l.userData.spr.userData.glow = 1.6 * (1 - 0.9 * night); });
    an.strobe.forEach(l => { l.visible = strobe; l.userData.spr.scale.setScalar(ls * (0.26 + 0.4 * night)); l.userData.spr.userData.glow = 3.5 * (1 - 0.85 * night); });
    holder.updateMatrixWorld(true);
    // forces
    arrowGroup.position.copy(holder.position);
    const lw = Math.max(vis.L, vis.W, 1), td = Math.max(vis.T, vis.D, 1);
    setArrow(arrows.lift, new T.Vector3(0, 1, 0), 2.5 * Math.max(0, vis.L) / lw);
    setArrow(arrows.weight, new T.Vector3(0, -1, 0), 2.5 * vis.W / lw);
    setArrow(arrows.thrust, new T.Vector3(Math.cos(a), Math.sin(a), 0), 2.6 * vis.T / td);
    setArrow(arrows.drag, new T.Vector3(-1, 0, 0), 2.6 * vis.D / td);
    camera.updateMatrixWorld();
    const centre=new T.Vector3(0,0,0).project(camera);host.dataset.aircraftX=String((centre.x+1)*bounds.width/2);host.dataset.aircraftY=String((1-centre.y)*bounds.height/2);host.dataset.cameraDistance=camera.position.length().toFixed(1);host.dataset.ground=ground.toFixed(1);host.dataset.cameraFraction=world.cameraFraction.toFixed(3);
    const r = host.getBoundingClientRect();
    for (const [n, el] of Object.entries(labels)) {
      const A = arrows[n];
      if (!A.visible) { el.hidden = true; continue; }
      const p = A.userData.tip.clone().multiplyScalar(air.L / 10).applyAxisAngle(new T.Vector3(0,1,0),-heading).add(arrowGroup.position).project(camera);
      el.hidden = p.z > 1;
      el.style.transform = `translate(${Math.max(60, Math.min(r.width - 60, (p.x + 1) / 2 * r.width+(r.width<600?(n==='drag'?24:n==='thrust'?-24:0):0))).toFixed(1)}px, ${Math.max(70, Math.min(r.height - 20, (1 - p.y) / 2 * r.height)).toFixed(1)}px) translate(-50%, -50%)`;
    }
    seg.n = 0;
    prepareArrows();
    // environment for this frame
    EnvGPU.update(alt);
    const env = EnvGPU.env;
    env.planeAlt = alt;
    env.shift.set(world.x-previousX, dAlt, world.z-previousZ);env.flight=[heading,nav.bank,nav.pitch,nav.mode==='manual'?1:0];
    const tile = TP.tile, W = GClouds.WSIZE;
    env.terrOff = [((world.x % tile) + tile) % tile, ((world.z % tile) + tile) % tile];
    const wind = time * 6;
    env.cloudOff = [(((world.x + wind) % W) + W) % W, ((world.z % W) + W) % W];
    env.cloudT = time;
    const vp = GR.projRZ(camera, new T.Matrix4(), 0, 0).multiply(camera.matrixWorldInverse);
    updateTrails(alt, env);
    aerosolOn=show.flow&&show.weather&&!matchMedia('(prefers-reduced-motion:reduce)').matches;
    host.dataset.cascades=String(GWaterfalls.count);
    GTerrain.update({ worldX: world.x, worldZ: world.z, env }, camera, vp);
    GShadow.update(camera, size, alt - Math.max(ground, TP.water), env.sunDir, alt);
    envTimer -= dt;
    const envDue = envTimer <= 0; if (envDue) envTimer = 1.2;
    const t0 = performance.now();
    env.wake=[air.span,air.L,vis.V,Math.max(0,vis.CL)];
    GR.frame({ camera, roots: [holder], dt: Math.max(dt, 1e-4), env, envDue, jitter: true });
    // At most one in-flight frame: avoid an unbounded command queue on slow GPUs.
    gpuBusy=true;G.device.queue.onSubmittedWorkDone().then(()=>{gpuBusy=false;if(GTerrain.cpuReady&&world.routePlace===EnvGPU.state.place&&!G.S.errors.length)presented=true;}).catch(()=>{gpuBusy=false;});
    adapt(elapsed);
    if(!world.telemetryAt||performance.now()-world.telemetryAt>150){world.telemetryAt=performance.now();host.dispatchEvent(new CustomEvent('flighttelemetry',{detail:{...nav,alt}}));}
    void t0;
  }
  // keep the frame rate up: step the quality level down when frames are slow, up when there is headroom
  function adapt(dt) {
    if (!dt) return;
    perf.acc += dt; perf.n++; perf.cool -= dt;
    if (perf.n < 45) return;
    const ms = perf.acc / perf.n * 1000; perf.acc = 0; perf.n = 0;
    if (perf.cool > 0) return;
    if (ms > 46 && perf.level > 0) { perf.level--; applyLevel(); perf.cool = 1.5; }
    else if (ms < 35 && perf.level < LEVELS.length - 1) { perf.level++; applyLevel(); perf.cool = 4; }
  }
  function setLabels(t) { for (const [n, s] of Object.entries(t)) if (labels[n]) labels[n].textContent = s; }

  // picker thumbnails: a small separate WebGL renderer (synchronous, transparent background)
  let tr = null, trEnv = null;
  function releaseThumbnails(){trEnv?.dispose();trEnv=null;if(tr){tr.dispose();tr.forceContextLoss();tr=null;}}
  function thumbnail(built, w = 360, h = 200) {
    if (!tr) {
      tr = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, canvas: document.createElement('canvas') });
      tr.setSize(w, h, false); tr.outputColorSpace = T.SRGBColorSpace; tr.toneMapping = T.ACESFilmicToneMapping; tr.toneMappingExposure = 1.05;
      if (mods && mods.RoomEnvironment) { const pm = new T.PMREMGenerator(tr); const room=new mods.RoomEnvironment();trEnv = pm.fromScene(room, 0.04).texture;room.dispose();pm.dispose(); }
    }
    const sc = new T.Scene(), c = new T.PerspectiveCamera(30, w / h, 0.1, 1000), s = Math.max(built.L, built.span);
    sc.add(built.group); sc.environment = trEnv; sc.add(new T.HemisphereLight('#ffffff', '#8a96a3', 1.0));
    const dl = new T.DirectionalLight('#fff', 2.2); dl.position.set(-3, 5, -4); sc.add(dl);
    c.position.set(s * 0.95, s * 0.42, -s * 1.05); c.lookAt(0, 0, 0);
    tr.setClearColor(0x000000, 0); tr.clear(); tr.render(sc, c);
    const url = tr.domElement.toDataURL();
    Model.dispose(built.group);
    return url;
  }
  return { init, setAircraft, setView, set, toggle, frame, setLabels, thumbnail, releaseThumbnails, setInsets, pause: p => { paused = p; }, get ready(){return presented&&GTerrain.cpuReady&&GTerrain.place?.key===EnvGPU.state.place&&world.routePlace===EnvGPU.state.place;}, get view() { return viewName; }, gpu: true, perf };
})();
