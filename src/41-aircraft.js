/* ================= Model: the seven aircraft, built to scale from published dimensions ================= */
const Model = (() => {
  const T = THREE, K = Kit, D2R = Math.PI / 180;
  const V3 = (x, y, z) => new T.Vector3(x, y, z);

  /* Approximate fuselage stations informed by published three-views (see AIRCRAFT-REFERENCES.md): [x/L, half-width, top, bottom, centre height] in metres */
  const DEFS = {
    stearman: { n: 3.2, f0: 0.05, finSweep: 20, tailY: 0.05, tailShape: 'round',
      st: [[.05, .36, .40, .40, .10], [.10, .42, .46, .44, .10], [.2, .43, .52, .46, .10], [.33, .42, .52, .46, .11], [.5, .36, .45, .40, .14], [.68, .26, .36, .30, .2], [.85, .15, .26, .18, .26], [.97, .06, .17, .08, .30], [1, .03, .12, .04, .31]],
      colors: { wing: '#F2B20C', fin: '#F2B20C', body: '#26458F' },
      paint(p, L) { p.fill('#26458F'); p.roundel(0.62, 0, 0.38, [[1, '#1B2F66'], [0.82, '#FFFFFF'], [0.34, '#C8102E']], L, 3.0); p.band(-90, -80, '#1E3A7A'); },
      finPaint(p) { p.fill('#F2B20C'); for (let i = 0; i < 13; i++) { p.region(0, 0.16, i / 13, (i + 0.5) / 13, '#C8102E'); p.region(0.84, 1, i / 13, (i + 0.5) / 13, '#C8102E'); } p.region(0.16, 0.24, 0, 1, '#1B2F66'); p.region(0.76, 0.84, 0, 1, '#1B2F66'); } },
    spitfire: { n: 2.2, finSweep: 0, tailY: 0.08, tailShape: 'ellipse',
      st: [[0, .24, .26, .26, .12], [.04, .34, .38, .38, .10], [.12, .39, .44, .46, .08], [.25, .42, .50, .50, .06], [.37, .41, .50, .52, .06], [.48, .36, .46, .48, .10], [.62, .29, .40, .40, .16], [.78, .2, .33, .30, .22], [.92, .11, .27, .20, .27], [1, .03, .2, .08, .29]],
      colors: { wing: '#6F7376', fin: '#6F7376', body: '#6F7376' },
      paint(p, L) {
        p.fill('#A9AEB1'); p.band(-8, 188, '#6F7376'); p.blobs(0.3, 0.7, '#3E4735', 34, 5, 0.05);
        p.region(0.8, 0.84, 0, 1, '#C3D6BE');
        p.roundel(0.66, 0, 0.45, [[1, '#E6B800'], [0.84, '#1C2F6E'], [0.56, '#FFFFFF'], [0.36, '#B01C2E']], L, 2.8);
        p.text(0.52, 0, 'WL·A', 0.5, '#A9AEB1', L, 2.8);
      },
      wingPaint(p, geo) { p.fill('#A9AEB1'); p.region(0.5, 1, 0, 1, '#6F7376'); p.blobs(0.0, 1.0, '#3E4735', 14, 9, 0.07); p.region(0, 0.5, 0, 1, '#A9AEB1');
        p.wingRoundel(0.73, 0.68, 0.85, [[1, '#1C2F6E'], [0.4, '#B01C2E']], geo); },
      finPaint(p) { p.fill('#6F7376'); p.region(0.55, 0.7, 0, 0.55, '#1C2F6E'); p.region(0.58, 0.67, 0, 0.55, '#FFFFFF'); p.region(0.6, 0.65, 0, 0.55, '#B01C2E'); } },
    ventus: { n: 2.0, finSweep: 22, tailShape: 'trap',
      st: [[0, 0, 0, 0, .02], [.03, .16, .18, .18, .02], [.1, .28, .30, .30, .03], [.2, .31, .34, .33, .05], [.3, .29, .33, .31, .06], [.4, .22, .26, .24, .08], [.52, .13, .16, .13, .11], [.7, .085, .11, .085, .14], [.9, .07, .10, .07, .16], [1, .05, .06, .05, .17]],
      colors: { wing: '#F7F8F8', fin: '#F7F8F8', body: '#F7F8F8' },
      paint(p, L) { p.fill('#F7F8F8'); p.text(0.72, 5, 'D-KWLB', 0.22, '#1B2C4A', L, 1.2); p.region(0, 0.02, 0, 1, '#E4E7EA'); },
      finPaint(p) { p.fill('#F7F8F8'); p.region(0, 1, 0.85, 1, '#C8102E'); } },
    epic: { n: 2.3, finSweep: 38, tailY: 0.1, tailShape: 'trap',
      st: [[0, .26, .28, .26, .02], [.04, .38, .42, .38, .03], [.1, .48, .54, .46, .05], [.18, .57, .66, .54, .08], [.28, .62, .74, .58, .10], [.45, .62, .74, .58, .12], [.58, .55, .66, .50, .16], [.74, .36, .46, .32, .28], [.9, .18, .30, .16, .40], [1, .06, .14, .06, .46]],
      colors: { wing: '#F4F5F6', fin: '#F4F5F6', body: '#F4F5F6' },
      paint(p, L) {
        p.fill('#F4F5F6'); p.band(-90, -22, '#C4C9CE'); p.band(-6, -3.5, '#1B2C4A', 0.08, 1); p.band(-9, -7.5, '#B3202A', 0.12, 1);
        p.dotsSide(15, 0.335, 0.53, 0.065, 0.031, 21, '#142536'); p.text(.69, 7, 'N100WL', .22, '#233b56', L, 4.5); p.region(0, 0.04, 0, 1, '#DADDE0');
      },
      finPaint(p) { p.fill('#F4F5F6'); p.region(0, 1, 0.55, 0.62, '#1B2C4A'); p.region(0, 1, 0.66, 0.7, '#B3202A'); } },
    b737: { n: 2.0, finSweep: 35, tailY: -0.1, tailShape: 'trap', tailDih: 7,
      st: [[0, 0, 0, 0, -.3], [.01, .5, .45, .55, -.35], [.03, 1.1, 1.05, 1.15, -.25], [.06, 1.6, 1.65, 1.75, -.1], [.11, 1.86, 1.95, 1.95, 0], [.18, 1.88, 1.98, 1.98, 0], [.68, 1.88, 1.98, 1.98, 0], [.78, 1.7, 1.85, 1.55, .15], [.88, 1.2, 1.35, .9, .55], [.96, .6, .75, .35, .95], [1, .2, .28, .15, 1.2]],
      colors: { wing: '#D9DEE3', fin: '#1B3A6B', body: '#F5F6F7' },
      paint(p, L) {
        p.fill('#F5F6F7'); p.band(-90, -16, '#C7D0DA'); p.band(-13, -9, '#1B3A6B', 0.03, 0.97); p.band(-8.4, -7.6, '#E8621C', 0.05, 0.9);
        p.dotsSide(10, 0.13, 0.74, 0.0133, 0.0045, 8, '#141C26');
        p.cockpit([[0.028, 12], [0.052, 15], [0.05, 31], [0.034, 36]]);
        p.text(0.36, 26, 'WING LAB AIR', 0.95, '#1B3A6B', L, 12);
        p.door(.105,.029,-19,27);p.door(.78,.029,-19,27);p.door(.44,.018,3,26);p.door(.465,.018,3,26);p.text(.82,2,'N737WL',.32,'#284361',L,12);
      },
      finPaint(p) { p.fill('#1B3A6B'); p.region(0, 1, 0.22, 0.3, '#E8621C'); } },
    concorde: { n: 2.0, finSweep: 52, tailShape: 'trap', droop: 0.085,
      st: [[0, 0, 0, 0, 0], [.015, .12, .12, .12, -.01], [.05, .45, .45, .45, -.04], [.1, .92, .95, .95, -.02], [.16, 1.3, 1.38, 1.36, 0], [.25, 1.44, 1.5, 1.5, 0], [.68, 1.44, 1.5, 1.5, 0], [.82, 1.25, 1.35, 1.15, .1], [.93, .75, .9, .55, .3], [1, .2, .35, .12, .5]],
      colors: { wing: '#F2F3F5', fin: '#F2F3F5', body: '#F4F5F7' },
      paint(p, L) { p.fill('#F4F5F7'); p.dotsSide(6, 0.16, 0.74, 0.0105, 0.0028, 6, '#18212B'); p.cockpit([[0.086, 14], [0.098, 18], [0.097, 34], [0.088, 38]]); p.band(-11, -10, '#1B3A6B', 0.1, 0.95);p.text(.32,24,'CONCORDE',.65,'#1B3A6B',L,9);p.door(.146,.019,-15,25);p.door(.77,.019,-15,25); },
      finPaint(p) { p.fill('#F2F3F5'); p.region(0.0, 0.5, 0.35, 0.45, '#1B3A6B'); p.region(0.0, 0.5, 0.48, 0.52, '#B3202A'); } },
    overture: { n: 2.0, finSweep: 55, tailY: 0.2, tailShape: 'trap',
      st: [[0, 0, 0, 0, 0], [.02, .18, .18, .18, -.01], [.07, .75, .78, .76, 0], [.14, 1.3, 1.4, 1.35, .05], [.26, 1.62, 1.72, 1.62, .05], [.42, 1.45, 1.6, 1.5, .05], [.58, 1.6, 1.7, 1.6, .05], [.78, 1.35, 1.45, 1.25, .15], [.92, .75, .85, .55, .35], [1, .2, .32, .15, .5]],
      colors: { wing: '#EEF0F2', fin: '#0F1E3A', body: '#F5F6F8' },
      paint(p, L) { p.fill('#F5F6F8'); p.dotsSide(7, 0.2, 0.7, 0.016, 0.0034, 6, '#18212B'); p.cockpit([[0.06, 12], [0.085, 16], [0.083, 30], [0.066, 34]]); p.band(-90, -30, '#E3E6EA'); p.band(-12, -11, '#C9A227', 0.12, 0.96);p.text(.31,26,'OVERTURE',.74,'#18324c',L,10);p.door(.165,.021,-15,26);p.door(.76,.021,-15,26); },
      finPaint(p) { p.fill('#0F1E3A'); p.region(0, 1, 0.12, 0.16, '#C9A227'); } }
  };

  /* extra painter helpers that need geometry */
  function paintKit(c) {
    const p = K.painter(c), g = p.g, W = p.W, H = p.H, vy = v => (1 - v) * H;
    p.text = (u, a, s, hM, col, L, girth) => {   // lettering that reads correctly on both sides of the body
      [[0.25 + a / 360, -1, 1], [0.75 - a / 360, 1, -1]].forEach(([v, sx, sy]) => {
        g.save(); g.translate(u * W, vy(v)); g.scale(sx * (girth / L) * (W / H) * 1, sy);
        g.font = `600 ${hM / girth * H}px -apple-system, "Helvetica Neue", Arial, sans-serif`; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(s, 0, 0); g.restore();
      });
    };
    p.cockpit = pts => { [[0.25, 1], [0.75, -1]].forEach(([vs, sg]) => p.poly(pts.map(([u, a]) => [u, vs + sg * a / 360]), '#0C131C')); p.region(pts[0][0], pts[1][0] - 0.004, 0.5 - 20 / 360, 0.5 + 20 / 360, '#0C131C'); };
    p.door=(u,w,a0,a1)=>{for(const [v,sg] of [[.25,1],[.75,-1]]){const y0=vy(v+sg*a0/360),y1=vy(v+sg*a1/360);g.strokeStyle='rgba(46,63,75,.6)';g.lineWidth=1.4;g.beginPath();g.roundRect((u-w/2)*W,Math.min(y0,y1),w*W,Math.abs(y1-y0),3);g.stroke();g.fillStyle='#8b969d';g.fillRect((u+w*.08)*W,(y0+y1)*.5,w*W*.24,2);}};
    p.wingRoundel = (u, v, R, rings, geo) => {
      const c = geo.chord(v), ru = R / c / Math.PI, rv = R / geo.s;
      rings.forEach(([f, col]) => { g.fillStyle = col; g.beginPath(); g.ellipse(u * W, vy(v), ru * f * W, rv * f * H, 0, 0, Math.PI * 2); g.fill(); });
    };
    return p;
  }

  function mkMaterials(id, def) {
    const M = K.materials();
    const bc = K.canvas(2048, 1024), bp = paintKit(bc); def.paint(bp, Aero.AIRCRAFT[id].L);
    const finish=id==='stearman'?{roughness:.58,clearcoat:.16}:id==='spitfire'?{roughness:.56,clearcoat:.12}:['epic','ventus','overture'].includes(id)?{roughness:.25,clearcoat:.72}:{roughness:.34,clearcoat:.48};
    if(id==='epic')bp.door(.30,.047,-25,34);
    M.body = M.phys('#ffffff', { ...finish,map: bp.tex() });
    M.wing = M.phys(def.colors.wing,finish);
    if (def.wingPaint) M.wingPainted = geo => { const c = K.canvas(1024, 1024), p = paintKit(c); def.wingPaint(p, geo); return M.phys('#ffffff', {...finish,map:p.tex()}); };
    const fc = K.canvas(512, 512), fp = paintKit(fc); (def.finPaint || (q => q.fill(def.colors.fin)))(fp);
    M.fin = M.phys('#ffffff', {...finish,map: fp.tex() });
    if(id==='stearman')M.wingPainted=geo=>{const c=K.canvas(1024,1024),p=paintKit(c);p.fill('#EFB522');for(let v=.03;v<1;v+=.045)p.region(0,1,v,v+.002,'rgba(146,104,28,.2)');p.wingRoundel(.72,.72,.48,[[1,'#203967'],[.78,'#faf4de'],[.31,'#bd2735']],geo);return M.phys('#ffffff',{...finish,map:p.tex()});};
    if(id==='ventus')M.wingPainted=geo=>{const c=K.canvas(512,512),p=paintKit(c);p.fill('#F7F8F8');p.region(0,1,.955,1,'#C52E37');p.region(.865,.87,.2,.96,'#a2abb2');return M.phys('#ffffff',{...finish,map:p.tex()});};
    M.tail = def.colors.fin === def.colors.wing ? M.wing : M.phys(def.colors.wing,finish);
    return M;
  }

  /* ---------- assemble ---------- */
  function build(ac) {
    const A = ac.A, id = ac.cfg.aircraft, def = DEFS[id], L = A.L, xcg = A.xcg, geo = ac.geo, M = mkMaterials(id, def);
    const grp = new T.Group(), anim = { props: [], fans: [], flames: [], lights: [], mast: null, droop: null, strobe: [], exhausts: [], controls: [] };
    const add = (m, sh = true) => { m.castShadow = sh; m.receiveShadow = sh; grp.add(m); return m; };
    const X = s => xcg - s;                     // station (m from nose) → model x
    const st = def.st, S = f => K.sample(st, Math.min(1, Math.max(0, f)));
    const spec = ac.spec, kind = ac.eng.kind, mount = A.engine.mount, jetNose = spec && kind === 'jet' && mount === 'nose';

    // fuselage (Concorde's nose is a separate part that droops)
    const f0 = def.f0 || 0, split = def.droop || f0;
    const girth = (() => { const q = S(0.4); return 3.3 * (q[1] + (q[2] + q[3]) / 2); })();
    const pnl = (m, su, sv, kind) => { m.userData.panel = [su, sv, ['ventus','epic','overture'].includes(id)?(kind===1?3:4):id==='stearman'?(kind===1?5:6):kind]; return m; };
    // Split the actual airfoil into fixed and hinged meshes, keeping the paint UVs.
    const controlledSurface=(g,foil,pl,zfn,mat,type,opt={})=>{
      const root=new T.Group(),lo=opt.lo??.50,hi=opt.hi??.96,hinge=opt.hinge??.73;
      const mesh=o=>{const m=pnl(new T.Mesh(K.surface(g,foil,pl,zfn,{round:opt.round||0,...o}),mat),2*g.MAC,g.s,2);m.castShadow=m.receiveShadow=true;return m;};
      for(const side of opt.sides||[1,-1]){
        if(lo>0)root.add(mesh({sides:[side],e1:lo,ns:16}));
        if(hi<1)root.add(mesh({sides:[side],e0:hi,ns:8}));
        root.add(mesh({sides:[side],e0:lo,e1:hi,xMax:hinge-.0015,ns:24}));
        const start=V3(pl.x-g.xle(lo)-hinge*g.chord(lo),pl.y+zfn(lo)*g.s,side*lo*g.s);
        const end=V3(pl.x-g.xle(hi)-hinge*g.chord(hi),pl.y+zfn(hi)*g.s,side*hi*g.s);
        const pivot=new T.Group(),axis=end.clone().sub(start).multiplyScalar(side).normalize();pivot.position.copy(start);
        const moving=mesh({sides:[side],e0:lo+.001,e1:hi-.001,xMin:hinge+.0015,ns:24});moving.geometry.translate(-start.x,-start.y,-start.z);pivot.add(moving);root.add(pivot);
        pivot.name=type+(side>0?' right':' left');anim.controls.push({pivot,axis,type,side,angle:0});
      }return root;
    };
    add(pnl(new T.Mesh(K.loft(st, L, xcg, def.n, split, 1), M.body), L, girth, 1));
    if (def.droop) {
      const piv = new T.Group(), s = S(split); piv.position.set(X(split * L), s[4] + s[2] * 0.3, 0);
      const nose = pnl(new T.Mesh(K.loft(st, L, xcg, def.n, 0, split, 64, 30), M.body), L, girth, 1); nose.position.set(-piv.position.x, -piv.position.y, 0);
      nose.castShadow = true; piv.add(nose); grp.add(piv); anim.droop = piv;
    }

    // wings
    const tR = ac.foil.t * geo.cr, rootMid = Math.min(0.95, Math.max(0.05, (ac.rootLE + geo.cr * 0.5) / L)), sm = S(rootMid);
    const yFor = pos => ({ parasol: sm[4] + sm[2] + Math.max(0.45 * (sm[2] + sm[3]), 0.5 * tR + 0.3), high: sm[4] + sm[2] - 0.55 * tR,
      mid: sm[4] - (ac.foil.m ? 0.3 * tR : 0), low: sm[4] - sm[3] + 0.6 * tR }[pos]);
    const own = k => ac.cfg[k] === A.cfg[k];
    const wingMat = M.wingPainted && own('planform') ? M.wingPainted(geo) : M.wing;
    const round = own('planform') && (id === 'stearman' || id === 'epic') ? 0.06 : 0;
    const wings = [];
    if (ac.biplane) {
      const gap = A.biplane ? A.biplane.gap : 1.1 * (sm[2] + sm[3]), stag = A.biplane ? A.biplane.stagger : 0.35;
      const yLo = sm[4] - sm[3] * 0.72, yUp = yLo + gap;
      wings.push({ x: X(ac.rootLE), y: yLo }, { x: X(ac.rootLE) + stag, y: yUp });
    } else wings.push({ x: X(ac.rootLE), y: yFor(ac.cfg.position) });
    wings.forEach((w,i)=>{
      const zfn=i===1?(()=>0):ac.dfn.z;
      if(id==='stearman'&&ac.biplane&&i===1)add(pnl(new T.Mesh(K.surface(geo,ac.foil,w,zfn,{round}),wingMat),2*geo.MAC,geo.s,2));
      else grp.add(controlledSurface(geo,ac.foil,w,zfn,wingMat,ac.tailless?'elevon':'aileron',{round,lo:ac.tailless?.18:.50,hi:.96,hinge:ac.tailless?.77:.73}));
    });
    const main = wings[wings.length - 1];
    const wingY = e => main.y + ac.dfn.z(e) * geo.s, wingLE = e => main.x - geo.xle(e);
    if (A.winglets && own('planform') && !ac.biplane) {
      const ct = Math.max(geo.chord(1), geo.cr * 0.12), h = Math.max(0.25, geo.s * (id === 'b737' ? 0.14 : 0.05)), wg = K.trapGeo(ct * h * 1.1, 2 * h, 0.35, 38);
      [1, -1].forEach(sd => { const m = new T.Mesh(K.surface(wg, { m: 0, p: 0, t: 0.09 }, { x: 0, y: 0 }, () => 0, { sides: [1], ns: 10 }), M.wing);
        m.rotation.x = -Math.PI / 2; m.rotation.z = -sd * 0.12; m.position.set(wingLE(1), wingY(1) + ac.foil.t * ct * 0.3, sd * geo.s * 0.998); add(m); });
    }
    if (ac.biplane) {   // struts and bracing wires
      const e = 0.62, zs = e * geo.s, lo = wings[0], up = wings[1], c = geo.chord(e);
      [1, -1].forEach(sd => {
        [0.22, 0.68].forEach(fr => add(K.rod(V3(lo.x - geo.xle(e) - fr * c, lo.y + ac.dfn.z(e) * geo.s + 0.03, sd * zs), V3(up.x - geo.xle(e) - fr * c, up.y - 0.03, sd * zs), 0.035, M.metal, 2.4)));
        [0.25, 0.6].forEach(fr => add(K.rod(V3(X(ac.rootLE + fr * geo.cr) + 0.2, sm[4] + sm[2] * 0.9, sd * 0.25), V3(up.x - fr * geo.cr, up.y - 0.02, sd * 0.45), 0.025, M.metal)));
        add(K.rod(V3(lo.x - 0.3 * c, lo.y + 0.05, sd * 0.5), V3(up.x - geo.xle(e) - 0.3 * c, up.y, sd * (zs - 0.1)), 0.006, M.steel));
        add(K.rod(V3(up.x - 0.3 * c, up.y, sd * 0.5), V3(lo.x - geo.xle(e) - 0.3 * c, lo.y + ac.dfn.z(e) * geo.s, sd * (zs - 0.1)), 0.006, M.steel));
      });
    } else if (ac.cfg.position === 'parasol') {
      const e = 0.42, xs = wingLE(e) - 0.35 * geo.chord(e);
      [1, -1].forEach(sd => {
        add(K.rod(V3(xs + 0.1, sm[4] - sm[3] * 0.4, sd * sm[1] * 0.9), V3(xs, wingY(e) - 0.03, sd * e * geo.s), 0.04, M.metal, 2));
        [0, -0.5].forEach(dx => add(K.rod(V3(main.x - 0.2 * geo.cr + dx, sm[4] + sm[2] * 0.9, sd * sm[1] * 0.5), V3(main.x - 0.2 * geo.cr + dx, main.y - 0.03, sd * sm[1] * 0.8), 0.03, M.metal)));
      });
    }

    // tail surfaces
    const tailFoil = { m: 0, p: 0, t: 0.1 }, ts = S(Math.min(0.97, A.tail.x / L));
    const hv = Math.sqrt(1.5 * A.tail.Sv), finSw = def.finSweep;
    const vg = def.tailShape === 'ellipse' ? Aero.wingGeometry({ kind: 'ellipse', f: 0.35 }, 2 * A.tail.Sv, 2 * hv) : K.trapGeo(2 * A.tail.Sv, 2 * hv, 0.42, finSw);
    const finX = Math.min(L - 0.4 * vg.cr, A.tail.x - 0.1 * vg.cr);
    const fs = S(Math.min(0.97, (finX + 0.2 * vg.cr) / L)), finY = fs[4] + fs[2] * 0.75;
    const fin=controlledSurface(vg,tailFoil,{x:0,y:0},()=>0,M.fin,'rudder',{lo:.10,hi:.94,hinge:.66,sides:[1]});
    fin.rotation.x=-Math.PI/2;fin.position.set(X(finX-.25*vg.cr),finY,0);grp.add(fin);
    if (!ac.tailless && A.tail.S > 0) {
      const bt = Math.sqrt(A.tail.AR * A.tail.S);
      const tg = def.tailShape === 'ellipse' ? Aero.wingGeometry({ kind: 'ellipse', f: 0.3 }, A.tail.S, bt) : K.trapGeo(A.tail.S, bt, 0.5, A.tail.sweep);
      let tx = X(A.tail.x - tg.xac), ty = ts[4] + (def.tailY || 0);
      if (A.tail.T) { tx = X(finX - 0.25 * vg.cr) - vg.xle(1) - 0.05; ty = finY + hv * 0.98; }
      const td = Math.tan((def.tailDih || 0) * D2R);
      grp.add(controlledSurface(tg,tailFoil,{x:tx,y:ty},e=>e*td,M.tail,'elevator',{lo:.07,hi:.94,hinge:.64,round:def.tailShape==='round'?.2:0}));
    }

    // engines
    const nose = st[0], noseX = X(f0 * L);
    if (spec) {
      if (mount === 'nose' && kind === 'prop') {
        const R = spec.R || Math.min(2.2, 0.052 * Math.sqrt(spec.P)), hub = Math.max(0.12, nose[1] * 0.85);
        const pr = K.propeller(R, spec.blades || 3, id === 'stearman' ? 0.14 : hub, M, id === 'spitfire' ? 2.6 : 1.8);
        pr.position.set(noseX + (id === 'stearman' ? 0.25 : 0.03), nose[4], 0); grp.add(pr); anim.props.push(pr);
        [1, -1].forEach(sd => anim.exhausts.push(V3(X(0.16 * L), nose[4] - 0.1, sd * (nose[1] + 0.12))));
        if (A.engine.radial && spec.type === 'piston') {   // exposed seven-cylinder radial
          const x0 = noseX + 0.12; add(new T.Mesh(new T.CylinderGeometry(0.22, 0.26, 0.28, 20).rotateZ(Math.PI / 2), M.steel)).position.set(x0, nose[4], 0);
          for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, cyl = new T.Mesh(new T.CylinderGeometry(0.075, 0.085, 0.34, 10), M.steel);
            cyl.position.set(x0, nose[4] + Math.cos(a) * 0.36, Math.sin(a) * 0.36); cyl.rotation.x = -a; add(cyl);
            const head = new T.Mesh(new T.BoxGeometry(0.12, 0.08, 0.12), M.hot); head.position.set(x0, nose[4] + Math.cos(a) * 0.54, Math.sin(a) * 0.54); head.rotation.x = -a; add(head); }
        }
        if (spec.type === 'turboprop' || id === 'spitfire') [1, -1].forEach(sd => { for (let i = 0; i < (id === 'spitfire' ? 6 : 1); i++) {
          const ex = new T.Mesh(new T.CylinderGeometry(0.05, 0.07, 0.18, 10), M.hot); ex.rotation.x = Math.PI / 2; const s = S(0.06 + i * 0.022);
          ex.position.set(X((0.06 + i * 0.022) * L), s[4] + (id === 'spitfire' ? 0.12 : 0.05), sd * (s[1] + 0.02)); add(ex); } });
      } else if (mount === 'nose' && kind === 'jet') {
        const mouth = new T.Mesh(new T.CircleGeometry(Math.max(0.2, nose[1] * 0.8), 32), M.black); mouth.rotation.y = Math.PI / 2; mouth.position.set(noseX + 0.02, nose[4], 0); grp.add(mouth);
        const end = st[st.length - 1], rr = Math.max(0.25, S(0.93)[1] * 0.8);
        const noz = new T.Mesh(K.lathe([[rr, 0.1], [rr * 1.02, -0.3], [rr * 0.85, -0.7]]), M.hot); noz.material = M.hot; noz.position.set(X(L), end[4], 0); add(noz);
        const f = K.flame(rr * 0.8, 6, M); f.position.set(X(L) - 0.7, end[4], 0); grp.add(f); anim.flames.push(f); anim.exhausts.push(V3(X(L), end[4], 0));
      } else if (mount === 'mast') {
        const hinge = new T.Group(), sPos = S(0.44); hinge.position.set(X(0.44 * L), sPos[4] + sPos[2] * 0.85, 0);
        const pylon = new T.Mesh(new T.BoxGeometry(0.22, 0.9, 0.07), M.nacelle); pylon.position.y = 0.45; hinge.add(pylon);
        if (kind === 'prop') { const pr = K.propeller(0.72, 2, 0.08, M, 1.6); pr.position.set(0.12, 0.92, 0); hinge.add(pr); anim.props.push(pr); }
        else { const n = K.nacelleFan(0.18, 0.9, M, false); n.position.set(0, 0.95, 0); hinge.add(n); anim.fans.push(n); }
        grp.add(hinge); anim.mast = hinge;
      } else {
        const pairs = { wing2: [0.34], concorde: [0.32, 0.455], overture: [0.30, 0.62] }[mount] || [0.34];
        pairs.forEach(e => [1, -1].forEach(sd => {
          const c = geo.chord(e), xL = wingLE(e), yLow = wingY(e) + (ac.foil.m - 0.5 * ac.foil.t) * c, z = sd * e * geo.s;
          if (kind === 'prop') {
            const Rn = Math.min(1.1, 0.02 * Math.sqrt(spec.P)), Ln = Rn * 6, cx = xL - Ln * 0.2;
            add(new T.Mesh(K.lathe([[0.55 * Rn, Ln * 0.5], [0.9 * Rn, Ln * 0.42], [Rn, Ln * 0.2], [0.95 * Rn, -Ln * 0.1], [0.4 * Rn, -Ln * 0.45], [0, -Ln * 0.5]]), M.nacelle)).position.set(cx, yLow + 0.05, z);
            const pr = K.propeller(Math.min(3, 0.055 * Math.sqrt(spec.P)), spec.blades || 4, 0.5 * Rn, M); pr.position.set(cx + Ln * 0.5, yLow + 0.05, z); grp.add(pr); anim.props.push(pr); anim.exhausts.push(V3(cx - Ln * 0.45, yLow + 0.05, z));
          } else if (mount === 'wing2') {
            const bypass = kind === 'jet' && spec.type === 'turbofan', Rn = bypass ? 1.0 : 0.7, Ln = bypass ? 4.2 : 5.2;
            const n = K.nacelleFan(Rn, Ln, M, bypass), cx = xL - 0.3 * Ln, cy = yLow - Rn - 0.35; n.scale.y = bypass ? 0.94 : 1;
            n.position.set(cx, cy, z); n.traverse(o => { o.castShadow = true; }); grp.add(n); anim.fans.push(n); anim.exhausts.push(V3(cx - Ln * 0.7, cy, z));
            add(new T.Mesh(new T.BoxGeometry(Ln * 0.66, 0.6, 0.2), M.nacelle)).position.set(cx - 0.1 * Ln, cy + Rn * 0.95, z);
            if (!bypass) { const f = K.flame(Rn * 0.6, 7, M); f.position.set(cx - Ln / 2 - 0.2, cy, z); grp.add(f); anim.flames.push(f); }
          } else if(mount==='overture') {
            const Rn=1.06,Ln=8.5,cx=xL-c*.46,cy=yLow-Rn-0.5;
            const n=K.nacelleFan(Rn,Ln,M,true);n.position.set(cx,cy,z);grp.add(n);anim.fans.push(n);anim.exhausts.push(V3(cx-Ln*.7,cy,z));
            add(new T.Mesh(new T.BoxGeometry(Ln*.55,.9,.22),M.nacelle)).position.set(cx-.4,cy+Rn,z);
          } else {   // Concorde's rectangular variable-geometry intakes
            const Rn = mount === 'concorde' ? 0.72 : 0.95, Ln = mount === 'concorde' ? 11 : 8.5, cx = xL - c * 0.72, cy = yLow - Rn * 0.85;
            const box = [[0, .9, .9, .9, 0], [.08, 1, 1, 1, 0], [.85, 1, 1, 1, 0], [1, .85, .85, .85, 0]];
            const nm = new T.Mesh(K.loft(box, Ln, cx + Ln / 2, mount === 'concorde' ? 4.5 : 2.2, 0, 1, 40, 20), M.nacelle);
            nm.scale.set(1, Rn, Rn * (mount === 'concorde' ? 1.15 : 1)); nm.position.set(0, cy, z); add(nm);
            const mouth = new T.Mesh(new T.PlaneGeometry(Rn * 1.6, Rn * 1.5), M.black); mouth.rotation.y = Math.PI / 2; mouth.position.set(cx + Ln / 2 + 0.02, cy, z); grp.add(mouth);
            add(new T.Mesh(new T.BoxGeometry(1.4,.075,Rn*1.45),M.steel)).position.set(cx+Ln/2-.5,cy+Rn*.37,z);
            const noz = new T.Mesh(K.lathe([[Rn * 0.8, 0], [Rn * 0.72, -0.9]]), M.hot); noz.material = M.hot; noz.position.set(cx - Ln / 2, cy, z); add(noz);
            const f = K.flame(Rn * 0.62, 9, M); f.position.set(cx - Ln / 2 - 0.9, cy, z); grp.add(f); anim.flames.push(f); anim.exhausts.push(V3(cx - Ln / 2, cy, z));
            anim.fans.push({ userData: { fan: new T.Group() } });
          }
        }));
      }
    }

    // aircraft-specific details
    const glass = (x, y, len, h, w) => { const m = new T.Mesh(new T.SphereGeometry(1, 40, 20), M.glass); m.scale.set(len, h, w); m.position.set(x, y, 0); add(m); return m; };
    const framedCanopy=(x,y,len,h,w)=>{
      glass(x,y,len,h,w);
      for(const f of [-.55,.5]){const rr=Math.sqrt(1-f*f),pts=[];for(let k=0;k<=20;k++){const a=k/20*Math.PI;pts.push(V3(x+len*f,y+h*rr*Math.sin(a)+.006,w*rr*Math.cos(a)));}add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts),24,.013,6,false),M.body));}
      for(const sd of [-1,1])add(K.rod(V3(x-len*.8,y+.01,sd*w*.55),V3(x+len*.8,y+.01,sd*w*.55),.018,M.body));
    };
    const glazing=(u0,u1,a0,a1)=>{for(const sd of [-1,1]){
      const pos=[],ix=[],nu=12,nv=10,ex=2/def.n;
      for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++){const u=u0+(u1-u0)*i/nu,a=(a0+(a1-a0)*j/nv)*D2R,q=S(u);pos.push(X(u*L),q[4]+(q[2]+.012)*Math.pow(Math.sin(a),ex),sd*(q[1]+.012)*Math.pow(Math.cos(a),ex));}
      for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const a=i*(nv+1)+j,b=a+nv+1;ix.push(a,b,a+1,b,b+1,a+1);}
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(ix);g.computeVertexNormals();add(new T.Mesh(g,M.glass));
      for(const col of [0,nv]){const pts=[];for(let i=0;i<=nu;i++){const k=(i*(nv+1)+col)*3;pts.push(V3(pos[k],pos[k+1],pos[k+2]));}add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts),16,.009,5,false),M.body));}
    }};
    if (id === 'stearman') {
      [0.34, 0.46].forEach(f => { const s = S(f), hole = new T.Mesh(new T.SphereGeometry(1, 24, 12), M.cockpit); hole.scale.set(0.42, 0.12, 0.3); hole.position.set(X(f * L), s[4] + s[2] - 0.02, 0); add(hole);
        const head = new T.Mesh(new T.SphereGeometry(0.12, 16, 12), M.std('#4A2E1C', 0, 0.7)); head.position.set(X(f * L) - 0.05, s[4] + s[2] + 0.1, 0); add(head);
        const ws = new T.Mesh(new T.PlaneGeometry(0.34, 0.2), M.glass); ws.rotation.set(0, Math.PI / 2, -0.4); ws.position.set(X(f * L) + 0.34, s[4] + s[2] + 0.08, 0); add(ws); });
      const gy = sm[4] - sm[3] - 0.75;
      [1, -1].forEach(sd => { add(K.rod(V3(X(1.1), sm[4] - sm[3] * 0.8, sd * 0.3), V3(X(1.25), gy, sd * 0.9), 0.05, M.metal, 1.8));
        const wh = K.wheel(0.3, 0.16, M); wh.position.set(X(1.25), gy, sd * 0.95); grp.add(wh); });
      const tw = K.wheel(0.1, 0.06, M); tw.position.set(X(L - 0.3), S(0.97)[4] - 0.25, 0); grp.add(tw);
    }
    if (id === 'spitfire') {
      framedCanopy(X(0.41 * L), S(0.41)[4] + S(0.41)[2] + 0.02, 0.62, 0.28, 0.3);
      add(K.rod(V3(X(.51*L),.61,0),V3(X(.52*L),.98,0),.016,M.body));
      [1, -1].forEach(sd => { const e = 0.24, rad = new T.Mesh(new T.BoxGeometry(0.9, 0.22, 0.36), M.body); rad.position.set(wingLE(e) - 0.55 * geo.chord(e), wingY(e) - 0.2, sd * e * geo.s); add(rad); });
    }
    if (id === 'ventus') framedCanopy(X(0.17 * L), S(0.17)[4] + S(0.17)[2] * 0.45, 1.02, 0.28, 0.29);
    if(id==='epic'){glazing(.165,.228,25,83);glazing(.233,.287,14,58);add(K.rod(V3(X(.06*L),-.31,0),V3(X(.16*L),-.39,0),.10,M.black,2));}
    if(id==='b737'){glazing(.031,.046,17,69);glazing(.048,.061,14,43);glazing(.063,.074,14,34);}
    if(id==='concorde'){glazing(.088,.099,22,79);glazing(.102,.12,12,40);}
    if(id==='overture'){glazing(.062,.085,18,81);glazing(.088,.111,12,42);}
    if (id === 'b737') { add(K.rod(V3(X(L) + 0.05, S(1)[4], 0), V3(X(L) - 0.3, S(1)[4], 0), 0.15, M.hot));
      [0.25, 0.48, 0.7].forEach(e => [1, -1].forEach(sd => { const c = geo.chord(e), f = new T.Mesh(K.lathe([[0, 0], [0.18, 0.6], [0.22, 1.6], [0, 3.2]]), M.wing); f.position.set(wingLE(e) - c * 0.7 - 1.6, wingY(e) - 0.15, sd * e * geo.s); f.scale.set(1, 1.1, 0.8); add(f); })); }

    // navigation lights: red on the left (port) tip, green on the right, white tail and strobes
    const tipX = wingLE(1) - geo.chord(1) * 0.3, tipY = wingY(1), sz = Math.max(0.045, L * 0.004);
    [[-1, '#FF2A2A'], [1, '#2AFF6A']].forEach(([sd, col]) => { const l = K.light(col, sz); l.position.set(tipX, tipY, sd * geo.s * 1.005); grp.add(l); anim.lights.push(l);
      const s = K.light('#FFFFFF', sz * 1.3); s.position.set(tipX - 0.15, tipY, sd * geo.s * 1.01); grp.add(s); anim.strobe.push(s); });
    const tl = K.light('#FFFFFF', sz); tl.position.set(X(L) - 0.05, S(1)[4] + 0.05, 0); grp.add(tl); anim.lights.push(tl);
    const bcn = K.light('#FF3B30', sz); bcn.position.set(X(0.5 * L), S(0.5)[4] + S(0.5)[2] + 0.05, 0); grp.add(bcn); anim.strobe.push(bcn);

    if(id==='ventus'){for(const l of [...anim.lights,...anim.strobe]){grp.remove(l);Model.dispose(l);}anim.lights=[];anim.strobe=[];}
    grp.traverse(o => { if (o.isMesh && !M.flame.includes(o.material) && o.material !== M.disc && !o.material.isMeshBasicMaterial) { o.castShadow = true; o.receiveShadow = true; } });
    const wing = { rootX: main.x, rootY: main.y, s: geo.s, chord: geo.chord, xle: geo.xle, z: ac.dfn.z, cr: geo.cr, MAC: geo.MAC, foil: ac.foil, S: ac.S, b: ac.b };
    return { group: grp, anim, wing, L, span: ac.b, height: A.H, mats: M };
  }

  function animateControls(built,nav,dt){
    const blend=1-Math.exp(-Math.max(0,dt)*14);
    for(const c of built.anim.controls||[]){
      const roll=nav.aileron||0,pull=nav.elevator||0,yaw=nav.rudder||0;
      const target=c.type==='rudder'?yaw*.38:c.type==='elevator'?-pull*.42:c.type==='elevon'?-pull*.36-c.side*roll*.32:-c.side*roll*.38;
      c.angle+=(Math.max(-.55,Math.min(.55,target))-c.angle)*blend;
      c.pivot.quaternion.setFromAxisAngle(c.axis,c.angle);
    }
  }

  function dispose(obj) {
    obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map && m.map.image && m.map.image.tagName === 'CANVAS' && m.map !== undefined && !m.map.userData.keep) m.map.dispose(); m.dispose(); }); });
  }
  return { build, dispose, animateControls, DEFS };
})();
