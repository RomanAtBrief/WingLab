/* ================= Charts: Apple-style lift and drag/thrust charts with hover ================= */
const Charts = (() => {
  let c = {};
  const state = new Map();   // canvas → { kind, data, hover }
  function readColors() {
    const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
    c = { label: g('--label'), label2: g('--label2'), label3: g('--label3'), grid: g('--grid'), surface: g('--glass-strong') || '#fff',
      lift: g('--lift'), drag: g('--drag'), thrust: g('--thrust'), bad: g('--bad'), good: g('--green'), font: g('--font') };
  }
  function prep(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.max(40, r.width), H = Math.max(40, r.height);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
  }
  const nice = (range, n) => { const raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
  const alpha = (col, a) => { const h = col.replace('#', ''); if (h.length < 6) return col; const n = parseInt(h.slice(0, 6), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  function frame(ctx, box, xr, yr, xs, ys, fx, fy) {
    const X = v => box.l + (v - xr[0]) / (xr[1] - xr[0]) * box.w, Y = v => box.t + box.h - (v - yr[0]) / (yr[1] - yr[0]) * box.h;
    ctx.font = `11px ${c.font}`; ctx.lineWidth = 1; ctx.strokeStyle = c.grid; ctx.fillStyle = c.label3;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(yr[0] / ys) * ys; v <= yr[1] + 1e-9; v += ys) { const y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(box.l, y); ctx.lineTo(box.l + box.w, y); ctx.stroke(); ctx.fillText(fy(v), box.l + box.w + 6, y); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = Math.ceil(xr[0] / xs) * xs; v <= xr[1] + 1e-9; v += xs) ctx.fillText(fx(v), X(v), box.t + box.h + 6);
    return { X, Y };
  }
  function line(ctx, pts, X, Y, col, w = 3) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath(); let pen = false;
    for (const p of pts) { if (!p) { pen = false; continue; } const x = X(p[0]), y = Y(p[1]); pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; }
    ctx.stroke();
  }
  function dot(ctx, x, y, col, r = 6.5) { ctx.fillStyle = col; ctx.strokeStyle = c.surface; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  function text(ctx, s, x, y, col, align = 'left', weight = 500, size = 11.5) { ctx.font = `${weight} ${size}px ${c.font}`; ctx.fillStyle = col; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y); }

  function drawLift(cv, d, hov) {
    const { ctx, W, H } = prep(cv), box = { l: 6, t: 8, w: W - 42, h: H - 30 };
    const a0 = d.pts[0].a, a1 = d.pts[d.pts.length - 1].a;
    const ymax = Math.max(...d.pts.map(p => p.CL)) * 1.15, ymin = Math.min(0, ...d.pts.map(p => p.CL));
    const { X, Y } = frame(ctx, box, [a0, a1], [ymin, ymax], nice(a1 - a0, 4), nice(ymax - ymin, 3), v => v.toFixed(0) + '°', v => v.toFixed(1));
    ctx.fillStyle = alpha(c.bad, 0.1); ctx.fillRect(X(d.aTop), box.t, box.l + box.w - X(d.aTop), box.h);
    text(ctx, 'Stall', X(d.aTop) + 6, box.t + 14, c.label2, 'left', 600);
    const att = d.pts.filter(p => p.a <= d.aTop + 1e-6);
    line(ctx, att.map(p => [p.a, p.CL]), X, Y, c.lift);
    line(ctx, d.pts.filter(p => p.a >= d.aTop - 1e-6).map(p => [p.a, p.CL]), X, Y, alpha(c.lift, 0.45));
    const ax = Math.max(a0, Math.min(a1, d.alpha));
    ctx.setLineDash([3,4]);line(ctx,[[ax,ymin],[ax,d.CL]],X,Y,c.label3,1);ctx.setLineDash([]);dot(ctx, X(ax), Y(d.CL), c.lift, 6.5);
    text(ctx, 'you', X(ax), Y(d.CL) - 10, c.label, 'center', 600);
    if (hov != null) {
      const p = d.pts.reduce((b, q) => (Math.abs(q.a - hov) < Math.abs(b.a - hov) ? q : b), d.pts[0]);
      ctx.strokeStyle = c.label3; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(p.a) + 0.5, box.t); ctx.lineTo(X(p.a) + 0.5, box.t + box.h); ctx.stroke();
      dot(ctx, X(p.a), Y(p.CL), c.lift, 4.5);
      return { x: X(p.a), y: Y(p.CL), html: `<b>${p.a.toFixed(1)}°</b> angle<br>lift coefficient <b>${p.CL.toFixed(2)}</b>${p.a > d.aTop ? '<br>stalled' : ''}` };
    }
  }
  function drawDrag(cv, d, hov) {
    const { ctx, W, H } = prep(cv), box = { l: 6, t: 8, w: W - 46, h: H - 30 }, k = d.speedFactor || 3.6, Vmax = d.pts[d.pts.length - 1].V;
    const fly = d.pts.filter(p => !p.stalled && p.D != null);
    const minD = fly.length ? Math.min(...fly.map(p => p.D)) : 1, maxT = d.hasEngine ? Math.max(...d.pts.map(p => p.T)) : 0;
    const ymax = Math.max(minD * 3, d.forceMax || minD * 6) / 1000;
    const { X, Y } = frame(ctx, box, [0, Vmax * k], [0, ymax], nice(Vmax * k, 4), nice(ymax, 3), v => v.toFixed(0), v => (ymax < 5 ? v.toFixed(1) : v.toFixed(0)));
    ctx.save(); ctx.beginPath(); ctx.rect(box.l, box.t, box.w, box.h); ctx.clip();
    ctx.fillStyle = alpha(c.bad, 0.08); ctx.fillRect(box.l, box.t, X(d.Vs * k) - box.l, box.h);
    line(ctx, d.pts.map(p => (p.stalled || p.D == null ? null : [p.V * k, p.D / 1000])), X, Y, c.drag);
    if (d.hasEngine) {ctx.setLineDash([8,5]);line(ctx, d.pts.map(p => [p.V * k, p.T / 1000]), X, Y, c.thrust);ctx.setLineDash([]);}
    ctx.restore();
    text(ctx,'kN',box.l+box.w+6,box.t+4,c.label2);text(ctx,d.speedUnit||'km/h',box.l+box.w, H-2,c.label2,'right');
    // direct labels at the right-hand ends
    const lastD = fly[fly.length - 1], lastT = d.pts[d.pts.length - 1];
    if (lastD && lastD.D / 1000 < ymax) text(ctx, 'drag', box.l + box.w - 4, Y(lastD.D / 1000) - 6, c.label2, 'right', 600);
    if (d.hasEngine && lastT.T / 1000 < ymax) text(ctx, 'thrust', box.l + box.w - 4, Y(lastT.T / 1000) + 14, c.label2, 'right', 600);
    const now = d.pts.reduce((a, p) => (Math.abs(p.V - d.V) < Math.abs(a.V - d.V) ? p : a), d.pts[0]);
    if (now.D != null && !now.stalled && now.D / 1000 < ymax) { dot(ctx, X(d.V * k), Y(now.D / 1000), c.label, 5); text(ctx, 'you', X(d.V * k), Y(now.D / 1000) - 10, c.label, 'center', 600); }
    if (hov != null) {
      const p = d.pts.reduce((b, q) => (Math.abs(q.V * k - hov) < Math.abs(b.V * k - hov) ? q : b), d.pts[0]);
      ctx.strokeStyle = c.label3; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(p.V * k) + 0.5, box.t); ctx.lineTo(X(p.V * k) + 0.5, box.t + box.h); ctx.stroke();
      if (p.D != null && !p.stalled) dot(ctx, X(p.V * k), Y(Math.min(p.D / 1000, ymax)), c.drag, 4.5);
      if (d.hasEngine) dot(ctx, X(p.V * k), Y(Math.min(p.T / 1000, ymax)), c.thrust, 4.5);
      const f = v => (v < 10000 ? (v / 1000).toFixed(2) : (v / 1000).toFixed(v < 100000 ? 1 : 0));
      return { x: X(p.V * k), y: box.t + 10, html: `<b>${Math.round(p.V * k)} ${d.speedUnit || 'km/h'}</b>` + (p.stalled ? '<br>too slow — stalls' : `<br>drag <b>${f(p.D)} kN</b>`) + (d.hasEngine ? `<br>thrust <b>${f(p.T)} kN</b>` : '') };
    }
  }
  function draw(cv) {
    const s = state.get(cv); if (!s || !s.data) return;
    const r = (s.kind === 'lift' ? drawLift : drawDrag)(cv, s.data, s.hover);
    if (s.tip) {
      if (r && s.hover != null) { s.tip.hidden = false; s.tip.innerHTML = r.html; const w = cv.clientWidth, left = r.x + 12 + 130 > w ? r.x - 12 - s.tip.offsetWidth : r.x + 12;
        s.tip.style.left = (cv.offsetLeft + left) + 'px'; s.tip.style.top = (cv.offsetTop + Math.max(0, r.y - 20)) + 'px'; }
      else s.tip.hidden = true;
    }
  }
  function attach(cv, kind) {
    const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; cv.parentElement.appendChild(tip);
    const s = { kind, data: null, hover: null, tip }; state.set(cv, s);
    const move = e => {
      if (!s.data) return; const r = cv.getBoundingClientRect(), x = e.clientX - r.left, w = r.width - (kind === 'lift' ? 42 : 46) - 6;
      const f = Math.max(0, Math.min(1, (x - 6) / w));
      s.hover = kind === 'lift' ? s.data.pts[0].a + f * (s.data.pts[s.data.pts.length - 1].a - s.data.pts[0].a) : f * s.data.pts[s.data.pts.length - 1].V * (s.data.speedFactor || 3.6);
      draw(cv);
    };
    cv.addEventListener('pointermove', move); cv.addEventListener('pointerdown', move);
    cv.addEventListener('pointerleave', () => { s.hover = null; draw(cv); });
  }
  function set(cv, data) { const s = state.get(cv); if (s) { s.data = data; draw(cv); } }
  return { readColors, attach, set, redraw: () => state.forEach((s, cv) => draw(cv)) };
})();
