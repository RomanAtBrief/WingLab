/* ================= Mesh renderer: draws three.js aircraft parts into the G-buffer, shadow maps and the forward pass ================= */
const GMesh = (() => {
  const T = THREE, DS = 256, MAXD = 2048;
  let d, frameBuf, drawBuf, drawData, L = {}, P = {}, white, bgFrame, bgFrameFwd, bgDraw, bgDrawShadow;
  const geoCache = new WeakMap(), texCache = new WeakMap(), prevMat = new WeakMap(), texBG = new WeakMap();
  const nm = new T.Matrix3();

  const DRAW_WGSL = `
struct Draw { model: mat4x4f, prevModel: mat4x4f, n0: vec4f, n1: vec4f, n2: vec4f, color: vec4f, pbr: vec4f, emis: vec4f, flags: vec4f };`;
  const VTX = [
    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
    { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
    { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }
  ];

  function init(fb, shBuf) {
    d = G.device; frameBuf = fb;
    const V = GPUShaderStage.VERTEX, Fs = GPUShaderStage.FRAGMENT;
    L.frame = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | Fs, buffer: { type: 'uniform' } }] });
    L.frameFwd = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | Fs, buffer: { type: 'uniform' } }, { binding: 1, visibility: Fs, buffer: { type: 'read-only-storage' } }] });
    L.draw = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | Fs, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 240 } }] });
    L.tex = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: Fs, texture: { sampleType: 'float' } }, { binding: 1, visibility: Fs, sampler: { type: 'filtering' } }] });
    L.shadowCam = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: V, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 } }] });
    drawBuf = G.buf(DS * MAXD, GPUBufferUsage.UNIFORM, null, 'draws'); drawData = new Float32Array(DS / 4 * MAXD);
    bgFrame = d.createBindGroup({ layout: L.frame, entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
    bgFrameFwd = d.createBindGroup({ layout: L.frameFwd, entries: [{ binding: 0, resource: { buffer: frameBuf } }, { binding: 1, resource: { buffer: shBuf } }] });
    bgDraw = d.createBindGroup({ layout: L.draw, entries: [{ binding: 0, resource: { buffer: drawBuf, offset: 0, size: 240 } }] });
    white = d.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    d.queue.writeTexture({ texture: white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    white = { view: white.createView() };

    const mk = (label, layouts, code, o) => {
      const m = G.shader(code, label);
      return d.createRenderPipeline({ label, layout: d.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module: m, entryPoint: 'vs', buffers: o.buffers || VTX },
        fragment: o.targets ? { module: m, entryPoint: 'fs', targets: o.targets } : undefined,
        primitive: { topology: 'triangle-list', cullMode: o.cull || 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: o.write !== false, depthCompare: o.compare || 'greater', depthBias: o.bias || 0, depthBiasSlopeScale: o.slope || 0 } });
    };
    const C = G.COMMON;
    P.gbuf = mk('mesh-gbuffer', [L.frame, L.draw, L.tex], `${C}
@group(0) @binding(0) var<uniform> F: Frame;
${DRAW_WGSL}
@group(1) @binding(0) var<uniform> D: Draw;
@group(2) @binding(0) var map: texture_2d<f32>;
@group(2) @binding(1) var smp: sampler;
struct VI { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f };
struct VO { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) uv: vec2f, @location(2) cur: vec4f, @location(3) prev: vec4f };
@vertex fn vs(i: VI) -> VO {
  let wp = D.model * vec4f(i.p, 1.0);
  var o: VO; o.pos = F.viewProj * wp; o.cur = F.viewProjNJ * wp; o.prev = F.prevViewProjNJ * (D.prevModel * vec4f(i.p, 1.0));
  o.n = mat3x3f(D.n0.xyz, D.n1.xyz, D.n2.xyz) * i.n; o.uv = i.uv; return o;
}
struct GO { @location(0) a: vec4f, @location(1) n: vec4f, @location(2) m: vec4f };
// skin panels: seams, lap joints, rivet rows and a little uneven wear, in metres on the part's own uv layout
fn vn2(p: vec2f) -> f32 { return vnoise2(p); }
fn seam(d: f32, w: f32, fw: f32) -> f32 { return sat((w + 0.5 * fw - d) / max(fw, 1e-5)) * min(1.0, (w * 3.0) / max(fw, 1e-5) + 0.15); }
struct Skin { line: f32, rivet: f32, wear: f32, gap: f32 };
fn skin(uv: vec2f) -> Skin {
  var s: Skin; s.line = 0.0; s.rivet = 0.0; s.wear = 0.0; s.gap = 0.0;
  let kind = D.emis.z;
  if (kind < 0.5) { return s; }
  if (kind > 2.5) {
    let q=uv*D.emis.xy;let fw=length(fwidth(q));
    if (kind < 4.5) { // smooth composite skins, only control-surface hinges
      if(kind>3.5){s.gap=seam(abs(abs(uv.x-.5)*2.0-.74)*D.emis.x*.5,.009,fw);}
      s.wear=0.5+vn2(q*2.0)*.12;return s;
    }
    // Painted fabric: soft rib shading, no metal rivets.
    let rib=abs(fract(q.y/.44)-.5)*.44;
    s.line=seam(.22-rib,.018,fw)*.22;s.wear=.5;return s;
  }
  if (kind < 1.5) {        // fuselage: frames and stringers, panels staggered row by row
    let q = uv * D.emis.xy;
    let row = floor(q.y / 1.05);
    let px = q.x / 1.7 + 0.5 * (row - 2.0 * floor(row * 0.5));
    let dx = abs(fract(px) - 0.5) * 1.7; let dy = abs(fract(q.y / 1.05 + 0.5) - 0.5) * 1.05;
    let fw = length(fwidth(q));
    s.line = max(seam(0.85 - dx, 0.006, fw), seam(0.525 - dy, 0.005, fw));
    let rv = max(step(0.8, 1.0 - abs(fract(q.y / 0.045) - 0.5) * 2.0) * seam(abs(0.85 - dx - 0.03), 0.004, fw), step(0.8, 1.0 - abs(fract(q.x / 0.045) - 0.5) * 2.0) * seam(abs(0.525 - dy - 0.025), 0.004, fw));
    s.rivet = rv * sat(0.012 / max(fw, 1e-5) - 0.5);
    s.wear = vn2(q * vec2f(0.6, 1.2)) * 0.6 + vn2(q * 3.1) * 0.4;
  } else {                 // wing and tail: ribs span-wise, spars and the control-surface hinge line chord-wise
    let c = abs(uv.x - 0.5) * 2.0;                 // 0 at the leading edge, 1 at the trailing edge
    let q = vec2f(c * D.emis.x * 0.5, uv.y * D.emis.y);
    let fw = length(fwidth(q));
    let dr = abs(fract(q.y / 0.62) - 0.5) * 0.62;
    let chord = D.emis.x * 0.5;
    var dsp = min(abs(c - 0.12), abs(c - 0.6)) * chord;
    s.line = max(seam(0.31 - dr, 0.004, fw) * 0.6, seam(dsp, 0.006, fw));
    s.gap = seam(abs(c - 0.74) * chord, 0.012, fw);
    s.rivet = step(0.8, 1.0 - abs(fract(q.y / 0.05) - 0.5) * 2.0) * seam(abs(dsp - 0.03), 0.004, fw) * sat(0.012 / max(fw, 1e-5) - 0.5);
    s.wear = vn2(q * vec2f(1.1, 0.5)) * 0.6 + vn2(q * 3.7) * 0.4;
  }
  return s;
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> GO {
  let t = textureSample(map, smp, i.uv);
  var c = D.color.rgb * select(vec3f(1.0), t.rgb, D.flags.x > 0.5);
  var n = normalize(i.n); if (!ff) { n = -n; }
  let vel = (i.cur.xy / i.cur.w - i.prev.xy / i.prev.w) * vec2f(0.5, -0.5);
  let sk = skin(i.uv);
  var rough = D.pbr.x;
  c *= (1.0 - 0.22 * sk.line - 0.5 * sk.gap) * (0.97 + 0.05 * sk.wear) * (1.0 - 0.1 * sk.rivet);
  rough = clamp(rough + 0.12 * sk.line + 0.25 * sk.gap + 0.1 * sk.rivet + 0.08 * (sk.wear - 0.5), 0.04, 1.0);
  let cc = min(D.pbr.z, 0.99) * (1.0 - 0.6 * sk.gap - 0.3 * sk.line) * (0.92 + 0.08 * sk.wear);
  var o: GO;
  o.a = vec4f(c, 1.0 - 0.35 * sk.gap - 0.15 * sk.line);
  o.n = vec4f(n, select(rough, D.pbr.w, D.emis.w > 3.5));
  o.m = vec4f(vel, D.pbr.y, D.emis.w + select(cc, 0.0, D.emis.w > 3.5));
  return o;
}`, { targets: [{ format: 'rgba8unorm-srgb' }, { format: 'rgba16float' }, { format: 'rgba16float' }] });

    P.shadow = mk('mesh-shadow', [L.shadowCam, L.draw], `
${DRAW_WGSL}
@group(0) @binding(0) var<uniform> SC: mat4x4f;
@group(1) @binding(0) var<uniform> D: Draw;
@vertex fn vs(@location(0) p: vec3f) -> @builtin(position) vec4f { return SC * (D.model * vec4f(p, 1.0)); }`,
      { buffers: [VTX[0]], compare: 'less', bias: 2, slope: 2.0 });

    const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
    const FWD = `${C}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> SH: array<vec4f, 9>;
${DRAW_WGSL}
@group(1) @binding(0) var<uniform> D: Draw;
@group(2) @binding(0) var map: texture_2d<f32>;
@group(2) @binding(1) var smp: sampler;
fn shEval(n: vec3f) -> vec3f {
  return SH[0].rgb * 0.282095 + SH[1].rgb * 0.488603 * n.y + SH[2].rgb * 0.488603 * n.z + SH[3].rgb * 0.488603 * n.x
    + SH[4].rgb * 1.092548 * n.x * n.y + SH[5].rgb * 1.092548 * n.y * n.z + SH[6].rgb * 0.315392 * (3.0 * n.z * n.z - 1.0)
    + SH[7].rgb * 1.092548 * n.x * n.z + SH[8].rgb * 0.546274 * (n.x * n.x - n.y * n.y);
}
fn shade(c: vec3f, a: f32) -> vec4f {
  if (D.flags.y > 0.5) { return vec4f(c * a * D.pbr.w, 0.0); }                 // additive glow
  let amb = max(shEval(vec3f(0.0, 1.0, 0.0)), vec3f(0.0)) + F.lightTint * F.sunE * 0.15 * max(F.sunDir.y, 0.0);
  return vec4f(c * amb * a, a);
}`;
    P.fwd = mk('mesh-forward', [L.frameFwd, L.draw, L.tex], `${FWD}
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f) -> VO { var o: VO; o.pos = F.viewProj * (D.model * vec4f(p, 1.0)); o.uv = uv; return o; }
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let t = textureSample(map, smp, i.uv);
  let tt = select(vec4f(1.0), t, D.flags.x > 0.5);
  return shade(D.color.rgb * tt.rgb, D.color.a * tt.a);
}`, { targets: [{ format: 'rgba16float', blend }], write: false });
    P.sprite = mk('mesh-sprite', [L.frameFwd, L.draw, L.tex], `${FWD}
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  var ks = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u); let k = ks[vi];
  let c = vec2f(f32(k & 1u), f32(k >> 1u));
  let ctr = (D.model * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
  let right = vec3f(F.view[0][0], F.view[1][0], F.view[2][0]); let up = vec3f(F.view[0][1], F.view[1][1], F.view[2][1]);
  let sx = length(D.model[0].xyz); let sy = length(D.model[1].xyz);
  let wp = ctr + right * (c.x - 0.5) * sx + up * (c.y - 0.5) * sy;
  var o: VO; o.pos = F.viewProj * vec4f(wp, 1.0); o.uv = vec2f(c.x, 1.0 - c.y); return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let t = textureSample(map, smp, i.uv);
  return shade(D.color.rgb * t.rgb, D.color.a * t.a);
}`, { buffers: [], targets: [{ format: 'rgba16float', blend }], write: false });
  }

  /* ---------- geometry and textures ---------- */
  function vbuf(arr, usage) { const b = d.createBuffer({ size: Math.max(4, arr.byteLength), usage: usage | GPUBufferUsage.COPY_DST }); if (arr.byteLength) d.queue.writeBuffer(b, 0, arr); return b; }
  function f32(attr, n) {
    if (!attr) return null;
    if (attr.isInterleavedBufferAttribute || !(attr.array instanceof Float32Array) || attr.itemSize !== n) {
      const out = new Float32Array(attr.count * n);
      for (let i = 0; i < attr.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = attr.getComponent ? attr.getComponent(i, k) : [attr.getX(i), attr.getY(i), attr.getZ(i)][k];
      return out;
    }
    return attr.array;
  }
  function gpuGeo(g) {
    let e = geoCache.get(g); if (e) return e;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = f32(g.attributes.position, 3), nrm = f32(g.attributes.normal, 3), uv = f32(g.attributes.uv, 2) || new Float32Array(g.attributes.position.count * 2);
    e = { pos: vbuf(pos, GPUBufferUsage.VERTEX), nrm: vbuf(nrm, GPUBufferUsage.VERTEX), uv: vbuf(uv, GPUBufferUsage.VERTEX), count: g.attributes.position.count };
    if (g.index) {
      let ia = g.index.array;
      if (ia instanceof Uint16Array && ia.length % 2) { const p = new Uint16Array(ia.length + 1); p.set(ia); ia = p; }
      if (!(ia instanceof Uint16Array) && !(ia instanceof Uint32Array)) ia = Uint32Array.from(ia);
      e.idx = vbuf(ia, GPUBufferUsage.INDEX); e.fmt = ia instanceof Uint16Array ? 'uint16' : 'uint32'; e.count = g.index.count;
    }
    geoCache.set(g, e);
    g.addEventListener('dispose', () => { const x = geoCache.get(g); if (x) { x.pos.destroy(); x.nrm.destroy(); x.uv.destroy(); if (x.idx) x.idx.destroy(); geoCache.delete(g); } });
    return e;
  }
  function gpuTex(t) {
    if (!t || !t.image) return white;
    let e = texCache.get(t);
    if (e && e.version === t.version) return e;
    const img = t.image, w = img.width, h = img.height, srgb = t.colorSpace === T.SRGBColorSpace, fmt = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
    const mips = G.mipCount(w, h);
    const tx = d.createTexture({ size: [w, h], format: fmt, mipLevelCount: mips, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    d.queue.copyExternalImageToTexture({ source: img, flipY: t.flipY !== false }, { texture: tx }, [w, h]);
    G.genMips(tx, fmt);
    if (e) e.tex.destroy();
    e = { tex: tx, view: tx.createView(), version: t.version };
    texCache.set(t, e);
    t.addEventListener('dispose', () => { const x = texCache.get(t); if (x) { x.tex.destroy(); texCache.delete(t); } });
    return e;
  }
  function texGroup(t) {
    const key = t && t.image ? t : white;
    const e = key === white ? white : gpuTex(t);
    let bg = texBG.get(key);
    if (!bg || bg.v !== e.view) { bg = { v: e.view, g: d.createBindGroup({ layout: L.tex, entries: [{ binding: 0, resource: e.view }, { binding: 1, resource: G.sampler('anisoClamp') }] }) }; texBG.set(key, bg); }
    return bg.g;
  }

  /* ---------- per-frame lists ---------- */
  function collect(root) {
    const out = { opaque: [], blend: [], sprite: [] };
    root.traverseVisible(o => {
      if (o.isSprite) { out.sprite.push(o); return; }
      if (!o.isMesh || o.isInstancedMesh) return;
      const m = o.material;
      if (!m || m.visible === false) return;
      if (m.isMeshBasicMaterial && m.transparent) out.blend.push(o);
      else if (m.transparent && m.opacity < 0.99) out.blend.push(o);
      else out.opaque.push(o);
    });
    return out;
  }
  function pack(list, base) {
    for (let i = 0; i < list.length && base + i < MAXD; i++) {
      const o = list[i], m = o.material, off = (base + i) * DS / 4, mw = o.matrixWorld.elements;
      drawData.set(mw, off);
      const pm = prevMat.get(o); drawData.set(pm || mw, off + 16);
      if (pm) pm.set(mw); else prevMat.set(o, Float32Array.from(mw));
      nm.getNormalMatrix(o.matrixWorld); const e = nm.elements;
      drawData.set([e[0], e[1], e[2], 0, e[3], e[4], e[5], 0, e[6], e[7], e[8], 0], off + 32);
      const c = m.color || new T.Color(1, 1, 1);
      const basic = m.isMeshBasicMaterial || m.isSpriteMaterial;
      const add = m.blending === T.AdditiveBlending;
      drawData.set([c.r, c.g, c.b, m.opacity ?? 1], off + 44);
      drawData.set([m.roughness ?? 0.5, m.metalness ?? 0, m.clearcoat ?? 0, o.userData.glow ?? (basic ? (add ? 6 : 2.5) : 1)], off + 48);
      const pn = o.userData.panel;
      drawData.set([pn ? pn[0] : 0, pn ? pn[1] : 0, pn ? pn[2] : 0, basic && !m.transparent ? 4 : 0], off + 52);
      drawData.set([m.map ? 1 : 0, add ? 1 : 0, m.side === T.DoubleSide ? 1 : 0, 0], off + 56);
      o.userData._slot = base + i;
    }
    return base + list.length;
  }
  let lists = null, nDraw = 0;
  function prepare(roots) {
    lists = { opaque: [], blend: [], sprite: [] };
    for (const r of roots) { if (!r) continue; const l = collect(r); lists.opaque.push(...l.opaque); lists.blend.push(...l.blend); lists.sprite.push(...l.sprite); }
    let n = pack(lists.opaque, 0); n = pack(lists.blend, n); n = pack(lists.sprite, n);
    nDraw = Math.min(n, MAXD);
    if (nDraw) d.queue.writeBuffer(drawBuf, 0, drawData.buffer, 0, nDraw * DS);
    return lists;
  }
  function drawList(pass, list, withTex) {
    for (const o of list) {
      const s = o.userData._slot; if (s === undefined || s >= MAXD) continue;
      const g = gpuGeo(o.geometry);
      pass.setBindGroup(1, bgDraw, [s * DS]);
      if (withTex) pass.setBindGroup(2, texGroup(o.material.map));
      pass.setVertexBuffer(0, g.pos);
      pass.setVertexBuffer(1, g.nrm); pass.setVertexBuffer(2, g.uv);
      if (g.idx) { pass.setIndexBuffer(g.idx, g.fmt); pass.drawIndexed(g.count); } else pass.draw(g.count);
    }
  }
  function gbuffer(pass) { if (!lists) return; pass.setPipeline(P.gbuf); pass.setBindGroup(0, bgFrame); drawList(pass, lists.opaque, true); }
  let shadowBG = null, shadowBuf = null;
  function shadowCams(buf) { shadowBuf = buf; shadowBG = d.createBindGroup({ layout: L.shadowCam, entries: [{ binding: 0, resource: { buffer: buf, offset: 0, size: 64 } }] }); }
  function shadow(pass, cascade) {
    if (!lists || !shadowBG) return;
    pass.setPipeline(P.shadow); pass.setBindGroup(0, shadowBG, [cascade * 256]);
    for (const o of lists.opaque) {
      if (o.castShadow === false) continue;
      const s = o.userData._slot; if (s === undefined || s >= MAXD) continue;
      const g = gpuGeo(o.geometry); pass.setBindGroup(1, bgDraw, [s * DS]); pass.setVertexBuffer(0, g.pos);
      if (g.idx) { pass.setIndexBuffer(g.idx, g.fmt); pass.drawIndexed(g.count); } else pass.draw(g.count);
    }
  }
  function forward(pass) {
    if (!lists) return;
    if (lists.blend.length) { pass.setPipeline(P.fwd); pass.setBindGroup(0, bgFrameFwd); drawList(pass, lists.blend, true); }
    if (lists.sprite.length) {
      pass.setPipeline(P.sprite); pass.setBindGroup(0, bgFrameFwd);
      for (const o of lists.sprite) { const s = o.userData._slot; if (s === undefined || s >= MAXD) continue; pass.setBindGroup(1, bgDraw, [s * DS]); pass.setBindGroup(2, texGroup(o.material.map)); pass.draw(6); }
    }
  }
  return { init, prepare, gbuffer, shadow, forward, shadowCams, texGroup, gpuGeo, layouts: L };
})();
