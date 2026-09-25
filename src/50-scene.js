/* ================= Scene3D: renderer, camera, aircraft, airflow, forces, rain & snow ================= */
const Scene3DGL = (() => {
  const T = THREE;
  let renderer, composer, bloom, scene, camera, host, envRT, sun, hemi, air = null, envOK = null;
  const holder = new T.Group(), pitch = new T.Group(), flowGroup = new T.Group(), arrowGroup = new T.Group();
  const cam = { az: -0.7, el: 0.22, d: 1, taz: -0.7, tel: 0.22, td: 1 };
  const vis = { alpha: 0, CL: 0.4, stalled: false, sepX: 1, V: 50, h: 1000, thr: 0.8, ab: false, L: 1, W: 1, T: 0, D: 0.1, extended: true };
  const show = { forces: false, flow: true };
  let flow = null, precip = null, arrows = {}, labels = {}, time = 0, viewName = '34', size = 10, paused = false;
  const perf = { acc: 0, n: 0, scale: 0.6 };
  let insets = { l: 16, r: 16, b: 88, t: 136 };
  const framing={l:16,r:16,b:88,t:136};

  /* ---------- airflow: particles carried by the freestream + a horseshoe vortex (lifting-line model) ---------- */
  function makeFlow() {
    const N = 700, pos = new Float32Array(N * 6), col = new Float32Array(N * 6), g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
    const lines = new T.LineSegments(g, new T.LineBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = false; lines.renderOrder = 5;
    const P = {}; ['x', 'y', 'z', 'age', 'life'].forEach(k => (P[k] = new Float32Array(N))); P.tip = new Uint8Array(N);
    return { N, lines, P, pos, col, init: false };
  }
  const kN = () => 10 / air.L;   // normalised flow space: aircraft 10 units long
  function wingWorld(e, side, frac) {
    const w = air.wing, c = Math.max(w.chord(e), w.cr * 0.02), k = kN();
    return new T.Vector3(w.rootX - w.xle(e) - frac * c, w.rootY + w.z(e) * w.s, side * e * w.s).multiplyScalar(k).applyAxisAngle(new T.Vector3(0, 0, 1), vis.alpha * Math.PI / 180);
  }
  const speedU = () => Math.max(4, Math.min(13, 3 + vis.V * 0.035));
  function spawn(i, fresh) {
    const f = flow.P, w = air.wing, k = kN(), s = w.s * k, U = speedU(), tip = Math.random() < 0.24;
    let zz;
    if (tip) zz = (Math.random() < 0.5 ? -1 : 1) * s * (0.86 + Math.random() * 0.22);
    else { do { zz = (Math.random() * 2 - 1) * s * 1.25; } while (Math.abs(zz) < 0.07 * s + 0.3); }
    const base = wingWorld(Math.min(1, Math.abs(zz) / s), Math.sign(zz) || 1, 0), mac = w.MAC * k, layers = [-0.8, -0.35, 0.3, 0.75];
    f.x[i] = base.x + mac * 1.5 + (fresh ? Math.random() * 26 : Math.random() * 3);
    f.y[i] = base.y + (tip ? (Math.random() - 0.5) * 0.5 * mac : layers[i % 4] * mac * (0.6 + Math.random() * 0.7));
    f.z[i] = zz; f.age[i] = fresh ? Math.random() * 0.5 : 0; f.life[i] = (f.x[i] + 24) / U + 1; f.tip[i] = tip ? 1 : 0;
  }
  function induced(px, py, pz, A, B, G, rcB, rcT, out) {
    let ux = 0, uy = 0, uz = 0;
    { const r1x = px - A.x, r1y = py - A.y, r1z = pz - A.z, r2x = px - B.x, r2y = py - B.y, r2z = pz - B.z, r0x = B.x - A.x, r0y = B.y - A.y, r0z = B.z - A.z;
      const cx = r1y * r2z - r1z * r2y, cy = r1z * r2x - r1x * r2z, cz = r1x * r2y - r1y * r2x, n1 = Math.hypot(r1x, r1y, r1z), n2 = Math.hypot(r2x, r2y, r2z);
      const K = G / (4 * Math.PI) * (r0x * (r1x / n1 - r2x / n2) + r0y * (r1y / n1 - r2y / n2) + r0z * (r1z / n1 - r2z / n2)) / (cx * cx + cy * cy + cz * cz + rcB * rcB * (r0x * r0x + r0y * r0y + r0z * r0z));
      ux += K * cx; uy += K * cy; uz += K * cz; }
    for (const [Q, g] of [[B, G], [A, -G]]) {
      const rx = px - Q.x, ry = py - Q.y, rz = pz - Q.z, n = Math.hypot(rx, ry, rz) || 1e-6, fac = g / (4 * Math.PI) * (1 - rx / n) / (ry * ry + rz * rz + rcT * rcT);
      uy += fac * rz; uz -= fac * ry;
    }
    out[0] = ux; out[1] = uy; out[2] = uz;
  }
  function updateFlow(dt) {
    if (!air || !flow) return;
    flow.lines.visible = false;   // the 3D airflow particles were retired: the wing-section panel shows the flow instead
    return;
    const f = flow.P, N = flow.N, U = speedU(), w = air.wing, k = kN();
    if (!flow.init) { for (let i = 0; i < N; i++) spawn(i, true); flow.init = true; }
    const A = wingWorld(Math.PI / 4, -1, 0.25), B = wingWorld(Math.PI / 4, 1, 0.25);
    const G = 0.5 * U * w.S * k * k * vis.CL / (Math.abs(B.z - A.z) || 1), mac = w.MAC * k, rcB = 0.35 * mac, rcT = Math.max(0.12 * mac, 0.035 * w.s * k);
    const a = vis.alpha * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), foil = w.foil, out = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      induced(f.x[i], f.y[i], f.z[i], A, B, G, rcB, rcT, out);
      let vx = -U + out[0], vy = out[1], vz = out[2];
      let lx = (f.x[i] * ca + f.y[i] * sa) / k, ly = (-f.x[i] * sa + f.y[i] * ca) / k;
      const e = Math.abs(f.z[i] / k) / w.s;
      if (e < 1) {
        const c = Math.max(w.chord(e), 1e-3), xi = (w.rootX - w.xle(e) - lx) / c;
        if (xi > -0.05 && xi < 3) {
          const yc = w.rootY + w.z(e) * w.s + (foil.m || 0) * c * 2.8 * Math.max(0, Math.min(1, xi)) * (1 - Math.max(0, Math.min(1, xi)));
          if (xi < 1.02) {
            const x = Math.max(0, Math.min(1, xi)), m = 5 * foil.t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4) * c + 0.035 * c;
            if (Math.abs(ly - yc) < m) { ly = yc + Math.sign(ly - yc || 1) * m; f.x[i] = lx * k * ca - ly * k * sa; f.y[i] = lx * k * sa + ly * k * ca; }
          }
          if (vis.sepX < 0.98 && xi > vis.sepX && ly > yc && ly - yc < (0.25 + 0.9 * (1 - vis.sepX)) * c * (0.6 + 0.4 * Math.min(xi, 2))) {
            vx = vx * 0.35 + (Math.random() - 0.3) * U * 0.6; vy += (Math.random() - 0.5) * U * 1.6; vz += (Math.random() - 0.5) * U * 0.8;
          }
        }
      }
      f.x[i] += vx * dt; f.y[i] += vy * dt; f.z[i] += vz * dt; f.age[i] += dt;
      if (f.x[i] < -24 || f.age[i] > f.life[i] * 1.4 || Math.abs(f.y[i]) > 14) spawn(i, false);
      const o = i * 6;
      flow.pos[o] = f.x[i]; flow.pos[o + 1] = f.y[i]; flow.pos[o + 2] = f.z[i];
      flow.pos[o + 3] = f.x[i] - vx * 0.1; flow.pos[o + 4] = f.y[i] - vy * 0.1; flow.pos[o + 5] = f.z[i] - vz * 0.1;
      const spd = Math.hypot(vx, vy, vz) / U, fade = Math.min(1, f.age[i] / 0.4) * Math.min(1, Math.max(0, (f.x[i] + 24) / 8));
      const b = (f.tip[i] ? 0.55 : 0.26 + 0.34 * Math.max(0, Math.min(1, (spd - 0.8) / 0.5))) * fade * (1 - 0.5 * EnvGL.out.night);
      const tint = f.tip[i] ? [0.62, 0.9, 1.0] : [0.95, 0.97, 1.0];
      for (let q = 0; q < 2; q++) { const s2 = q ? 0.05 : 1; flow.col[o + q * 3] = b * tint[0] * s2; flow.col[o + q * 3 + 1] = b * tint[1] * s2; flow.col[o + q * 3 + 2] = b * tint[2] * s2; }
    }
    flow.lines.geometry.attributes.position.needsUpdate = true; flow.lines.geometry.attributes.color.needsUpdate = true;
  }

  /* ---------- rain and snow, relative to the moving aircraft ---------- */
  function makePrecip() {
    const N = 2400, pos = new Float32Array(N * 6), g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    const rain = new T.LineSegments(g, new T.LineBasicMaterial({ color: '#AFC3D6', transparent: true, opacity: 0.45, depthWrite: false }));
    const sg = new T.BufferGeometry(), sp = new Float32Array(N * 3); sg.setAttribute('position', new T.BufferAttribute(sp, 3));
    const snow = new T.Points(sg, new T.PointsMaterial({ color: '#FFFFFF', size: 0.09, map: Kit.light('#fff', 1).userData.spr.material.map, transparent: true, depthWrite: false, opacity: 0.95 }));
    [rain, snow].forEach(o => { o.frustumCulled = false; o.visible = false; });
    const P = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) P[i] = (Math.random() - 0.5) * 2;
    return { N, rain, snow, pos, sp, P };
  }
  function updatePrecip(dt) {
    const kind = EnvGL.out.precip, R = precip, box = Math.max(18, size * 1.1);
    R.rain.visible = kind === 'rain'; R.snow.visible = kind === 'snow';
    if (kind === 'none') return;
    const vx = -Math.min(vis.V, 70) * (kind === 'rain' ? 0.7 : 0.35), vy = kind === 'rain' ? -9 : -1.3, c = camera.position;
    for (let i = 0; i < R.N; i++) {
      const o = i * 3;
      R.P[o] += vx * dt / box; R.P[o + 1] += vy * dt / box + (kind === 'snow' ? Math.sin(time * 1.3 + i) * 0.02 * dt : 0);
      for (let j = 0; j < 3; j++) { if (R.P[o + j] < -1) R.P[o + j] += 2; if (R.P[o + j] > 1) R.P[o + j] -= 2; }
      const x = c.x + R.P[o] * box, y = c.y + R.P[o + 1] * box, z = c.z + R.P[o + 2] * box;
      if (kind === 'rain') { const p6 = i * 6, len = 0.045; R.pos[p6] = x; R.pos[p6 + 1] = y; R.pos[p6 + 2] = z; R.pos[p6 + 3] = x - vx * len; R.pos[p6 + 4] = y - vy * len; R.pos[p6 + 5] = z; }
      else { R.sp[o] = x; R.sp[o + 1] = y; R.sp[o + 2] = z; }
    }
    (kind === 'rain' ? R.rain : R.snow).geometry.attributes.position.needsUpdate = true;
  }

  function makeArrow(color) {
    const mat = new T.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.92, toneMapped: false });
    const g = new T.Group(), shaft = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 1, 14), mat), head = new T.Mesh(new T.ConeGeometry(0.22, 0.55, 20), mat);
    g.add(shaft, head); [g, shaft, head].forEach(o => (o.renderOrder = 20)); g.userData = { shaft, head }; return g;
  }
  function setArrow(a, dir, len) {
    const { shaft, head } = a.userData;
    a.visible = len > 0.05 && show.forces;
    a.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
    const sh = Math.max(0.001, len - 0.5); shaft.scale.set(1, sh, 1); shaft.position.y = sh / 2; head.position.y = sh + 0.27;
    a.userData.tip = dir.clone().multiplyScalar(len + 0.35);
  }

  /* ---------- setup ---------- */
  function init(el, lab, mods) {
    host = el;
    renderer = new T.WebGLRenderer({ canvas: el.querySelector('canvas'), antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene(); camera = new T.PerspectiveCamera(36, 1, 0.3, 5000);
    EnvGL.init(renderer);
    if (location.hash === '#lite') { perf.scale = 0.3; EnvGL.state.quality = 0.1; }
    envRT = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, depthBuffer: false }); envRT.texture.colorSpace = T.LinearSRGBColorSpace;
    scene.background = envRT.texture;
    sun = new T.DirectionalLight('#ffffff', 3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
    hemi = new T.HemisphereLight('#BFD6F0', '#5E6A74', 0.0);
    scene.add(sun, sun.target, hemi, holder); holder.add(pitch); pitch.add(flowGroup);
    scene.add(arrowGroup);
    flow = makeFlow(); flowGroup.add(flow.lines);
    precip = makePrecip(); scene.add(precip.rain, precip.snow);
    const css = getComputedStyle(document.documentElement), cssv = (k, f) => (css.getPropertyValue(k).trim() || f);
    [['lift', cssv('--lift', '#3B82F6')], ['weight', '#8E8E93'], ['thrust', cssv('--thrust', '#FF9500')], ['drag', cssv('--drag', '#CB30E0')]].forEach(([n, c]) => {
      arrows[n] = makeArrow(new T.Color(c)); arrowGroup.add(arrows[n]);
      const d = document.createElement('div'); d.className = 'flabel ' + n; lab.appendChild(d); labels[n] = d;
    });
    const rt = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, samples: 4 });
    composer = new mods.EffectComposer(renderer, rt);
    composer.addPass(new mods.RenderPass(scene, camera));
    bloom = new mods.UnrealBloomPass(new T.Vector2(256, 256), 0.32, 0.55, 1.1); composer.addPass(bloom);
    composer.addPass(new mods.OutputPass());
    // orbit with pointer, wheel and pinch
    const cv = renderer.domElement, ptrs = new Map(); let pinch = 0;
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (viewName !== 'free') { viewName = 'free'; host.dispatchEvent(new CustomEvent('viewchange')); } });
    cv.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      const [px, py] = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 1) { cam.taz += (e.clientX - px) * 0.007; cam.tel = Math.max(-1.2, Math.min(1.52, cam.tel + (e.clientY - py) * 0.005)); }
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) cam.td = Math.max(0.5, Math.min(6, cam.td * pinch / d)); pinch = d; }
    });
    const up = e => { ptrs.delete(e.pointerId); pinch = 0; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); cam.td = Math.max(0.5, Math.min(6, cam.td * Math.exp(e.deltaY * 0.001))); }, { passive: false });
    renderer.domElement.addEventListener('keydown',e=>{const key=e.key;if((FlightDirector.state.mode!=='manual'||e.altKey)&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(key)){e.preventDefault();if(key==='ArrowLeft')cam.taz-=.12;if(key==='ArrowRight')cam.taz+=.12;if(key==='ArrowUp')cam.tel=Math.min(1.5,cam.tel+.1);if(key==='ArrowDown')cam.tel=Math.max(-1.2,cam.tel-.1);if(key==='+'||key==='=')cam.td=Math.max(.5,cam.td*.9);if(key==='-')cam.td=Math.min(6,cam.td*1.1);viewName='free';host.dispatchEvent(new CustomEvent('viewchange'));}});
    new ResizeObserver(resize).observe(host); resize();
  }
  function resize() {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const pr = renderer.getPixelRatio();
    renderer.setSize(r.width, r.height, false); composer.setSize(r.width, r.height);
    envRT.setSize(Math.max(64, Math.round(r.width * pr * perf.scale)), Math.max(64, Math.round(r.height * pr * perf.scale)));
    bloom.setSize(r.width * pr / 2, r.height * pr / 2);
    camera.aspect = r.width / r.height;
    camera.setViewOffset(r.width,r.height,(framing.r-framing.l)/2,(framing.b-framing.t)/2,r.width,r.height);
    camera.updateProjectionMatrix();
  }
  function setInsets(l,r,b,t=136){insets={l,r,b,t};}

  function setAircraft(built) {
    if (air) { pitch.remove(air.group); Model.dispose(air.group); }
    air = built; pitch.add(built.group);
    size = Math.max(built.L, built.span);
    flowGroup.scale.setScalar(built.L / 10); arrowGroup.scale.setScalar(built.L / 10);
    const sc = sun.shadow.camera, h = size * 0.75; Object.assign(sc, { left: -h, right: h, top: h, bottom: -h, near: 1, far: size * 6 }); sc.updateProjectionMatrix();
    flow.init = false; camera.near = Math.max(0.2, size * 0.02); camera.updateProjectionMatrix();
    EnvGL.state.captureDue = true;
  }
  function setView(name) {
    viewName = name;
    const v = { '34': [-0.7, 0.2], side: [-Math.PI / 2, 0.02], front: [0, 0.05], top: [-Math.PI / 2, 1.5], rear: [Math.PI, 0.20] }[name];
    if (!v) return;
    let az = v[0]; while (az - cam.taz > Math.PI) az -= 2 * Math.PI; while (cam.taz - az > Math.PI) az += 2 * Math.PI;
    cam.taz = az; cam.tel = v[1]; cam.td = 1;
  }
  const set = v => Object.assign(vis, v);
  const toggle = (n, on) => { show[n] = on;if(n==='weather')EnvGL.set('weatherEffects',on); };

  function envWorks() {   // some software renderers return black reflections; test once
    try {
      const rt = new T.WebGLRenderTarget(8, 8, { type: T.HalfFloatType }), sc = new T.Scene(), px = new Uint16Array(256);
      sc.environment = scene.environment;
      const m = new T.Mesh(new T.SphereGeometry(1, 16, 8), new T.MeshStandardMaterial({ color: '#fff', roughness: 0.6 })); sc.add(m);
      const c = new T.PerspectiveCamera(30, 1, 0.1, 10); c.position.set(0, 0, 4); c.lookAt(0, 0, 0);
      renderer.setRenderTarget(rt); renderer.render(sc, c); renderer.readRenderTargetPixels(rt, 0, 0, 8, 8, px); renderer.setRenderTarget(null);
      rt.dispose(); m.geometry.dispose(); m.material.dispose();
      const i = (4 * 8 + 4) * 4, v = T.DataUtils.fromHalfFloat(px[i]) + T.DataUtils.fromHalfFloat(px[i + 1]);
      return isFinite(v) && v > 0.002;
    } catch (e) { return false; }
  }

  let routePlace=null,telemetryAt=0;
  function frame(dt) {
    if (!renderer || !air || document.hidden) return;
    const t0 = performance.now();
    if (paused || matchMedia('(prefers-reduced-motion:reduce)').matches) dt = 0;
    time += dt;
    const riverZ=x=>1300*Math.sin(x*Math.PI*2/14000)+350*Math.sin(x*Math.PI*4/14000);
    const fallbackGround=(x,z)=>{if(routePlace!=='canyon')return 850;const d=Math.abs(z-riverZ(x));return d<108?0:d<200?60:d<275?200:330;};
    if(routePlace!==EnvGL.state.place){routePlace=EnvGL.state.place;const route=[];
      for(let i=0;i<180;i++){const a=i/180*Math.PI*2;route.push(routePlace==='canyon'?{x:i/180*14000,z:riverZ(i/180*14000)}:{x:4000*Math.sin(a),z:3000*Math.cos(a)});}
      if(routePlace==='canyon')route.periodX=14000;FlightDirector.configure(routePlace,route,routePlace==='canyon'?180:3000);
    }
    const nav=FlightDirector.step(dt,vis.V,size,fallbackGround);
    const e = 1 - Math.exp(-Math.min(dt || 0.016, 0.05) * 5);
    cam.az += (cam.taz - cam.az) * e; cam.el += (cam.tel - cam.el) * e; cam.d += (cam.td - cam.d) * e;
    const bounds=host.getBoundingClientRect();
    const easing=matchMedia('(prefers-reduced-motion:reduce)').matches?1:1-Math.exp(-Math.max(dt,.016)*12);
    for(const key of ['l','r','b','t'])framing[key]+=(insets[key]-framing[key])*easing;
    const safeW=Math.max(120,bounds.width-framing.l-framing.r-64),safeH=Math.max(100,bounds.height-framing.t-framing.b-56);
    camera.setViewOffset(bounds.width,bounds.height,(framing.r-framing.l)/2,(framing.b-framing.t)/2,bounds.width,bounds.height);
    const vf=Math.tan(camera.fov*Math.PI/360),fit=Math.max(bounds.height/safeH,bounds.width/(safeW*camera.aspect));
    const D=size*(bounds.width<600?.43:.52)/vf*fit*cam.d*(viewName==='rear'?1.18:1);
    camera.position.set(D * Math.cos(cam.el) * Math.cos(cam.az), D * Math.sin(cam.el), D * Math.cos(cam.el) * Math.sin(cam.az));
    camera.position.applyAxisAngle(new T.Vector3(0,1,0),-nav.heading);holder.rotation.y=-nav.heading;arrowGroup.rotation.y=-nav.heading;
    camera.lookAt(0, size * 0.02, 0);
    const a = vis.alpha * Math.PI / 180, buf = vis.stalled ? 0.012 : 0.0025;
    pitch.rotation.set(nav.bank+Math.sin(time * 1.3) * buf * 1.5 + (vis.stalled && dt ? (Math.random() - 0.5) * buf : 0), 0, a+nav.pitch + Math.sin(time * 0.9) * buf);
    holder.position.y = Math.sin(time * 0.7) * size * 0.004;
    Model.animateControls(air,nav,dt);
    const an = air.anim;
    an.props.forEach(p => { p.userData.spin.rotation.x += dt * (3 + 26 * vis.thr); p.userData.disc.material.opacity = 0.04 + 0.1 * vis.thr; });
    an.fans.forEach(f => { f.userData.fan.rotation.x += dt * (4 + 22 * vis.thr); });
    an.flames.forEach(f => { f.visible = vis.ab; if (vis.ab) f.scale.set(1 + 0.08 * Math.sin(time * 40) + 0.05 * Math.random(), 1, 1); });
    if (an.mast) { const tgt = vis.extended ? 0 : 1; an.mast.userData.k = (an.mast.userData.k ?? tgt) + (tgt - (an.mast.userData.k ?? tgt)) * e * 0.6;
      const k = an.mast.userData.k; an.mast.rotation.z = -k * Math.PI / 2 * 0.96; an.mast.visible = k < 0.97; an.mast.scale.setScalar(1 - 0.4 * k); }
    if (an.droop) { const tgt = vis.V < 110 ? 12.5 : vis.V < 165 ? 5 : 0; an.droop.userData.a = (an.droop.userData.a ?? tgt) + (tgt - (an.droop.userData.a ?? tgt)) * e * 0.5; an.droop.rotation.z = -an.droop.userData.a * Math.PI / 180; }
    const night = EnvGL.out.night, strobe = (time % 1.2) < 0.06;
    const ls = 0.6 + size / 60;
    an.lights.forEach(l => { l.userData.spr.material.opacity = 0.35 + 0.65 * night; l.userData.spr.scale.setScalar(ls * (0.5 + 1.3 * night)); });
    an.strobe.forEach(l => { l.visible = strobe; l.userData.spr.scale.setScalar(ls * (1.2 + 1.8 * night)); });
    updateFlow(Math.min(dt, 0.05)); updatePrecip(Math.min(dt, 0.05));
    // forces at the centre of gravity (lift ⟂ airflow, drag ∥ airflow, thrust along the body)
    arrowGroup.position.copy(holder.position);
    const lw = Math.max(vis.L, vis.W, 1), td = Math.max(vis.T, vis.D, 1);
    setArrow(arrows.lift, new T.Vector3(0, 1, 0), 2.5 * Math.max(0, vis.L) / lw);
    setArrow(arrows.weight, new T.Vector3(0, -1, 0), 2.5 * vis.W / lw);
    setArrow(arrows.thrust, new T.Vector3(Math.cos(a), Math.sin(a), 0), 2.6 * vis.T / td);
    setArrow(arrows.drag, new T.Vector3(-1, 0, 0), 2.6 * vis.D / td);
    const r = host.getBoundingClientRect();
    for (const [n, el] of Object.entries(labels)) {
      const A = arrows[n];
      if (!A.visible) { el.hidden = true; continue; }
      const p = A.userData.tip.clone().multiplyScalar(air.L / 10).applyAxisAngle(new T.Vector3(0,1,0),-nav.heading).add(arrowGroup.position).project(camera);
      el.hidden = p.z > 1;
      el.style.transform = `translate(${Math.max(60, Math.min(r.width - 60, (p.x + 1) / 2 * r.width+(r.width<600?(n==='drag'?24:n==='thrust'?-24:0):0))).toFixed(1)}px, ${Math.max(70, Math.min(r.height - 20, (1 - p.y) / 2 * r.height)).toFixed(1)}px) translate(-50%, -50%)`;
    }
    // environment, light and reflections
    EnvGL.state.travelX=nav.x;EnvGL.state.travelZ=nav.z;EnvGL.update(dt, camera, nav.alt, 0);
    if (EnvGL.state.captureDue) {
      scene.environment = EnvGL.capture();
      if (envOK === null) envOK = envWorks();
      if (!envOK) { scene.environment = null; hemi.intensity = 1.6; }
      const o = EnvGL.out;
      sun.position.copy(o.lightDir).multiplyScalar(size * 3); sun.color.copy(o.lightColor); sun.intensity = Math.PI * (o.night ? 1 : 1);
      renderer.toneMappingExposure = o.exposure;
      hemi.color.copy(o.lightColor).multiplyScalar(0.4).addScalar(0.1);
    }
    EnvGL.render(envRT, camera);
    composer.render();if(performance.now()-telemetryAt>150){telemetryAt=performance.now();host.dispatchEvent(new CustomEvent('flighttelemetry',{detail:{...nav}}));}
    // keep the frame rate up: trade cloud and terrain detail for speed
    perf.acc += performance.now() - t0; perf.n++;
    if (perf.n >= 30) {
      const ms = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
      const q = EnvGL.state.quality;
      if (ms > 26 && (q > 0.2 || perf.scale > 0.34)) { EnvGL.state.quality = Math.max(0.15, q - 0.15); if (q <= 0.3) { perf.scale = Math.max(0.33, perf.scale - 0.07); resize(); } }
      else if (ms < 12 && (q < 1 || perf.scale < 0.7)) { if (q < 1) EnvGL.state.quality = Math.min(1, q + 0.1); else { perf.scale = Math.min(0.7, perf.scale + 0.05); resize(); } }
    }
  }
  function setLabels(t) { for (const [n, s] of Object.entries(t)) if (labels[n]) labels[n].textContent = s; }
  function thumbnail(built, w = 360, h = 200) {   // small render of an aircraft for the picker
    const sc = new T.Scene(), c = new T.PerspectiveCamera(30, w / h, 0.1, 1000), s = Math.max(built.L, built.span);
    sc.add(built.group); sc.environment = scene.environment; sc.add(new T.HemisphereLight('#ffffff', '#8a96a3', 1.2));
    const dl = new T.DirectionalLight('#fff', 2.4); dl.position.set(-3, 5, -4); sc.add(dl);
    c.position.set(s * 0.95, s * 0.42, -s * 1.05); c.lookAt(0, 0, 0);
    const rt = new T.WebGLRenderTarget(w, h, { samples: 4 }), px = new Uint8Array(w * h * 4); rt.texture.colorSpace = T.SRGBColorSpace;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, c); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px); renderer.setRenderTarget(null);
    rt.dispose(); Model.dispose(built.group);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'), img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    g.putImageData(img, 0, 0); return cv.toDataURL();
  }
  return { init, setAircraft, setView, set, toggle, frame, setLabels, thumbnail, setInsets, pause: p => { paused = p; }, get view() { return viewName; } };
})();
