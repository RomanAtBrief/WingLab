/* ================= Profile: 2D wing section with panel-method airflow ================= */
const Profile = (() => {
  const TAU = Math.PI * 2;
  let cv, ctx, Wpx = 0, Hpx = 0, dpr = 1, scale = 1, x0 = -1, y0 = 0, Wc = 2.6, Hc = 1.2;
  let sol = null, lines = [], fieldCv = null, wake = null, eddies = [], key = '', pending = false;
  const opts = { flow: true, field: true, arrows: false };
  let vis = null, colors = {};

  /* ---- Hess–Smith panel method: constant sources + one uniform vortex, Kutta condition ---- */
  function solve(foil, aDeg) {
    const n = 34, { up, lo } = Aero.naca(foil, n), pts = [];
    for (let i = n; i >= 0; i--) pts.push(lo[i]);
    for (let i = 1; i <= n; i++) pts.push(up[i]);
    const a = aDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const P = pts.map(([x, y]) => [(x - 0.25) * ca + y * sa, -(x - 0.25) * sa + y * ca]);
    const N = P.length - 1;
    const X1 = new Float64Array(N), Y1 = new Float64Array(N), L = new Float64Array(N), TX = new Float64Array(N),
      TY = new Float64Array(N), NX = new Float64Array(N), NY = new Float64Array(N), MX = new Float64Array(N), MY = new Float64Array(N),
      XC = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      const [ax, ay] = P[j], [bx, by] = P[j + 1], l = Math.hypot(bx - ax, by - ay);
      X1[j] = ax; Y1[j] = ay; L[j] = l; TX[j] = (bx - ax) / l; TY[j] = (by - ay) / l; NX[j] = -TY[j]; NY[j] = TX[j];
      MX[j] = (ax + bx) / 2; MY[j] = (ay + by) / 2;
      XC[j] = 0.5 * (pts[j][0] + pts[j + 1][0]);
    }
    const inf = new Float64Array(4);
    function infl(j, px, py) {
      const dx = px - X1[j], dy = py - Y1[j];
      const xl = dx * TX[j] + dy * TY[j], yl = dx * NX[j] + dy * NY[j], l = L[j];
      const lg = 0.5 * Math.log((xl * xl + yl * yl) / ((xl - l) * (xl - l) + yl * yl)) / TAU;
      const th = (Math.atan2(yl, xl - l) - Math.atan2(yl, xl)) / TAU;
      inf[0] = lg * TX[j] + th * NX[j]; inf[1] = lg * TY[j] + th * NY[j];     // source (u, v)
      inf[2] = th * TX[j] - lg * NX[j]; inf[3] = th * TY[j] - lg * NY[j];     // vortex (u, v)
    }
    const M = N + 1, A = [], B = new Float64Array(M), At = [], Bt = new Float64Array(N);
    for (let i = 0; i < M; i++) A.push(new Float64Array(M));
    for (let i = 0; i < N; i++) {
      const rowT = new Float64Array(M);
      for (let j = 0; j < N; j++) {
        if (i === j) { inf[0] = 0.5 * NX[j]; inf[1] = 0.5 * NY[j]; inf[2] = 0.5 * TX[j]; inf[3] = 0.5 * TY[j]; }
        else infl(j, MX[i], MY[i]);
        A[i][j] = inf[0] * NX[i] + inf[1] * NY[i];
        A[i][N] += inf[2] * NX[i] + inf[3] * NY[i];
        rowT[j] = inf[0] * TX[i] + inf[1] * TY[i];
        rowT[N] += inf[2] * TX[i] + inf[3] * TY[i];
      }
      B[i] = -NX[i]; Bt[i] = TX[i]; At.push(rowT);
    }
    for (let j = 0; j <= N; j++) A[N][j] = At[0][j] + At[N - 1][j];
    B[N] = -(TX[0] + TX[N - 1]);
    // Gaussian elimination with partial pivoting
    for (let k = 0; k < M; k++) {
      let piv = k;
      for (let i = k + 1; i < M; i++) if (Math.abs(A[i][k]) > Math.abs(A[piv][k])) piv = i;
      [A[k], A[piv]] = [A[piv], A[k]]; [B[k], B[piv]] = [B[piv], B[k]];
      for (let i = k + 1; i < M; i++) {
        const f = A[i][k] / A[k][k];
        if (f === 0) continue;
        for (let j = k; j < M; j++) A[i][j] -= f * A[k][j];
        B[i] -= f * B[k];
      }
    }
    const x = new Float64Array(M);
    for (let i = M - 1; i >= 0; i--) { let s = B[i]; for (let j = i + 1; j < M; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
    const q = x.subarray(0, N), g = x[N];
    const Cp = new Float64Array(N);
    let per = 0;
    for (let i = 0; i < N; i++) {
      let vt = Bt[i];
      for (let j = 0; j < N; j++) vt += At[i][j] * q[j];
      vt += At[i][N] * g;
      Cp[i] = 1 - vt * vt; per += L[i];
    }
    function vel(px, py) {
      let u = 1, v = 0;
      for (let j = 0; j < N; j++) { infl(j, px, py); u += q[j] * inf[0] + g * inf[2]; v += q[j] * inf[1] + g * inf[3]; }
      return [u, v];
    }
    function inside(px, py) {
      let c = false;
      for (let i = 0, j = N - 1; i < N; j = i++) {
        const yi = P[i][1], yj = P[j][1];
        if ((yi > py) !== (yj > py) && px < (P[j][0] - P[i][0]) * (py - yi) / (yj - yi) + P[i][0]) c = !c;
      }
      return c;
    }
    let cpMin = 0; for (let i = n; i < N; i++) cpMin = Math.min(cpMin, Cp[i]);
    return { P, pts, N, n, MX, MY, NX, NY, TX, TY, XC, Cp, Cl: 2 * g * per, vel, inside, vmax: Math.sqrt(Math.max(0, 1 - cpMin)) };
  }

  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(px - ax - t * vx, py - ay - t * vy);
  }

  function pointInPoly(poly, px, py) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /* ---- Recompute flow field, streamlines and stall wake ---- */
  function recompute() {
    pending = false;
    if (!vis || !Wpx) return;
    const s = solve(vis.foil, vis.alpha);
    sol = s;
    const LE = s.P[s.n], TE = s.P[0];
    // separation (trailing-edge stall creeps forward; thin sections stall from the leading edge)
    wake = null;
    if (vis.sepX < 0.98) {
      const up = s.P.slice(s.n);                   // LE → TE along upper surface
      let k = 0;
      for (let i = 0; i < up.length; i++) if (s.pts[s.n + i][0] <= vis.sepX) k = i;
      const S0 = up[k], len = 2.6, spread = 0.1 + 0.35 * (1 - vis.sepX);
      const poly = [];
      for (let i = up.length - 1; i >= k; i--) poly.push(up[i]);
      const lift = Math.max(0.03, S0[1] - TE[1]);
      for (let i = 0; i <= 14; i++) { const d = len * i / 14; poly.push([S0[0] + d, S0[1] + 0.02 + spread * d * 0.55 * (1 - Math.exp(-d * 2))]); }
      for (let i = 14; i >= 0; i--) { const d = len * i / 14 + (S0[0] - TE[0]); poly.push([TE[0] + Math.max(0, d), TE[1] - 0.12 * Math.max(0, d) * spread]); }
      wake = { poly, S0, strength: Math.min(1, lift * 3 + (1 - vis.sepX)) };
      for (let i = 0; i < s.N; i++) if (i >= s.n && s.XC[i] > vis.sepX) s.Cp[i] = s.Cp[s.n + k] * 0.9;
      if (eddies.length === 0) for (let i = 0; i < 16; i++) eddies.push({ p: Math.random(), r: Math.random(), s: 0.6 + Math.random() * 0.8 });
    }
    // pressure field on a coarse grid
    const nx = 88, ny = Math.max(24, Math.round(nx * Hc / Wc));
    fieldCv = fieldCv || document.createElement('canvas');
    fieldCv.width = nx; fieldCv.height = ny;
    const fctx = fieldCv.getContext('2d'), img = fctx.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const px = x0 + (i + 0.5) / nx * Wc, py = y0 + Hc / 2 - (j + 0.5) / ny * Hc;
      let cp = 0;
      if (!s.inside(px, py)) { const [u, v] = s.vel(px, py); cp = 1 - (u * u + v * v); }
      if (wake && pointInPoly(wake.poly, px, py)) cp = cp * 0.25 - 0.25;
      const c = cpColor(cp), o = (j * nx + i) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    fctx.putImageData(img, 0, 0);
    // streamlines: traced with RK2, adaptive step, time recorded for pulses
    lines = [];
    const nL = 12;
    for (let k = 0; k < nL; k++) {
      let x = x0 - 0.02, y = y0 - Hc / 2 * 1.05 + (k + 0.5) / nL * Hc * 1.05, t = 0;
      const X = [x], Y = [y], T = [0], hid = [0];
      for (let step = 0; step < 900 && x < x0 + Wc + 0.05; step++) {
        const d = Math.max(0.002, segDist(x, y, LE[0], LE[1], TE[0], TE[1]) - 0.05);
        const ds = Math.max(0.004, Math.min(0.04, 0.35 * d));
        const [u1, v1] = s.vel(x, y), s1 = Math.hypot(u1, v1) || 1e-6;
        const xm = x + 0.5 * ds * u1 / s1, ym = y + 0.5 * ds * v1 / s1;
        const [u2, v2] = s.vel(xm, ym), s2 = Math.hypot(u2, v2) || 1e-6;
        if (s2 < 0.01) break;
        let nx2 = x + ds * u2 / s2, ny2 = y + ds * v2 / s2;
        if (s.inside(nx2, ny2)) {   // nudge back out along the nearest panel normal
          let best = 0, bd = 1e9;
          for (let i = 0; i < s.N; i++) { const dd = (s.MX[i] - nx2) ** 2 + (s.MY[i] - ny2) ** 2; if (dd < bd) { bd = dd; best = i; } }
          nx2 = s.MX[best] + s.NX[best] * 0.006 + s.TX[best] * 0.004; ny2 = s.MY[best] + s.NY[best] * 0.006 + s.TY[best] * 0.004;
        }
        t += ds / s2; x = nx2; y = ny2;
        X.push(x); Y.push(y); T.push(t); hid.push(wake && pointInPoly(wake.poly, x, y) ? 1 : 0);
      }
      lines.push({ X, Y, T, hid });
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(recompute, 30);
  }

  function hex(c) { c = c.trim(); if (c[0] === '#') { const v = parseInt(c.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; } return [128, 128, 128]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function cpColor(cp) {
    if (cp < 0) { const t = Math.min(1, -cp / 1.6); return mix(colors.mid, colors.lo, Math.pow(t, 0.7)); }
    const t = Math.min(1, cp); return mix(colors.mid, colors.hi, Math.pow(t, 0.8));
  }
  function readColors() {
    const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
    colors = { mid: hex(g('--cp-mid')), lo: hex(g('--cp-lo')), hi: hex(g('--cp-hi')), ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'),
      line: g('--line'), lift: g('--lift'), drag: g('--drag'), bad: g('--bad'), foilA: g('--foil-a'), foilB: g('--foil-b'),
      streak: g('--streak'), accent: g('--accent') };
  }

  function layout() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    Wpx = Math.max(10, r.width); Hpx = Math.max(10, r.height);
    cv.width = Math.round(Wpx * dpr); cv.height = Math.round(Hpx * dpr);
    Wc = Math.max(2.1, Math.min(3.4, Wpx / Hpx * 1.15));
    scale = Wpx / Wc; Hc = Hpx / scale; x0 = -0.9; y0 = 0.02;
    key = ''; schedule();
  }

  const sx = x => (x - x0) * scale, sy = y => (y0 + Hc / 2 - y) * scale;

  function arrow(x1, y1, x2, y2, color, w = 2, head = 8) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(a - 0.42), y2 - head * Math.sin(a - 0.42));
    ctx.lineTo(x2 - head * Math.cos(a + 0.42), y2 - head * Math.sin(a + 0.42)); ctx.closePath(); ctx.fill();
  }

  function posAt(L, t) {
    const T = L.T; if (t <= 0 || t >= T[T.length - 1]) return null;
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m; else hi = m; }
    if (L.hid[lo] || L.hid[hi]) return null;
    const f = (t - T[lo]) / (T[hi] - T[lo] || 1);
    return [L.X[lo] + (L.X[hi] - L.X[lo]) * f, L.Y[lo] + (L.Y[hi] - L.Y[lo]) * f];
  }

  function draw(time) {
    if (!cv || !Wpx || !vis) return;
    const k = `${vis.foil.code}|${vis.alpha.toFixed(1)}|${vis.sepX.toFixed(2)}|${Wpx}x${Hpx}`;
    if (k !== key) { key = k; schedule(); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, Wpx, Hpx);
    const bg = colors.mid;
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`; ctx.fillRect(0, 0, Wpx, Hpx);
    if (!sol) return;
    if (opts.field && fieldCv) { ctx.imageSmoothingEnabled = true; ctx.drawImage(fieldCv, 0, 0, Wpx, Hpx); }

    // stall wake
    if (wake) {
      ctx.save();
      ctx.beginPath(); wake.poly.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)))); ctx.closePath();
      ctx.fillStyle = colors.bad; ctx.globalAlpha = 0.1; ctx.fill(); ctx.globalAlpha = 0.5; ctx.setLineDash([3, 4]);
      ctx.strokeStyle = colors.bad; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      ctx.clip();
      ctx.globalAlpha = 0.55; ctx.strokeStyle = colors.bad; ctx.lineWidth = 1.4;
      const S0 = wake.S0;
      eddies.forEach(e => {
        const u = (e.p + time * 0.00012 * e.s) % 1, d = u * 2.4;
        const cx = sx(S0[0] + 0.06 + d), cy = sy(S0[1] - 0.02 - (e.r - 0.3) * (0.08 + 0.3 * u) * (0.6 + wake.strength));
        const rr = (5 + 16 * u) * (0.5 + e.s * 0.5), ph = -time * 0.004 * e.s;
        ctx.beginPath(); ctx.arc(cx, cy, rr, ph, ph + 4.2); ctx.stroke();
      });
      ctx.restore();
    }

    // streamlines + pulses
    if (opts.flow) {
      ctx.lineWidth = 1; ctx.strokeStyle = colors.ink3; ctx.globalAlpha = 0.45;
      lines.forEach(L => {
        ctx.beginPath(); let pen = false;
        for (let i = 0; i < L.X.length; i++) {
          if (L.hid[i]) { pen = false; continue; }
          const X = sx(L.X[i]), Y = sy(L.Y[i]);
          if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
        }
        ctx.stroke();
      });
      ctx.globalAlpha = 0.75; ctx.strokeStyle = colors.streak; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      const period = 0.3, phase = (time * 0.00032) % period;
      lines.forEach(L => {
        const Tend = L.T[L.T.length - 1];
        for (let t = phase; t < Tend; t += period) {
          const a = posAt(L, t), b = posAt(L, t - 0.05);
          if (!a || !b) continue;
          ctx.beginPath(); ctx.moveTo(sx(b[0]), sy(b[1])); ctx.lineTo(sx(a[0]), sy(a[1])); ctx.stroke();
        }
      });
      ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
    }

    // airfoil
    const P = sol.P;
    ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)))); ctx.closePath();
    const gr = ctx.createLinearGradient(0, sy(0.12), 0, sy(-0.12));
    gr.addColorStop(0, colors.foilA); gr.addColorStop(1, colors.foilB);
    ctx.fillStyle = gr; ctx.fill(); ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.4; ctx.stroke();

    // pressure arrows on the surface
    if (opts.arrows) {
      for (let i = 0; i < sol.N; i += 2) {
        const cp = sol.Cp[i], len = Math.min(0.14, Math.abs(cp) * 0.075) * scale;
        if (len < 2) continue;
        const mx = sx(sol.MX[i]), my = sy(sol.MY[i]), nx = sol.NX[i], ny = -sol.NY[i];
        const col = cp < 0 ? `rgb(${colors.lo.map(v => v * 0.8).join(',')})` : `rgb(${colors.hi.map(v => v * 0.85).join(',')})`;
        if (cp < 0) arrow(mx, my, mx + nx * len, my + ny * len, col, 1.3, 5);
        else arrow(mx + nx * len, my + ny * len, mx, my, col, 1.3, 5);
      }
    }

    // chord line, relative wind and angle of attack
    const LE = P[sol.n], TE = P[0];
    ctx.setLineDash([5, 4]); ctx.strokeStyle = colors.ink2; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx(LE[0] - (TE[0] - LE[0]) * 0.25), sy(LE[1] - (TE[1] - LE[1]) * 0.25)); ctx.lineTo(sx(TE[0] + (TE[0] - LE[0]) * 0.12), sy(TE[1] + (TE[1] - LE[1]) * 0.12)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx(LE[0] - 0.25), sy(LE[1])); ctx.lineTo(sx(LE[0] + 0.62), sy(LE[1])); ctx.stroke();
    ctx.setLineDash([]);
    const aR = vis.alpha * Math.PI / 180, rr = 0.5 * scale;
    ctx.strokeStyle = colors.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx(LE[0]), sy(LE[1]), rr, 0, aR, aR < 0); ctx.stroke();
    ctx.font = '600 12px -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif'; ctx.fillStyle = colors.accent;
    ctx.fillText(`α ${vis.alpha.toFixed(1)}°`, sx(LE[0]) + rr + 6, sy(LE[1]) + (aR >= 0 ? 12 : -4));

    ctx.font = '500 11px -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif'; ctx.fillStyle = colors.ink2;
    const wy = sy(y0 + Hc / 2 - 0.1);
    arrow(10, wy, 10 + 0.3 * scale, wy, colors.ink2, 1.5, 7);
    ctx.fillText('Relative wind', 10, wy - 8);

    // lift and drag on the section (quarter chord)
    const ox = sx(0), oy = sy(0);
    const Lh = Math.max(-0.5, Math.min(0.6, vis.CL * 0.5)) * scale;
    if (Math.abs(Lh) > 4) { arrow(ox, oy, ox, oy - Lh, colors.lift, 3, 11); ctx.fillStyle = colors.ink; ctx.font = '600 12px -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif'; ctx.textAlign = 'right'; ctx.fillText('Lift', ox - 7, oy - Lh + 9); ctx.textAlign = 'left'; }
    const Dl = Math.min(0.6, vis.CD * 0.5 * 5) * scale;
    if (Dl > 4) { arrow(ox, oy, ox + Dl, oy, colors.drag, 3, 10); ctx.fillStyle = colors.ink; ctx.font = '600 12px -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif'; ctx.fillText('Drag ×5', ox + Dl + 4, oy + 16); }

    // plain-language labels
    ctx.font = '500 11px -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
    const topY = Math.min(...P.map(p => sy(p[1]))), botY = Math.max(...P.map(p => sy(p[1])));
    ctx.fillStyle = colors.ink2;
    if (!wake) ctx.fillText('Faster air · lower pressure', sx(0.3), topY - 22);
    ctx.fillText('Slower air · higher pressure', sx(0.05), botY + 30);
    if (wake) {
      ctx.fillStyle = colors.bad; ctx.font = '600 12px -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
      ctx.fillText(vis.stalled ? 'Air breaks away from the top — stall' : 'Air starts to break away near the back', sx(wake.S0[0]) + 4, topY - 26);
    }
  }

  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    readColors();
    new ResizeObserver(layout).observe(cv);
    layout();
  }
  function set(v) { vis = v; }
  function setOpt(k, on) { opts[k] = on; }
  function theme() { readColors(); key = ''; schedule(); }
  return { init, set, draw, setOpt, theme, solve, opts, info: () => (sol ? { vmax: sol.vmax } : null) };
})();
