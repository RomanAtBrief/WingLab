/* ================= Aero: atmosphere, real aircraft, parts, aerodynamics ================= */
const Aero = (() => {
  const G = 9.80665, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /* International Standard Atmosphere, 0–20 km */
  function atmosphere(h) {
    const T0 = 288.15, p0 = 101325, Lr = 0.0065, R = 287.053;
    let T, p;
    if (h <= 11000) { T = T0 - Lr * h; p = p0 * Math.pow(T / T0, G / (Lr * R)); }
    else { T = 216.65; p = 22632.1 * Math.exp(-G * (h - 11000) / (R * T)); }
    const rho = p / (R * T);
    return { T, p, rho, a: Math.sqrt(1.4 * R * T), sigma: rho / 1.225 };
  }

  /* ---------- Parts ---------- */
  const PLANFORMS = {
    rect:      { name: 'Rectangular', kind: 'trap', taper: 1.0, f: 0.25, sweep: 0, AR: 7.3 },
    taperTE:   { name: 'Straight front edge', kind: 'trap', taper: 0.5, f: 0, sweep: 0, AR: 7.8 },
    taperBoth: { name: 'Tapered', kind: 'trap', taper: 0.45, f: 0.5, sweep: 0, AR: 8.2 },
    taperLE:   { name: 'Straight back edge', kind: 'trap', taper: 0.5, f: 1, sweep: 0, AR: 7.8 },
    ellipse:   { name: 'Elliptical', kind: 'ellipse', f: 0.25, AR: 7.8 },
    swept:     { name: 'Swept back', kind: 'trap', taper: 0.28, f: 0, sweep: 33, AR: 8.0 },
    forward:   { name: 'Forward swept', kind: 'trap', taper: 0.4, f: 0.25, sweep: -28, AR: 7.0 },
    delta:     { name: 'Delta', kind: 'trap', taper: 0.04, f: 1, sweep: 0, AR: 2.3, fixedAR: true },
    ogee:      { name: 'Ogee delta', kind: 'ogee', k: 1.5, AR: 1.83, fixedAR: true },
    cranked:   { name: 'Cranked delta', kind: 'cranked', ek: 0.38, ck: 0.42, ct: 0.08, AR: 3.0, fixedAR: true }
  };

  /* NACA sections use published wind-tunnel data (Abbott & von Doenhoff); others are representative */
  const AIRFOILS = {
    plate: { name: 'Flat plate', code: '2 % thick', m: 0, p: 0, t: 0.02, a0: 0, clmax: 0.85, cd0: 0.011, kap: 0.9, korn: 0.87, drop: 0.6, width: 0.7, kLE: 0 },
    thin3: { name: 'Supersonic', code: 'Razor-thin, 3 %', m: 0.006, p: 0.4, t: 0.03, a0: -0.6, clmax: 0.9, cd0: 0.0045, kap: 0.92, korn: 0.87, drop: 0.65, width: 0.8, kLE: 0.45 },
    n0012: { name: 'Symmetric', code: 'NACA 0012', m: 0, p: 0, t: 0.12, a0: 0, clmax: 1.45, cd0: 0.006, kap: 0.95, korn: 0.87, drop: 0.72, width: 1.0, kLE: 0.35 },
    n2213: { name: 'Classic', code: 'NACA 2213', m: 0.02, p: 0.2, t: 0.13, a0: -2.0, clmax: 1.55, cd0: 0.0065, kap: 0.95, korn: 0.87, drop: 0.75, width: 1.1, kLE: 0.35 },
    n2412: { name: 'Cambered', code: 'NACA 2412', m: 0.02, p: 0.4, t: 0.12, a0: -2.1, clmax: 1.6, cd0: 0.0063, kap: 0.96, korn: 0.87, drop: 0.78, width: 1.2, kLE: 0.35 },
    n4415: { name: 'High-lift', code: 'NACA 4415', m: 0.04, p: 0.4, t: 0.15, a0: -4.1, clmax: 1.7, cd0: 0.0074, kap: 0.97, korn: 0.87, drop: 0.82, width: 1.5, kLE: 0.4 },
    lam:   { name: 'Laminar', code: 'Glider section, 14 %', m: 0.035, p: 0.5, t: 0.14, a0: -3.8, clmax: 1.5, cd0: 0.0045, kap: 0.98, korn: 0.87, drop: 0.8, width: 1.3, kLE: 0.4 },
    sc:    { name: 'Supercritical', code: 'Flat-top, 11 %', m: 0.012, p: 0, t: 0.11, a0: -2.3, clmax: 1.55, cd0: 0.0058, kap: 0.96, korn: 0.95, drop: 0.76, width: 1.1, kLE: 0.35, aft: true }
  };

  const POSITIONS = {
    parasol: { name: 'Parasol', roll: 4, k: 0.05 },
    high:    { name: 'High', roll: 3, k: 0.01 },
    mid:     { name: 'Middle', roll: 0, k: 0 },
    low:     { name: 'Low', roll: -3, k: 0.015 }
  };

  const DIHEDRALS = {
    anhedral:   { name: 'Down', inner: -4, outer: -4, split: 0.3 },
    flat:       { name: 'Flat', inner: 0, outer: 0, split: 0.3 },
    dihedral:   { name: 'Up', inner: 5, outer: 5, split: 0.3 },
    polyhedral: { name: 'Tips up', inner: 0, outer: 12, split: 0.68 },
    gull:       { name: 'Gull', inner: 14, outer: 2, split: 0.32 },
    invgull:    { name: 'Inverted gull', inner: -13, outer: 9, split: 0.32 }
  };

  const gagg = s => Math.max(0, s - (1 - s) / 7.55);          // Gagg–Ferrar piston power lapse
  const ENGINES = {
    none:      { name: 'No engine', kind: 'none' },
    piston:    { name: 'Piston + propeller', kind: 'prop', eta: 0.8, nPerKW: 19, mLo: 0.62, mHi: 0.92, lapse: gagg },
    turboprop: { name: 'Turboprop', kind: 'prop', eta: 0.85, nPerKW: 15, mLo: 0.65, mHi: 0.95, lapse: s => Math.pow(s, 0.75) },
    turbofan:  { name: 'Turbofan', kind: 'jet', lapse: (s, M) => Math.pow(s, 0.75) * Math.max(0.2, 1 - 0.49 * Math.sqrt(M)) },
    turbojet:  { name: 'Jet + afterburner', kind: 'jet', ab: 1.5,
      lapse: (s, M) => { const m = Math.min(M, 2.1); return Math.pow(s, 0.8) * (1 + 0.12 * m + 0.2 * m * m) * (1 - 0.9 * sstep(2.15, 2.7, M)); } },
    superfan:  { name: 'Supersonic turbofan', kind: 'jet',
      lapse: (s, M) => { const m = Math.min(M, 1.9); return Math.pow(s, 0.8) * (1 + 0.08 * m + 0.17 * m * m) * (1 - 0.9 * sstep(1.95, 2.4, M)); } }
  };

  /* ---------- The seven real aircraft (published data; ~ marks our estimates) ---------- */
  const AIRCRAFT = {
    stearman: { name: 'Boeing-Stearman 75', short: 'Stearman', year: 1934, role: 'Biplane trainer',
      blurb: 'The “Kaydet” trained most American pilots of the 1940s. Two short wings braced by struts and wires give lots of lift at low speed.',
      mass: 1150, S: 27.7, span: 9.80, L: 7.54, W: 0.86, H: 2.95,
      cfg: { planform: 'rect', airfoil: 'n2213', position: 'mid', wings: 2, engine: 'piston' },
      dihedral: { inner: 2.5, outer: 2.5, split: 0.3 }, biplane: { gap: 1.55, stagger: 0.45 },
      engine: { type: 'piston', n: 1, P: 164, m: 200, f: 0.16, eta: 0.72, blades: 2, R: 1.32, mount: 'nose', radial: true },
      fusF: 0.42, bodyWave: 0.4, xcg: 2.3, acOff: 0.0, tail: { S: 3.3, AR: 3.2, x: 6.9, sweep: 5, Sv: 1.2 },
      start: { V: 42, h: 800, thr: 0.85 }, vTop: 75, vScan: 110, hMax: 5000,
      facts: { Engine: 'Continental R-670 radial, 220 hp', Top: '200 km/h', Ceiling: '4,000 m' } },
    spitfire: { name: 'Supermarine Spitfire IX', short: 'Spitfire', year: 1942, role: 'Fighter',
      blurb: 'Its thin elliptical wing makes very little induced drag, and it was twisted so the roots stall before the tips, warning the pilot.',
      mass: 3400, S: 22.48, span: 11.23, L: 9.47, W: 0.95, H: 3.86,
      cfg: { planform: 'ellipse', airfoil: 'n2213', position: 'low', wings: 1, engine: 'piston' },
      foilTweak: { t: 0.113, code: 'NACA 2213 → 2209' }, dihedral: { inner: 6, outer: 6, split: 0.3 },
      engine: { type: 'piston', n: 1, P: 1100, m: 750, f: 0.08, eta: 0.82, crit: 7200, blades: 4, R: 1.64, mount: 'nose' },
      fusF: 0.20, bodyWave: 0.4, xcg: 2.9, acOff: 0.0, tail: { S: 2.9, AR: 4.2, x: 8.7, sweep: 8, Sv: 1.2 },
      start: { V: 130, h: 4000, thr: 0.85 }, vTop: 200, vScan: 260, hMax: 13500,
      facts: { Engine: 'Rolls-Royce Merlin 61, 1,565 hp', Top: '657 km/h at 7,600 m', Ceiling: '13,100 m' } },
    ventus: { name: 'Schempp-Hirth Ventus-3M', short: 'Glider', year: 2016, role: 'Glider with fold-away engine',
      blurb: 'An 18-metre racing sailplane. Its long, slender wing glides about 50 metres for every metre it sinks; a small engine folds out of the back to launch it.',
      mass: 480, S: 10.84, span: 18.0, L: 6.63, W: 0.62, H: 1.3,
      cfg: { planform: 'taperBoth', airfoil: 'lam', position: 'mid', wings: 1, engine: 'piston' },
      pfTweak: { taper: 0.36 }, dihedral: { inner: 3, outer: 3, split: 0.3 }, winglets: true, clmaxF: 1.15,
      engine: { type: 'piston', n: 1, P: 40, m: 50, f: 0.10, eta: 0.68, blades: 2, R: 0.72, mount: 'mast', retract: true },
      fusF: 0.026, bodyWave: 0.05, xcg: 2.1, acOff: -0.1, tail: { S: 0.95, AR: 6.5, x: 6.25, sweep: 5, Sv: 0.95, T: true },
      start: { V: 28, h: 1500, thr: 0 }, vTop: 75, vScan: 90, hMax: 6000,
      facts: { Engine: 'Retractable propeller engine, ~40 kW', Glide: 'about 1 : 50', 'Top speed': '280 km/h (never exceed)' } },
    epic: { name: 'Epic E1000 GX', short: 'Epic E1000', year: 2020, role: 'Turboprop',
      blurb: 'A six-seat carbon-fibre turboprop. A gas turbine drives a five-blade propeller, and it cruises high where the air is thin.',
      mass: 3100, S: 18.9, span: 13.11, L: 10.91, W: 1.3, H: 3.8,
      cfg: { planform: 'taperBoth', airfoil: 'n2412', position: 'low', wings: 1, engine: 'turboprop' },
      pfTweak: { taper: 0.5, f: 0.35 }, dihedral: { inner: 5, outer: 5, split: 0.3 }, winglets: true,
      engine: { type: 'turboprop', n: 1, P: 895, m: 250, f: 0.06, eta: 0.85, crit: 6000, blades: 5, R: 1.15, mount: 'nose' },
      fusF: 0.21, bodyWave: 0.4, xcg: 4.2, acOff: -0.14, tail: { S: 4.2, AR: 4.5, x: 10.0, sweep: 12, Sv: 2.6 },
      start: { V: 150, h: 7500, thr: 0.9 }, vTop: 190, vScan: 240, hMax: 11000,
      facts: { Engine: 'Pratt & Whitney PT6A-67A, 1,200 hp', Cruise: '617 km/h', Ceiling: '10,400 m' } },
    b737: { name: 'Boeing 737-800', short: 'Boeing 737', year: 1998, role: 'Airliner',
      blurb: 'The world’s most common airliner type. Its wing is swept back 25° so it can cruise close to the speed of sound.',
      mass: 65000, S: 124.6, span: 35.79, L: 39.47, W: 3.76, H: 12.5,
      cfg: { planform: 'swept', airfoil: 'sc', position: 'low', wings: 1, engine: 'turbofan' },
      pfTweak: { sweep: 28, taper: 0.28 }, dihedral: { inner: 6, outer: 6, split: 0.3 }, winglets: true,
      engine: { type: 'turbofan', n: 2, T: 117, m: 2380, f: 0.45, mount: 'wing2' },
      fusF: 0.8, bodyWave: 2.2, xcg: 17.6, acOff: -0.28, tail: { S: 32.8, AR: 5.0, x: 36.0, sweep: 30, Sv: 26.4 },
      start: { V: 230, h: 11000, thr: 0.85 }, vTop: 290, vScan: 330, hMax: 13000,
      facts: { Engines: '2 × CFM56-7B, 117 kN each', Cruise: 'Mach 0.78', Ceiling: '12,500 m' } },
    concorde: { name: 'Concorde', short: 'Concorde', year: 1976, role: 'Supersonic airliner',
      blurb: 'Flew passengers at twice the speed of sound. Its ogee delta wing makes swirling vortices that keep it flying at steep angles when slow.',
      mass: 135000, S: 358.25, span: 25.6, L: 61.66, W: 2.88, H: 12.2,
      cfg: { planform: 'ogee', airfoil: 'thin3', position: 'low', wings: 1, engine: 'turbojet' },
      dihedral: { inner: 0, outer: 0, split: 0.3 }, tailless: true, kLE: 0.5,
      engine: { type: 'turbojet', n: 4, T: 142, ab: 1.19, m: 3175, f: 0.2, mount: 'concorde' },
      fusF: 1.0, bodyWave: 2.0, xcg: 33.5, acOff: 0.06, tail: { S: 0, AR: 1, x: 58, sweep: 0, Sv: 33.5 },
      start: { V: 580, h: 16500, thr: 1 }, vTop: 700, vScan: 720, hMax: 19000,
      facts: { Engines: '4 × Olympus 593, 142 kN (169 with reheat)', Cruise: 'Mach 2.02 at 18,000 m', Retired: '2003' } },
    overture: { name: 'Boom Overture', short: 'Overture', year: 2029, role: 'Supersonic airliner (in development)',
      blurb: 'A planned supersonic airliner. It aims to cruise at Mach 1.7 without afterburners. It has not flown yet, so these figures are Boom’s design targets and our estimates.',
      mass: 150000, S: 340, span: 32, L: 61, W: 3.2, H: 14,
      cfg: { planform: 'cranked', airfoil: 'thin3', position: 'low', wings: 1, engine: 'superfan' },
      dihedral: { inner: 4, outer: -2, split: 0.38 }, estimate: true, kLE: 0.5,
      engine: { type: 'superfan', n: 4, T: 180, m: 3300, f: 0.2, mount: 'overture' },
      fusF: 1.0, bodyWave: 1.7, xcg: 34, acOff: 0.07, tail: { S: 38, AR: 3, x: 57, sweep: 45, Sv: 30 },
      start: { V: 495, h: 16500, thr: 1 }, vTop: 620, vScan: 700, hMax: 19000,
      facts: { Engines: '4 × Symphony, 180 kN each (planned)', Cruise: 'Mach 1.7 (target)', Status: 'first flight planned 2027' } }
  };

  function defaultCfg(id) {
    const A = AIRCRAFT[id];
    return { aircraft: id, ...A.cfg, dihedral: 'original', area: A.S, span: A.span, shift: 0, engineOut: false };
  }

  /* ---------- Geometry ---------- */
  function naca(foil, n) {
    const { m, p, t } = foil, up = [], lo = [];
    for (let i = 0; i <= n; i++) {
      const x = 0.5 * (1 - Math.cos(Math.PI * i / n));
      const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
      let yc = 0, dy = 0;
      if (foil.aft) { const k = 4.6 * m; yc = k * x * (1 - x) * (0.3 + 1.4 * x * x); dy = k * (0.3 - 0.6 * x + 4.2 * x * x - 5.6 * x ** 3); }
      else if (m > 0) {
        if (x < p) { yc = m / (p * p) * (2 * p * x - x * x); dy = 2 * m / (p * p) * (p - x); }
        else { yc = m / ((1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x); dy = 2 * m / ((1 - p) ** 2) * (p - x); }
      }
      const th = Math.atan(dy);
      up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
      lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
    }
    return { up, lo };
  }

  function wingGeometry(pf, S, b) {
    const s = b / 2;
    let chord, xle, cr, taper;
    if (pf.kind === 'ellipse') {
      cr = 4 * S / (Math.PI * b); taper = 0;
      chord = e => cr * Math.sqrt(Math.max(0, 1 - e * e)); xle = e => pf.f * (cr - chord(e));
    } else if (pf.kind === 'ogee') {
      const k = pf.k; cr = S * (k + 1) / (2 * s); taper = 0;
      chord = e => cr * Math.pow(Math.max(0, 1 - e), k); xle = e => cr - chord(e);
    } else if (pf.kind === 'cranked') {
      const { ek, ck, ct } = pf, af = (1 + ck) * ek / 2 + (ck + ct) * (1 - ek) / 2;
      cr = S / (2 * s * af); taper = ct;
      chord = e => cr * (e < ek ? 1 + (ck - 1) * e / ek : ck + (ct - ck) * (e - ek) / (1 - ek)); xle = e => cr - chord(e);
    } else {
      taper = pf.taper; cr = 2 * S / (b * (1 + taper));
      const tn = Math.tan(pf.sweep * D2R);
      chord = e => cr * (1 - (1 - taper) * e); xle = e => pf.f * cr + e * s * tn - pf.f * chord(e);
    }
    const n = 240; let A = 0, mac = 0, xac = 0, ym = 0;
    for (let i = 0; i < n; i++) {
      const e = (i + 0.5) / n, c = chord(e), dy = s / n;
      A += c * dy; mac += c * c * dy; xac += (xle(e) + 0.25 * c) * c * dy; ym += e * s * c * dy;
    }
    const sweepAt = f => Math.atan(((xle(1) + f * chord(1)) - (xle(0) + f * chord(0))) / s);
    return { b, S, s, AR: b * b / S, cr, ct: chord(1), taper, chord, xle, MAC: mac / A, xac: xac / A, yMAC: ym / A,
      sweepLE: sweepAt(0), sweepC4: sweepAt(0.25), sweepC2: sweepAt(0.5) };
  }

  function dihedralFn(dh) {
    const ti = Math.tan(dh.inner * D2R), to = Math.tan(dh.outer * D2R), sp = dh.split;
    return { z: e => (e <= sp ? e * ti : sp * ti + (e - sp) * to), ang: e => (e <= sp ? dh.inner : dh.outer) };
  }
  const helmbold = (AR, sweep, kap) => { const tl = Math.tan(sweep); return 2 * Math.PI * AR / (2 + Math.sqrt(AR * AR / (kap * kap) * (1 + tl * tl) + 4)); };

  /* Engines: the aircraft's own, or another type sized to suit its weight */
  function engineFor(A, type) {
    if (type === 'none') return null;
    const o = A.engine;
    if (type === o.type) return { ...o };
    const base = A.mass - o.m * o.n, n = o.n, e = { type, n, mount: o.mount, retract: o.retract, blades: 4 };
    if (type === 'piston') { e.P = 0.16 * base / n; e.m = 0.8 * e.P; e.f = 0.00025 * e.P + 0.03; e.eta = 0.8; e.blades = e.P > 500 ? 4 : 2; }
    else if (type === 'turboprop') { e.P = 0.3 * base / n; e.m = 0.22 * e.P; e.f = 0.00012 * e.P + 0.03; e.eta = 0.85; e.crit = 3000; e.blades = 4; }
    else if (type === 'turbofan') { e.T = 0.32 * base * G / n / 1000; e.m = e.T * 1000 / (5.5 * G); e.f = 0.0034 * e.T; }
    else if (type === 'turbojet') { e.T = 0.45 * base * G / n / 1000; e.m = e.T * 1000 / (5 * G); e.f = 0.0024 * e.T; e.ab = 1.5; }
    else if (type === 'superfan') { e.T = 0.5 * base * G / n / 1000; e.m = e.T * 1000 / (5 * G); e.f = 0.003 * e.T; }
    if (o.mount === 'nose' && ENGINES[type].kind === 'jet') e.f *= 0.25;   // buried in the fuselage
    return e;
  }

  /* ---------- Build a flyable aircraft from a configuration ---------- */
  function build(cfg) {
    const A = AIRCRAFT[cfg.aircraft];
    const own = k => cfg[k] === A.cfg[k];
    const pf = own('planform') && A.pfTweak ? { ...PLANFORMS[cfg.planform], ...A.pfTweak } : PLANFORMS[cfg.planform];
    const foil = own('airfoil') && A.foilTweak ? { ...AIRFOILS[cfg.airfoil], ...A.foilTweak } : AIRFOILS[cfg.airfoil];
    const dh = cfg.dihedral === 'original' ? A.dihedral : DIHEDRALS[cfg.dihedral];
    const pos = POSITIONS[cfg.position], biplane = cfg.wings === 2;
    const spec = engineFor(A, cfg.engine), eng = ENGINES[cfg.engine];
    const S = cfg.area, b = cfg.span;
    const geo = wingGeometry(pf, biplane ? S / 2 : S, b);
    const mass = A.mass - A.engine.m * A.engine.n + (spec ? spec.m * spec.n : 0);
    const tailless = own('planform') ? !!A.tailless : ['delta', 'ogee'].includes(cfg.planform);
    const retract = !!(spec && spec.retract), extended = !retract || cfg.engineOut;

    // biplane: Prandtl's interference factor from gap/span
    const gap = A.biplane ? A.biplane.gap : 0.9 * A.H * 0.5;
    const gb = gap / b, sigma = biplane ? clamp((1 - 0.66 * gb) / (1.055 + 3.7 * gb), 0.2, 0.9) : 0;
    const AR = biplane ? (b * b / S) * 2 / (1 + sigma) : b * b / S;

    // parasite drag areas f = CD·A (m²)
    const Sexp = Math.max(0.5 * S, S - geo.cr * A.W * (biplane ? 2 : 1));
    const parts = {
      body: A.fusF, wing: foil.cd0 * Sexp * (1 + 2 * foil.t * foil.t),
      tail: 0.0075 * ((tailless ? 0 : A.tail.S) + A.tail.Sv),
      engines: spec && extended ? spec.f * spec.n : 0,
      fittings: biplane ? 0.008 * S : pos.k * A.W * A.W
    };
    const CD0 = Object.values(parts).reduce((a, v) => a + v, 0) / S;

    // dihedral: chord × arm weighted angle, and the small lift loss cos²Γ
    const dfn = dihedralFn(dh);
    let wsum = 0, gsum = 0, csum = 0, cos2 = 0;
    for (let i = 0; i < 100; i++) {
      const e = (i + 0.5) / 100, c = geo.chord(e), g = dfn.ang(e);
      wsum += c * e; gsum += g * c * e; csum += c; cos2 += c * Math.cos(g * D2R) ** 2;
    }
    const gEff = gsum / wsum;

    // Oswald span efficiency (Nita & Scholz)
    let fl = 0;
    if (pf.kind !== 'ellipse') {
      const dl = -0.357 + 0.45 * Math.exp(-0.0375 * Math.abs(geo.sweepC4 * R2D)), x = geo.taper - dl;
      fl = Math.max(0, 0.0524 * x ** 4 - 0.15 * x ** 3 + 0.1659 * x * x - 0.0706 * x + 0.0119);
    }
    const e = clamp(1 / (1 + fl * geo.AR) * (1 - 2 * (A.W / b) ** 2) * 0.87 * (A.winglets ? 1.04 : 1), 0.3, 0.97);

    const ac = { cfg, A, pf, foil, pos, dh, dfn, eng, spec, retract, extended, biplane, sigma, geo, S, b, AR, mass, W: mass * G, CD0, parts, Sexp, e,
      kap: foil.kap, a0: foil.a0 * D2R, tc: foil.t, korn: foil.korn, clmax: foil.clmax * (A.clmaxF || 1), drop: foil.drop, stallW: foil.width,
      kLE: own('airfoil') && A.kLE != null ? A.kLE : foil.kLE, vk: sstep(45, 62, geo.sweepLE * R2D), tailless,
      sweepLE: geo.sweepLE, sweepC4: geo.sweepC4, sweepC2: geo.sweepC2, dihF: cos2 / csum, gEff,
      CDmax: 1.11 + 0.018 * Math.min(AR, 50), bodyWave: A.bodyWave, vScan: A.vScan, _stall: new Map() };

    ac.rollDeg = gEff + (biplane ? 2 : pos.roll) + 0.1 * geo.sweepC4 * R2D;
    const aw = CLa(ac, 0.2), MAC = geo.MAC;
    const xacw = A.xcg + A.acOff * MAC + (cfg.shift || 0) * 0.06 * A.L;
    const at = helmbold(A.tail.AR, A.tail.sweep * D2R, 0.95), deda = clamp(2 * aw / (Math.PI * AR), 0, 0.9);
    const VH = tailless ? 0 : A.tail.S * (A.tail.x - xacw) / (S * MAC);
    ac.SM = (xacw - A.xcg) / MAC + 0.9 * VH * (at / aw) * (1 - deda) - 0.69 * A.W * A.W * A.L / (S * MAC * aw);
    ac.rootLE = xacw - geo.xac;
    return ac;
  }

  /* ---------- Aerodynamic coefficients ---------- */
  function CLa(ac, M) {
    const sub = m => { const b2 = Math.max(1 - m * m, 0.02), tl = Math.tan(ac.sweepC2);
      return 2 * Math.PI * ac.AR / (2 + Math.sqrt(ac.AR * ac.AR * b2 / (ac.kap * ac.kap) * (1 + tl * tl / b2) + 4)); };
    let v;
    if (M <= 0.9) v = sub(M);
    else {
      const s9 = sub(0.9), sup = m => { const k = Math.sqrt(m * m - 1); return 4 / k * Math.max(0.35, 1 - 1 / (2 * ac.AR * k)); };
      v = M >= 1.2 ? Math.min(s9, sup(M)) : s9 + (Math.min(s9, sup(1.2)) - s9) * (M - 0.9) / 0.3;
    }
    return v * ac.dihF;
  }
  function CLatt(ac, a, sp) {
    const ae = a - ac.a0, lin = sp.slope * ae;
    if (ac.vk <= 0) return lin;
    const s = Math.sin(ae), c = Math.cos(ae);
    return lin * (1 - ac.vk) + (sp.slope * s * c * c + Math.PI * 0.9 * s * Math.abs(s) * c) * ac.vk;
  }
  function viterna(ac, a, aS, CLs) {
    const ss = Math.sin(aS), cs = Math.cos(aS), A2 = (CLs - ac.CDmax * ss * cs) * ss / (cs * cs);
    const sa = Math.max(Math.sin(a), 0.03), ca = Math.cos(a);
    return ac.CDmax * sa * ca + A2 * ca * ca / sa;
  }
  function stallParams(ac, M) {
    const key = Math.round(M * 50);
    let sp = ac._stall.get(key);
    if (sp) return sp;
    const Mq = key / 50, slope = CLa(ac, Mq), mf = Mq < 0.2 ? 1 : clamp(1 - 0.75 * (Mq - 0.2), 0.5, 1);
    const aN = ac.a0 + 0.9 * ac.clmax * Math.cos(ac.sweepC4) * mf / slope;
    const aV = clamp(20 + 0.7 * (ac.sweepLE * R2D - 45), 20, 34) * D2R * (0.6 + 0.4 * mf);
    const aS = aN + 1.8 * ac.stallW * D2R * (1 - ac.vk) + (aV - aN) * ac.vk;
    sp = { slope, mf, aS, aSn: ac.a0 - 0.85 * (aS - ac.a0) };
    let best = -9, aTop = aS;
    for (let a = aS - 8 * D2R; a <= aS + 5 * D2R; a += 0.05 * D2R) { const cl = core(ac, a, sp).CL; if (cl > best) { best = cl; aTop = a; } }
    sp.aTop = aTop; sp.CLmax = best;
    ac._stall.set(key, sp);
    return sp;
  }
  function core(ac, a, sp) {
    const att = CLatt(ac, a, sp), w = ac.stallW * D2R;
    let sig, CLp = 0;
    if (a >= ac.a0) { sig = 1 / (1 + Math.exp(-(a - sp.aS) / w)); if (sig > 1e-6) CLp = viterna(ac, Math.max(a, 0.02), sp.aS, ac.drop * CLatt(ac, sp.aS, sp)); }
    else { sig = 1 / (1 + Math.exp((a - sp.aSn) / w)); if (sig > 1e-6) CLp = -viterna(ac, Math.max(-a, 0.02), -sp.aSn, ac.drop * Math.abs(CLatt(ac, sp.aSn, sp))); }
    return { CL: (1 - sig) * att + sig * CLp, att, sig };
  }
  /* drag due to lift: CL²/(πAe) subsonic (CL·tanα where a sharp delta loses leading-edge suction); linear theory when supersonic */
  function induced(ac, cl, a, M = 0) {
    const vkl = ac.vk * (1 - ac.kLE), ae = Math.min(Math.abs(a - ac.a0), 1.2);
    const sub = (1 - vkl) * cl * cl / (Math.PI * ac.AR * ac.e) + vkl * Math.abs(cl) * Math.tan(ae);
    if (M <= 0.95) return sub;
    const sup = 0.8 * Math.sqrt(Math.max(M * M - 1, 0.1)) / 4 * cl * cl;
    return M >= 1.2 ? sup : sub + (sup - sub) * (M - 0.95) / 0.25;
  }
  function wave(ac, M, CL) {   // Korn equation + Lock's law, linear supersonic theory above Mach 1
    const cL = Math.cos(ac.sweepC4);
    const Mcr = ac.korn / cL - ac.tc / (cL * cL) - Math.abs(CL) / (10 * cL ** 3) - 0.1077;
    if (M < 0.45) return { total: 0, Mcr };
    let wing = M > Mcr ? 20 * (M - Mcr) ** 4 : 0;
    const cLE = Math.cos(ac.sweepLE), Mn = M * cLE, root = Math.max(Math.sqrt(Math.abs(Mn * Mn - 1)), 0.55);
    wing = Math.min(wing, (16 / 3) * ac.tc * ac.tc * 1.6 * cLE * cLE / root * (M > 1 && Mn < 1 ? 0.35 : 1) + 0.002) * ac.Sexp / ac.S;
    const body = ac.bodyWave / ac.S * sstep(0.8, 1.02, M) * (M > 1.02 ? 1 - 0.25 * clamp(M - 1.02, 0, 1) : 1);
    return { total: wing + body, Mcr, wing, body };
  }
  function coeffs(ac, aDeg, M) {
    const sp = stallParams(ac, M), a = aDeg * D2R, k = core(ac, a, sp), CL = k.CL;
    let CD = ac.CD0 + induced(ac, k.att, a, M);
    if (k.sig > 1e-6) {
      const pos = a >= ac.a0, aS = pos ? sp.aS : -sp.aSn, clS = CLatt(ac, pos ? sp.aS : sp.aSn, sp);
      const CDs = ac.CD0 + induced(ac, clS, pos ? sp.aS : sp.aSn, M), ss = Math.sin(aS), cs = Math.cos(aS);
      const B2 = (CDs - ac.CDmax * ss * ss) / cs, aa = Math.abs(a);
      CD = (1 - k.sig) * CD + k.sig * Math.max(ac.CDmax * Math.sin(aa) ** 2 + B2 * Math.cos(aa), ac.CD0);
    }
    const w = wave(ac, M, CL);
    return { CL, CD: CD + w.total, CD0: ac.CD0, CDi: CD - ac.CD0, CDw: w.total, sig: k.sig,
      aS: sp.aS * R2D, aTop: sp.aTop * R2D, CLmax: sp.CLmax, Mcr: w.Mcr, slope: sp.slope };
  }

  /* ---------- Engines ---------- */
  function thrust(ac, V, at, M, thr, ab) {
    const s = ac.spec;
    if (!s || !ac.extended) return 0;
    const e = ac.eng;
    if (e.kind === 'prop') {
      const sc = s.crit ? atmosphere(s.crit).sigma : 1, sig = Math.min(1, at.sigma / sc);   // supercharged / flat-rated to s.crit
      const P = s.P * 1000 * s.n * e.lapse(sig) * thr, eta = s.eta || e.eta, Vs = eta * 1000 / e.nPerKW;
      return eta * (1 - sstep(e.mLo, e.mHi, M)) * P / Math.pow(V ** 4 + Vs ** 4, 0.25);
    }
    const boost = ab && (s.ab || e.ab) ? (s.ab || e.ab) : 0;
    return s.n * s.T * 1000 * e.lapse(at.sigma, M) * (boost ? boost : thr);
  }
  const hasAB = ac => !!(ac.spec && ac.eng.kind === 'jet' && (ac.spec.ab || ac.eng.ab));

  /* ---------- Flight ---------- */
  function flight(ac, V, h, aDeg, thr, ab) {
    const at = atmosphere(h), M = V / at.a, q = 0.5 * at.rho * V * V;
    const c = coeffs(ac, aDeg, M), T = thrust(ac, V, at, M, thr, ab);
    const L = q * ac.S * c.CL, D = q * ac.S * c.CD, a = aDeg * D2R, excess = T * Math.cos(a) - D;
    return { V, h, alpha: aDeg, at, M, q, c, T, L, D, nz: (L + T * Math.sin(a)) / ac.W, excess, roc: V * excess / ac.W, LD: c.CD > 0 ? c.CL / c.CD : 0 };
  }
  function trim(ac, V, h, thr, ab, n = 1) {
    const at = atmosphere(h), M = V / at.a, q = 0.5 * at.rho * V * V;
    const T = thrust(ac, V, at, M, thr, ab), sp = stallParams(ac, M), W = ac.W * n;
    const f = aD => q * ac.S * core(ac, aD * D2R, sp).CL + T * Math.sin(aD * D2R) - W;
    const top = sp.aTop * R2D;
    if (V < 1 || f(top) < 0) return { alpha: top, stalled: true };
    let lo = -15, hi = top;
    if (f(lo) > 0) return { alpha: lo, stalled: false };
    for (let i = 0; i < 32; i++) { const mid = 0.5 * (lo + hi); if (f(mid) > 0) hi = mid; else lo = mid; }
    return { alpha: 0.5 * (lo + hi), stalled: false };
  }
  function level(ac, V, h, thr, ab) { const t = trim(ac, V, h, thr, ab), f = flight(ac, V, h, t.alpha, thr, ab); f.stalled = t.stalled; return f; }
  function stallSpeed(ac, h) {
    const at = atmosphere(h); let V = 40;
    for (let i = 0; i < 8; i++) V = Math.sqrt(2 * ac.W / (at.rho * ac.S * Math.max(stallParams(ac, V / at.a).CLmax, 0.05)));
    return V;
  }
  function maxRoc(ac, h, thr, ab) {
    const lo = stallSpeed(ac, h) * 1.04, hi = ac.vScan;
    if (lo >= hi) return { roc: -1, V: lo };
    let best = -Infinity, bV = lo; const N = 22;
    for (let i = 0; i <= N; i++) { const V = lo + (hi - lo) * i / N, r = level(ac, V, h, thr, ab).roc; if (r > best) { best = r; bV = V; } }
    const st = (hi - lo) / N;
    for (let i = -5; i <= 5; i++) { const V = clamp(bV + st * i / 5, lo, hi), r = level(ac, V, h, thr, ab).roc; if (r > best) { best = r; bV = V; } }
    return { roc: best, V: bV };
  }
  function performance(ac, h, thr, ab) {
    const Vs = stallSpeed(ac, h), lo = Vs * 1.02, hi = ac.vScan, N = 150;
    let maxV = null, prev = null, bestLD = 0, bestLDV = lo, climb = -Infinity, sinkMin = Infinity, sinkV = lo;
    for (let i = 0; i <= N; i++) {
      const V = lo + (hi - lo) * i / N, l = level(ac, V, h, thr, ab);
      if (!l.stalled) {
        if (prev && prev.excess >= 0 && l.excess < 0) maxV = prev.V + (V - prev.V) * prev.excess / (prev.excess - l.excess);
        if (l.roc > climb) climb = l.roc;
        const g = level(ac, V, h, 0, false);
        if (g.LD > bestLD) { bestLD = g.LD; bestLDV = V; }
        if (-g.roc < sinkMin) { sinkMin = -g.roc; sinkV = V; }
      }
      prev = l;
    }
    if (prev && prev.excess >= 0) maxV = hi;
    let ceiling = null;
    if (ac.spec && ac.extended) {
      const f = hh => maxRoc(ac, hh, 1, ab).roc - 0.5;
      if (f(0) < 0) ceiling = 0; else if (f(22000) > 0) ceiling = 22000;
      else { let a = 0, b = 22000; for (let i = 0; i < 13; i++) { const m = 0.5 * (a + b); if (f(m) > 0) a = m; else b = m; } ceiling = 0.5 * (a + b); }
    }
    const cruise = level(ac, clamp(maxV || lo, lo, hi) * 0.85, h, thr, ab);
    return { Vs, maxV, bestLD, bestLDV, climb, ceiling, sinkMin, sinkV, Mcr: wave(ac, 0.7, cruise.c.CL).Mcr };
  }
  function curves(ac, h, thr, ab, Vmax, N = 90) {
    const Vs = stallSpeed(ac, h), at = atmosphere(h), out = [];
    for (let i = 0; i <= N; i++) {
      const V = Math.max(1, Vmax * i / N), T = thrust(ac, V, at, V / at.a, thr, ab);
      if (V < Vs) { out.push({ V, T, stalled: true }); continue; }
      const l = level(ac, V, h, thr, ab), q = l.q * ac.S;
      out.push({ V, T, D: l.D, Dp: q * l.c.CD0, Di: q * l.c.CDi, Dw: q * l.c.CDw, stalled: l.stalled });
    }
    return { Vs, pts: out };
  }
  function liftCurve(ac, M, a0 = -6, a1 = 30, step = 0.25) {
    const pts = [];
    for (let a = a0; a <= a1 + 1e-9; a += step) { const c = coeffs(ac, a, M); pts.push({ a, CL: c.CL, CD: c.CD, sig: c.sig }); }
    return pts;
  }

  return { G, D2R, R2D, clamp, sstep, atmosphere, AIRCRAFT, PLANFORMS, AIRFOILS, POSITIONS, DIHEDRALS, ENGINES, defaultCfg, engineFor, hasAB,
    naca, wingGeometry, dihedralFn, build, coeffs, thrust, flight, trim, level, stallSpeed, performance, curves, liftCurve, wave, stallParams };
})();
