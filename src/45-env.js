/* ================= Env: physically based sky, volumetric clouds, terrain, water, weather ================= */
const EnvGL = (() => {
  const T = THREE;
  /* ---------- noise textures (generated once) ---------- */
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function noise2D() {
    const N = 256, d = new Uint8Array(N * N * 4), r = rng(7);
    for (let i = 0; i < N * N * 4; i++) d[i] = Math.floor(r() * 256);
    const t = new T.DataTexture(d, N, N, T.RGBAFormat);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = t.minFilter = T.LinearFilter; t.needsUpdate = true;
    return t;
  }
  function worley(N, cells, r) {   // tileable 3D Worley, returns 1 - distance to nearest feature point
    const pts = new Float32Array(cells ** 3 * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = r();
    const out = new Float32Array(N ** 3), sc = cells / N;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = (x + 0.5) * sc, py = (y + 0.5) * sc, pz = (z + 0.5) * sc, cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
      let m = 9;
      for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const ix = (cx + i + cells) % cells, iy = (cy + j + cells) % cells, iz = (cz + k + cells) % cells, o = ((iz * cells + iy) * cells + ix) * 3;
        const dx = cx + i + pts[o] - px, dy = cy + j + pts[o + 1] - py, dz = cz + k + pts[o + 2] - pz, dd = dx * dx + dy * dy + dz * dz;
        if (dd < m) m = dd;
      }
      out[(z * N + y) * N + x] = 1 - Math.min(1, Math.sqrt(m));
    }
    return out;
  }
  function perlin(N, P, r) {   // tileable 3D gradient noise with period P cells
    const g = new Float32Array(P ** 3 * 3);
    for (let i = 0; i < P ** 3; i++) { let x, y, z, l; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 0.01); l = Math.sqrt(l); g[i * 3] = x / l; g[i * 3 + 1] = y / l; g[i * 3 + 2] = z / l; }
    const out = new Float32Array(N ** 3), f = t => t * t * t * (t * (t * 6 - 15) + 10);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = (x + 0.5) / N * P, py = (y + 0.5) / N * P, pz = (z + 0.5) / N * P;
      const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz), fx = px - x0, fy = py - y0, fz = pz - z0;
      let v = 0;
      for (let c = 0; c < 8; c++) {
        const i = c & 1, j = (c >> 1) & 1, k = c >> 2, o = ((((z0 + k) % P) * P + (y0 + j) % P) * P + (x0 + i) % P) * 3;
        const w = (i ? f(fx) : 1 - f(fx)) * (j ? f(fy) : 1 - f(fy)) * (k ? f(fz) : 1 - f(fz));
        v += w * (g[o] * (fx - i) + g[o + 1] * (fy - j) + g[o + 2] * (fz - k));
      }
      out[(z * N + y) * N + x] = v;
    }
    return out;
  }
  function tex3D(data, N) {
    const u8 = new Uint8Array(N ** 3);
    for (let i = 0; i < u8.length; i++) u8[i] = Math.max(0, Math.min(255, Math.round(data[i] * 255)));
    const t = new T.Data3DTexture(u8, N, N, N);
    t.format = T.RedFormat; t.type = T.UnsignedByteType; t.minFilter = t.magFilter = T.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = T.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  }
  function cloudNoise() {
    const N = 64, r = rng(11);
    const w1 = worley(N, 4, r), w2 = worley(N, 8, r), w3 = worley(N, 16, r), p1 = perlin(N, 4, r), p2 = perlin(N, 8, r), p3 = perlin(N, 16, r);
    const base = new Float32Array(N ** 3);
    for (let i = 0; i < base.length; i++) {
      const wf = w1[i] * 0.625 + w2[i] * 0.25 + w3[i] * 0.125;
      const pf = Math.min(1, Math.max(0, (p1[i] + p2[i] * 0.5 + p3[i] * 0.25) * 0.75 + 0.5));
      base[i] = Math.min(1, Math.max(0, (pf - (1 - wf)) / wf * 0.85 + wf * 0.35));   // Perlin–Worley (Schneider)
    }
    const M = 32, r2 = rng(23), d1 = worley(M, 4, r2), d2 = worley(M, 8, r2), d3 = worley(M, 16, r2), det = new Float32Array(M ** 3);
    for (let i = 0; i < det.length; i++) det[i] = d1[i] * 0.625 + d2[i] * 0.25 + d3[i] * 0.125;
    return { base: tex3D(base, N), detail: tex3D(det, M) };
  }

  /* ---------- atmosphere (Rayleigh + Mie single scattering) ---------- */
  const ATMO_GLSL = `
    const float Re = 6371e3, Ra = 6471e3, HR = 8000.0, HM = 1200.0;
    const vec3 bR = vec3(5.8e-6, 13.5e-6, 33.1e-6); const float bM = 21e-6;
    vec2 rsi(vec3 o, vec3 d, float r) { float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c; if (h < 0.0) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
    vec3 atmo(vec3 d, float alt, vec3 sun, float I) {
      vec3 o = vec3(0.0, Re + alt, 0.0);
      vec2 p = rsi(o, d, Ra); if (p.x > p.y) return vec3(0.0);
      vec2 g = rsi(o, d, Re); float tEnd = p.y; if (g.x > 0.0) tEnd = min(tEnd, g.x);
      float t0 = max(p.x, 0.0), ds = (tEnd - t0) / 20.0;
      float mu = dot(d, sun), pR = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu), gg = 0.76;
      float pM = 3.0 / (8.0 * 3.14159) * ((1.0 - gg * gg) * (1.0 + mu * mu)) / ((2.0 + gg * gg) * pow(1.0 + gg * gg - 2.0 * mu * gg, 1.5));
      vec3 sR = vec3(0.0), sM = vec3(0.0); float oR = 0.0, oM = 0.0;
      for (int i = 0; i < 20; i++) {
        vec3 x = o + d * (t0 + ds * (float(i) + 0.5)); float h = length(x) - Re;
        float dR = exp(-h / HR) * ds, dM = exp(-h / HM) * ds; oR += dR; oM += dM;
        vec2 l = rsi(x, sun, Ra); float ls = l.y / 6.0, lR = 0.0, lM = 0.0; bool blocked = false;
        for (int j = 0; j < 6; j++) { vec3 y = x + sun * ls * (float(j) + 0.5); float hh = length(y) - Re; if (hh < 0.0) { blocked = true; break; } lR += exp(-hh / HR) * ls; lM += exp(-hh / HM) * ls; }
        if (!blocked) { vec3 att = exp(-(bR * (oR + lR) + bM * 1.1 * (oM + lM))); sR += dR * att; sM += dM * att; }
      }
      return I * (pR * bR * sR + pM * bM * sM);
    }`;

  function transmittance(alt, sunY) {   // same model on the CPU, for the sunlight that reaches the aircraft
    const Re = 6371e3, Ra = 6471e3, o = [0, Re + alt, 0], d = [Math.sqrt(Math.max(0, 1 - sunY * sunY)), sunY, 0];
    const b = o[1] * d[1], c = o[1] * o[1] - Re * Re;
    if (sunY < 0 && b * b - c > 0 && -b - Math.sqrt(b * b - c) > 0) return [0, 0, 0];
    const cA = o[1] * o[1] - Ra * Ra, tEnd = -b + Math.sqrt(b * b - cA), n = 40, ds = tEnd / n;
    let oR = 0, oM = 0;
    for (let i = 0; i < n; i++) { const t = ds * (i + 0.5), x = d[0] * t, y = o[1] + d[1] * t, h = Math.hypot(x, y) - Re; oR += Math.exp(-h / 8000) * ds; oM += Math.exp(-h / 1200) * ds; }
    return [5.8e-6, 13.5e-6, 33.1e-6].map(bR => Math.exp(-(bR * oR + 21e-6 * 1.1 * oM)));
  }

  /* ---------- the environment shader ---------- */
  const FRAG = `
    precision highp float; precision highp sampler3D;
    uniform sampler2D uSky, uN2; uniform sampler3D uN3, uN3d;
    uniform vec3 uCam, uSun, uSunCol, uLight, uLightCol, uMoon;
    uniform float uTime, uNight, uHmax, uHaze, uCB, uCT, uCover, uDens, uCScale, uOvercast, uFog, uSnow, uWet, uFlat;
    uniform int uEnv, uCSteps, uTSteps;
    varying vec3 vDir;
    const mat2 M2 = mat2(0.8, -0.6, 0.6, 0.8);
    float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return texture2D(uN2, (i + f + 0.5) / 256.0).x; }
    float fbm(vec2 p, int o) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < 10; i++) { if (i >= o) break; s += a * n2(p); n += a; p = M2 * p * 2.02; a *= 0.5; } return s / n; }
    float ridged(vec2 p, int o) { float s = 0.0, a = 0.5, w = 1.0; for (int i = 0; i < 10; i++) { if (i >= o) break; float n = 1.0 - abs(n2(p) * 2.0 - 1.0); n *= n; s += a * n * w; w = clamp(n * 1.8, 0.0, 1.0); p = M2 * p * 2.03; a *= 0.5; } return s; }
    float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    bool water() { return uEnv == 0 || uEnv == 3 || uEnv == 4; }

    float terrain(vec2 p, int o) {
      if (uEnv == 0) { vec2 q = p / 4200.0; float w = fbm(q * 0.35 + 3.1, 3); float n = fbm(q + vec2(w, -w) * 1.7, o);
        float h = (n - 0.56) * 3600.0; h = h > 0.0 ? h * (0.3 + 0.7 * smoothstep(0.0, 800.0, h)) : h * 0.5; return max(h, -140.0); }
      if (uEnv == 1) { float hills = 520.0 * fbm(p / 5200.0, o < 6 ? o : 6);
        vec2 q = p / 150.0; float w = fbm(q * 0.3, 3); float c = fbm(q + w * 2.0, o < 6 ? o : 6);
        float pill = smoothstep(0.565, 0.6, c) * smoothstep(0.3, 0.55, fbm(p / 2600.0, 3));
        float top = 170.0 + 260.0 * fbm(p / 900.0, 3);
        return hills + pill * top * (0.92 + 0.08 * fbm(p / 25.0, 2)); }
      if (uEnv == 2) { vec2 q = p / 9000.0; float w = fbm(q * 0.5, 3);
        return 300.0 + 4300.0 * ridged(q + w * 0.9, o) * (0.3 + 0.7 * smoothstep(0.35, 0.65, fbm(q * 0.25, 3))) + 260.0 * fbm(q * 4.0, 3); }
      if (uEnv == 3) {
        float phase=p.x*6.2831853/14000.0;
        float centre=1300.0*sin(phase)+350.0*sin(2.0*phase);
        float d=abs(p.y-centre);float q=clamp(d/108.0,0.0,1.0);
        float h=-12.0+10.0*q*q+8.0*smoothstep(100.0,126.0,d);
        float wall=d+(fbm(p/60.0,3)-.5)*20.0*smoothstep(135.0,200.0,d);
        h+=54.0*smoothstep(126.0,200.0,wall)+125.0*smoothstep(200.0,240.0,wall);
        h+=14.0*smoothstep(240.0,274.0,wall)+125.0*smoothstep(274.0,328.0,wall);
        return h+8.0*(fbm(p/260.0,3)-.5)*smoothstep(145.0,350.0,d);
      }
      vec2 q = p / 5200.0; return max((fbm(q, o < 7 ? o : 7) - 0.63) * 4200.0, -200.0);
    }
    int octaves(float t) { return int(clamp(9.5 - log2(1.0 + t / 900.0) * 1.15, 3.0, 9.0)); }
    float surf(vec2 p, int o, float drop) { float h = terrain(p, o); if (water()) h = max(h, 0.0); return h - drop; }
    float marchTerrain(vec3 ro, vec3 rd, float tmax) {
      float t = 0.0, hr = length(rd.xz);
      if (ro.y > uHmax) { if (rd.y >= -1e-4) return -1.0; t = (ro.y - uHmax) / -rd.y; }
      float k = uEnv == 1 ? 0.28 : 0.45, tp = t;
      for (int i = 0; i < 400; i++) {
        if (i >= uTSteps || t > tmax) break;
        vec3 p = ro + rd * t; float dr = t * hr; float d = p.y - surf(p.xz, octaves(t), dr * dr / 1.2742e7);
        if (d < 0.0012 * t + 0.3) {
          float a = tp, b = t;
          for (int j = 0; j < 5; j++) { float m = 0.5 * (a + b); vec3 q = ro + rd * m; float dm = m * hr; if (q.y - surf(q.xz, octaves(m), dm * dm / 1.2742e7) < 0.0) b = m; else a = m; }
          return 0.5 * (a + b);
        }
        tp = t; t += max(d * k, 1.0 + t * 0.0016);
      }
      return -1.0;
    }
    vec3 terrainNormal(vec2 p, float t) { int o = octaves(t) + 1; float e = max(1.5, t * 0.0015);
      return normalize(vec3(terrain(p - vec2(e, 0), o) - terrain(p + vec2(e, 0), o), 2.0 * e, terrain(p - vec2(0, e), o) - terrain(p + vec2(0, e), o))); }

    vec2 skyUV(vec3 d) { float el = asin(clamp(d.y, -1.0, 1.0)); return vec2(atan(d.z, d.x) / 6.2831853 + 0.5, 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5707963)); }
    vec3 sky(vec3 d) { vec3 c = texture2D(uSky, skyUV(d)).rgb; float g = dot(c, vec3(0.3, 0.55, 0.15));
      return mix(c, vec3(g) * vec3(0.93, 0.97, 1.04), uOvercast * 0.85) * (1.0 - 0.5 * uOvercast) + vec3(0.0006, 0.0009, 0.0018) * uNight; }
    vec3 fogColor(vec3 rd) { vec3 d = normalize(vec3(rd.x, max(rd.y, 0.015), rd.z)); float s = max(dot(d, uLight), 0.0);
      return sky(d) + uLightCol * 0.035 * pow(s, 8.0) * (1.0 - uOvercast); }
    float odExp(float y0, float ry, float t, float H) {   // optical depth of an exponential layer along a ray
      float y1 = max(y0 + t * ry, -300.0);
      if (abs(ry) < 1e-3) return exp(-clamp(y0, -300.0, 1e5) / H) * t;
      return H * (exp(-max(y0, -300.0) / H) - exp(-y1 / H)) / ry * (ry < 0.0 ? 1.0 : 1.0);
    }
    float fogAmount(vec3 ro, vec3 rd, float t) {
      float od = odExp(ro.y, rd.y, t, 1400.0) / uHaze;
      if (uFog > 0.0) od += uFog * 3.2e-3 * odExp(ro.y, rd.y, t, 280.0);
      return 1.0 - exp(-max(od, 0.0));
    }

    float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
    float cloudD(vec3 p, bool det) {
      float hf = (p.y - uCB) / (uCT - uCB); if (hf < 0.0 || hf > 1.0) return 0.0;
      vec3 q = p + vec3(uTime * 7.0, 0.0, uTime * 2.0);
      float cov = clamp(uCover + (fbm(q.xz / 16000.0, 3) - 0.5) * 0.9, 0.0, 1.0);
      float grad = smoothstep(0.0, 0.1 + 0.1 * uFlat, hf) * smoothstep(1.0, mix(0.45, 0.8, uFlat), hf);
      float d = remap(texture(uN3, q / uCScale).r * grad, 1.0 - cov, 1.0, 0.0, 1.0);
      if (d <= 0.0) return 0.0;
      if (det) d = remap(d, texture(uN3d, q / (uCScale * 0.16)).r * 0.42 * (1.0 - 0.5 * hf), 1.0, 0.0, 1.0);
      return clamp(d, 0.0, 1.0) * uDens;
    }
    float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }
    vec4 clouds(vec3 ro, vec3 rd, float tEnd, float jit) {
      float tb = (uCB - ro.y) / rd.y, tt = (uCT - ro.y) / rd.y, t0 = min(tb, tt), t1 = max(tb, tt);
      if (ro.y > uCB && ro.y < uCT) { t0 = 0.0; t1 = rd.y > 0.0 ? tt : (rd.y < 0.0 ? tb : 60000.0); }
      if (abs(rd.y) < 1e-5 && (ro.y < uCB || ro.y > uCT)) return vec4(0, 0, 0, 1);
      t0 = max(t0, 0.0); t1 = min(min(t1, tEnd), t0 + 70000.0);
      if (t1 <= t0 || t0 > 150000.0) return vec4(0, 0, 0, 1);
      float N = float(uCSteps), dt = (t1 - t0) / N, t = t0 + dt * jit, sig = 0.045, Tr = 1.0, tw = 0.0, wsum = 0.0;
      float mu = dot(rd, uLight), ph = mix(hg(mu, 0.78), hg(mu, -0.25), 0.35) * 4.0 * 3.14159;
      vec3 S = vec3(0.0), skyUp = sky(vec3(0, 1, 0)) * 1.3, skyDn = sky(vec3(0.3, -0.1, 0.0)) * 0.7;
      for (int i = 0; i < 160; i++) {
        if (i >= uCSteps) break;
        vec3 p = ro + rd * t; float d = cloudD(p, true);
        if (d > 0.003) {
          float od = 0.0, ls = 25.0;
          for (int j = 0; j < 5; j++) { od += cloudD(p + uLight * ls * (float(j) + 0.5), j < 2) * ls; ls *= 1.8; }
          float hf = (p.y - uCB) / (uCT - uCB), beer = max(exp(-sig * od), 0.65 * exp(-sig * 0.22 * od));
          float powder = 1.0 - 0.55 * exp(-sig * d * 180.0);
          vec3 Li = uLightCol * ph * beer * powder + mix(skyDn, skyUp, hf) * (0.45 + 0.55 * hf);
          float st = sig * d, Ts = exp(-st * dt);
          S += Tr * Li * (1.0 - Ts); Tr *= Ts; tw += t * (1.0 - Ts); wsum += 1.0 - Ts;
          if (Tr < 0.015) break;
        }
        t += dt;
      }
      float tm = wsum > 0.0 ? tw / wsum : t0, f = fogAmount(ro, rd, tm);
      S = S * (1.0 - f) + fogColor(rd) * (1.0 - Tr) * f;
      return vec4(S, Tr);
    }
    float cloudShadow(vec3 p) {
      if (uLight.y <= 0.02 || uCover <= 0.01) return 1.0;
      float mid = 0.5 * (uCB + uCT); if (p.y > mid) return 1.0;
      vec3 q = p + uLight * ((mid - p.y) / uLight.y);
      return mix(0.45, 1.0, exp(-cloudD(q, true) * (uCT - uCB) * 0.02 / uLight.y));
    }
    float softShadow(vec3 p, vec3 l) {
      if (l.y <= 0.0) return 0.0; float t = 8.0, s = 1.0;
      for (int i = 0; i < 18; i++) { vec3 q = p + l * t; float h = q.y - terrain(q.xz, 5); s = min(s, 10.0 * h / t); if (s < 0.02) break; t *= 1.45; }
      return clamp(s, 0.0, 1.0);
    }
    vec3 material(vec3 p, vec3 n, float h) {
      float nz = fbm(p.xz / 35.0, 3), steep = 1.0 - n.y;
      vec3 c;
      if (uEnv == 0 || uEnv == 4) { c = mix(vec3(0.08, 0.2, 0.05), vec3(0.18, 0.28, 0.08), nz); c = mix(c, vec3(0.34, 0.3, 0.25), smoothstep(0.4, 0.62, steep));
        c = mix(vec3(0.78, 0.7, 0.52), c, smoothstep(3.0, 14.0, h + nz * 8.0)); }
      else if (uEnv == 1) { c = mix(vec3(0.07, 0.18, 0.06), vec3(0.16, 0.26, 0.09), nz); c = mix(c, mix(vec3(0.42, 0.36, 0.3), vec3(0.58, 0.5, 0.4), fbm(vec2(p.x + p.z, p.y) / 18.0, 3)), smoothstep(0.35, 0.55, steep)); }
      else if (uEnv == 2) { c = mix(vec3(0.16, 0.24, 0.09), vec3(0.3, 0.29, 0.27), smoothstep(900.0, 1800.0, h + nz * 300.0));
        c = mix(c, vec3(0.26, 0.25, 0.24), smoothstep(0.3, 0.5, steep));
        float snow = smoothstep(2300.0, 2700.0, h + nz * 500.0) * smoothstep(0.45, 0.3, steep); c = mix(c, vec3(0.92, 0.94, 0.98), snow); }
      else { c=mix(vec3(.53,.45,.39),vec3(.70,.61,.50),nz);
        float grain=fbm(vec2(p.x+p.z,h)*.22,4),bed=pow(.5+.5*sin(h*1.6+fbm(p.xz/40.0,3)*2.0),10.0);
        c*=.72+.44*grain-.15*bed;c=mix(c,vec3(.71,.65,.54),smoothstep(12.0,2.0,h)); }
      c = mix(c, vec3(0.9, 0.92, 0.96), uSnow * smoothstep(0.5, 0.25, steep));
      return c * (1.0 - 0.35 * uWet);
    }
    vec3 shade(vec3 ro, vec3 rd, float t) {
      vec3 p = ro + rd * t; float h = terrain(p.xz, octaves(t));
      vec3 skyA = sky(vec3(0, 1, 0)) * 2.4;
      if (water() && h < 0.4) {   // ocean
        float fade = exp(-t / 9000.0), e = 0.5;
        vec2 w1 = p.xz / 41.0 + uTime * vec2(0.05, 0.03), w2 = p.xz / 13.0 - uTime * vec2(0.06, 0.08);
        float hx = (n2(w1 + vec2(e, 0)) - n2(w1 - vec2(e, 0))) * 0.7 + (n2(w2 + vec2(e, 0)) - n2(w2 - vec2(e, 0))) * 0.3;
        float hz = (n2(w1 + vec2(0, e)) - n2(w1 - vec2(0, e))) * 0.7 + (n2(w2 + vec2(0, e)) - n2(w2 - vec2(0, e))) * 0.3;
        vec3 n = normalize(vec3(-hx * 0.35 * fade, 1.0, -hz * 0.35 * fade)), r = reflect(rd, n);
        float fr = 0.02 + 0.98 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
        float depth = max(-h, 0.0), cs = cloudShadow(p);
        vec3 body = mix(vec3(0.06, 0.42, 0.42), mix(vec3(0.004, 0.03, 0.06),vec3(.008,.12,.14),float(uEnv==3)), smoothstep(0.0, uEnv==3?10.0:45.0, depth)) * (skyA * 0.35 + uLightCol * max(uLight.y, 0.0) * 0.25 * cs);
        float rough = mix(0.004, 0.035, fade);
        vec3 spec = uLightCol * pow(max(dot(r, uLight), 0.0), 1.0 / rough) * (1.0 / rough) * 0.012 * cs * (1.0 - uOvercast * 0.9);
        vec3 col = mix(body, sky(r) * 0.95, fr) + spec;
        col = mix(col, vec3(0.85) * (skyA * 0.3 + uLightCol * 0.25), smoothstep(1.4, 0.2, depth) * 0.6);   // surf on the shore
        return col;
      }
      vec3 n = terrainNormal(p.xz, t), alb = material(p, n, h);
      float dif = max(dot(n, uLight), 0.0), sh = dif > 0.0 && t < 30000.0 ? softShadow(p + n * 2.0, uLight) : 1.0;
      vec3 amb = skyA * (0.55 + 0.45 * n.y) + vec3(0.3, 0.26, 0.2) * uLightCol * 0.06 * (1.0 - n.y);
      return alb * (uLightCol * dif * sh * cloudShadow(p) * 0.9 + amb * 0.9);
    }
    vec3 night(vec3 d) {
      vec3 c = vec3(0.0); if (uNight <= 0.0 || d.y < -0.05) return c;
      vec3 q = d * 380.0, i = floor(q); float h = hash3(i);
      if (h > 0.9965) { vec3 ctr = i + 0.5 + (vec3(hash3(i + 7.1), hash3(i + 3.3), hash3(i + 5.7)) - 0.5) * 0.7;
        float s = smoothstep(0.35, 0.0, length(q - ctr)) * (h - 0.9965) / 0.0035; c += vec3(0.9, 0.95, 1.1) * s * 0.06 * (0.7 + 0.3 * sin(uTime * 3.0 + h * 90.0)); }
      float m = dot(d, uMoon); c += vec3(1.0, 0.97, 0.9) * smoothstep(0.99975, 0.9999, m) * 0.9 + vec3(0.3, 0.35, 0.45) * pow(max(m, 0.0), 300.0) * 0.02;
      return c * uNight * (1.0 - uOvercast);
    }
    void main() {
      vec3 rd = normalize(vDir), ro = uCam;
      float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float tT = marchTerrain(ro, rd, 220000.0);
      vec3 col;
      if (tT > 0.0) col = mix(shade(ro, rd, tT), fogColor(rd), fogAmount(ro, rd, tT));
      else {
        col = sky(rd) + night(rd);
        col += uSunCol * smoothstep(0.99994, 0.99998, dot(rd, uSun)) * (1.0 - uOvercast);
        if (rd.y < 0.0) col = mix(col, fogColor(rd), fogAmount(ro, rd, 220000.0));
      }
      vec4 cl = clouds(ro, rd, tT > 0.0 ? tT : 1e9, jit);
      col = col * cl.a + cl.rgb;
      if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
      gl_FragColor = vec4(min(col, vec3(30000.0)), 1.0);
    }`;
  const VERT = `varying vec3 vDir; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w * 0.99999; }`;

  /* ---------- places, times, weather ---------- */
  const PLACES = {
    islands: { name: 'Philippine islands', env: 0, hmax: 1500, haze: 42000, clouds: { base: 900, top: 2400, cover: 0.38, dens: 1, scale: 6500, flat: 0 } },
    canyon:  { name: 'Grand Canyon', env: 3, hmax: 900, haze: 60000, clouds: { base: 4200, top: 6200, cover: 0.3, dens: 0.9, scale: 6000, flat: 0.2 } }
  };
  const TIMES = { morning: { name: 'Morning', el: 27, az: 38 }, midday: { name: 'Midday', el: 62, az: -18 }, golden: { name: 'Golden hour', el: 10, az: -32 } };
  const WEATHER = {};

  let renderer, mat, scene, mesh, skyRT, skyMat, skyScene, skyCam, cubeRT, cubeCam, pmrem, envTex = null, noiseN2, cloudTex;
  const state = { place: 'islands', time: 'morning', weather: 'clear', alt: 2000, travelX: 0, travelZ: 0, t: 0, skyKey: '', dirty: true, quality: 1 };
  const out = { sunDir: new T.Vector3(), lightDir: new T.Vector3(), lightColor: new T.Color(), night: 0, exposure: 1, precip: 'none', overcast: 0 };

  function init(r) {
    renderer = r; noiseN2 = noise2D(); cloudTex = cloudNoise();
    skyRT = new T.WebGLRenderTarget(192, 108, { type: T.HalfFloatType, magFilter: T.LinearFilter, minFilter: T.LinearFilter, depthBuffer: false, wrapS: T.RepeatWrapping });
    skyRT.texture.wrapS = T.RepeatWrapping;
    skyMat = new T.ShaderMaterial({ uniforms: { uSun: { value: new T.Vector3() }, uAlt: { value: 0 }, uI: { value: 20 } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `precision highp float; varying vec2 vUv; uniform vec3 uSun; uniform float uAlt, uI; ${ATMO_GLSL}
        void main(){ float az = (vUv.x - 0.5) * 6.2831853, v = vUv.y * 2.0 - 1.0, el = sign(v) * v * v * 1.5707963;
          vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az)); gl_FragColor = vec4(atmo(d, uAlt, uSun, uI), 1.0); }` });
    skyScene = new T.Scene(); skyScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), skyMat)); skyCam = new T.Camera();
    mat = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: T.BackSide, depthWrite: false, depthTest: false,
      uniforms: { uSky: { value: skyRT.texture }, uN2: { value: noiseN2 }, uN3: { value: cloudTex.base }, uN3d: { value: cloudTex.detail },
        uCam: { value: new T.Vector3() }, uSun: { value: new T.Vector3() }, uSunCol: { value: new T.Vector3() }, uLight: { value: new T.Vector3() }, uLightCol: { value: new T.Vector3() },
        uMoon: { value: new T.Vector3() }, uTime: { value: 0 }, uNight: { value: 0 }, uHmax: { value: 1000 }, uHaze: { value: 40000 },
        uCB: { value: 800 }, uCT: { value: 2000 }, uCover: { value: 0.5 }, uDens: { value: 1 }, uCScale: { value: 4000 }, uFlat: { value: 0 },
        uOvercast: { value: 0 }, uFog: { value: 0 }, uSnow: { value: 0 }, uWet: { value: 0 }, uEnv: { value: 4 }, uCSteps: { value: 48 }, uTSteps: { value: 150 } } });
    mesh = new T.Mesh(new T.SphereGeometry(10, 32, 16), mat); mesh.frustumCulled = false;
    scene = new T.Scene(); scene.add(mesh);
    cubeRT = new T.WebGLCubeRenderTarget(64, { type: T.HalfFloatType }); cubeCam = new T.CubeCamera(0.1, 100, cubeRT);
    pmrem = new T.PMREMGenerator(renderer);
  }

  function dirFrom(el, az) { const e = el * Math.PI / 180, a = az * Math.PI / 180; return new T.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)); }

  function setup() {   // uniforms that only change with place/time/weather/altitude
    const P = PLACES[state.place], tm = TIMES[state.time], w = state.weather, u = mat.uniforms, c = { ...P.clouds };
    let overcast = 0, fog = 0, snow = 0, wet = 0, precip = 'none';
    if (w === 'cloudy') { c.cover = Math.max(c.cover, 0.62); c.flat = Math.max(c.flat, 0.3); overcast = 0.25; }
    if (w === 'rain' || w === 'snow') {
      const base = state.alt < 3600 ? Math.min(Math.max(state.alt + 380, 700), 4000) : 900;
      Object.assign(c, { base, top: base + 3200, cover: 0.93, dens: 1.3, scale: 4200, flat: 0.7 });
      overcast = 0.75; wet = w === 'rain' ? 1 : 0; snow = w === 'snow' ? 1 : 0; precip = w;
    }
    if (w === 'fog') { fog = 1; overcast = 0.35; }
    if (P.env === 2) snow = Math.max(snow, 0);
    const sun = dirFrom(tm.el, tm.az), isNight = tm.el < -6;
    const tr = transmittance(state.alt, sun.y), I = 20;
    u.uEnv.value = P.env; u.uHmax.value = P.hmax; u.uHaze.value = P.haze * (w === 'fog' ? 0.25 : w === 'rain' || w === 'snow' ? 0.4 : 1);
    u.uCB.value = c.base; u.uCT.value = c.top; u.uCover.value = c.cover; u.uDens.value = state.weatherEffects===false?0:c.dens; u.uCScale.value = c.scale; u.uFlat.value = c.flat;
    u.uOvercast.value = overcast; u.uFog.value = fog; u.uSnow.value = snow; u.uWet.value = wet;
    u.uSun.value.copy(sun); u.uSunCol.value.set(tr[0] * I * 60, tr[1] * I * 60, tr[2] * I * 60);
    const moon = dirFrom(38, 140); u.uMoon.value.copy(moon); u.uNight.value = isNight ? 1 : 0;
    let lc;
    if (isNight) { u.uLight.value.copy(moon); lc = [0.028, 0.034, 0.05]; }
    else { u.uLight.value.copy(sun); const k = 1.9 * (1 - overcast * 0.8); lc = tr.map(v => v * k * Math.min(1, Math.max(0, sun.y * 12 + 0.15))); }
    u.uLightCol.value.set(lc[0], lc[1], lc[2]);
    skyMat.uniforms.uSun.value.copy(sun); skyMat.uniforms.uAlt.value = Math.min(state.alt, 30000); skyMat.uniforms.uI.value = I;
    renderer.setRenderTarget(skyRT); renderer.render(skyScene, skyCam); renderer.setRenderTarget(null);
    out.sunDir.copy(sun); out.lightDir.copy(u.uLight.value); out.lightColor.setRGB(lc[0], lc[1], lc[2]);
    out.night = isNight ? 1 : 0; out.precip = precip; out.overcast = overcast;
    out.exposure = isNight ? 9 : tm.el < 6 ? 1.6 : 1.0;
    state.dirty = false; state.captureDue = true;
  }

  function set(k, v) { state[k] = v; state.dirty = true; }
  function update(dt, cam, alt, V) {
    const altKey = Math.round(alt / 400);
    if (altKey !== state.altKey) { state.altKey = altKey; state.alt = alt; state.dirty = true; }
    state.alt = alt;
    if (state.dirty) setup();
    state.t += dt; state.travelX += V * dt;
    if (state.travelX > 4e5) state.travelX -= 4e5;   // keep shader coordinates precise
    const u = mat.uniforms;
    u.uTime.value = state.t;
    u.uCam.value.set(cam.position.x + state.travelX, cam.position.y + alt, cam.position.z + state.travelZ);
    mesh.position.copy(cam.position);
  }
  function render(target, cam) {
    const u = mat.uniforms, q = state.quality;
    u.uCSteps.value = Math.round(20 + 44 * q); u.uTSteps.value = Math.round(90 + 110 * q);
    renderer.setRenderTarget(target); renderer.render(scene, cam); renderer.setRenderTarget(null);
  }
  function capture() {   // reflections for the aircraft
    if (!state.captureDue) return envTex;
    state.captureDue = false;
    const u = mat.uniforms, keep = u.uCam.value.clone(), q = state.quality;
    u.uCSteps.value = 24; u.uTSteps.value = 80;
    mesh.position.set(0, 0, 0); cubeCam.position.set(0, 0, 0);
    cubeCam.update(renderer, scene);
    if (envTex) envTex.dispose();
    envTex = pmrem.fromCubemap(cubeRT.texture).texture;
    u.uCam.value.copy(keep); state.quality = q;
    return envTex;
  }
  return { init, set, update, render, capture, state, out, PLACES, TIMES, WEATHER, get dirtyCapture() { return state.captureDue; } };
})();
