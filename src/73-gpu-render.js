/* ================= Renderer: HDR deferred pipeline (G-buffer → lighting → forward → TAA → post) ================= */
const GR = (() => {
  const T = THREE, D2R = Math.PI / 180;
  let d, canvas, ctx, fmt, frameBuf, RT = null, P = {}, BG = {}, ph = {}, csBuf;
  const st = { frame: 0, time: 0, W: 1, H: 1, CW: 1, CH: 1, scale: 1, exposure: 1.4, lightDirty: true, first: true };
  const M = { view: new T.Matrix4(), proj: new T.Matrix4(), projNJ: new T.Matrix4(), vp: new T.Matrix4(), vpNJ: new T.Matrix4(), ivp: new T.Matrix4(), ivpNJ: new T.Matrix4(), prevVPNJ: new T.Matrix4() };
  const hooks = [];   // other modules: { name, gbuffer(pass), shadow(pass, c), pre(enc), post(enc), light: {...} }

  let readback = false, outTex = null, msaaTex = null;
  function init(canvasEl, opts = {}) {
    d = G.device; canvas = canvasEl; readback = !!opts.readback;
    if (readback) fmt = 'rgba8unorm';
    else { ctx = canvas.getContext('webgpu'); fmt = navigator.gpu.getPreferredCanvasFormat(); ctx.configure({ device: d, format: fmt, alphaMode: 'opaque' }); }
    frameBuf = G.buf(G.FRAME_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE, null, 'frame');
    csBuf = G.buf(512, GPUBufferUsage.UNIFORM, null, 'cascades');
    GAtmos.init(frameBuf);
    GMesh.init(frameBuf, GAtmos.R.sh);
    // placeholders for inputs that later stages provide
    const U = GPUTextureUsage;
    ph.csm = d.createTexture({ size: [1, 1, 4], format: 'depth32float', usage: U.TEXTURE_BINDING | U.RENDER_ATTACHMENT });
    { const e = d.createCommandEncoder(); for (let i = 0; i < 4; i++) { const p = e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: ph.csm.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } }); p.end(); } d.queue.submit([e.finish()]); }
    ph.white = d.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: U.TEXTURE_BINDING | U.COPY_DST });
    d.queue.writeTexture({ texture: ph.white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    ph.csmV = ph.csm.createView({ dimension: '2d-array' }); ph.whiteV = ph.white.createView();
    ph.black = d.createTexture({ size: [1, 1], format: 'rgba16float', usage: U.TEXTURE_BINDING }); ph.blackV = ph.black.createView();
    buildPipes();
  }

  const LIGHT_CODE = () => `${G.COMMON}${G.ATMO}${G.ATMO_T}
struct Cascades { m: array<mat4x4f, 4>, split: vec4f, texel: vec4f, cloudMap: vec4f, terr: vec4f };
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var gA: texture_2d<f32>;
@group(0) @binding(2) var gN: texture_2d<f32>;
@group(0) @binding(3) var gM: texture_2d<f32>;
@group(0) @binding(4) var gD: texture_depth_2d;
@group(0) @binding(5) var transLut: texture_2d<f32>;
@group(0) @binding(6) var skyLut: texture_2d<f32>;
@group(0) @binding(7) var apL: texture_3d<f32>;
@group(0) @binding(8) var apT: texture_3d<f32>;
@group(0) @binding(9) var envP: texture_2d<f32>;
@group(0) @binding(10) var<storage, read> SH: array<vec4f, 9>;
@group(0) @binding(11) var smpL: sampler;
@group(0) @binding(12) var outC: texture_storage_2d<rgba16float, write>;
@group(0) @binding(13) var csm: texture_depth_2d_array;
@group(0) @binding(14) var smpS: sampler_comparison;
@group(0) @binding(15) var terrSh: texture_2d<f32>;
@group(0) @binding(16) var cloudSh: texture_2d<f32>;
@group(0) @binding(17) var aoTex: texture_2d<f32>;
@group(0) @binding(18) var<uniform> CS: Cascades;
@group(0) @binding(19) var smpR: sampler;
@group(0) @binding(20) var msLut: texture_2d<f32>;
const ENV_MIPS: f32 = ${GAtmos.ENV_MIPS}.0;
@group(0) @binding(21) var smpLL: sampler;
@group(0) @binding(22) var prevC: texture_2d<f32>;      // last frame's anti-aliased HDR image (for screen-space reflections)
// screen-space reflection: march the reflected ray against the depth buffer; returns (colour, confidence)
fn ssr(P: vec3f, R: vec3f, px: vec2f) -> vec4f {
  if (R.y <= 0.0) { return vec4f(0.0); }
  let dimf = vec2f(textureDimensions(gD));
  var t = 1.5 + 2.0 * ign(px + f32(F.frame % 8u) * 3.1);
  var prevT = 0.0;
  let camD = distance(P, F.camPos);
  for (var i = 0; i < 36; i++) {
    let Q = P + R * t;
    let c = F.viewProjNJ * vec4f(Q, 1.0);
    if (c.w <= 0.0) { break; }
    let ndc = c.xyz / c.w;
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { break; }
    let dz = textureLoad(gD, vec2i(uv * dimf), 0);
    if (dz > ndc.z && dz > 0.0) {
      // behind the scene surface: refine between the last two steps, then accept if the surface is close to the ray
      var a = prevT; var b = t;
      for (var k = 0; k < 5; k++) {
        let m = 0.5 * (a + b); let cm = F.viewProjNJ * vec4f(P + R * m, 1.0); let nm = cm.xyz / cm.w;
        let um = vec2f(nm.x * 0.5 + 0.5, 0.5 - nm.y * 0.5);
        if (textureLoad(gD, vec2i(um * dimf), 0) > nm.z) { b = m; } else { a = m; }
      }
      let H = P + R * b;
      let ch = F.viewProjNJ * vec4f(H, 1.0); let nh = ch.xyz / ch.w; let uh = vec2f(nh.x * 0.5 + 0.5, 0.5 - nh.y * 0.5);
      let sz = textureLoad(gD, vec2i(uh * dimf), 0);
      let sp = F.invViewProjNJ * vec4f(nh.x, nh.y, sz, 1.0); let S3 = sp.xyz / sp.w;
      let thick = distance(S3, H);
      if (thick > max(4.0, b * 0.08)) { return vec4f(0.0); }
      // colour from last frame, reprojected
      let pc = F.prevViewProjNJ * vec4f(S3 + F.shift, 1.0);
      let pu = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
      let edge = sat(min(min(pu.x, 1.0 - pu.x), min(pu.y, 1.0 - pu.y)) * 10.0);
      let previous = textureSampleLevel(prevC, smpL, pu, 0.0);
      let expectedDepth=log2(1.0+1.0/max(pc.z/pc.w,1e-7));
      if(abs(previous.a-expectedDepth)>.14){return vec4f(0.0);}
      let motion=length((pu-uh)*F.res);
      let confidence=(1.0-smoothstep(1.0,8.0,motion))*.35;
      return vec4f(previous.rgb, edge * confidence * (1.0 - f32(i) / 36.0 * 0.3));
    }
    prevT = t;
    t = t * 1.22 + 1.0 + camD * 0.004;
  }
  return vec4f(0.0);
}
${GAtmos.LL}
fn envAt(d: vec3f, lod: f32) -> vec3f { return textureSampleLevel(envP, smpLL, llUv(d), lod).rgb; }
const AP_MAX: f32 = ${GAtmos.AP_MAX}.0;

fn shEval(n: vec3f) -> vec3f {
  return SH[0].rgb * 0.282095 + SH[1].rgb * 0.488603 * n.y + SH[2].rgb * 0.488603 * n.z + SH[3].rgb * 0.488603 * n.x
    + SH[4].rgb * 1.092548 * n.x * n.y + SH[5].rgb * 1.092548 * n.y * n.z + SH[6].rgb * 0.315392 * (3.0 * n.z * n.z - 1.0)
    + SH[7].rgb * 1.092548 * n.x * n.z + SH[8].rgb * 0.546274 * (n.x * n.x - n.y * n.y);
}
fn D_GGX(nh: f32, a: f32) -> f32 { let a2 = a * a; let f = (nh * a2 - nh) * nh + 1.0; return a2 / (PI * f * f); }
fn V_SGGX(nv: f32, nl: f32, a: f32) -> f32 { let a2 = a * a; let l = nv * sqrt((-nl * a2 + nl) * nl + a2); let v = nl * sqrt((-nv * a2 + nv) * nv + a2); return 0.5 / max(v + l, 1e-5); }
fn F_Sch(f0: vec3f, vh: f32) -> vec3f { return f0 + (vec3f(1.0) - f0) * pow(1.0 - vh, 5.0); }
fn envBRDF(f0: vec3f, nv: f32, r: f32) -> vec3f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022); let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let q = r * c0 + c1; let a004 = min(q.x * q.x, exp2(-9.28 * nv)) * q.x + q.y;
  let ab = vec2f(-1.04, 1.04) * a004 + q.zw; return f0 * ab.x + ab.y;
}
fn shadowCascade(P:vec3f,N:vec3f,c:i32)->f32 {
  let tx = CS.texel[c];
  let nl = dot(N, F.sunDir);
  let Pb = P + N * tx * select(0.7 + 1.1 * sqrt(max(0.0, 1.0 - nl * nl)), 1.5 + 2.0 * sqrt(max(0.0, 1.0 - nl * nl)), c == 0);
  let sp = CS.m[c] * vec4f(Pb, 1.0);
  let uv = vec2f(sp.x * 0.5 + 0.5, 0.5 - sp.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || sp.z > 1.0) { return 1.0; }
  let ang = 0.37; let cs = vec2f(cos(ang), sin(ang));
  let rad = select(2.4, 1.65, c > 1) / f32(textureDimensions(csm).x);
  var s = 0.0;
  for (var k = 0; k < 16; k++) {
    let fk = (f32(k) + 0.5) / 16.0; let r = sqrt(fk) * rad; let a2 = f32(k) * 2.39996;
    let o = vec2f(cos(a2), sin(a2)); let ro = vec2f(o.x * cs.x - o.y * cs.y, o.x * cs.y + o.y * cs.x) * r;
    s += textureSampleCompareLevel(csm, smpS, uv + ro, c, sp.z);
  }
  return s / 16.0;
}
fn csmShadow(P:vec3f,N:vec3f,dist:f32,px:vec2f)->f32 {
  if(CS.terr.x<.5||dist>CS.split[3]){return 1.0;}
  var c=3;for(var i=0;i<4;i++){if(dist<CS.split[i]){c=i;break;}}
  let s=shadowCascade(P,N,c);
  // Aircraft cascade is tightly fitted; blend only the overlapping terrain cascades.
  if(c>0&&c<3){let w=smoothstep(CS.split[c]*.9,CS.split[c],dist);if(w>0.0){return mix(s,shadowCascade(P,N,c+1),w);}}
  return s;
}
fn apply_ap(col: vec3f, uv: vec2f, dist_m: f32) -> vec3f {
  let dk = dist_m * 0.001;
  let s = sqrt(dk / AP_MAX) * ${GAtmos.AP_N}.0;
  let z = clamp((s - 0.5) / ${GAtmos.AP_N}.0, 0.5 / ${GAtmos.AP_N}.0, 1.0);
  var L = textureSampleLevel(apL, smpL, vec3f(uv, z), 0.0).rgb;
  var Tr = textureSampleLevel(apT, smpL, vec3f(uv, z), 0.0).rgb;
  let w = sat(s);
  L *= w; Tr = mix(vec3f(1.0), Tr, w);
  return col * Tr + L * F.sunE * F.lightTint;
}
fn stars(dir: vec3f) -> vec3f {
  var c = vec3f(0.0);
  let g = dir * 180.0; let cell = floor(g);
  for (var i = 0; i < 2; i++) {
    let q = cell + vec3f(f32(i) * 0.5);
    let h = hash13v(q);
    if (h > 0.985) {
      let sp = normalize((q + vec3f(hash13v(q + 1.3), hash13v(q + 2.7), hash13v(q + 4.1))) / 180.0);
      let d2 = 1.0 - dot(sp, dir);
      let b = pow((h - 0.985) / 0.015, 6.0) * 60.0 + 0.6;
      let tw = 0.75 + 0.25 * sin(F.time * (3.0 + h * 9.0) + h * 91.0);
      let tint = mix(vec3f(0.7, 0.8, 1.0), vec3f(1.0, 0.85, 0.7), fract(h * 71.0));
      c += tint * b * tw * exp(-d2 * 4.0e6);
    }
  }
  return c;
}
fn hash13v(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
fn sky(dir: vec3f, r: f32, px: vec2f) -> vec3f {
  var L = textureSampleLevel(skyLut, smpL, skyLutUv(r, dir, F.sunDir), 0.0).rgb * F.sunE * F.lightTint;
  let muH = -sqrt(max(0.0, 1.0 - (RG * RG) / (r * r)));
  if (dir.y > muH) {
    // the sun: limb-darkened disk
    let cs = dot(dir, F.realSun); let rad = 0.00475;
    let ang = acos(clamp(cs, -1.0, 1.0));
    if (ang < rad * 1.2 && F.night < 0.5) {
      let x = sat(ang / rad); let mu = sqrt(max(0.0, 1.0 - x * x));
      let ld = 1.0 - 0.6 * (1.0 - mu) - 0.2 * (1.0 - mu) * (1.0 - mu);
      let edge = 1.0 - smoothstep(0.92, 1.08, ang / rad);
      L += sunTrans(r, dir.y) * F.sunE * 14000.0 * ld * edge;
    }
    if (F.night > 0.0) {
      let sk = sat(1.0 - luma(L) * 40.0) * F.night * sat((dir.y - muH) * 20.0);
      L += stars(dir) * 0.0025 * sk * sunTrans(r, dir.y);
      // the moon (F.sunDir is the moon at night), lit from the direction of the real sun
      let mc = dot(dir, F.sunDir); let mrad = 0.0048;
      if (mc > cos(mrad * 1.3)) {
        let tx = normalize(cross(F.sunDir, vec3f(0.0, 1.0, 0.0))); let ty = cross(tx, F.sunDir);
        let q = vec2f(dot(dir, tx), dot(dir, ty)) / mrad; let rr = length(q);
        if (rr < 1.0) {
          let n3 = normalize(q.x * tx + q.y * ty - F.sunDir * sqrt(max(0.0, 1.0 - rr * rr)));
          let lit = sat(dot(-n3, normalize(vec3f(0.9, 0.35, -0.3))) * 1.2 + 0.05);
          let maria = 0.75 + 0.25 * vnoise2(q * 3.0 + 7.0) - 0.2 * smoothstep(0.55, 0.75, vnoise2(q * 1.6 + 2.0));
          L += vec3f(1.0, 0.97, 0.92) * lit * maria * F.sunE * 2500.0 * (1.0 - smoothstep(0.96, 1.0, rr)) * sunTrans(r, dir.y);
        }
      }
    }
  }
  return L;
}

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = vec2u(F.res); if (gid.x >= res.x || gid.y >= res.y) { return; }
  let px = vec2i(gid.xy); let uv = (vec2f(gid.xy) + 0.5) * F.invRes;
  let dz = textureLoad(gD, px, 0);
  let nxy = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let pn4 = F.invViewProj * vec4f(nxy, 1.0, 1.0); let pn = pn4.xyz / pn4.w;
  let dir = normalize(pn - F.camPos);
  let rCam = RG + camAltKm();
  if (F.flags >= 7u && F.flags < 12u) { let dd = textureLoad(csm, vec2i(uv * f32(textureDimensions(csm).x)), i32(F.flags - 7u), 0); textureStore(outC, px, vec4f(vec3f(fract(dd * 20.0)), 1.0)); return; }
  if (F.flags == 12u) { textureStore(outC, px, vec4f(envAt(dir, 0.0), 1.0)); return; }
  if (F.flags == 13u) { textureStore(outC, px, vec4f(max(shEval(dir), vec3f(0.0)), 1.0)); return; }
  if (dz <= 0.0) { textureStore(outC, px, vec4f(min(sky(dir, rCam, vec2f(gid.xy)), vec3f(60000.0)), 1.0)); return; }
  let wp4 = F.invViewProj * vec4f(nxy, dz, 1.0); let P = wp4.xyz / wp4.w;
  let V = -dir; let dist = length(P - F.camPos);
  let A = textureLoad(gA, px, 0); let Nr = textureLoad(gN, px, 0); let Mt = textureLoad(gM, px, 0);
  let idf = Mt.w; let id = u32(floor(idf + 0.001)); let cc = sat(idf - floor(idf + 0.001));
  var albedo = A.rgb;
  if (id == 4u) { textureStore(outC, px, vec4f(apply_ap(albedo * Nr.w * F.sunE * 0.6 * (1.0 + 20.0 * F.night), uv, dist), 1.0)); return; }
  var N = normalize(Nr.xyz);
  if (dot(N, V) < 0.0 && id != 2u) { N = normalize(N - V * dot(N, V) * 1.01); }
  var rough = clamp(Nr.w, 0.045, 1.0); let metal = Mt.z;
  var ao = min(A.a, textureLoad(aoTex, px / 2, 0).r);
  let pp = planetPos(P); let rP = length(pp); let upP = pp / rP;
  let E = F.sunE * F.lightTint * sunTrans(rP, dot(F.sunDir, upP));
  let L = F.sunDir; let H = normalize(V + L);
  let nl = sat(dot(N, L)); let nv = max(dot(N, V), 1e-4); let nh = sat(dot(N, H)); let vh = sat(dot(V, H));
  // shadows: cascades, terrain horizon, clouds
  var sh = csmShadow(P, N, dist, vec2f(gid.xy));
  var skyVis = 1.0;
  if (CS.terr.y > 0.5 && id != 0u) {
    let tuv = (P.xz + F.terrOff) / F.tile;
    let ts = textureSampleLevel(terrSh, smpR, tuv, 0.0);
    sh *= ts.r;
    skyVis = ts.g;
  }
  let pAlt = P.y + F.planeAlt;
  if (CS.cloudMap.w > 0.5 && pAlt < F.cloudTop) {
    let tc = (F.cloudBase - pAlt) / max(F.sunDir.y, 0.05);
    let cp = P.xz + F.sunDir.xz * max(tc, 0.0);
    let cuv = (cp - CS.cloudMap.xy) / CS.cloudMap.z + 0.5;
    let cs = textureSampleLevel(cloudSh, smpL, cuv, 0.0).r;
    sh *= mix(cs, 1.0, sat((pAlt - F.cloudBase) / max(F.cloudTop - F.cloudBase, 1.0)));
  }
  var col = vec3f(0.0);
  if (id == 1u) {
    // water: albedo holds the in-water colour, roughness the wave slope variance
    let f0 = vec3f(0.02);
    let a = max(rough * rough, 0.0025);
    let Fr = F_Sch(f0, nv);
    let R = reflect(-V, N);
    let Rr = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
    var refl = envAt(Rr, rough * (ENV_MIPS - 1.0));
    let sr = ssr(P, normalize(vec3f(R.x, max(R.y, 0.0), R.z)), vec2f(gid.xy));
    refl = mix(refl, sr.rgb, sr.a * sat(1.2 - rough * 3.0));
    let spec = D_GGX(nh, a) * V_SGGX(nv, nl, a) * F_Sch(f0, vh) * nl * E * sh;
    let body = albedo * (E * sh * (0.35 + 0.65 * sat(F.sunDir.y * 2.0)) * 0.25 / PI + shEval(vec3f(0.0, 1.0, 0.0)) * 0.9);
    col = refl * Fr * mix(1.0, sh, 0.3) + body * (vec3f(1.0) - Fr) + min(spec, vec3f(40000.0));
  } else {
    let a = rough * rough;
    let f0 = mix(vec3f(0.04), albedo, metal);
    let Fs = F_Sch(f0, vh);
    let spec = D_GGX(nh, a) * V_SGGX(nv, nl, a) * Fs;
    let kd = (vec3f(1.0) - Fs) * (1.0 - metal);
    var direct = (kd * albedo / PI + spec) * E * nl * sh;
    if (id == 3u) { direct += albedo * E * sh * 0.25 * pow(sat(dot(-V, L)), 4.0); }   // leaves let light through
    let irr = max(shEval(N), vec3f(0.0));
    var amb = albedo * (1.0 - metal) * irr * ao * skyVis;
    // light bounced from the sunlit ground and walls around (canyons, valleys): what the sky cannot reach, the surroundings light up
    if (id == 2u || id == 3u) { amb += albedo * F.groundAlbedo * E * max(F.sunDir.y, 0.0) * (1.0 - skyVis) * 1.1 / PI * ao; }
    let R = reflect(-V, N);
    let lod = sqrt(rough) * (ENV_MIPS - 1.0);
    let pre = envAt(R, lod);
    let so = sat(pow(nv + ao, exp2(-16.0 * a - 1.0)) - 1.0 + ao) * skyVis;
    amb += pre * envBRDF(f0, nv, rough) * so;
    col = direct + amb;
    if (F.flags == 20u) { col = direct; } else if (F.flags == 21u) { col = amb; } else if (F.flags == 22u) { col = irr; } else if (F.flags == 23u) { col = E * nl; }
    if (cc > 0.01) {
      let ac = 0.012; let Fc = F_Sch(vec3f(0.04), vh).x * cc;
      let sc = D_GGX(nh, ac) * V_SGGX(nv, nl, ac) * Fc;
      let Fcv = (0.04 + 0.96 * pow(1.0 - nv, 5.0)) * cc;
      col = col * (1.0 - Fcv) + min(sc * E * nl * sh, vec3f(30000.0)) + envAt(R, 0.6) * Fcv * so;
    }
  }
  col = apply_ap(col, uv, dist);
  if (F.flags >= 20u) { textureStore(outC, px, vec4f(col, 1.0)); return; }
  if (F.flags == 1u) { col = vec3f(sh); } else if (F.flags == 2u) { col = albedo; } else if (F.flags == 3u) { col = N * 0.5 + 0.5; } else if (F.flags == 4u) { col = vec3f(skyVis * ao); }
  if (F.flags == 5u) { col = vec3f(csmShadow(P, N, dist, vec2f(gid.xy))); }
  if (F.flags == 6u) {
    var c = 3; for (var i = 0; i < 4; i++) { if (dist < CS.split[i]) { c = i; break; } }
    let sp = CS.m[c] * vec4f(P, 1.0); let uv2 = vec2f(sp.x * 0.5 + 0.5, 0.5 - sp.y * 0.5);
    let stored = textureLoad(csm, vec2i(uv2 * f32(textureDimensions(csm).x)), c, 0);
    col = vec3f(sat((sp.z - stored) * 3000.0), sat((stored - sp.z) * 3000.0), f32(c) / 3.0);
  }
  if (any(col != col)) { col = vec3f(0.0); }
  textureStore(outC, px, vec4f(min(col, vec3f(60000.0)), 1.0));
}`;

  const FINAL_CODE = () => `${G.COMMON}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var<storage, read> EX: array<f32, 4>;
@group(0) @binding(4) var bloom: texture_2d<f32>;
struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> O { var o: O; let x = f32((i << 1u) & 2u); let y = f32(i & 2u); o.p = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0); o.uv = vec2f(x, y); return o; }
fn agx(c0: vec3f) -> vec3f {
  let toR = mat3x3f(vec3f(0.6274, 0.0691, 0.0164), vec3f(0.3293, 0.9195, 0.0880), vec3f(0.0433, 0.0113, 0.8956));
  let inset = mat3x3f(vec3f(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3f(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3f(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  let outset = mat3x3f(vec3f(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3f(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3f(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  let toS = mat3x3f(vec3f(1.6605, -0.1246, -0.0182), vec3f(-0.5876, 1.1329, -0.1006), vec3f(-0.0728, -0.0083, 1.1187));
  var c = inset * (toR * max(c0, vec3f(0.0)));
  c = clamp((log2(max(c, vec3f(1e-10))) + 12.47393) / 16.5, vec3f(0.0), vec3f(1.0));
  let x2 = c * c; let x4 = x2 * x2;
  c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
  // gentle "punchy" look: a little more contrast and colour
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = pow(max(c, vec3f(0.0)), vec3f(1.12));
  let l2 = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = vec3f(l2) + (c - vec3f(l2)) * 1.18;
  c = outset * c;
  c = pow(max(c, vec3f(0.0)), vec3f(2.2));
  return sat3(toS * c);
}
// Khronos PBR Neutral tone mapping (keeps the hue and saturation of everything below the highlights) with a gentle toe and a touch more colour
fn tonemap(c0: vec3f) -> vec3f {
  var c = max(c0, vec3f(0.0));
  c = c * c / (c + vec3f(0.012));
  let x = min(c.r, min(c.g, c.b));
  let off = select(0.04, x - 6.25 * x * x, x < 0.08);
  c -= vec3f(off);
  let peak = max(c.r, max(c.g, c.b));
  let startC = 0.76;
  if (peak >= startC) {
    let dd = 1.0 - startC;
    let np = 1.0 - dd * dd / (peak + dd - startC);
    c *= np / peak;
    let g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0);
    c = mix(c, vec3f(np), g);
  }
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = vec3f(l) + (c - vec3f(l)) * 1.08;
  return sat3(c);
}
fn oetf(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
@group(0) @binding(5) var<storage, read> VIS: array<f32, 4>;
fn flare(uv: vec2f) -> vec3f {
  if (F.sunScreen.z < 0.5 || F.night > 0.5) { return vec3f(0.0); }
  let vis = VIS[0]; if (vis <= 0.001) { return vec3f(0.0); }
  let asp = vec2f(F.res.x / F.res.y, 1.0);
  let s = (F.sunScreen.xy - 0.5) * asp; let p = (uv - 0.5) * asp;
  let edge = sat(1.2 - length(s) * 0.9);
  var c = vec3f(0.0);
  // ghosts mirrored through the centre of the lens
  var gp = array<f32, 5>(-0.35, -0.7, 0.45, -1.15, 0.25);
  var gr = array<f32, 5>(0.05, 0.11, 0.035, 0.18, 0.02);
  var gc = array<vec3f, 5>(vec3f(0.3, 0.5, 1.0), vec3f(0.5, 1.0, 0.6), vec3f(1.0, 0.6, 0.3), vec3f(0.4, 0.4, 1.0), vec3f(1.0, 0.8, 0.5));
  for (var k = 0; k < 5; k++) {
    let d = length(p - s * gp[k]);
    c += gc[k] * smoothstep(gr[k], gr[k] * 0.55, d) * 0.0016;
  }
  // halo ring and a faint starburst round the sun
  let dh = abs(length(p - s * 0.4) - 0.42); c += vec3f(0.6, 0.8, 1.0) * smoothstep(0.02, 0.0, dh) * 0.0007;
  let ds = p - s; let r = length(ds); let ang = atan2(ds.y, ds.x);
  let rays = pow(abs(cos(ang * 3.0 + 0.3)), 60.0) + pow(abs(cos(ang * 4.0 + 1.1)), 90.0) * 0.6;
  c += vec3f(1.0, 0.95, 0.85) * rays * exp(-r * 26.0) * 0.025;
  c += vec3f(1.0, 0.9, 0.75) * exp(-r * 30.0) * 0.03;
  return c * vis * edge * (1.0 - F.overcast);
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  var c = textureSampleLevel(src, smp, i.uv, 0.0).rgb;
  // light sharpening to counter the softness of temporal filtering and upscaling
  let t = 1.0 / vec2f(textureDimensions(src));
  let nb = textureSampleLevel(src, smp, i.uv + vec2f(t.x, 0.0), 0.0).rgb + textureSampleLevel(src, smp, i.uv - vec2f(t.x, 0.0), 0.0).rgb + textureSampleLevel(src, smp, i.uv + vec2f(0.0, t.y), 0.0).rgb + textureSampleLevel(src, smp, i.uv - vec2f(0.0, t.y), 0.0).rgb;
  c = max(c + (c - nb * 0.25) * 0.35 * sat(1.0 - luma(c) * 0.02), vec3f(0.0));
  let bl = textureSampleLevel(bloom, smp, i.uv, 0.0).rgb;
  c = mix(c, bl / 5.0, 0.045);
  let ex = EX[0] * F.exComp;
  c *= ex * F.wb;
  c += flare(i.uv) * F.sunE * 30.0 * ex;
  // gentle vignette
  let v = i.uv - 0.5; c *= 1.0 - 0.22 * dot(v, v) * 1.6;
  var o = oetf(select(tonemap(c), agx(c), F.flags == 40u));
  o += (vec3f(hash12(i.p.xy + fract(F.time) * 97.0), hash12(i.p.yx * 1.7 + 13.0), hash12(i.p.xy * 0.73 + 5.0)) - 0.5) / 255.0;
  return vec4f(o, 1.0);
}`;

  function buildPipes() {
    P.light = G.compute(LIGHT_CODE(), 'lighting');
    P.final = G.render({ label: 'final', code: FINAL_CODE(), targets: [{ format: fmt }], samples: 4 });
    P.exBuf = G.buf(16, GPUBufferUsage.STORAGE, new Float32Array([1.4, 1, 0, 0]), 'exposure');
    P.visDummy = G.buf(16, GPUBufferUsage.STORAGE, null, 'visDummy');
  }

  /* ---------- render targets ---------- */
  function resize(cssW, cssH, dpr, scale) {
    const CW = Math.max(1, Math.round(cssW * dpr)), CH = Math.max(1, Math.round(cssH * dpr));
    const W = Math.max(64, Math.round(cssW * scale)), H = Math.max(64, Math.round(cssH * scale));
    if (canvas.width !== CW || canvas.height !== CH) { canvas.width = CW; canvas.height = CH; }
    if (!RT || !RT.msaa || RT.msaa.width !== CW || RT.msaa.height !== CH) { if (RT && RT.msaa) RT.msaa.destroy(); msaaTex = d.createTexture({ size: [CW, CH], format: fmt, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT }); }
    if (readback && (!outTex || outTex.width !== CW || outTex.height !== CH)) { if (outTex) outTex.destroy(); outTex = d.createTexture({ size: [CW, CH], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }); }
    if (RT && RT.W === W && RT.H === H) { RT.msaa = msaaTex; return; }
    if (RT) Object.entries(RT).forEach(([k, t]) => k !== 'msaa' && t && t.destroy && t.destroy());
    const U = GPUTextureUsage, att = U.RENDER_ATTACHMENT | U.TEXTURE_BINDING;
    RT = {
      W, H, msaa: msaaTex,
      gA: d.createTexture({ size: [W, H], format: 'rgba8unorm-srgb', usage: att, label: 'gA' }),
      gN: d.createTexture({ size: [W, H], format: 'rgba16float', usage: att, label: 'gN' }),
      gM: d.createTexture({ size: [W, H], format: 'rgba16float', usage: att, label: 'gM' }),
      depth: d.createTexture({ size: [W, H], format: 'depth32float', usage: att, label: 'depth' }),
      hdr: d.createTexture({ size: [W, H], format: 'rgba16float', usage: att | U.STORAGE_BINDING | U.COPY_SRC | U.COPY_DST, label: 'hdr' }),
    };
    RT.V = {}; for (const k of ['gA', 'gN', 'gM', 'depth', 'hdr']) RT.V[k] = RT[k].createView();
    st.W = W; st.H = H; st.CW = CW; st.CH = CH;
    st.lightDirty = true; st.first = true;
    finalCache.clear(); inputs.post = null;
    hooks.forEach(h => h.resize && h.resize(W, H));
  }
  const inputs = { terrSh: null, cloudSh: null, ao: null, csm: null };
  const finalCache = new Map();
  function setInput(k, view) { if (inputs[k] === view) return; inputs[k] = view; if (k !== 'post') st.lightDirty = true; else finalCache.size > 4 && finalCache.clear(); }
  function finalBG() {
    const src = inputs.post || RT.V.hdr;
    let bg = finalCache.get(src);
    if (!bg) { bg = G.bind(P.final, 0, [frameBuf, src, G.sampler('linClamp'), inputs.exposure || P.exBuf, inputs.bloom || ph.blackV, inputs.sunVis || P.visDummy]); finalCache.set(src, bg); }
    return bg;
  }
  function addHook(h) { hooks.push(h); if (RT && h.resize) h.resize(RT.W, RT.H); }
  const lightCache = new Map();
  function lightBG() { lightCache.clear(); finalCache.clear(); st.lightDirty = false; }
  function lightFor(prev) {
    let bg = lightCache.get(prev);
    if (!bg) {
      const A = GAtmos.R;
      bg = G.bind(P.light, 0, [frameBuf, RT.V.gA, RT.V.gN, RT.V.gM, RT.V.depth, A.transV, A.skyV, A.apLV, A.apTV, A.envPrefV, A.sh, G.sampler('linClamp'), RT.V.hdr,
        inputs.csm || ph.csmV, G.sampler('shadowLess'), inputs.terrSh || ph.whiteV, inputs.cloudSh || ph.whiteV, inputs.ao || ph.whiteV, csBuf, G.sampler('linRepeat'), null, G.sampler('latlong'), prev], 'light');
      if (lightCache.size > 3) lightCache.clear();
      lightCache.set(prev, bg);
    }
    return bg;
  }

  /* ---------- camera matrices: reverse-Z, infinite far plane, optional sub-pixel jitter ---------- */
  function projRZ(cam, out, jx, jy) {
    const n = cam.near; let top = n * Math.tan(D2R * 0.5 * cam.fov) / cam.zoom, height = 2 * top, width = cam.aspect * height, left = -0.5 * width;
    const v = cam.view;
    if (v && v.enabled) { left += v.offsetX * width / v.fullWidth; top -= v.offsetY * height / v.fullHeight; width *= v.width / v.fullWidth; height *= v.height / v.fullHeight; }
    const r = left + width, b = top - height;
    out.set(2 * n / (r - left), 0, (r + left) / (r - left) + jx, 0,
      0, 2 * n / (top - b), (top + b) / (top - b) + jy, 0,
      0, 0, 0, n,
      0, 0, -1, 0);
    return out;
  }
  const HALTON = [];
  for (let i = 1; i <= 16; i++) { const h = (b) => { let f = 1, r = 0, k = i; while (k > 0) { f /= b; r += f * (k % b); k = Math.floor(k / b); } return r; }; HALTON.push([h(2) - 0.5, h(3) - 0.5]); }

  /* ---------- one frame ---------- */
  // o: { camera, roots, dt, env: {...}, jitter:bool }
  function frame(o) {
    if (!RT) return;
    const cam = o.camera, e = o.env;
    st.time += o.dt; st.frame++;
    cam.updateMatrixWorld(); M.view.copy(cam.matrixWorldInverse);
    const jit = o.jitter ? HALTON[st.frame % 8] : [0, 0];
    const jx = jit[0] * 2 / st.W, jy = jit[1] * 2 / st.H;
    projRZ(cam, M.proj, jx, jy); projRZ(cam, M.projNJ, 0, 0);
    M.vp.multiplyMatrices(M.proj, M.view); M.vpNJ.multiplyMatrices(M.projNJ, M.view);
    M.ivp.copy(M.vp).invert(); M.ivpNJ.copy(M.vpNJ).invert();
    if (st.first) M.prevVPNJ.copy(M.vpNJ);
    const S = G.setF; S('wake',e.wake||[0,0,0,0]);S('flight',e.flight||[0,0,0,0]);
    S('viewProj', M.vp); S('invViewProj', M.ivp); S('viewProjNJ', M.vpNJ); S('prevViewProjNJ', M.prevVPNJ); S('invViewProjNJ', M.ivpNJ); S('view', M.view);
    S('camPos', cam.position); S('time', st.time); S('dt', o.dt);
    S('res', [st.W, st.H]); S('invRes', [1 / st.W, 1 / st.H]); S('jitter', [jit[0], jit[1]]); S('frame', st.frame);
    const fw = new T.Vector3(); cam.getWorldDirection(fw); S('camFwd', fw); S('tanHalf', Math.tan(D2R * cam.fov / 2));
    { const sp = new T.Vector4(cam.position.x + e.realSun.x * 1e6, cam.position.y + e.realSun.y * 1e6, cam.position.z + e.realSun.z * 1e6, 1).applyMatrix4(M.vpNJ);
      const ok = sp.w > 0 && e.realSun.y > -0.02; const u = sp.x / sp.w * 0.5 + 0.5, v = 0.5 - sp.y / sp.w * 0.5;
      S('sunScreen', [u, v, ok && u > -0.3 && u < 1.3 && v > -0.3 && v < 1.3 ? 1 : 0, 0]); }
    S('alt', Math.max(1, e.planeAlt + cam.position.y)); S('planeAlt', e.planeAlt);
    for (const k of ['sunDir', 'lightTint', 'realSun', 'groundAlbedo', 'shift']) S(k, e[k]);
    for (const k of ['sunE', 'night', 'overcast', 'haze', 'fog', 'water', 'tile', 'cloudBase', 'cloudTop', 'cover', 'cdens', 'ctype', 'cscale', 'wet', 'snow', 'quality', 'hmax', 'cloudT', 'snowLine', 'treeLine', 'seaRough']) S(k, e[k] ?? 0);
    S('terrOff', e.terrOff || [0, 0]); S('cloudOff', e.cloudOff || [0, 0]); S('windDir', e.windDir || [1, 0]); S('place', e.placeId || 0); S('flags', e.flags || 0); S('wb', wb); S('exComp', e.exComp ?? 1);
    d.queue.writeBuffer(frameBuf, 0, G.frameData);

    const enc = d.createCommandEncoder();
    if (o.atmosDirty) GAtmos.markDirty();
    for (const h of hooks) h.pre && h.pre(enc, o);
    const DB = window.GDBG || {};
    if (!DB.noAtmos) GAtmos.run(enc, o.envDue);
    GMesh.prepare(DB.noMesh ? [] : o.roots);
    for (const h of hooks) h.shadow && h.shadow(enc, o);
    if (st.lightDirty) lightBG();
    // G-buffer
    const gp = enc.beginRenderPass({ label: 'gbuffer',
      colorAttachments: [{ view: RT.V.gA, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }, { view: RT.V.gN, loadOp: 'clear', storeOp: 'store', clearValue: [0, 1, 0, 1] }, { view: RT.V.gM, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      depthStencilAttachment: { view: RT.V.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    GMesh.gbuffer(gp);
    for (const h of hooks) h.gbuffer && h.gbuffer(gp, o);
    gp.end();
    for (const h of hooks) h.preLight && h.preLight(enc, o);
    const prevImg = inputs.post && inputs.post !== RT.V.hdr ? inputs.post : ph.blackV;
    if (!DB.noLight) G.dispatch(enc, P.light, [lightFor(prevImg)], st.W / 8, st.H / 8, 1, 'lighting');
    for (const h of hooks) h.postLight && h.postLight(enc, o);
    // forward: glass-like transparent parts, glows, flames
    const fp = enc.beginRenderPass({ label: 'forward', colorAttachments: [{ view: RT.V.hdr, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: RT.V.depth, depthLoadOp: 'load', depthStoreOp: 'store' } });
    GMesh.forward(fp);
    for (const h of hooks) h.forward && h.forward(fp, o);
    fp.end();
    for (const h of hooks) h.post && h.post(enc, o);
    if (st.lightDirty) lightBG();
    // output
    const out = readback ? outTex.createView() : ctx.getCurrentTexture().createView();
    const op = enc.beginRenderPass({ label: 'final', colorAttachments: [{ view: msaaTex.createView(), resolveTarget: out, loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }] });
    if (!DB.noFinal) { op.setPipeline(P.final); op.setBindGroup(0, finalBG()); op.draw(3); }
    for (const h of hooks) h.overlay && h.overlay(op, o);
    op.end();
    d.queue.submit([enc.finish()]);
    M.prevVPNJ.copy(M.vpNJ); st.first = false;
  }
  async function readPixels() {   // tests: copy the last output into a 2D canvas
    const w = outTex.width, h = outTex.height, bpr = Math.ceil(w * 4 / 256) * 256;
    const b = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const e = d.createCommandEncoder(); e.copyTextureToBuffer({ texture: outTex }, { buffer: b, bytesPerRow: bpr }, [w, h]); d.queue.submit([e.finish()]);
    await b.mapAsync(GPUMapMode.READ); const src = new Uint8Array(b.getMappedRange()), img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
    b.unmap(); b.destroy(); return img;
  }
  const wb = [1, 1, 1];
  function setExposure(v) { d.queue.writeBuffer(P.exBuf, 0, new Float32Array([v, 1, 1, 1])); }
  // white balance for daylight: undo the colour of the sun's path through the air when it is high, so white paint looks white at noon and warm at sunset
  // transmittance of the sun's path through the air (same medium as the shaders), from altitude altM with the sun at height sunY
  function sunT(altM, haze, mu) {
    const h0 = altM / 1000, od = [0, 0, 0], RS = [5.802e-3, 13.558e-3, 33.1e-3], OZ = [0.65e-3, 1.881e-3, 0.085e-3];
    for (let i = 0; i < 400; i++) {
      const t = (i + 0.5) * 0.5, h = Math.sqrt((6360 + h0) ** 2 + t * t + 2 * (6360 + h0) * mu * t) - 6360;
      if (h > 100) break;
      if (h < -0.05) return [0, 0, 0];
      const rd = Math.exp(-h / 8), md = Math.exp(-h / 1.2) * haze, oz = Math.max(0, 1 - Math.abs(h - 25) / 15);
      for (let k = 0; k < 3; k++) od[k] += (RS[k] * rd + 4.4e-3 * md + OZ[k] * oz) * 0.5;
    }
    return od.map(x => Math.exp(-x));
  }
  function setWhiteBalance(altM, haze, sunY = 0.75) {
    const T = sunT(altM, haze, Math.max(0.42, Math.min(0.8, sunY))), l = 0.2126 * T[0] + 0.7152 * T[1] + 0.0722 * T[2];
    for (let k = 0; k < 3; k++) wb[k] = 1 + 0.92 * (l / T[k] - 1);
  }
  return { addHook, init, resize, frame, readPixels, setInput, hooks, st, RT: () => RT, M, get frameBuf() { return frameBuf; }, get csBuf() { return csBuf; }, get format() { return fmt; }, setExposure, setWhiteBalance, sunT, projRZ };
})();
