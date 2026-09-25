/* ================= Trees: GPU-placed instanced meshes near the camera, billboard impostors further away ================= */
const GTrees = (() => {
  const T = THREE;
  const MAXM = 24000, MAXI = 120000, RINGS = 5, GRIDN = 128;
  // per place: density, share of conifers, tree height range (m)
  const SPECIES = { islands: [0.0, 0.0, 9, 19], canyon: [0.6, 0.45, 3, 8] };
  let d, frameBuf, R = {}, P = {}, BG = {}, on = true, placeKey = null;

  function mkMesh(kind) {   // unit-height tree: uv.x = 0 trunk, 1 foliage
    const parts = [];
    const trunk = new T.CylinderGeometry(0.025, 0.04, kind ? 0.35 : 0.45, 6, 1, true); trunk.translate(0, kind ? 0.175 : 0.225, 0); parts.push([trunk, 0]);
    if (kind) {   // conifer: stacked jagged cones
      for (let i = 0; i < 4; i++) {
        const r = 0.27 - i * 0.05, h = 0.42 - i * 0.05, y = 0.18 + i * 0.19;
        const c = new T.ConeGeometry(r, h, 9, 2, true); c.translate(0, y + h / 2, 0);
        const p = c.attributes.position;
        for (let k = 0; k < p.count; k++) { const a = Math.atan2(p.getZ(k), p.getX(k)); const j = 1 + 0.14 * Math.sin(a * 5 + i * 1.7); p.setX(k, p.getX(k) * j); p.setZ(k, p.getZ(k) * j); }
        parts.push([c, 1]);
      }
    } else {       // broadleaf: lumpy crown
      const s = new T.IcosahedronGeometry(0.34, 2); s.scale(1, 0.85, 1); s.translate(0, 0.62, 0);
      const p = s.attributes.position;
      for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k) - 0.62, z = p.getZ(k); const n = 1 + 0.13 * Math.sin(x * 19 + y * 7) * Math.cos(z * 17 - y * 11) + 0.08 * Math.sin(x * 41 + z * 37); p.setXYZ(k, x * n, 0.62 + y * n, z * n); }
      parts.push([s, 1]);
    }
    const pos = [], nrm = [], uv = [], idx = []; let base = 0;
    for (const [g0, part] of parts) {
      const g = g0.index ? g0 : g0; g.computeVertexNormals();
      const p = g.attributes.position, n = g.attributes.normal;
      for (let k = 0; k < p.count; k++) {
        pos.push(p.getX(k), p.getY(k), p.getZ(k));
        // foliage normals bent outward from the crown centre: soft, rounded shading like a real canopy
        let nx = n.getX(k), ny = n.getY(k), nz = n.getZ(k);
        if (part) { const cx = p.getX(k), cy = p.getY(k) - (kind ? 0.5 : 0.62), cz = p.getZ(k), l = Math.hypot(cx, cy, cz) || 1; nx = nx * 0.4 + cx / l * 0.6; ny = ny * 0.4 + cy / l * 0.6 + 0.15; nz = nz * 0.4 + cz / l * 0.6; }
        const l = Math.hypot(nx, ny, nz) || 1; nrm.push(nx / l, ny / l, nz / l); uv.push(part, p.getY(k));
      }
      const ix = g.index ? g.index.array : [...Array(p.count).keys()];
      for (const i of ix) idx.push(base + i);
      base += p.count;
    }
    return { pos: G.buf(pos.length * 4, GPUBufferUsage.VERTEX, new Float32Array(pos)), nrm: G.buf(nrm.length * 4, GPUBufferUsage.VERTEX, new Float32Array(nrm)),
      uv: G.buf(uv.length * 4, GPUBufferUsage.VERTEX, new Float32Array(uv)), idx: G.buf(idx.length * 4, GPUBufferUsage.INDEX, new Uint32Array(idx)), n: idx.length };
  }

  function init(fb) {
    d = G.device; frameBuf = fb;
    const S = GPUBufferUsage;
    R.inst = [G.buf(MAXM * 32, S.STORAGE, null, 'treesBroad'), G.buf(MAXM * 32, S.STORAGE, null, 'treesConifer'), G.buf(MAXI * 32, S.STORAGE, null, 'treesFar')];
    R.args = G.buf(64, S.STORAGE | S.INDIRECT, null, 'treeArgs');
    R.u = G.buf(32, S.UNIFORM, null, 'treeU');
    R.mesh = [mkMesh(0), mkMesh(1)];
    const C = G.COMMON;
    P.place = G.compute(`${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> TU: vec4f;     // density, conifer share, min height, max height
@group(0) @binding(2) var hgt: texture_2d<f32>;
@group(0) @binding(3) var mat: texture_2d<f32>;
@group(0) @binding(4) var nrm: texture_2d<f32>;
@group(0) @binding(5) var<storage, read_write> iB: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> iC: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> iF: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> args: array<atomic<u32>, 16>;
@group(0) @binding(9) var<uniform> TV: vec4f;     // camera world xz (mod tile), 0, 0
@group(0) @binding(10) var alb: texture_2d<f32>;
fn wrapi(i: vec2i, per: i32) -> vec2i { return vec2i(((i.x % per) + per) % per, ((i.y % per) + per) % per); }
fn Hs(uv: vec2f) -> f32 {
  let n = i32(textureDimensions(hgt, 0).x); let x = uv * f32(n) - 0.5; let i = vec2i(floor(x)); let f = fract(x);
  let a = textureLoad(hgt, wrapi(i, n), 0).r; let b = textureLoad(hgt, wrapi(i + vec2i(1, 0), n), 0).r;
  let c = textureLoad(hgt, wrapi(i + vec2i(0, 1), n), 0).r; let e = textureLoad(hgt, wrapi(i + vec2i(1, 1), n), 0).r;
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${GRIDN}u || gid.y >= ${GRIDN}u) { return; }
  let ring = gid.z; let cs = 8.0 * f32(1u << ring);
  let rel = vec2i(gid.xy) - vec2i(${GRIDN / 2});
  if (ring > 0u && abs(rel.x) < ${GRIDN / 4} && abs(rel.y) < ${GRIDN / 4}) { return; }
  let camW = TV.xy;                        // world xz of the camera
  let cell = vec2i(floor(camW / cs)) + rel;
  let h1 = hash2i(cell * 7 + vec2i(i32(ring) * 131, 17)); let h2 = hash2i(cell * 13 + vec2i(5, i32(ring) * 71)); let h3 = hash2i(cell * 3 + vec2i(91, 23));
  let wxz = (vec2f(cell) + vec2f(h1, h2) * 0.9 + 0.05) * cs;
  let uv = wxz / F.tile;
  let m = textureLoad(mat, wrapi(vec2i(floor(fract(uv) * vec2f(textureDimensions(mat, 0)))), i32(textureDimensions(mat, 0).x)), 0);
  let fa = textureLoad(alb, wrapi(vec2i(floor(fract(uv) * vec2f(textureDimensions(alb, 0)))), i32(textureDimensions(alb, 0).x)), 0).a;
  let dens = smoothstep(0.25, 0.7, m.b) * (1.0 - m.a) * (1.0 - m.r) * (1.0 - fa) * TU.x;
  if (h3 > dens * 0.95) { return; }
  let gh = Hs(fract(uv));
  if (gh < F.water + 1.5) { return; }
  let nn = textureLoad(nrm, wrapi(vec2i(floor(fract(uv) * vec2f(textureDimensions(nrm, 0)))), i32(textureDimensions(nrm, 0).x)), 0).xyz;
  if (nn.y < 0.78) { return; }
  let conifer = hash2i(cell * 29 + vec2i(3, 3)) < TU.y;
  var ht = mix(TU.z, TU.w, pow(hash2i(cell * 17 + vec2i(1, 9)), 0.8)) * (1.0 + 0.12 * f32(ring));
  let P = vec3f(wxz.x - camW.x + F.camPos.x, gh - F.planeAlt, wxz.y - camW.y + F.camPos.z);
  let dd = P.xz - F.camPos.xz;
  let Pc = P - vec3f(0.0, dot(dd, dd) / (2.0 * 6371000.0), 0.0);
  let dist = distance(Pc, F.camPos);
  if (dist > 14000.0) { return; }
  // frustum test on a bounding sphere
  let c = F.viewProjNJ * vec4f(Pc + vec3f(0.0, ht * 0.5, 0.0), 1.0);
  let rr = ht * 0.8 * abs(F.viewProjNJ[0][0]);
  if (c.w < -ht || c.x < -c.w - rr || c.x > c.w + rr || c.y < -c.w - rr * 2.0 || c.y > c.w + rr * 2.0) { return; }
  let seed = hash2i(cell * 41 + vec2i(7, 1));
  let data = vec4f(Pc, ht);
  let extra = vec4f(select(0.0, 1.0, conifer), seed, dist, 0.0);
  if (dist < 650.0) {
    if (conifer) { let k = atomicAdd(&args[1], 1u); if (k < ${MAXM}u) { iC[k * 2u] = data; iC[k * 2u + 1u] = extra; } }
    else { let k = atomicAdd(&args[6], 1u); if (k < ${MAXM}u) { iB[k * 2u] = data; iB[k * 2u + 1u] = extra; } }
  } else {
    let k = atomicAdd(&args[11], 1u); if (k < ${MAXI}u) { iF[k * 2u] = data; iF[k * 2u + 1u] = extra; }
  }
}`, 'trees-place');
    P.clamp = G.compute(`
@group(0) @binding(0) var<storage, read_write> args: array<u32, 16>;
@compute @workgroup_size(1) fn main() { args[1] = min(args[1], ${MAXM}u); args[6] = min(args[6], ${MAXM}u); args[11] = min(args[11], ${MAXI}u); }`, 'trees-clamp');

    const tgt = [{ format: 'rgba8unorm-srgb' }, { format: 'rgba16float' }, { format: 'rgba16float' }];
    const VB = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }, { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }, { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }];
    const TREE_COL = `
fn lin(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
fn leafCol(conifer: bool, seed: f32) -> vec3f {
  var c = lin(vec3f(0.21, 0.35, 0.09));                                                      // tropical broadleaf
  if (F.place == 1u) { c = select(lin(vec3f(0.27, 0.32, 0.14)), lin(vec3f(0.22, 0.26, 0.17)), conifer); }   // tamarisk / juniper
  let v = fract(seed * 7.13);
  c *= 0.75 + 0.5 * v; c = mix(c, c * vec3f(1.15, 1.0, 0.8), fract(seed * 3.7));
  return c;
}`;
    P.mesh = G.render({ label: 'trees-mesh', buffers: VB, depth: {}, targets: tgt, cull: 'back', code: `${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> inst: array<vec4f>;
${TREE_COL}
struct VO { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) uv: vec2f, @location(2) cur: vec4f, @location(3) prev: vec4f, @location(4) @interpolate(flat) s: vec2f };
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @builtin(instance_index) ii: u32) -> VO {
  let a = inst[ii * 2u]; let e = inst[ii * 2u + 1u];
  let ang = e.y * 6.2831853; let cs = cos(ang); let sn = sin(ang);
  let w = a.w * select(0.85, 0.55, e.x > 0.5) * (0.85 + 0.3 * fract(e.y * 11.0));
  let lp = vec3f((p.x * cs - p.z * sn) * w / 0.6, p.y * a.w, (p.x * sn + p.z * cs) * w / 0.6);
  let P = a.xyz + lp;
  var o: VO; o.pos = F.viewProj * vec4f(P, 1.0); o.n = vec3f(n.x * cs - n.z * sn, n.y, n.x * sn + n.z * cs); o.uv = uv; o.s = e.xy;
  o.cur = F.viewProjNJ * vec4f(P, 1.0); o.prev = F.prevViewProjNJ * vec4f(P + F.shift, 1.0);
  return o;
}
struct GO { @location(0) a: vec4f, @location(1) n: vec4f, @location(2) m: vec4f };
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> GO {
  let conifer = i.s.x > 0.5;
  var col = leafCol(conifer, i.s.y) * (0.65 + 0.45 * i.uv.y);
  var N = normalize(i.n); if (!ff) { N = -N; }
  var id = 3.0;
  if (i.uv.x < 0.5) { col = lin(vec3f(0.22, 0.16, 0.1)); id = 0.0; }
  var o: GO;
  o.a = vec4f(col, 0.75 + 0.25 * i.uv.y);
  o.n = vec4f(N, 0.85);
  o.m = vec4f((i.cur.xy / i.cur.w - i.prev.xy / i.prev.w) * vec2f(0.5, -0.5), 0.0, id);
  return o;
}` });
    P.imp = G.render({ label: 'trees-impostor', buffers: [], depth: {}, targets: tgt, cull: 'none', code: `${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> inst: array<vec4f>;
${TREE_COL}
struct VO { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) @interpolate(flat) s: vec3f, @location(2) cur: vec4f, @location(3) prev: vec4f, @location(4) @interpolate(flat) side: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var ks = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u); let k = ks[vi];
  let c = vec2f(f32(k & 1u), f32(k >> 1u));
  let a = inst[ii * 2u]; let e = inst[ii * 2u + 1u];
  let toCam = F.camPos - a.xyz; let side = normalize(vec3f(-toCam.z, 0.0, toCam.x) + vec3f(1e-5, 0.0, 0.0));
  let w = a.w * select(0.9, 0.55, e.x > 0.5) * (0.85 + 0.3 * fract(e.y * 11.0));
  let P = a.xyz + side * (c.x - 0.5) * w + vec3f(0.0, c.y * a.w * 1.02, 0.0);
  var o: VO; o.pos = F.viewProj * vec4f(P, 1.0); o.q = c; o.s = e.xyz; o.side = side;
  o.cur = F.viewProjNJ * vec4f(P, 1.0); o.prev = F.prevViewProjNJ * vec4f(P + F.shift, 1.0);
  return o;
}
struct GO { @location(0) a: vec4f, @location(1) n: vec4f, @location(2) m: vec4f };
@fragment fn fs(i: VO) -> GO {
  let conifer = i.s.x > 0.5; let x = i.q.x * 2.0 - 1.0; let y = i.q.y;
  var inside = false; var nrm = vec3f(0.0, 1.0, 0.0); var shade = 1.0;
  let jag = 0.12 * sin(y * 38.0 + i.s.y * 20.0) + 0.06 * sin(y * 91.0);
  if (conifer) {
    let r = (1.0 - (y - 0.12) / 0.88) * (0.95 + jag);
    inside = y > 0.12 && abs(x) < r;
    if (y < 0.14 && abs(x) < 0.08) { inside = true; shade = 0.4; }
    nrm = normalize(vec3f(x * 0.9, 0.55, 0.0));
  } else {
    let cy = 0.6; let dy = (y - cy) / 0.4; let rr = x * x + dy * dy;
    inside = rr < 0.9 + jag * 1.6;
    if (y < 0.3 && abs(x) < 0.07) { inside = true; shade = 0.4; }
    nrm = normalize(vec3f(x, dy + 0.3, sqrt(max(0.0, 1.0 - min(rr, 1.0)))));
  }
  if (!inside) { discard; }
  let fwd = normalize(cross(i.side, vec3f(0.0, 1.0, 0.0)));
  let N = normalize(i.side * nrm.x + vec3f(0.0, nrm.y, 0.0) - fwd * nrm.z);
  var o: GO;
  o.a = vec4f(leafCol(conifer, i.s.y) * (0.6 + 0.5 * y) * shade, 0.8);
  o.n = vec4f(N, 0.9);
  o.m = vec4f((i.cur.xy / i.cur.w - i.prev.xy / i.prev.w) * vec2f(0.5, -0.5), 0.0, 3.0);
  return o;
}` });
    P.shadow = G.render({ label: 'trees-shadow', buffers: [VB[0]], depth: { compare: 'less', bias: 2, slope: 1.5 }, cull: 'none', code: `
@group(0) @binding(0) var<storage, read> inst: array<vec4f>;
@group(0) @binding(1) var<uniform> SC: mat4x4f;
@vertex fn vs(@location(0) p: vec3f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let a = inst[ii * 2u]; let e = inst[ii * 2u + 1u];
  let ang = e.y * 6.2831853; let cs = cos(ang); let sn = sin(ang);
  let w = a.w * select(0.85, 0.55, e.x > 0.5) * (0.85 + 0.3 * fract(e.y * 11.0));
  return SC * vec4f(a.xyz + vec3f((p.x * cs - p.z * sn) * w / 0.6, p.y * a.w, (p.x * sn + p.z * cs) * w / 0.6), 1.0);
}` });
  }

  let ready = false, tv = new Float32Array(4);
  function setPlace(key) { placeKey = key; BG.place = null; ready = false; }
  function bindAll() {
    const TR = GTerrain.R;
    BG.place = G.bind(P.place, 0, [frameBuf, R.u, TR.hgt.createView({ baseMipLevel: 0, mipLevelCount: 1 }), TR.mat.createView({ baseMipLevel: 0, mipLevelCount: 1 }), TR.nrm.createView({ baseMipLevel: 0, mipLevelCount: 1 }), R.inst[0], R.inst[1], R.inst[2], R.args, R.tv || (R.tv = G.buf(16, GPUBufferUsage.UNIFORM)), TR.alb.createView({ baseMipLevel: 0, mipLevelCount: 1 })]);
    BG.clamp = G.bind(P.clamp, 0, [R.args]);
    BG.mesh = [G.bind(P.mesh, 0, [frameBuf, R.inst[0]]), G.bind(P.mesh, 0, [frameBuf, R.inst[1]])];
    BG.imp = G.bind(P.imp, 0, [frameBuf, R.inst[2]]);
    ready = true;
  }
  const hook = {
    name: 'trees',
    pre(enc, o) {
      if (!on || !GTerrain.ready || !placeKey) return;
      if (!BG.place) bindAll();
      const sp = SPECIES[placeKey] || SPECIES.islands, q = GTerrain.q, tile = GTerrain.place.tile;
      d.queue.writeBuffer(R.u, 0, new Float32Array([sp[0], sp[1], sp[2], sp[3]]));
      const cx = o.camera.position.x + q.wx, cz = o.camera.position.z + q.wz;
      tv[0] = ((cx % tile) + tile) % tile; tv[1] = ((cz % tile) + tile) % tile;
      d.queue.writeBuffer(R.tv, 0, tv);
      const m0 = R.mesh[0], m1 = R.mesh[1];
      // indirect args: [conifer mesh: 5 u32][broad mesh: 5][impostor: 4]
      d.queue.writeBuffer(R.args, 0, new Uint32Array([m1.n, 0, 0, 0, 0, m0.n, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0]));
      G.dispatch(enc, P.place, [BG.place], GRIDN / 8, GRIDN / 8, RINGS, 'trees');
      G.dispatch(enc, P.clamp, [BG.clamp], 1);
    },
    gbuffer(pass) {
      if (!on || !ready || !GTerrain.ready) return;
      const draw = (m, bg, off) => { pass.setBindGroup(0, bg); pass.setVertexBuffer(0, m.pos); pass.setVertexBuffer(1, m.nrm); pass.setVertexBuffer(2, m.uv); pass.setIndexBuffer(m.idx, 'uint32'); pass.drawIndexedIndirect(R.args, off); };
      pass.setPipeline(P.mesh);
      draw(R.mesh[1], BG.mesh[1], 0);
      draw(R.mesh[0], BG.mesh[0], 20);
      pass.setPipeline(P.imp); pass.setBindGroup(0, BG.imp); pass.drawIndirect(R.args, 40);
    }
  };
  const shBG = {};
  function drawShadow(pass, c, camBuf) {
    if (!on || !ready) return;
    const key = c;
    if (!shBG[key]) shBG[key] = [0, 1].map(k => G.bind(P.shadow, 0, [R.inst[k], { buffer: camBuf, offset: c * 256, size: 64 }]));
    pass.setPipeline(P.shadow);
    [[1, 0], [0, 20]].forEach(([k, off]) => { const m = R.mesh[k]; pass.setBindGroup(0, shBG[key][k]); pass.setVertexBuffer(0, m.pos); pass.setIndexBuffer(m.idx, 'uint32'); pass.drawIndexedIndirect(R.args, off); });
  }
  return { init, setPlace, hook, drawShadow, set on(v) { on = v; } };
})();
