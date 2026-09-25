/* ================= UI: panels, controls, charts drawer, pickers, info cards ================= */
(() => {
  const A = Aero, C = Content, $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString('en-GB');
  const kmh = v => S.units === 'aviation' ? `${fmt(v * 1.94384)} kt` : S.units === 'imperial' ? `${fmt(v * 2.23694)} mph` : `${fmt(v * 3.6)} km/h`;
  const altitude = h => S.units === 'metric' ? `${fmt(h)} m` : `${fmt(h * 3.28084)} ft`;
  const kN = N => { const v = N / 1000; return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : fmt(v)) + ' kN'; };
  const f1 = v => (Math.round(v * 10) / 10).toLocaleString('en-GB');
  const fillRange = el => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');

  document.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = C.icon(el.dataset.icon, el.className); });
  document.querySelectorAll('.info').forEach(b => { b.innerHTML = C.icon('info', ''); });

  const S = { cfg: null, ac: null, V: 50, h: 1000, thr: 0.8, ab: false, auto: true, alpha: 3, perf: null, f: null,
    place: 'islands', time: 'morning', weather: 'clear', build: false, fly: innerWidth >= 1280, drawer: innerHeight >= 800, chart: 'Lift', tab: 'Controls', focus: false, values: false, units: 'metric',
    perfDirty: true, chartDirty: true, perfT: 0, chartT: 0, open: { planform: true, engine: true }, thumbs: {}, lastVmax: -1 };

  /* ---------- aircraft ---------- */
  function loadAircraft(id) {
    const a = A.AIRCRAFT[id];
    S.cfg = A.defaultCfg(id); S.V = a.start.V; S.h = a.start.h; S.thr = a.start.thr; S.ab = false; S.auto = true;
    if (['epic','spitfire','stearman'].includes(id)) S.h = S.place === 'canyon' ? 600 : 3000;
    if(id==='epic')S.V=105;
    if(FlightDirector.ready)S.h=FlightDirector.state.alt;
    FlightDirector.setThrottle(S.thr);
  }
  function rebuild(model = true) {
    S.forceTick=0;
    S.ac = A.build(S.cfg);
    if (model) Scene3D.setAircraft(Model.build(S.ac));
    const a = S.ac.A;
    $('spd').max = a.vTop; $('alt').max = a.hMax; S.V = Math.min(S.V, a.vTop); S.h = Math.min(S.h, a.hMax);
    $('acName').textContent = a.name; $('acThumb').src = S.thumbs[S.cfg.aircraft] || ''; $('acThumb').hidden = !S.thumbs[S.cfg.aircraft];
    $('flyTitle').textContent = a.name; $('flySub').textContent = `${a.role} · ${a.year}`;
    syncControls(); runPerf(); renderBuild(); renderAbout(); update();
  }
  function isReal() { const d = A.defaultCfg(S.cfg.aircraft); return ['planform', 'airfoil', 'position', 'wings', 'engine', 'dihedral'].every(k => S.cfg[k] === d[k]) && Math.abs(S.cfg.area - d.area) < 0.01 && Math.abs(S.cfg.span - d.span) < 0.01 && S.cfg.shift === 0; }

  /* ---------- Build panel ---------- */
  function opt(k, id, pic, label, sub, tag) {
    return `<button type="button" class="opt" data-k="${k}" data-id="${id}" aria-pressed="${String(S.cfg[k]) === String(id)}">${pic}${sub != null ? `<div><span>${label}${tag ? ` <b class="tag">${tag}</b>` : ''}</span><small>${sub}</small></div>` : `<span>${label}${tag ? `<br><b class="tag">${tag}</b>` : ''}</span>`}</button>`;
  }
  function grp(key, title, info, value, body) {
    const open = !!S.open[key];
    return `<section class="grp" data-open="${open}" data-key="${key}"><button class="grp-h" type="button">${title}<span class="val">${value || ''}</span>${C.icon('chevdown', 'i chev')}</button><div class="grp-b">${info ? `<p class="hint" style="margin:-2px 0 10px;display:flex;gap:6px;align-items:flex-start">${C.INFO[info].w}<button class="info" data-info="${info}" type="button" aria-label="More about ${title}">${C.icon('info', '')}</button></p>` : ''}${body}</div></section>`;
  }
  function engineSub(id) {
    const e = A.engineFor(S.ac.A, id); if (!e) return 'glides';
    const n = e.n > 1 ? `${e.n} × ` : '';
    return e.P ? `${n}${fmt(e.P)} kW` : `${n}${fmt(e.T)} kN${e.ab ? ' + afterburner' : ''}`;
  }
  function renderBuild() {
    const a = S.ac.A, d = A.defaultCfg(S.cfg.aircraft), real = (k, id) => (String(d[k]) === String(id) ? 'real' : '');
    $('buildSub').textContent = isReal() ? `The real ${a.short}. Swap a part to see what changes.` : `Your modified ${a.short}`;
    const bi = S.cfg.wings === 2;
    const html = [
      isReal() ? '' : `<button class="btn wide" type="button" id="resetParts">Back to the real ${a.short}</button>`,
      grp('wings', 'Wings', 'wings', bi ? 'Two' : 'One', `<div class="opts g2">${opt('wings', 1, C.wings(1), 'One wing', null, real('wings', 1))}${opt('wings', 2, C.wings(2), 'Biplane', null, real('wings', 2))}</div>`),
      grp('planform', 'Wing shape', 'planform', A.PLANFORMS[S.cfg.planform].name, `<div class="opts g2">${Object.keys(A.PLANFORMS).map(id => opt('planform', id, C.planform(id), A.PLANFORMS[id].name, null, real('planform', id))).join('')}</div>`),
      grp('airfoil', 'Wing profile', 'airfoil', A.AIRFOILS[S.cfg.airfoil].name, `<div class="opts list">${Object.keys(A.AIRFOILS).map(id => opt('airfoil', id, C.airfoil(id), A.AIRFOILS[id].name, A.AIRFOILS[id].code, real('airfoil', id))).join('')}</div>`),
      grp('position', 'Wing height', 'position', bi ? 'Biplane' : A.POSITIONS[S.cfg.position].name, bi ? '<p class="hint">A biplane has one wing above the body and one below.</p>' : `<div class="opts g2">${Object.keys(A.POSITIONS).map(id => opt('position', id, C.position(id), A.POSITIONS[id].name, null, real('position', id))).join('')}</div>`),
      grp('dihedral', 'Wing tilt', 'dihedral', S.cfg.dihedral === 'original' ? 'Real' : A.DIHEDRALS[S.cfg.dihedral].name, `<div class="opts g3">${opt('dihedral', 'original', C.dihedral(a.dihedral), 'Real', null, '')}${Object.keys(A.DIHEDRALS).map(id => opt('dihedral', id, C.dihedral(A.DIHEDRALS[id]), A.DIHEDRALS[id].name)).join('')}</div>`),
      grp('engine', 'Engine', 'engine', A.ENGINES[S.cfg.engine].name, `<div class="opts list">${Object.keys(A.ENGINES).map(id => opt('engine', id, C.engine(id), A.ENGINES[id].name, engineSub(id), real('engine', id))).join('')}</div>`),
      grp('size', 'Wing size', 'area', `${f1(S.ac.S)} m²`, `<div class="ctl"><div class="ctl-h"><label for="area">Area</label><button class="info" data-info="area" type="button" aria-label="About wing area">${C.icon('info', '')}</button><output id="areaOut">${f1(S.ac.S)} m²</output></div><input type="range" id="area" min="0.5" max="1.6" step="0.01" value="${S.cfg.area / a.S}"></div>
        <div class="ctl"><div class="ctl-h"><label for="span">Wingspan</label><button class="info" data-info="span" type="button" aria-label="About wingspan">${C.icon('info', '')}</button><output id="spanOut">${f1(S.ac.b)} m</output></div><input type="range" id="span" min="0" max="1" step="0.001"><span class="hint" id="arHint">Aspect ratio ${f1(S.ac.AR)}</span></div>`),
      grp('balance', 'Wing position', 'balance', S.cfg.shift === 0 ? 'Real' : S.cfg.shift > 0 ? 'Further back' : 'Further forward', `<div class="ctl"><div class="ctl-h"><label for="shift">Forward ↔ back</label><output id="shiftOut"></output></div><input type="range" id="shift" min="-1" max="1" step="0.05" value="${S.cfg.shift}"></div>`)
    ].join('');
    $('buildBody').innerHTML = html;
    const bmin = Math.sqrt(1.5 * S.cfg.area), bmax = Math.sqrt(16 * S.cfg.area);
    $('span').value = (S.cfg.span - bmin) / (bmax - bmin);
    ['area', 'span', 'shift'].forEach(id => fillRange($(id)));
    $('shiftOut').textContent = S.cfg.shift === 0 ? 'real' : `${S.cfg.shift > 0 ? 'back' : 'forward'} ${f1(Math.abs(S.cfg.shift) * 0.06 * a.L)} m`;
    const rp = $('resetParts'); if (rp) rp.onclick = () => { const before = snapshot(); const keep = { V: S.V, h: S.h, thr: S.thr }; S.cfg = A.defaultCfg(S.cfg.aircraft); Object.assign(S, keep); rebuild(); toast(`The real ${a.short}`, 'All parts are back to the real aircraft.', before); };
    wireSize();
  }
  function wireSize() {
    let before = null;
    const geo = (id, fn, note) => {
      const el = $(id);
      el.addEventListener('pointerdown', () => { before = snapshot(); });
      el.addEventListener('input', () => { fn(+el.value); fillRange(el); S.ac = A.build(S.cfg); S.perfDirty = true; clearTimeout(geo.t); geo.t = setTimeout(() => Scene3D.setAircraft(Model.build(S.ac)), 60);
        $('areaOut').textContent = `${f1(S.ac.S)} m²`; $('spanOut').textContent = `${f1(S.ac.b)} m`; $('arHint').textContent = `Aspect ratio ${f1(S.ac.AR)}`;
        $('shiftOut').textContent = S.cfg.shift === 0 ? 'real' : `${S.cfg.shift > 0 ? 'back' : 'forward'} ${f1(Math.abs(S.cfg.shift) * 0.06 * S.ac.A.L)} m`; update(); });
      el.addEventListener('change', () => { runPerf(); const n = note(); toast(n[0], n[1], before); before = null; renderBuildHeader(); });
    };
    geo('area', v => { const AR = S.cfg.span ** 2 / S.cfg.area; S.cfg.area = v * S.ac.A.S; S.cfg.span = Math.sqrt(AR * S.cfg.area); }, () => [`Wing area ${f1(S.ac.S)} m²`, C.INFO.area.y]);
    geo('span', v => { const lo = Math.sqrt(1.5 * S.cfg.area), hi = Math.sqrt(16 * S.cfg.area); S.cfg.span = lo + (hi - lo) * v; }, () => [`Wingspan ${f1(S.ac.b)} m`, `Aspect ratio ${f1(S.ac.AR)}. ${C.INFO.ar.y}`]);
    geo('shift', v => { S.cfg.shift = v; }, () => ['Wing moved along the body', C.INFO.balance.y]);
  }
  function renderBuildHeader() { $('buildSub').textContent = isReal() ? `The real ${S.ac.A.short}. Swap a part to see what changes.` : `Your modified ${S.ac.A.short}`; }

  function choose(k, id) {
    const before = snapshot(), a = S.ac.A;
    if (k === 'wings') S.cfg.wings = +id; else S.cfg[k] = id;
    if (k === 'planform') {
      const pf = A.PLANFORMS[id], origFixed = A.PLANFORMS[a.cfg.planform].fixedAR;
      const AR = id === a.cfg.planform ? a.span ** 2 / a.S : pf.fixedAR || origFixed ? pf.AR : a.span ** 2 / a.S;
      S.cfg.span = Math.sqrt(AR * S.cfg.area);
    }
    if (k === 'engine') { S.ab = false; if (id !== 'none' && S.thr < 0.3) S.thr = 0.8; S.cfg.engineOut = false; }
    rebuild();
    const names = { planform: A.PLANFORMS, airfoil: A.AIRFOILS, position: A.POSITIONS, engine: A.ENGINES };
    const title = k === 'wings' ? (id == 2 ? 'Two wings' : 'One wing') : k === 'dihedral' ? `Wing tilt: ${id === 'original' ? 'real' : A.DIHEDRALS[id].name.toLowerCase()}` : names[k][id].name;
    toast(title, C.DESC[k][id], before);
  }

  /* ---------- flight ---------- */
  function syncControls() {
    const ac = S.ac;
    $('spd').value = S.V; $('alt').value = S.h; $('thr').value = S.thr;
    $('thr').disabled = !ac.spec || S.ab || (ac.retract && !ac.extended);
    $('abWrap').hidden = !A.hasAB(ac); $('ab').checked = S.ab;
    $('mastWrap').hidden = !ac.retract; $('mast').checked = !!S.cfg.engineOut;
    document.querySelectorAll('#aoaSeg button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.m === 'auto') === S.auto)));
    $('aoa').disabled = S.auto;
    ['spd', 'alt', 'thr', 'aoa'].forEach(i => fillRange($(i)));
  }
  function runPerf() { S.perf = A.performance(S.ac, S.h, S.thr, S.ab); S.perfDirty = false; S.perfT = performance.now(); S.chartDirty = true; renderFacts(); }
  function sepFrom(alpha, aS, foil) {
    if (foil.t < 0.08) return alpha > aS - 0.3 ? 0.04 : alpha > aS - 2.5 ? 0.9 : 1;
    if (alpha < aS - 4) return 1;
    return Math.max(0.05, 1 - 0.95 * Math.pow(Math.min(1, (alpha - aS + 4) / 14), 1.2));
  }
  function navigationStatus(n=FlightDirector.state){
    if(n.mode!=='manual')return;
    const t=n.clearance?'Terrain assist':Math.abs(n.bank)>.12?'Turning':n.verticalSpeed>.5?'Climbing':n.verticalSpeed<-.5?'Descending':'Level flight';
    const vertical=S.units==='metric'?`${n.verticalSpeed>=0?'+':''}${f1(n.verticalSpeed)} m/s`:`${n.verticalSpeed>=0?'+':''}${fmt(n.verticalSpeed*196.85)} ft/min`;
    $('status').className='status glass';$('statusText').textContent=t;$('statusSub').textContent=`${vertical} · ${kmh(n.speed)} · ${altitude(n.alt)}`;
    if($('liveStatus').textContent!==t)$('liveStatus').textContent=t;
  }
  function update() {
    const ac = S.ac;
    let alpha = S.alpha, stalled = false;
    if (S.auto) { const t = A.trim(ac, S.V, S.h, S.thr, S.ab); alpha = t.alpha + (t.stalled ? 4 : 0); stalled = t.stalled; S.alpha = alpha; }
    const f = A.flight(ac, S.V, S.h, alpha, S.thr, S.ab);
    if (!S.auto) stalled = f.c.sig > 0.5;
    f.stalled = stalled; S.f = f;
    const sepX = sepFrom(alpha, f.c.aS, ac.foil);
    if(!$('spdOut').querySelector('input'))$('spdOut').textContent = kmh(S.V);
    if(!$('altOut').querySelector('input'))$('altOut').textContent = altitude(S.h);
    $('thrOut').textContent = !ac.spec ? 'no engine' : ac.retract && !ac.extended ? 'engine folded' : S.ab ? 'afterburner' : `${Math.round(S.thr * 100)}%`;
    $('aoa').value = Math.max(-6, Math.min(30, alpha)); fillRange($('aoa')); $('aoaOut').textContent = `${f1(alpha)}°`;
    ['spd', 'alt', 'thr'].forEach(i => fillRange($(i)));
    const near = !stalled && alpha > f.c.aTop - 2;
    const t = stalled ? 'Stalled' : near ? 'Near Stall' : f.roc > .4 ? 'Climbing' : f.roc < -.4 ? 'Descending' : 'Level';
    const cls = stalled ? 'bad' : near ? 'warn' : '';
    const vertical = S.units === 'metric' ? `${f.roc >= 0 ? '+' : ''}${f1(f.roc)} m/s` : `${f.roc >= 0 ? '+' : ''}${fmt(f.roc * 196.85)} ft/min`;
    $('status').className = 'status glass ' + cls; $('statusText').textContent = t;
    $('statusSub').textContent = vertical + (S.fly ? '' : ` · ${kmh(S.V)} · ${altitude(S.h)}`);
    if ($('liveStatus').textContent !== t) $('liveStatus').textContent = t;navigationStatus();
    [['spd',kmh(S.V)],['alt',altitude(S.h)],['thr',`${Math.round(S.thr*100)} percent`],['aoa',`${f1(alpha)} degrees`]].forEach(([id,v]) => $(id).setAttribute('aria-valuetext',v));
    $('trimHint').textContent = S.auto ? 'Auto-trim finds the angle that balances lift and weight.' : 'Change the angle to explore lift and the onset of stall.';
    Scene3D.set({ alpha, CL: f.c.CL, stalled, sepX, V: S.V, h: S.h, thr: ac.spec && ac.extended ? (S.ab ? 1 : S.thr) : 0, ab: S.ab && A.hasAB(ac), L: f.L, W: ac.W, T: f.T, D: f.D, extended: ac.extended });
    Scene3D.setLabels(Object.fromEntries([['lift',f.L],['weight',ac.W],['thrust',f.T],['drag',f.D]].map(([k,v])=>[k,k[0].toUpperCase()+k.slice(1)+(S.values && innerWidth >= 600 && S.chart !== 'Forces' ? ` ${kN(v)}` : '')])));
    if (!S.forceTick || performance.now()-S.forceTick>1000) { $('forceSummary').innerHTML=[['Lift',f.L],['Weight',ac.W],['Thrust',f.T],['Drag',f.D]].map(([k,v])=>`<li>${k}: ${kN(v)}</li>`).join(''); S.forceTick=performance.now(); }
    Profile.set({ foil: ac.foil, alpha, sepX, stalled, CL: f.c.CL, CD: f.c.CD });
    $('foilName').textContent = `${ac.foil.name} · ${ac.foil.code}`;
    // headlines
    const aTop = f.c.aTop;
    $('hlLift').innerHTML = stalled ? `Past <em>${f1(aTop)}°</em> the lift collapses — the wing is stalled.` : `Stalls at <em>${f1(aTop)}°</em>. You are flying at <em>${f1(alpha)}°</em>.`;
    $('drawerSub').textContent = stalled ? 'The wing is stalled' : `Stalls at ${f1(aTop)}° · you are at ${f1(alpha)}°`;
    renderBars(f); renderStats(f); renderAnalysis(); S.lastVmax = -1;
    S.chartDirty = true;
  }
  function renderBars(f) {
    const pair = (a,b,av,bv,ca,cb) => { const max = Math.max(av,bv,1)*1.12, net=av-bv; return `<div class="force-pair">${[[a,av,ca],[b,bv,cb]].map(([k,v,c])=>`<div class="force-bar"><span>${k}</span><span style="color:var(--${c})">${kN(v)}</span><div class="force-track"><i style="--c:var(--${c});--w:${Math.max(0,v)/max*100}%"></i></div></div>`).join('')}<div class="net"><i style="--c:var(--${net>=0?ca:cb});--start:${net>=0?50:50-Math.abs(net)/max*50}%;--w:${Math.abs(net)/max*50}%"></i></div><p class="net-label">Net ${net>=0?'+':''}${kN(net)} · scale 0–${kN(max)}</p></div>`; };
    $('bars').innerHTML = pair('Lift','Weight',f.L,S.ac.W,'lift','weight') + pair('Thrust','Drag',f.T,f.D,'thrust','drag');
  }
  function renderFacts() {
    const p=S.perf;
    $('facts').innerHTML = [['Stall Speed',kmh(p.Vs),'Lift'],['Top Speed',p.maxV ? kmh(p.maxV) : 'Not available','Drag'],['Best Glide',`${f1(p.bestLD)}:1`,'Drag'],['Max Climb',`${f1(p.climb)} m/s`,'Forces']].map(([label,v,c])=>`<button class="fact" data-chart="${c}"><span>${label}</span><b>${v}</b></button>`).join('');
    renderStability();
  }
  function stat(label, info, val) { return `<div class="stat"><dt>${label}<button class="info" data-info="${info}" type="button" aria-label="About ${label}">${C.icon('info', '')}</button></dt><dd>${val}</dd></div>`; }
  function renderStats(f) {
    const ac = S.ac, p = S.perf;
    $('stats').innerHTML = [
      stat('Lift ÷ drag now', 'ld', f1(Math.max(0, f.LD))), stat('Mach now', 'mach', f.M.toFixed(2)),
      stat('Shock waves from', 'shock', `Mach ${f.c.Mcr.toFixed(2)}`), stat('Ceiling', 'ceiling', !ac.spec || !ac.extended ? '—' : p.ceiling >= 21900 ? 'over 20 km' : p.ceiling <= 0 ? 'none' : `${fmt(p.ceiling)} m`),
      stat('Mass', 'mass', `${fmt(ac.mass)} kg`), stat('Wing loading', 'wingload', `${fmt(ac.mass / ac.S)} <small>kg/m²</small>`),
      stat('Aspect ratio', 'ar', f1(ac.AR)), stat('Sweep', 'sweep', `${Math.round(ac.sweepLE * 180 / Math.PI)}°`)
    ].join('');
  }
  function renderStability() {
    const ac=S.ac, r=ac.rollDeg, sm=ac.SM;
    const rows=[['Pitch',sm<0?'Unstable':sm<.05?'Sensitive':sm>.25?'Nose-heavy':'Steady',sm<0?'bad':sm<.05||sm>.25?'warn':'good',sm<.05?'The nose needs active correction.':'The tail tends to restore the angle after a small gust.'],['Roll',r<0?'Unstable':r<2?'Agile':r>11?'Wallows':'Steady',r<0?'bad':r<2||r>11?'warn':'good','Wing tilt changes how the aircraft recovers from a gust.'],['Yaw','Not modelled','warn','This lesson models pitch and roll; directional stability is not calculated.']];
    $('stability').innerHTML=rows.map(([k,v,c,txt])=>`<div class="stability-row"><div><span>${k}</span><span class="state ${c}">${C.icon(c==='good'?'circle-check':'triangle-alert')}<span>${v}</span></span></div><p>${txt}</p></div>`).join('');
  }
  function renderAbout() {
    const a = S.ac.A;
    $('about').innerHTML = `<p>${a.blurb}</p><dl><dt>Wingspan</dt><dd>${f1(a.span)} m</dd><dt>Length</dt><dd>${f1(a.L)} m</dd><dt>Wing area</dt><dd>${f1(a.S)} m²</dd><dt>Mass in flight</dt><dd>${fmt(a.mass)} kg</dd>${Object.entries(a.facts).map(([k, v]) => `<dt>${k === 'Top' ? 'Top speed' : k}</dt><dd>${v}</dd>`).join('')}</dl>${a.estimate ? '<p class="est">Not flying yet: figures are Boom’s published targets, with our estimates for wing area and drag.</p>' : '<p class="hint" style="margin-top:10px">Published figures; drag is calibrated so the model matches the real top speed, climb and glide.</p>'}`;
  }

  /* ---------- charts ---------- */
  function drawCharts() {
    S.chartDirty=false;S.chartT=performance.now();const ac=S.ac,f=S.f,c=A.coeffs(ac,S.alpha,f.M);
    if(S.chart==='Lift') Charts.set($('liftChart'),{pts:A.liftCurve(ac,f.M,-5,Math.max(20,Math.ceil(c.aTop/5)*5+5),.25),alpha:S.alpha,CL:c.CL,aTop:c.aTop,CLmax:c.CLmax});
    if(S.chart==='Drag'){const cv=A.curves(ac,S.h,S.thr,S.ab,ac.A.vTop,120);Charts.set($('dragChart'),{pts:cv.pts,Vs:cv.Vs,V:S.V,maxV:S.perf?.maxV,hasEngine:!!(ac.spec&&ac.extended),speedFactor:S.units==='aviation'?1.94384:S.units==='imperial'?2.23694:3.6,speedUnit:S.units==='aviation'?'kt':S.units==='imperial'?'mph':'km/h',forceMax:ac.W*.6});}
    renderAnalysis();
  }
  function renderAnalysis() {
    if(!S.f || !S.perf)return;
    const f=S.f,p=S.perf, margin=f.c.aTop-S.alpha, netL=f.L-S.ac.W, netT=f.T-f.D, inf=Profile.info();
    const data={
      Lift:[`${f1(S.alpha)}°`,'Angle of attack',`${f1(f.c.aTop)}°`,'Stall angle',margin>0?`Lift builds until the stall angle. You have ${f1(margin)}° in hand.`:'The wing is beyond its stall angle; separated flow reduces lift.'],
      Drag:[`${fmt(p.Vs*3.6)}–${p.maxV?fmt(p.maxV*3.6):'—'}`,'Speed range · km/h',kmh(S.V),'Your speed',p.maxV?`Thrust and drag determine the speeds this aircraft can hold at this altitude.`:'There is not enough thrust to maintain level flight at this altitude.'],
      Forces:[kN(netL),'Lift minus weight',`${netT>=0?'+':''}${kN(netT)}`,'Thrust minus drag',Math.abs(netL)<S.ac.W*.03?'Lift balances weight. Spare thrust is available for climbing.':'Unequal forces change the aircraft’s motion.'],
      Airflow:[`${(inf?.vmax||1).toFixed(1)}×`,'Air speed over the top',kN(f.L),'Lift',f.stalled?'The flow separates from the upper surface as the wing stalls.':'Faster air over the upper surface reduces pressure and contributes to lift.']
    }[S.chart];
    ['metric1','metric1Label','metric2','metric2Label','insight'].forEach((id,i)=>$(id).textContent=data[i]);
    $('drawerSub').textContent=data[4];
    const cv={Lift:'liftChart',Drag:'dragChart',Airflow:'profile'}[S.chart];if(cv)$(cv).setAttribute('aria-label',S.chart+'. '+data[4]);
    if(!$('chartData').hidden){const rows=S.chart==='Forces'?[['Lift',kN(f.L)],['Weight',kN(S.ac.W)],['Thrust',kN(f.T)],['Drag',kN(f.D)]]:S.chart==='Lift'?A.liftCurve(S.ac,f.M,-5,20,5).map(q=>[`${q.a}°`,q.CL.toFixed(2)]):S.chart==='Drag'?A.curves(S.ac,S.h,S.thr,S.ab,S.ac.A.vTop,14).pts.map(q=>[kmh(q.V),`${kN(q.D||0)} drag / ${kN(q.T)} thrust`]):[['Air speed ratio',data[0]],['Lift',data[2]],['Airfoil',S.ac.foil.code]]; $('chartData').innerHTML=`<table><caption>${S.chart} data</caption><thead><tr><th scope="col">${S.chart==='Lift'?'Angle of attack':S.chart==='Drag'?'Speed':'Measure'}</th><th scope="col">${S.chart==='Lift'?'Lift coefficient':'Value'}</th></tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${r[0]}</th><td>${r[1]}</td></tr>`).join('')}</tbody></table>`;}
  }
  function selectChart(name){S.chart=name;S.drawer=true;document.querySelectorAll('[data-chart]').forEach(b=>{if(b.getAttribute('role')==='tab'){b.setAttribute('aria-selected',String(b.dataset.chart===name));b.tabIndex=b.dataset.chart===name?0:-1;}});['Profile','Lift','Drag','Forces'].forEach(k=>$('card'+k).hidden=(k==='Profile'?'Airflow':k)!==name);S.chartDirty=true;update();layout();}
  function selectTab(name){S.tab=name;document.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===name;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;$('pane'+b.dataset.tab).hidden=!on;});try{sessionStorage.setItem('winglab-tab',name);}catch{}}

  /* ---------- toast ---------- */
  function snapshot() { if (S.perfDirty) runPerf(); const p = S.perf, e = S.ac.spec && S.ac.extended; return { Vs: p.Vs, maxV: e ? p.maxV : null, LD: p.bestLD, climb: e ? p.climb : null, Mcr: p.Mcr }; }
  let toastT = 0;
  function toast(title, text, before) {
    const out = [];
    if (before) {
      const after = snapshot();
      [['Vs', 'Stall speed', v => kmh(v), -1], ['maxV', 'Top speed', v => kmh(v), 1], ['LD', 'Glide', v => `1 : ${f1(v)}`, 1], ['climb', 'Climb', v => `${f1(v)} m/s`, 1], ['Mcr', 'Shock waves from', v => `Mach ${v.toFixed(2)}`, 1]].forEach(([k, lab, fm, good]) => {
        const a = before[k], b = after[k]; if (a == null || b == null || !isFinite(a) || !isFinite(b)) return;
        const rel = (b - a) / Math.max(Math.abs(a), 1e-6); if (Math.abs(rel) < 0.02) return;
        out.push({ w: Math.abs(rel), h: `<li class="${rel * good > 0 ? 'up' : 'down'}">${lab} ${fm(b)}</li>` });
      });
    }
    $('toastTitle').textContent = title; $('toastText').textContent = text;
    $('toastChips').innerHTML = out.sort((x, y) => y.w - x.w).slice(0, 3).map(o => o.h).join('');
    $('toast').hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { $('toast').hidden = true; }, 10000);
    layout();
  }

  /* ---------- pickers ---------- */
  function renderPicker() {
    $('acGrid').innerHTML = Object.keys(A.AIRCRAFT).map(id => { const a = A.AIRCRAFT[id];
      return `<button class="accard" type="button" data-ac="${id}" aria-pressed="${S.cfg.aircraft === id}"><span class="th">${S.thumbs[id] ? `<img src="${S.thumbs[id]}" alt="">` : '<span class=preview-pending>Preparing preview…</span>'}</span><b>${a.short}</b><small>${a.role} · ${a.year}</small></button>`; }).join('');
  }
  const PLACE_ART = {islands:'assets/scenes/philippine-islands.jpg',canyon:'assets/scenes/grand-canyon.png'};
  function renderEnvPop() {
    $('placeGrid').innerHTML = Object.entries(Env.PLACES).map(([id, p]) => `<button class="place" type="button" data-place="${id}" aria-pressed="${S.place === id}" ><img src="${PLACE_ART[id]}" alt="" loading="lazy"><span>${p.name}</span></button>`).join('');
    const ti = { morning: 'sun', midday: 'sunhigh', golden: 'sunset' };
    $('timeSeg').innerHTML = Object.entries(Env.TIMES).map(([id, t]) => `<button type="button" data-time="${id}" aria-pressed="${S.time === id}">${C.icon(ti[id], '')}<span class="tb-hide-s">${t.name}</span></button>`).join('');
    $('envName').textContent = Env.PLACES[S.place].name;
  }
  function openPop(id, anchor, alignRight) {
    ['acPop', 'envPop','overlaysPop','morePop'].forEach(p => { if (p !== id) { $(p).hidden = true; } });
    const el = $(id), was = !el.hidden;if(id==='acPop'&&was===false)makeThumbs();
    el.hidden = was; $('acBtn').setAttribute('aria-expanded', String(id === 'acPop' && !was)); $('envBtn').setAttribute('aria-expanded', String(id === 'envPop' && !was));
    for(const [pop,btn] of [['overlaysPop','overlaysBtn'],['morePop','moreBtn']])$(btn).setAttribute('aria-expanded',String(!$(pop).hidden));
    if (was) return;
    $('toast').hidden=true;clearTimeout(toastT);
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth;
    el.style.top = (r.bottom + 8) + 'px';
    el.style.left = Math.max(12, Math.min(innerWidth - w - 12, alignRight ? r.right - w : r.left)) + 'px';
  }
  function showInfo(key, btn) {
    const d = C.INFO[key]; if (!d) return;
    $('infoTitle').textContent = d.t; $('infoWhat').textContent = d.w; $('infoWhy').textContent = d.y;
    $('infoReal').hidden = !d.r; $('infoReal').innerHTML = d.r ? `<b>In real life</b>${d.r}` : '';
    $('infoFormula').hidden = !d.f; $('infoFormula').textContent = d.f;
    const el = $('infoCard'); el.hidden = false;
    const r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let left = r.left - w - 10; if (left < 12) left = Math.min(innerWidth - w - 12, r.right + 10);
    el.style.left = left + 'px'; el.style.top = Math.max(12, Math.min(innerHeight - h - 12, r.top - 20)) + 'px';
  }

  /* ---------- layout: keep the aircraft centred between open panels ---------- */
  let layoutFrame=0;
  function layout() {
    const mobile=innerWidth<1024, phone=innerWidth<600, edge=16;
    if(phone&&S.drawer)S.fly=false;
    $('build').dataset.open=String(S.build);$('build').inert=!S.build;
    $('fly').dataset.open=String(S.fly);$('fly').inert=!S.fly;
    $('drawer').dataset.open=String(S.drawer);$('drawer').dataset.focus=String(S.focus);
    $('drawerH').setAttribute('aria-label',S.drawer?'Collapse analysis':'Expand analysis');
    $('buildBtn').setAttribute('aria-pressed',String(S.build));$('flyBtn').setAttribute('aria-pressed',String(S.fly));
    const R=!mobile&&S.fly?$('fly').offsetWidth+32:edge,L=!mobile&&S.build?$('build').offsetWidth+32:edge;
    const dr=$('drawer');dr.style.left=L+'px';dr.style.right=R+'px';
    dr.style.setProperty('--analysis-height',dr.clientWidth<760?'25rem':'21.25rem');
    $('toast').style.left=edge+'px';$('toast').style.bottom=(dr.offsetHeight+32)+'px';
    cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(()=>{
      const rect=dr.getBoundingClientRect(),top=Math.max($('status').getBoundingClientRect().bottom,phone?$('pilotHint').getBoundingClientRect().bottom:120)+24;
      const right= S.fly ? (phone?edge:$('fly').offsetWidth+32):R;
      const bottom=innerHeight-Math.min(rect.top,phone&&S.fly?$('fly').getBoundingClientRect().top:innerHeight)+24;
      Scene3D.setInsets(L,right,bottom,top);S.chartDirty=true;
    });
    if(S.f)update();
  }

  function syncPilot(){
    const manual=FlightDirector.state.mode==='manual';
    $('pilotMode').textContent=manual?'Manual':'Autopilot';const icon=$('pilotBtn').querySelector('svg');if(icon)icon.outerHTML=C.icon(manual?'arrows':'plane');$('pilotBtn').setAttribute('aria-pressed',String(!manual));$('pilotBtn').setAttribute('aria-label',manual?'Switch to autopilot':'Switch to manual flight');
    $('pilotHelp').textContent=manual?'Release to level · terrain assist':'A relaxed scenic tour';$('flightPad').hidden=!manual;$('manualGuide').hidden=!manual;$('pilotHint').dataset.manual=String(manual);
    $('alt').disabled=!manual;$('altOut').setAttribute('aria-disabled',String(!manual));
    $('alt').title=manual?'Set your target altitude':'Autopilot follows the scenic route';
    layout();
  }
  let lessonForces=true;
  $('pilotBtn').onclick=()=>{const manual=FlightDirector.state.mode==='auto';FlightDirector.setMode(manual?'manual':'auto');FlightDirector.setThrottle(S.thr);if(manual){lessonForces=$('forcesBtn').getAttribute('aria-pressed')==='true';$('forcesBtn').setAttribute('aria-pressed','false');Scene3D.toggle('forces',false);Scene3D.setView('rear');document.querySelectorAll('#viewSeg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v==='rear')));}else{$('forcesBtn').setAttribute('aria-pressed',String(lessonForces));Scene3D.toggle('forces',lessonForces);}syncPilot();};
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,select,textarea,[contenteditable=true]')||e.target.closest('[role=tablist],.pop,.infocard')||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key.toLowerCase()==='p'&&!e.repeat){e.preventDefault();$('pilotBtn').click();return;}
    if(FlightDirector.state.mode==='manual'&&['arrowleft','arrowright','arrowup','arrowdown','w','s'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();FlightDirector.key(e.key,true);$('manualGuide').querySelector(`[data-key="${e.key.toLowerCase()}"]`)?.classList.add('active');}
  },true);
  document.addEventListener('keyup',e=>{FlightDirector.key(e.key,false);$('manualGuide').querySelector(`[data-key="${e.key.toLowerCase().replace(/[^a-z]/g,'')}"]`)?.classList.remove('active');});addEventListener('blur',()=>{FlightDirector.clearKeys();$('manualGuide').querySelectorAll('.active').forEach(k=>k.classList.remove('active'));});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)FlightDirector.clearKeys();});
  document.querySelectorAll('[data-flight-key]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);FlightDirector.key(b.dataset.flightKey,true);};['pointerup','pointercancel','lostpointercapture'].forEach(name=>b.addEventListener(name,()=>FlightDirector.key(b.dataset.flightKey,false)));});
  let telemetryAlt=-1;
  $('viewport').addEventListener('flighttelemetry',e=>{
    const n=e.detail;$('routePhase').textContent=n.clearance?'Terrain clearance assist':n.phase;
    $('viewport').dataset.flightMode=n.mode;$('viewport').dataset.heading=n.heading.toFixed(3);$('viewport').dataset.altitude=n.alt.toFixed(1);$('viewport').dataset.worldX=n.x.toFixed(1);$('viewport').dataset.worldZ=n.z.toFixed(1);$('viewport').dataset.bank=n.bank.toFixed(3);$('viewport').dataset.pitch=n.pitch.toFixed(3);$('viewport').dataset.aileron=n.aileron.toFixed(3);$('viewport').dataset.elevator=n.elevator.toFixed(3);
    if(n.mode==='manual'){$('manualReadout').textContent=`${kmh(n.speed)} · ${Math.round(n.throttle*100)}% power · ${Math.round(n.bank*180/Math.PI)}° bank`;if(Math.abs(S.thr-n.throttle)>.002){S.thr=n.throttle;$('thr').value=S.thr;fillRange($('thr'));S.perfDirty=true;update();}}
    if(Math.abs(n.alt-telemetryAlt)>2||Math.abs(n.alt-S.h)>2){S.h=n.alt;telemetryAlt=n.alt;$('alt').value=S.h;if(Math.abs(S.h-(S.perfAltitude||0))>60){S.perfDirty=true;S.perfAltitude=S.h;}update();}navigationStatus(n);
  });

  /* ---------- wiring ---------- */
  document.addEventListener('click', e => {
    const info = e.target.closest('.info[data-info]'); if (info) { e.stopPropagation(); showInfo(info.dataset.info, info); return; }
    const o = e.target.closest('.opt[data-k]'); if (o && String(S.cfg[o.dataset.k]) !== o.dataset.id) { choose(o.dataset.k, o.dataset.id); return; }
    const g = e.target.closest('.grp-h'); if (g) { const s = g.parentElement, open = s.dataset.open !== 'true'; s.dataset.open = String(open); if (s.dataset.key) S.open[s.dataset.key] = open; return; }
    const cl = e.target.closest('[data-close]'); if (cl) { const k = cl.dataset.close; if (k === 'build') S.build = false; else if (k === 'fly') S.fly = false; else $(k).hidden = true; if(k==='envPop')$('envBtn').setAttribute('aria-expanded','false');if(k==='acPop')$('acBtn').setAttribute('aria-expanded','false');layout();return; }
    const ac = e.target.closest('[data-ac]'); if (ac) { $('acPop').hidden = true; $('acBtn').setAttribute('aria-expanded', 'false'); if (ac.dataset.ac !== S.cfg.aircraft) { loadAircraft(ac.dataset.ac); rebuild(); const a = A.AIRCRAFT[ac.dataset.ac]; toast(a.name, a.blurb, null); } return; }
    const pl = e.target.closest('[data-place]'); if (pl) { S.place = pl.dataset.place; Env.set('place', S.place); S.h=S.place==='canyon'?480:1150; syncControls();S.perfDirty=true;update(); renderEnvPop(); return; }
    const tm = e.target.closest('[data-time]'); if (tm) { S.time = tm.dataset.time; Env.set('time', S.time); renderEnvPop(); return; }
    const wx = e.target.closest('[data-wx]'); if (wx) { S.weather = wx.dataset.wx; Env.set('weather', S.weather); renderEnvPop(); return; }
    if (!e.target.closest('.infocard')) $('infoCard').hidden = true;
    if (!e.target.closest('.pop') && !e.target.closest('#acBtn') && !e.target.closest('#envBtn')) { $('acPop').hidden = true; $('envPop').hidden = true; $('acBtn').setAttribute('aria-expanded', 'false'); $('envBtn').setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ['acPop', 'envPop', 'infoCard'].forEach(p => { $(p).hidden = true; }); });
  $('acBtn').addEventListener('click', () => { renderPicker(); openPop('acPop', $('acBtn'), false); });
  $('envBtn').addEventListener('click', () => { renderEnvPop(); openPop('envPop', $('envBtn'), true); });
  $('buildBtn').addEventListener('click', () => { S.build = !S.build; if(S.build) S.fly=false; layout(); });
  $('flyBtn').addEventListener('click', () => { S.fly = !S.fly; if(S.fly)S.build=false; layout(); });
  $('drawerH').addEventListener('click', () => { S.drawer = !S.drawer; layout(); });
  const tog = (id, key) => $(id).addEventListener('click', () => { const on = $(id).getAttribute('aria-pressed') !== 'true'; $(id).setAttribute('aria-pressed', String(on)); Scene3D.toggle(key, on); });
  tog('forcesBtn', 'forces'); tog('flowBtn', 'flow');
  $('pauseBtn').addEventListener('click', () => { const on = $('pauseBtn').getAttribute('aria-pressed') !== 'true'; $('pauseBtn').setAttribute('aria-pressed', String(on)); $('pauseBtn').innerHTML = C.icon(on ? 'play' : 'pause');$('pauseBtn').setAttribute('aria-label',on?'Play':'Pause'); FlightDirector.clearKeys();Scene3D.pause(on); });
  $('viewSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; Scene3D.setView(b.dataset.v); document.querySelectorAll('#viewSeg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  $('viewport').addEventListener('viewchange', () => document.querySelectorAll('#viewSeg button').forEach(x => x.setAttribute('aria-pressed', 'false')));
  $('profSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); Profile.setOpt(b.dataset.p, on); });
  const flightInput = (id, fn) => $(id).addEventListener('input', e => { fn(+e.target.value); fillRange(e.target); update(); });
  flightInput('spd', v => { S.V = v; });
  flightInput('alt', v => { S.h = v;FlightDirector.setAltitude(v); S.perfDirty = true; });
  flightInput('thr', v => { S.thr = v;FlightDirector.setThrottle(v); S.perfDirty = true; });
  flightInput('aoa', v => { S.alpha = v; });
  $('ab').addEventListener('change', e => { S.ab = e.target.checked; S.perfDirty = true; syncControls(); update(); });
  $('mast').addEventListener('change', e => { S.cfg.engineOut = e.target.checked; if (S.cfg.engineOut && S.thr < 0.3) S.thr = 1; S.ac = A.build(S.cfg); syncControls(); runPerf(); update(); toast(S.cfg.engineOut ? 'Engine out' : 'Engine folded away', S.cfg.engineOut ? 'The propeller rises on its mast. It can now climb — but it adds drag.' : 'Folded away, the engine adds no drag, so the glider keeps its long glide.', null); });
  $('aoaSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.auto = b.dataset.m === 'auto'; syncControls(); update(); });
  const retheme = () => { Profile.theme(); Charts.readColors(); S.chartDirty = true; };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  ['liftChart', 'dragChart'].forEach(id => new ResizeObserver(() => { S.chartDirty = true; }).observe($(id)));
  addEventListener('resize', layout);

  document.addEventListener('click',e=>{
    const ch=e.target.closest('[data-chart]');if(ch)selectChart(ch.dataset.chart);
    const tb=e.target.closest('[data-tab]');if(tb)selectTab(tb.dataset.tab);
    const mv=e.target.closest('[data-view]');if(mv)Scene3D.setView(mv.dataset.view);
    const mn=e.target.closest('[data-menu]');if(mn){$('morePop').hidden=true;$(mn.dataset.menu).click();}
    if(!e.target.closest('.pop')&&!e.target.closest('#overlaysBtn')&&!e.target.closest('#moreBtn'))['overlaysPop','morePop'].forEach(id=>$(id).hidden=true);
  });
  $('status').onclick=()=>{S.fly=true;if(innerWidth<600)S.drawer=false;selectTab('Controls');layout();};
  $('overlaysBtn').onclick=()=>openPop('overlaysPop',$('overlaysBtn'),true);
  $('moreBtn').onclick=()=>openPop('morePop',$('moreBtn'),true);
  $('valuesBtn').onclick=()=>{S.values=!S.values;$('valuesBtn').setAttribute('aria-pressed',String(S.values));update();};
  $('weatherBtn').onclick=()=>{const on=$('weatherBtn').getAttribute('aria-pressed')!=='true';$('weatherBtn').setAttribute('aria-pressed',String(on));Scene3D.toggle('weather',on);};
  $('themePicker').onchange=e=>{if(e.target.value==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=e.target.value;};
  $('unitsPicker').onchange=e=>{S.units=e.target.value;update();renderFacts();};
  $('focusChart').onclick=()=>{S.focus=!S.focus;S.drawer=true;layout();};
  $('showData').onclick=()=>{$('chartData').hidden=!$('chartData').hidden;$('showData').setAttribute('aria-pressed',String(!$('chartData').hidden));renderAnalysis();};
  $('performanceBtn').onclick=()=>{$('moreGrp').hidden=false;$('facts').hidden=true;$('performanceBtn').hidden=true;};
  $('performanceBack').onclick=()=>{$('moreGrp').hidden=true;$('facts').hidden=false;$('performanceBtn').hidden=false;};
  $('mobileTabs').onclick=e=>{const b=e.target.closest('[data-sheet]');if(!b)return;const name=b.dataset.sheet;S.drawer=name==='Charts';S.fly=name!=='Charts';if(S.fly)selectTab(name==='Controls'?'Controls':'Aircraft');document.querySelectorAll('[data-sheet]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));layout();};
  document.querySelectorAll('.seg').forEach(group=>group.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const bs=[...group.querySelectorAll('button')],i=bs.indexOf(document.activeElement);if(i<0)return;e.preventDefault();const b=bs[e.key==='Home'?0:e.key==='End'?bs.length-1:(i+(e.key==='ArrowRight'?1:-1)+bs.length)%bs.length];b.click();b.focus();}));
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){['acPop','envPop','overlaysPop','morePop','infoCard'].forEach(id=>$(id).hidden=true);S.focus=false;if(innerWidth<1024)S.fly=false;layout();return;}
    if(e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input,select,textarea'))return;
    if(e.code.startsWith('Digit')&&/[1-4]/.test(e.code.slice(-1))){e.preventDefault();const n=+e.code.slice(-1)-1;if(e.shiftKey)selectChart(['Airflow','Lift','Drag','Forces'][n]);else $('viewSeg').querySelectorAll('button')[n].click();}
    if(e.code==='Space'){e.preventDefault();if(!e.repeat)$('pauseBtn').click();}
    if(e.key.toLowerCase()==='i')$('flyBtn').click();if(e.key.toLowerCase()==='c')$('drawerH').click();if(e.key.toLowerCase()==='f')$('focusChart').click();
  });
  $('viewport').addEventListener('click',()=>{if(innerWidth>=600&&innerWidth<1024&&S.fly){S.fly=false;layout();}});
  ['spd','alt','thr','aoa'].forEach(id=>{
    const range=$(id),out=$(id+'Out');out.tabIndex=0;out.setAttribute('role','button');out.setAttribute('aria-label','Edit '+(id==='spd'?'speed':id==='alt'?'altitude':id==='thr'?'throttle':'angle'));
    const edit=()=>{if(range.disabled||out.querySelector('input'))return;const factor=id==='spd'?(S.units==='aviation'?1.94384:S.units==='imperial'?2.23694:3.6):id==='alt'&&S.units!=='metric'?3.28084:id==='thr'?100:1;const input=document.createElement('input');input.type='number';input.className='precise';input.min=+range.min*factor;input.max=+range.max*factor;input.step=id==='spd'?10:id==='thr'?5:range.step;input.value=(+range.value*factor).toFixed(id==='aoa'?1:0);input.setAttribute('aria-label','Precise '+({spd:'speed',alt:'altitude',thr:'throttle',aoa:'angle of attack'}[id]));out.replaceChildren(input);input.focus();input.select();let done=false;const commit=()=>{if(done)return;done=true;const n=input.value.trim()===''?NaN:Number(input.value);out.replaceChildren();if(Number.isFinite(n)){const value=Math.max(+range.min,Math.min(+range.max,n/factor));range.value=value;S[{spd:'V',alt:'h',thr:'thr',aoa:'alpha'}[id]]=value;if(id==='alt')FlightDirector.setAltitude(value);if(id==='thr')FlightDirector.setThrottle(value);S.perfDirty=true;S.chartDirty=true;}update();};input.onblur=commit;input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape'){done=true;out.replaceChildren();update();}};};out.onclick=edit;out.onkeydown=e=>{if(e.key==='Enter')edit();};
    range.addEventListener('keydown',e=>{if(e.shiftKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();range.value=+range.value+(e.key==='ArrowRight'||e.key==='ArrowUp'?1:-1)*+range.step*10;range.dispatchEvent(new Event('input',{bubbles:true}));}});
  });
  let sheetY=0;$('sheetHandle').addEventListener('pointerdown',e=>{sheetY=e.clientY;e.target.setPointerCapture(e.pointerId);});$('sheetHandle').addEventListener('pointerup',e=>{const dy=e.clientY-sheetY;if(Math.abs(dy)>20){if(dy<0){S.focus=S.drawer;S.drawer=true;}else if(S.focus)S.focus=false;else S.drawer=false;layout();}});
  new ResizeObserver(()=>{if(S.ac)layout();}).observe($('drawer'));

  /* ---------- start ---------- */
  Charts.readColors(); Charts.attach($('liftChart'), 'lift'); Charts.attach($('dragChart'), 'drag');
  Scene3D.init($('viewport'), $('labels'), window.WL_MODS);
  Env.set('place', S.place); Env.set('time', S.time); Env.set('weather', S.weather);
  Profile.init($('profile'));
  // optional start-up state from the link, e.g. #place=canyon&time=golden&ac=spitfire
  { const h = new URLSearchParams(location.hash.slice(1));
    if (Env.PLACES[h.get('place')]) S.place = h.get('place');
    if (Env.TIMES[h.get('time')]) S.time = h.get('time');
    if (Env.WEATHER[h.get('weather')]) S.weather = h.get('weather');
    Env.set('place', S.place); Env.set('time', S.time); Env.set('weather', S.weather);
    loadAircraft(A.AIRCRAFT[h.get('ac')] ? h.get('ac') : 'epic');
    if (h.has('h')&&Number.isFinite(+h.get('h'))) S.h = Math.max(0,+h.get('h'));
    if (h.get('fly') === '0') S.fly = false;
    if (h.get('charts') === '0') S.drawer = false; }
  rebuild(); renderEnvPop(); try{selectTab(sessionStorage.getItem('winglab-tab')||'Controls');}catch{selectTab('Controls');} syncPilot(); layout();

  let thumbsRunning=false,thumbQueue=null;
  function makeThumbs() {
    if(thumbsRunning)return;thumbsRunning=true;
    thumbQueue=Object.keys(A.AIRCRAFT).filter(id=>!S.thumbs[id]);
    const next=()=>{
      const id=thumbQueue.shift();if(!id){thumbsRunning=false;Scene3D.releaseThumbnails?.();return;}
      try{S.thumbs[id]=Scene3D.thumbnail(Model.build(A.build(A.defaultCfg(id))),480,280);}catch(e){console.warn('Aircraft preview unavailable:',id,e);}
      if(id===S.cfg.aircraft){$('acThumb').src=S.thumbs[id]||'';$('acThumb').hidden=!S.thumbs[id];}
      // Replace just the image: preserve keyboard focus and selection while the menu fills.
      const imageHost=$('acGrid').querySelector(`[data-ac="${id}"] .th`);
      if(imageHost)imageHost.innerHTML=S.thumbs[id]?`<img src="${S.thumbs[id]}" alt="${A.AIRCRAFT[id].short} model preview">`:'<span class="preview-pending">Preview unavailable</span>';
      setTimeout(next,180);
    };setTimeout(next,50);
  }
  let last = null, frames = 0, profileTime = 0;
  function loop(t) {
    const dt = last === null ? 0 : Math.max(0, Math.min(0.05, (t - last) / 1000)); last = t;
    if (S.perfDirty && t - S.perfT > 160) runPerf();
    if (S.chartDirty && t - S.chartT > 90 && S.drawer) drawCharts();
    Scene3D.frame(dt); if (S.drawer && S.chart==='Airflow') { if(!matchMedia('(prefers-reduced-motion:reduce)').matches&&$('pauseBtn').getAttribute('aria-pressed')!=='true')profileTime+=dt*1000;Profile.draw(profileTime); renderAnalysis(); }
    const inf = Profile.info();
    if (inf && Math.abs(inf.vmax - S.lastVmax) > 0.005) { S.lastVmax = inf.vmax;
      $('hlProfile').innerHTML = S.f.stalled || S.f.c.sig > 0.5 ? 'The air <em>breaks away</em> from the top — the wing is stalling.' : inf.vmax > 1.02 ? `Over the top, the air speeds up to <em>${inf.vmax.toFixed(1)}×</em> flight speed, so the pressure there drops.` : 'At this angle the wing makes almost no lift.'; }
    if (++frames === 3) { $('loading').style.opacity = 0; setTimeout(() => { $('loading').hidden = true; }, 600); /* Picker uses text labels; avoid seven extra GPU contexts at startup. */ }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
