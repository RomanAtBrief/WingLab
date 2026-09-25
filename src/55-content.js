/* ================= Content: icons, plain-language explanations, part pictures ================= */
const Content = (() => {
  const A = Aero;
  const ICONS = {
    'layers':'<path d="m12 3 10 6-10 6L2 9zM2 15l10 6 10-6M2 12l10 6 10-6"/>',
    'panel-right':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    'ellipsis':'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    'maximize-2':'<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    'circle-check':'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    'triangle-alert':'<path d="m12 3 10 18H2zM12 9v4M12 17h.01"/>',
    sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9 4.5v15"/>',
    chevdown: '<path d="M6 9l6 6 6-6"/>',
    xmark: '<path d="M7 7l10 10M17 7L7 17"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.4"/>',
    cloudsun: '<circle cx="8" cy="9" r="3"/><path d="M8 3.2v1.3M3.4 5l.9.9M2.3 9h1.3M12.6 5l-.9.9"/><path d="M9 19.5h8.2a3.3 3.3 0 0 0 .3-6.6 4.8 4.8 0 0 0-9.3 1.4A2.6 2.6 0 0 0 9 19.5z"/>',
    arrows: '<path d="M12 3.5v17M12 3.5l-2.8 2.8M12 3.5l2.8 2.8M12 20.5l-2.8-2.8M12 20.5l2.8-2.8M4.5 12h15M19.5 12l-2.6-2.4M19.5 12l-2.6 2.4"/>',
    wind: '<path d="M3 9h10.5a2.7 2.7 0 1 0-2.7-2.7M3 13h14.5a2.9 2.9 0 1 1-2.9 2.9M3 17h7"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    plane: '<path d="M21.5 11.5c0-.8-.7-1.5-1.5-1.5h-5L10 3H8l2.5 7H5.5L4 8H2.5l1 4-1 4H4l1.5-2h5L8 21h2l5-7h5c.8 0 1.5-.7 1.5-1.5z"/>',
    sunrise: '<path d="M4 18h16M7 14.5a5 5 0 0 1 10 0M12 4v4M12 4l-2 2M12 4l2 2M4.5 11l1.3.8M19.5 11l-1.3.8"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
    sunhigh: '<circle cx="12" cy="10" r="4.2"/><path d="M12 2.5v1.5M4.5 10H3M21 10h-1.5M6.6 4.6l1 1M17.4 4.6l-1 1M5 19h14"/>',
    sunset: '<path d="M4 18h16M7 14.5a5 5 0 0 1 10 0M12 9V4M12 9l-2-2M12 9l2-2M4.5 11l1.3.8M19.5 11l-1.3.8"/>',
    moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
    cloud: '<path d="M7.5 18.5h10a3.6 3.6 0 0 0 .4-7.2 5.3 5.3 0 0 0-10.2 1.5 2.9 2.9 0 0 0-.2 5.7z"/>',
    rain: '<path d="M7.5 14h10a3.6 3.6 0 0 0 .4-7.2 5.3 5.3 0 0 0-10.2 1.5A2.9 2.9 0 0 0 7.5 14zM8.5 17l-1 2.5M12.5 17l-1 2.5M16.5 17l-1 2.5"/>',
    snow: '<path d="M7.5 14h10a3.6 3.6 0 0 0 .4-7.2 5.3 5.3 0 0 0-10.2 1.5A2.9 2.9 0 0 0 7.5 14z"/><path d="M8.5 18h.01M12 19.5h.01M15.5 18h.01" stroke-width="2.6"/>',
    fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>', bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
    glide: '<path d="M3 6.5c5 .5 11 4 17 11M16 17.5h4v-4"/>'
  };
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  /* ⓘ cards: what it is, why it matters, a real example, and a formula for older students */
  const INFO = {
    flight: {rLabel:'Try it',t:'Flying and experimenting', w:'Autopilot gives you a scenic tour. Manual lets you bank, climb and dive using arrow keys, touch buttons or tilt.', y:'Speed sets the airspeed used by the lesson charts. Scenic flight runs at a slower, comfortable pace. Throttle changes power; altitude sets a target in Manual. Auto-trim balances the lesson’s lift and weight, independently of steering.', r:'Left / right bank into a turn. Up climbs; down dives. W / S change power. Release the controls to level off. Terrain clearance assist keeps the aircraft above the ground.', f:'On iPhone or iPad, choose Manual → Enable tilt, hold the device comfortably, then tap Recenter. Tilt sideways to bank and tip the top toward you to climb.'},
    lighting: {t:'Light and atmosphere', w:'Morning, midday and golden hour move the sun and change the light on the landscape.', y:'Low sun gives longer shadows and warmer reflections. Midday reveals the rock layers and water more clearly.', r:'The environments are inspired by real landscapes; their geography is generated for exploration.', f:''},
    speed: { t: 'Speed', w: 'How fast the aircraft moves through the air (its airspeed).', y: 'Lift grows with the square of speed: fly twice as fast and the same wing makes four times the lift. Too slow and the wing cannot hold the aircraft up.', r: 'A Spitfire needs about 150 km/h to stay up; Concorde cruised at 2,150 km/h.', f: 'Lift = ½ × air density × speed² × wing area × lift coefficient' },
    height: { t: 'Height', w: 'Altitude above sea level.', y: 'Air gets thinner as you climb — at 11,000 m it is only a third as dense. Thin air means less drag, but the wing must fly faster (or at a steeper angle) to make the same lift, and engines lose power.', r: 'Airliners cruise at 10–12 km; Concorde flew at 18 km where the sky looks dark blue.', f: 'Standard atmosphere: temperature falls 6.5 °C per km up to 11 km' },
    throttle: { t: 'Throttle', w: 'How much power or thrust the engine is asked to make.', y: 'If thrust is bigger than drag the aircraft climbs or speeds up; if smaller, it sinks or slows down.', r: 'Cruise power depends on the aircraft, altitude, weight and weather.', f: 'Climb rate = speed × (thrust − drag) ÷ weight' },
    aoa: { t: 'Angle of attack', w: 'The angle between the wing and the oncoming air.', y: 'A bigger angle deflects more air downwards and makes more lift — until about 15°, when the air can no longer follow the curved top and the wing stalls.', r: 'Concorde landed at about 11° angle of attack, which is why its nose had to droop so pilots could see the runway.', f: 'Lift coefficient ≈ 2π × angle (in radians) for a thin wing' },
    afterburner: { t: 'Afterburner', w: 'Extra fuel is sprayed into the hot exhaust and burnt again.', y: 'It adds a lot of thrust (about 20 % on Concorde, up to 50–60 % on fighters) but uses fuel very fast.', r: 'Concorde used “reheat” for take-off and to push through the speed of sound.', f: '' },
    mast: { t: 'Fold-away engine', w: 'The glider’s propeller and engine fold up out of the fuselage on a mast.', y: 'Folded away, it adds no drag so the glider keeps its long glide. Out and running, it can climb on its own.', r: 'Self-launching gliders like the Ventus-3M climb at about 2–3 m/s under power.', f: '' },
    stall: { t: 'Stall speed', w: 'The slowest speed at which the wing can still hold the aircraft up in level flight.', y: 'Slower than this, even the steepest angle of attack cannot make enough lift. A bigger wing, a lighter aircraft or a high-lift profile lowers it.', r: 'Real aircraft land a little faster than their stall speed, usually with flaps out.', f: 'Stall speed = √(2 × weight ÷ (air density × wing area × maximum lift coefficient))' },
    top: { t: 'Top speed', w: 'The fastest speed where full thrust still equals drag.', y: 'Drag rises with speed squared (and even faster near the speed of sound), so at some speed the engine cannot keep up.', r: 'Real aircraft may be limited below this by structural limits, noise or heating.', f: 'Top speed: thrust = drag' },
    glide: { t: 'Glide ratio', w: 'How far the aircraft travels forward for each metre it drops with no engine.', y: 'It equals the best lift-to-drag ratio. Long slender wings make it much better.', r: 'A Boeing 737 glides about 17 m per metre; an 18 m racing glider about 50.', f: 'Glide ratio = lift ÷ drag' },
    climb: { t: 'Climb rate', w: 'How fast the aircraft can gain height at full throttle.', y: 'It depends on spare power: the extra thrust left after beating drag.', r: 'An Epic E1000 climbs at about 20 m/s (4,000 feet per minute).', f: 'Climb rate = speed × (thrust − drag) ÷ weight' },
    ceiling: { t: 'Ceiling', w: 'The height where the aircraft can only just climb (0.5 m/s).', y: 'Higher up, the air is thin, engines make less thrust and the wing needs more speed.', r: 'Certified limits are often lower, for reasons such as cabin pressure.', f: '' },
    mach: { t: 'Mach number', w: 'Speed compared with the speed of sound. Mach 1 is the speed of sound.', y: 'Close to Mach 1, shock waves form on the wing and drag shoots up. Sweep and thin wings delay this.', r: 'Sound travels at 1,225 km/h at sea level but only 1,062 km/h at 11 km, where it is colder.', f: 'Mach = speed ÷ speed of sound' },
    shock: { t: 'Shock waves from', w: 'The Mach number where shock waves start to form on this wing.', y: 'Above it, “wave drag” grows fast. Swept, thin and supercritical wings push it higher.', r: 'A 737’s supercritical, swept wing lets it cruise at Mach 0.78.', f: 'Korn equation: M ≈ κ/cos Λ − (t/c)/cos²Λ − CL/(10 cos³Λ)' },
    ld: { t: 'Lift ÷ drag now', w: 'How much lift the aircraft makes for each unit of drag at this moment.', y: 'The higher it is, the less thrust (and fuel) the aircraft needs.', r: 'Airliners cruise at about 15–18; Concorde managed about 7 at Mach 2.', f: '' },
    mass: { t: 'Mass', w: 'How heavy the aircraft is, with crew, fuel and load.', y: 'More mass means the wing must make more lift, so the aircraft stalls at a higher speed.', r: '', f: 'Weight = mass × 9.81 N/kg' },
    wingload: { t: 'Wing loading', w: 'Mass carried by each square metre of wing.', y: 'Low wing loading gives slow, gentle flight; high wing loading needs high speed but gives a smoother ride in bumpy air.', r: 'A glider carries about 45 kg/m²; a 737 about 520 kg/m².', f: 'Wing loading = mass ÷ wing area' },
    ar: { t: 'Aspect ratio', w: 'How long and slender the wing is.', y: 'Air spills round the wing tips into swirling vortices. Long slender wings (high aspect ratio) spill less, so they make less “induced” drag.', r: 'Gliders reach 30; Concorde’s delta is under 2.', f: 'Aspect ratio = wingspan² ÷ wing area' },
    sweep: { t: 'Sweep', w: 'How far the wing leans back from straight across.', y: 'Air only “notices” the part of its speed that crosses the wing, so sweep delays shock waves at high speed. It also lowers lift at low speed.', r: 'A 737 is swept 25°; Concorde’s leading edge about 70°.', f: 'Effective Mach = Mach × cos(sweep)' },
    roll: { t: 'Roll stability', w: 'Whether the wings roll back to level on their own after a gust.', y: 'Dihedral (wings tilted up), a high wing and sweep all help. Too little and the aircraft slowly rolls over; too much and it rocks from side to side.', r: 'Fighters are made less stable so they roll quickly.', f: '' },
    pitch: { t: 'Pitch stability', w: 'Whether the nose swings back after a bump, like a weather vane.', y: 'It depends on where the wing’s lift acts compared with the centre of gravity, and on the tailplane.', r: 'Modern fighters are deliberately unstable and flown by computers.', f: 'Static margin = (neutral point − centre of gravity) ÷ wing chord' },
    wings: { t: 'Number of wings', w: 'One wing (monoplane) or two stacked wings (biplane).', y: 'Two wings give lots of area on a short span and a strong braced structure, but the wings disturb each other and struts and wires add drag.', r: 'Biplanes ruled until the 1930s; the Stearman trained thousands of pilots.', f: 'Prandtl: the two wings share their downwash, raising induced drag' },
    planform: { t: 'Wing shape', w: 'The outline of the wing seen from above.', y: 'It sets how lift spreads across the span (and so the induced drag), how the wing stalls, and how it copes with high speed.', r: '', f: '' },
    airfoil: { t: 'Wing profile', w: 'The shape of a slice through the wing, from front to back.', y: 'A curved (cambered) profile makes lift even at 0°; a thin one is best at high speed; a thick one gives more lift at low speed.', r: '', f: '' },
    position: { t: 'Wing height', w: 'Where the wing joins the body: on top, in the middle, or underneath.', y: 'A high wing is more stable in roll; a low wing is less stable and usually needs dihedral.', r: '', f: '' },
    dihedral: { t: 'Wing tilt (dihedral)', w: 'The upward angle of the wings seen from the front.', y: 'When the aircraft slips sideways, the lower wing meets the air more steeply, makes more lift and rolls the aircraft level again.', r: '', f: '' },
    engine: { t: 'Engine', w: 'What pushes the aircraft forward.', y: 'Propellers are best at low speed; jets at high speed. Thrust must beat drag for the aircraft to climb or go faster.', r: '', f: '' },
    area: { t: 'Wing area', w: 'The size of the wing seen from above.', y: 'A bigger wing lifts the same weight at a lower speed, so it stalls more slowly — but it has more skin to drag through the air.', r: '', f: '' },
    span: { t: 'Wingspan', w: 'The distance from one wing tip to the other.', y: 'For the same area, a longer span means a more slender wing and less induced drag.', r: '', f: '' },
    balance: { t: 'Wing position along the body', w: 'Moves the wing forward or back while the centre of gravity stays put.', y: 'Wing further back: more stable but nose-heavy. Further forward: twitchy, then unstable.', r: 'Pilots must load aircraft so the centre of gravity stays within safe limits.', f: '' },
    profile: { t: 'Air round the wing', w: 'A slice through the wing with the air flowing past, worked out with a “panel method” — the same maths early aircraft designers used.', y: 'Air over the curved top speeds up and its pressure drops (blue); under the wing it slows and pressure rises (orange). The difference pushes the wing up. At the stall, the air breaks away from the top.', r: 'Dashes set off together: those over the top arrive first — they are not waiting for the ones underneath.', f: 'Bernoulli: pressure + ½ × density × speed² = constant' },
    liftcurve: { t: 'Lift curve', w: 'How much lift the wing makes at each angle of attack.', y: 'Lift rises in a straight line, then collapses at the stall. Delta wings keep going to 20°+ thanks to vortices over the top.', r: '', f: 'Lift coefficient = lift ÷ (½ × density × speed² × area)' },
    dragchart: { t: 'Drag and thrust', w: 'The drag in level flight and the thrust available, at each speed.', y: 'Slow flight costs “induced” drag (making lots of lift); fast flight costs skin drag. The aircraft can hold its height wherever thrust is at least as large as drag.', r: '', f: 'Drag = ½ × density × speed² × area × drag coefficient' },
    forces: { t: 'The four forces', w: 'Lift, weight, thrust and drag acting on the aircraft now.', y: 'In steady level flight, lift equals weight and thrust equals drag. Drag is split into skin friction, drag from making lift, and shock waves.', r: '', f: '' }
  };

  /* what changed: one plain sentence per part */
  const DESC = {
    engine: { none: 'No engine: the aircraft trades height for speed, like a glider.', piston: 'A piston engine turns a propeller. Great thrust at low speed, fading as you go faster and higher.', turboprop: 'A gas turbine turns the propeller: more power for its weight, and it keeps its power higher up.', turbofan: 'A big fan pushes most of the air round the core: efficient near airliner speeds.', turbojet: 'All the air goes through the hot core. Thrust grows with speed, and the afterburner adds more.', superfan: 'A slim turbofan designed to cruise faster than sound without afterburners.' },
    planform: { rect: 'Easy to build and gentle in a stall, with a little more induced drag.', taperTE: 'Tapering spreads lift more evenly along the span, cutting induced drag.', taperBoth: 'Tapered both edges: close to the ideal lift spread and simple to build.', taperLE: 'A straight back edge keeps flap and aileron hinges in line.', ellipse: 'The ideal lift spread — the least induced drag for its span, as on the Spitfire.', swept: 'Sweep delays shock waves so the aircraft can fly close to the speed of sound.', forward: 'Forward sweep delays shock waves too, and the tips stall last — but it lowers roll stability.', delta: 'Strong and thin, good at supersonic speed, with vortex lift at steep angles.', ogee: 'Concorde’s curved delta: very thin, with strong vortex lift for slow flight.', cranked: 'A delta with a kink: steep sweep near the body, less further out.' },
    airfoil: { plate: 'A flat plate stalls early because the air cannot follow its sharp nose.', thin3: 'A razor-thin section for supersonic flight — little lift at low speed.', n0012: 'Symmetrical: no lift at 0° and it flies just as well upside-down.', n2213: 'A classic cambered section from the 1930s, as on the Spitfire and Stearman.', n2412: 'Cambered: makes lift even at 0°, the classic light-aircraft wing.', n4415: 'Extra camber and thickness give high lift for slow flight.', lam: 'A smooth laminar section that keeps the air flowing smoothly for longer, cutting skin drag.', sc: 'A flat top stops the air speeding up too much, so shock waves form later.' },
    position: { parasol: 'The wing sits above the body on struts — very stable in roll.', high: 'A high wing adds roll stability and a clear view of the ground.', mid: 'A mid wing has the least interference drag and neutral roll behaviour.', low: 'A low wing is less stable in roll, so it usually needs dihedral.' },
    dihedral: { original: 'The aircraft’s real wing tilt.', anhedral: 'Wings tilted down: quicker to roll, less stable.', flat: 'Flat: roll stability comes only from wing height and sweep.', dihedral: 'Wings tilted up roll the aircraft back to level after a gust.', polyhedral: 'Only the tips tilt up — most of the stability for a short bend.', gull: 'A steep inner wing with flatter outer panels.', invgull: 'An inverted gull lets short landing gear reach the ground.' },
    wings: { 1: 'One wing: less drag and cleaner airflow.', 2: 'Two wings: lots of area on a short span, but more drag and interference.' }
  };

  /* part pictures generated from the same geometry the physics uses */
  const f1 = v => (Math.round(v * 10) / 10).toString();
  function planform(id) {
    const pf = A.PLANFORMS[id], g = A.wingGeometry(pf, 1, Math.sqrt(pf.AR)), n = 40, pts = [];
    let xmin = 1e9, xmax = -1e9;
    for (let i = 0; i <= n; i++) { const e = i / n; xmin = Math.min(xmin, g.xle(e)); xmax = Math.max(xmax, g.xle(e) + g.chord(e)); }
    const sc = Math.min(88 / (2 * g.s), 40 / (xmax - xmin)), cy = 32 - (xmin + xmax) / 2 * sc;
    for (let i = n; i >= 0; i--) pts.push([50 - i / n * g.s * sc, cy + g.xle(i / n) * sc]);
    for (let i = 0; i <= n; i++) pts.push([50 + i / n * g.s * sc, cy + g.xle(i / n) * sc]);
    for (let i = n; i >= 0; i--) pts.push([50 + i / n * g.s * sc, cy + (g.xle(i / n) + g.chord(i / n)) * sc]);
    for (let i = 0; i <= n; i++) pts.push([50 - i / n * g.s * sc, cy + (g.xle(i / n) + g.chord(i / n)) * sc]);
    return `<svg viewBox="0 0 100 64" aria-hidden="true"><rect x="47.5" y="4" width="5" height="56" rx="2.5" fill="currentColor" fill-opacity=".18"/><path d="M${pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L')}Z" fill="currentColor" fill-opacity=".85"/></svg>`;
  }
  function airfoil(id) {
    const { up, lo } = A.naca(A.AIRFOILS[id], 30), P = [...up, ...lo.slice().reverse()];
    return `<svg viewBox="0 0 100 24" aria-hidden="true"><path d="M${P.map(([x, y]) => f1(4 + x * 92) + ' ' + f1(14 - y * 92)).join('L')}Z" fill="currentColor"/></svg>`;
  }
  function position(id) {
    const y = { parasol: 7, high: 18.6, mid: 27, low: 35.4 }[id];
    const st = id === 'parasol' ? '<path d="M44 20L41 8M56 20L59 8" stroke="currentColor" stroke-width="1.2" fill="none"/>' : '';
    return `<svg viewBox="0 0 100 46" aria-hidden="true">${st}<rect x="48.8" y="7" width="2.4" height="11" rx="1" fill="currentColor" fill-opacity=".5"/><circle cx="50" cy="27" r="10" fill="currentColor" fill-opacity=".18"/>` +
      `<path d="M5 ${y + 1.2}Q50 ${y - 3.2} 95 ${y + 1.2}Q50 ${y + 1.6} 5 ${y + 1.2}Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }
  function dihedral(dh) {
    const fn = A.dihedralFn(dh), pts = [];
    for (let i = 20; i >= 0; i--) pts.push([50 - i / 20 * 44, 26 - fn.z(i / 20) * 44 * 1.7]);
    for (let i = 1; i <= 20; i++) pts.push([50 + i / 20 * 44, 26 - fn.z(i / 20) * 44 * 1.7]);
    return `<svg viewBox="0 0 100 42" aria-hidden="true"><path d="M${pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L')}" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="27" r="7" fill="currentColor" fill-opacity=".25"/></svg>`;
  }
  function wings(n) {
    return `<svg viewBox="0 0 100 46" aria-hidden="true"><circle cx="50" cy="27" r="9" fill="currentColor" fill-opacity=".2"/>${n === 2 ? '<path d="M8 10H92M8 36H92M28 10L30 36M72 10L70 36" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/>' : '<path d="M8 30H92" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>'}</svg>`;
  }
  const ENG = {
    none: '<path d="M6 17Q30 14 58 16L70 6H75L72 17Q40 20.5 6 19Z" fill="currentColor" fill-opacity=".2"/><path d="M20 16.2H50" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    piston: '<path d="M17 8H48Q60 9 70 15Q60 21 48 22H17Q14 15 17 8Z" fill="currentColor" fill-opacity=".2"/><path d="M17 11.5Q9 15 17 18.5Z" fill="currentColor"/><rect x="11.5" y="2" width="3" height="26" rx="1.5" fill="currentColor"/>',
    turboprop: '<path d="M16 10H52L66 13V17L52 20H16Q13 15 16 10Z" fill="currentColor" fill-opacity=".2"/><path d="M16 12.5Q9 15 16 17.5Z" fill="currentColor"/><rect x="11.5" y="1" width="3" height="28" rx="1.5" fill="currentColor"/>',
    turbofan: '<path d="M10 5H48Q58 6 62 11V19Q58 24 48 25H10Q8 15 10 5Z" fill="currentColor" fill-opacity=".2"/><path d="M10 7V23" stroke="currentColor" stroke-width="3"/><path d="M62 12L72 13.5Q76 15 72 16.5L62 18Z" fill="currentColor"/>',
    turbojet: '<path d="M10 10H52L58 11.5V18.5L52 20H10Q8 15 10 10Z" fill="currentColor" fill-opacity=".2"/><path d="M10 11.5V18.5" stroke="currentColor" stroke-width="2.4"/><path d="M58 12Q70 13 78 15Q70 17 58 18Z" fill="#FF9500"/>',
    superfan: '<path d="M6 11.5L16 9H56L64 12V18L56 21H16L6 18.5Z" fill="currentColor" fill-opacity=".2"/><path d="M8 11.5V18.5" stroke="currentColor" stroke-width="2.4"/><path d="M64 13L73 14.2Q76 15 73 15.8L64 17Z" fill="currentColor"/>'
  };
  const engine = id => `<svg viewBox="0 0 80 30" aria-hidden="true">${ENG[id]}</svg>`;
  function silhouette(id) {   // quick side view used until the 3D thumbnails are ready
    const d = Model.DEFS[id], a = A.AIRCRAFT[id], sc = 92 / a.L, top = [], bot = [];
    for (let i = 0; i <= 50; i++) { const f = i / 50, s = Kit.sample(d.st, Math.max(f, d.f0 || 0)); top.push([4 + f * 92, 26 - (s[4] + s[2]) * sc]); bot.push([4 + f * 92, 26 - (s[4] - s[3]) * sc]); }
    return `<svg viewBox="0 0 100 44" aria-hidden="true"><path d="M${top.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L')}L${bot.reverse().map(p => f1(p[0]) + ' ' + f1(p[1])).join('L')}Z" fill="currentColor" fill-opacity=".5"/></svg>`;
  }
  return { icon, INFO, DESC, planform, airfoil, position, dihedral, wings, engine, silhouette };
})();
