/* ================= Model kit: shapes, paint, parts shared by every aircraft ================= */
const Kit = (() => {
  const T = THREE, D2R = Math.PI / 180;

  /* Catmull–Rom sampling of fuselage stations [x/L, half-width, top, bottom, centre height] */
  function sample(st, f) {
    let i = 0; while (i < st.length - 2 && st[i + 1][0] < f) i++;
    const p0 = st[Math.max(0, i - 1)], p1 = st[i], p2 = st[i + 1], p3 = st[Math.min(st.length - 1, i + 2)];
    const t = Math.max(0, Math.min(1, (f - p1[0]) / (p2[0] - p1[0] || 1)));
    const out = [f];
    for (let k = 1; k < 5; k++) {
      const a = p0[k], b = p1[k], c = p2[k], d = p3[k];
      out.push(Math.max(k < 4 ? 0 : -99, 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)));
    }
    return out;
  }
  /* lofted body: super-ellipse sections; u runs nose→tail, v runs round (0 bottom, .25 right/+z, .5 top, .75 left) */
  function loft(st, L, x0, n, f0 = 0, f1 = 1, nT = 64, rows = 110) {
    const pos = [], uv = [], idx = [], ex = 2 / n;
    for (let r = 0; r <= rows; r++) {
      const u = r / rows, f = f0 + (f1 - f0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      const [, w, top, bot, yc] = sample(st, f);
      for (let j = 0; j <= nT; j++) {
        const th = -Math.PI / 2 + 2 * Math.PI * j / nT, c = Math.cos(th), s = Math.sin(th);
        pos.push(x0 - f * L, yc + (s >= 0 ? top : bot) * Math.sign(s) * Math.pow(Math.abs(s), ex), w * Math.sign(c) * Math.pow(Math.abs(c), ex));
        uv.push(f, j / nT);
      }
    }
    for (let r = 0; r < rows; r++) for (let j = 0; j < nT; j++) { const a = r * (nT + 1) + j, b = a + nT + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const nr = g.attributes.normal;
    for (let r = 0; r <= rows; r++) { const a = r * (nT + 1), b = a + nT, v = new T.Vector3(nr.getX(a) + nr.getX(b), nr.getY(a) + nr.getY(b), nr.getZ(a) + nr.getZ(b)).normalize(); nr.setXYZ(a, v.x, v.y, v.z); nr.setXYZ(b, v.x, v.y, v.z); }
    return g;
  }
  /* lifting surface lofted from an airfoil; uv: u round the section (0 lower TE, .5 LE, 1 upper TE), v root→tip */
  function surface(geo, foil, place, zFn, opt = {}) {
    const sides=opt.sides||[1,-1],nc=opt.nc||28,ns=opt.ns||34,round=opt.round||0,e0=opt.e0||0,e1=opt.e1??1;
    const {up,lo}=Aero.naca(foil,nc);let loop=[];
    for(let i=nc;i>=0;i--)loop.push([...lo[i],(nc-i)/(2*nc)]);
    for(let i=1;i<=nc;i++)loop.push([...up[i],(nc+i)/(2*nc)]);
    const clip=(poly,edge,greater)=>{const out=[];for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],ai=greater?a[0]>=edge:a[0]<=edge,bi=greater?b[0]>=edge:b[0]<=edge;
      if(ai)out.push(a);if(ai!==bi){const t=(edge-a[0])/(b[0]-a[0]);out.push([edge,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]);}
    }return out;};
    if(opt.xMin!==undefined)loop=clip(loop,opt.xMin,true);
    if(opt.xMax!==undefined)loop=clip(loop,opt.xMax,false);
    const contour=loop.map(p=>new T.Vector2(p[0],p[1])),caps=T.ShapeUtils.triangulateShape(contour,[]);
    loop.push(loop[0]);const M=loop.length,pos=[],uv=[],idx=[],cmin=geo.cr*.015;
    const P=(e,xi,ya)=>{let c=Math.max(geo.chord(e),cmin),x0=geo.xle(e);
      if(round&&e>1-round){const k=Math.sqrt(Math.max(.02,1-((e-1+round)/round)**2));x0+=.3*c*(1-k);c*=k;}
      return [place.x-x0-xi*c,place.y+zFn(e)*geo.s+ya*c,e*geo.s];};
    sides.forEach(side=>{
      const base=pos.length/3;
      for(let k=0;k<=ns;k++){const e=e0+(e1-e0)*Math.sin(k/ns*Math.PI/2);loop.forEach(([xi,ya,u])=>{const p=P(e,xi,ya);pos.push(p[0],p[1],p[2]*side);uv.push(u,e);});}
      for(let k=0;k<ns;k++)for(let i=0;i<M-1;i++){const a=base+k*M+i,b=a+M;if(side>0)idx.push(a,a+1,b,a+1,b+1,b);else idx.push(a,b,a+1,a+1,b,b+1);}
      for(const [e,normal] of [[e0,-side],[e1,side]]){
        const base=pos.length/3;for(const [xi,ya,u] of loop.slice(0,-1)){const p=P(e,xi,ya);pos.push(p[0],p[1],p[2]*side);uv.push(u,e);}
        for(const tri of caps){const [a,b,c]=tri.map(i=>base+i);const z=(pos[b*3]-pos[a*3])*(pos[c*3+1]-pos[a*3+1])-(pos[b*3+1]-pos[a*3+1])*(pos[c*3]-pos[a*3]);if(z*normal>0)idx.push(a,b,c);else idx.push(a,c,b);}
      }
    });
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
  }
  function trapGeo(S, b, taper, sweepLE) { return Aero.wingGeometry({ kind: 'trap', taper, f: 0, sweep: sweepLE }, S, b); }
  function lathe(profile, seg = 40) {
    if (profile[0][1] > profile[profile.length - 1][1]) profile = profile.slice().reverse();
    const g = new T.LatheGeometry(profile.map(([r, a]) => new T.Vector2(Math.max(r, 1e-4), a)), seg);
    g.rotateZ(-Math.PI / 2); return g;
  }
  function rod(a, b, r, mat, flat = 1) {
    const d = new T.Vector3().subVectors(b, a), m = new T.Mesh(new T.CylinderGeometry(r, r, d.length(), 10), mat);
    if (flat !== 1) m.geometry.scale(flat, 1, 1);
    m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    return m;
  }
  function wheel(r, w, mats) {
    const g = new T.Group(), tyre = new T.Mesh(new T.TorusGeometry(r * 0.72, r * 0.28, 12, 28), mats.rubber);
    const hub = new T.Mesh(new T.CylinderGeometry(r * 0.45, r * 0.45, w * 0.9, 20), mats.metal); hub.rotation.x = Math.PI / 2;
    tyre.scale.z = w / (r * 0.56); g.add(tyre, hub); return g;
  }
  function propeller(R, nB, hubR, mats, spinnerLen = 1.7) {
    const grp = new T.Group(), spin = new T.Group();
    spin.add(new T.Mesh(lathe([[0, hubR * spinnerLen], [hubR * 0.45, hubR * spinnerLen * 0.85], [hubR * 0.82, hubR * spinnerLen * 0.5], [hubR, hubR * 0.15], [hubR, -hubR * 0.25], [0, -hubR * 0.25]]), mats.spinner));
    const ns = 12, nsec = 14, pos = [], idx = [];
    for (let k = 0; k <= ns; k++) {
      const f = k / ns, r = hubR * 0.6 + (R - hubR * 0.6) * f;
      let c = R * (0.11 + 0.06 * Math.sin(Math.PI * Math.min(1, f * 1.4)) - 0.05 * f); if (f > 0.85) c *= Math.sqrt(Math.max(0.05, 1 - ((f - 0.85) / 0.15) ** 2));
      const beta = Math.atan(1.1 * R / (2 * Math.PI * Math.max(r, hubR))), cd = [Math.sin(beta), Math.cos(beta)], td = [Math.cos(beta), -Math.sin(beta)];
      for (let j = 0; j < nsec; j++) { const t = 2 * Math.PI * j / nsec, a = 0.5 * c * Math.cos(t), b = 0.05 * c * Math.sin(t) * (1 - 0.5 * f); pos.push(a * cd[0] + b * td[0], r, a * cd[1] + b * td[1]); }
    }
    for (let k = 0; k < ns; k++) for (let j = 0; j < nsec; j++) { const a = k * nsec + j, b = k * nsec + (j + 1) % nsec; idx.push(a, b, a + nsec, b, b + nsec, a + nsec); }
    const bg = new T.BufferGeometry(); bg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); bg.setIndex(idx); bg.computeVertexNormals();
    const blades = [];
    for (let i = 0; i < nB; i++) {
      const m = new T.Mesh(bg, mats.blade); m.rotation.x = 2 * Math.PI * i / nB; spin.add(m); blades.push(m);
      const tip = new T.Mesh(new T.BoxGeometry(0.02, R * 0.07, R * 0.08), mats.tip); tip.position.y = R * 0.95; const tg = new T.Group(); tg.rotation.x = 2 * Math.PI * i / nB; tg.add(tip); spin.add(tg); blades.push(tg);
    }
    // a running propeller photographs as a soft, dark disc with faint blade sweeps and a yellow tip ring
    const disc = new T.Mesh(new T.CircleGeometry(R, 64), new T.MeshBasicMaterial({ map: propBlurTex(nB), transparent: true, opacity: 1, side: T.DoubleSide, depthWrite: false }));
    disc.rotation.y = Math.PI / 2; disc.position.x = 0.03;
    grp.add(spin, disc); grp.userData = { spin, disc, blades };
    return grp;
  }
  const blurCache = {};
  function propBlurTex(nB) {
    if (blurCache[nB]) return blurCache[nB];
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N), D = img.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      let v = 0;
      if (r < 1 && r > 0.12) {
        // each blade smeared over ~70 degrees by the shutter, strongest at its leading edge
        for (let b = 0; b < nB; b++) { let t = ((a - b * 2 * Math.PI / nB) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); v = Math.max(v, Math.exp(-t / 1.2) * 0.55 + 0.08); }
        v *= 0.55 + 0.45 * Math.min(1, (1 - r) * 6) * (0.7 + 0.3 * Math.sin(r * 38));
      }
      const tip = r > 0.9 && r < 0.985 ? 0.5 * Math.sin((r - 0.9) / 0.085 * Math.PI) : 0, o = (y * N + x) * 4;
      const col = tip > v ? [242, 194, 48] : [22, 24, 28], al = Math.min(1, Math.max(v * 0.42, tip * 0.2)) * (r < 1 ? 1 : 0);
      D[o] = col[0]; D[o + 1] = col[1]; D[o + 2] = col[2]; D[o + 3] = Math.round(al * 255);
    }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.userData.keep = true; return (blurCache[nB] = t);
  }
  function nacelleFan(Rn, Ln, mats, bypass) {
    const g = new T.Group(), h = Ln / 2;
    const outer = bypass
      ? [[0.8 * Rn, -0.34 * Ln], [0.86 * Rn, -0.2 * Ln], [0.87 * Rn, 0.3 * Ln], [0.86 * Rn, 0.47 * Ln], [0.93 * Rn, 0.505 * Ln], [0.99 * Rn, 0.47 * Ln], [Rn, 0.3 * Ln], [0.97 * Rn, 0], [0.86 * Rn, -0.3 * Ln], [0.8 * Rn, -0.34 * Ln]]
      : [[0.72 * Rn, -h], [0.8 * Rn, 0.46 * Ln], [0.9 * Rn, h], [Rn, 0.44 * Ln], [Rn, -0.1 * Ln], [0.82 * Rn, -h]];
    const cowl = new T.Mesh(lathe(outer, 56), mats.nacelle); g.add(cowl);
    const lip = new T.Mesh(new T.TorusGeometry(0.93 * Rn, 0.035 * Rn, 10, 56), mats.metal); lip.rotation.y = Math.PI / 2; lip.position.x = bypass ? 0.5 * Ln : h; g.add(lip);
    const face = new T.Mesh(new T.CircleGeometry((bypass ? 0.85 : 0.78) * Rn, 48), mats.black); face.rotation.y = Math.PI / 2; face.position.x = bypass ? 0.3 * Ln : 0.44 * Ln; g.add(face);
    const fan = new T.Group(); fan.position.x = face.position.x + 0.01;
    fan.add(new T.Mesh(lathe([[0, 0.26 * Rn], [0.18 * Rn, 0.13 * Rn], [0.27 * Rn, 0], [0, 0]]), mats.spinner));
    const nb = bypass ? 24 : 18;
    for (let i = 0; i < nb; i++) { const bl = new T.Mesh(new T.BoxGeometry(0.02 * Rn, (bypass ? 0.58 : 0.5) * Rn, 0.14 * Rn), mats.metal); bl.position.y = (bypass ? 0.54 : 0.47) * Rn; bl.rotation.y = 0.55; const arm = new T.Group(); arm.rotation.x = 2 * Math.PI * i / nb; arm.add(bl); fan.add(arm); }
    g.add(fan);
    if (bypass) g.add(new T.Mesh(lathe([[0.56 * Rn, -0.25 * Ln], [0.5 * Rn, -0.5 * Ln], [0.36 * Rn, -0.62 * Ln], [0.3 * Rn, -0.66 * Ln], [0, -0.8 * Ln]]), mats.hot));
    else g.add(new T.Mesh(lathe([[0.72 * Rn, -h], [0.62 * Rn, -h - 0.05 * Ln], [0.3 * Rn, -h + 0.05 * Ln], [0, -h + 0.12 * Ln]]), mats.hot));
    g.userData = { fan };
    return g;
  }
  function flame(r, len, mats) {
    const g = new T.Group();
    [[1, 1], [0.72, 0.78], [0.42, 0.5]].forEach(([rs, ls], i) => { const m = new T.Mesh(new T.ConeGeometry(r * rs, len * ls, 28, 1, true), mats.flame[i]); m.rotation.z = Math.PI / 2; m.position.x = -len * ls / 2; m.renderOrder = 8; g.add(m); });
    for (let i = 1; i <= 4; i++) { const d = new T.Mesh(new T.SphereGeometry(r * 0.35, 12, 8), mats.flame[2]); d.scale.set(1.8, 1, 1); d.position.x = -len * 0.16 * i; g.add(d); }   // shock diamonds
    g.visible = false; return g;
  }
  function light(color, size) {   // navigation light: small emissive bulb + glow sprite
    const g = new T.Group(), bulb = new T.Mesh(new T.SphereGeometry(size * 0.25, 10, 8), new T.MeshBasicMaterial({ color }));
    const spr = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    spr.scale.setScalar(size * 6); g.add(bulb, spr); g.userData = { spr, bulb }; return g;
  }
  let _glow;
  function glowTex() {
    if (_glow) return _glow;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); _glow = new T.CanvasTexture(c); _glow.userData.keep=true; return _glow;
  }

  /* paint: canvases drawn in u/v space; helpers take angles round the body in degrees (0 = side, 90 = top) */
  function canvas(W = 2048, H = 1024) { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
  function painter(c) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const vy = v => (1 - v) * H;
    return {
      g, W, H,
      fill(col) { g.fillStyle = col; g.fillRect(0, 0, W, H); },
      band(a1, a2, col, u0 = 0, u1 = 1) {   // both sides
        g.fillStyle = col;
        [[0.25 + a1 / 360, 0.25 + a2 / 360], [0.75 - a2 / 360, 0.75 - a1 / 360]].forEach(([v0, v1]) => g.fillRect(u0 * W, vy(v1), (u1 - u0) * W, (v1 - v0) * H));
      },
      region(u0, u1, v0, v1, col) { g.fillStyle = col; g.fillRect(u0 * W, vy(v1), (u1 - u0) * W, (v1 - v0) * H); },
      dotsSide(a, u0, u1, step, w, h, col) {   // windows, both sides
        g.fillStyle = col;
        for (let u = u0; u < u1; u += step) [0.25 + a / 360, 0.75 - a / 360].forEach(v => { g.beginPath(); const x = u * W, y = vy(v), rw = w * W / 2, rh = h / 360 * H / 2; g.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2); g.fillStyle=col;g.fill();g.lineWidth=1.5;g.strokeStyle='#7c8d98';g.stroke();g.beginPath();g.ellipse(x-rw*.12,y-rh*.2,rw*.69,rh*.5,0,Math.PI,Math.PI*1.8);g.strokeStyle='rgba(183,207,220,.3)';g.lineWidth=1;g.stroke(); });
      },
      roundel(u, a, r, rings, L, girth) {   // r in metres; converts to u/v scale
        [0.25 + a / 360, 0.75 - a / 360].forEach(v => rings.forEach(([f, col]) => { g.fillStyle = col; g.beginPath(); g.ellipse(u * W, vy(v), r * f / L * W, r * f / girth * H, 0, 0, Math.PI * 2); g.fill(); }));
      },
      poly(pts, col) { g.fillStyle = col; g.beginPath(); pts.forEach(([u, v], i) => (i ? g.lineTo(u * W, vy(v)) : g.moveTo(u * W, vy(v)))); g.closePath(); g.fill(); },
      lines(us, col, w = 2) { g.strokeStyle = col; g.lineWidth = w; us.forEach(u => { g.beginPath(); g.moveTo(u * W, 0); g.lineTo(u * W, H); g.stroke(); }); },
      blobs(v0, v1, col, n, seed, sz = 0.06) {   // camouflage patches
        let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        g.fillStyle = col;
        for (let i = 0; i < n; i++) { const cx = r(), cy = v0 + (v1 - v0) * r(); g.beginPath(); for (let k = 0; k < 9; k++) { const t = k / 9 * Math.PI * 2, rr = sz * (0.6 + 0.8 * r()); const x = (cx + Math.cos(t) * rr * 1.6) * W, y = vy(cy + Math.sin(t) * rr); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.fill(); }
      },
      tex(srgb = true) { const t = new T.CanvasTexture(c); t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = 8; return t; }
    };
  }

  function materials() {
    const phys = (color, o = {}) => new T.MeshPhysicalMaterial({ color, metalness: 0.0, roughness: 0.36, clearcoat: 0.92, clearcoatRoughness: 0.08, ...o });
    const std = (color, m = 0.1, r = 0.45) => new T.MeshStandardMaterial({ color, metalness: m, roughness: r });
    return {
      phys, std,
      metal: std('#C4C9CF', 1.0, 0.22), steel: std('#9AA1A8', 1.0, 0.32), hot: std('#4A4038', 0.9, 0.45), black: std('#07080A', 0.1, 0.9),
      rubber: std('#151617', 0, 0.85), blade: std('#16181C', 0.3, 0.5), tip: std('#F2C230', 0.1, 0.45), spinner: std('#D9DDE2', 1.0, 0.16),
      nacelle: phys('#E9ECEF'),
      glass: new T.MeshPhysicalMaterial({ color: '#213847', side:T.DoubleSide, metalness: 0.34, roughness: 0.11, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8 }),
      cockpit: std('#121418', 0.1, 0.8),
      disc: new T.MeshBasicMaterial({ color: '#202428', transparent: true, opacity: 0.08, side: T.DoubleSide, depthWrite: false }),
      flame: [['#FF7A2E', 0.32], ['#FFB35C', 0.5], ['#FFF1D0', 0.85]].map(([c, o]) => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }))
    };
  }
  return { sample, loft, surface, trapGeo, lathe, rod, wheel, propeller, nacelleFan, flame, light, canvas, painter, materials, D2R };
})();
