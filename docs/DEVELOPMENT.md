# Wing Lab — development guide

**[Play Wing Lab](https://romanatbrief.github.io/WingLab/)** — free in your browser, no installation.

An educational flight app for secondary-school students: fly seven real aircraft, swap wing parts (planform, profile, height, dihedral, engine, size) and see how lift, drag, stability and airflow change. It has a WebGPU 3D view with physically based lighting, set over the Philippine islands or the Grand Canyon, and a simpler WebGL version for browsers without WebGPU.

Everything runs in the browser: no server code, no build tools beyond a shell, and one bundled dependency (three.js 0.169.0, in `vendor/three`).

## Run it locally

```sh
cd /path/to/wing-lab
python3 -m http.server 8000
```

Then open <http://localhost:8000> in Chrome. A browser that exposes WebGPU uses the WebGPU renderer; otherwise the app uses its simpler WebGL fallback. Capability detection is used instead of browser-version assumptions. Serve the folder rather than double-clicking `index.html`, because WebGPU and ES modules behave more reliably over `http://localhost`.

## Edit and rebuild

**Don't edit `index.html` directly.** It is generated. Edit the files in `src/`, then run:

```sh
sh build.sh            # writes index.html
```

and reload the browser. `build.sh` simply joins the `src/` files in a fixed order, listed inside the script, into one generated page (keep the `assets` and `vendor` folders alongside it). Every `.js` file shares one module scope, so later files can use modules defined in earlier ones (`Aero`, `G`, `GR` and so on).

## Publish on GitHub Pages

1. Create a new GitHub repository and push this folder to it, with `index.html` at the root.
2. In the repository, open **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, then branch `main` and folder `/ (root)`.
3. The site appears at `https://<your-user>.github.io/<repo>/` after a minute or so.

This repository publishes `main` through GitHub Pages. After editing, run `sh build.sh`, commit the generated `index.html` with its source/assets, and push to `main`.

## Files

| File | What it does |
|---|---|
| `src/01-head.html` | Page title and legacy base CSS. |
| `src/tokens.css`, `src/03-design.css` | Design-system tokens, self-hosted Inter, responsive panels, safe frames, themes and accessibility. |
| `src/02-body.html` | Page markup: toolbar, Build and Fly panels, charts drawer, pop-overs. |
| `src/10-physics.js` | **Aero**: standard atmosphere, the 7 aircraft (published data), parts, aerodynamics (lift curve, stall, induced/wave drag, thrust, trim, performance). |
| `src/20-profile.js` | **Profile**: 2D wing-section airflow chart (Hess–Smith panel method, streamlines, pressure field, stall wake). |
| `src/30-charts.js` | **Charts**: lift-curve and drag/thrust charts with hover. |
| `src/40-kit.js` | **Kit**: shared modelling helpers (lofted fuselage, airfoil surfaces, propellers, nacelles, lights, paint canvases, PBR materials). |
| `src/41-aircraft.js` | **Model**: builds each aircraft to scale as a three.js group (paint schemes, engines, details). |
| `src/45-env.js`, `src/50-scene.js` | **EnvGL / Scene3DGL**: the WebGL fallback renderer (single-pass sky, clouds, terrain). |
| `src/65-flight-director.js` | Scenic route follower and assisted manual navigation, shared by both renderers. |
| `src/70-gpu-core.js` | **G**: WebGPU device, pipeline/bind helpers, the per-frame uniform block (`FRAME` list → WGSL `Frame` struct), shared WGSL. |
| `src/71-gpu-atmos.js` | **GAtmos**: Hillaire atmosphere LUTs, aerial perspective, reflection probe (GGX-prefiltered) and sky SH. |
| `src/72-gpu-mesh.js` | **GMesh**: draws three.js aircraft meshes into the G-buffer, shadow maps and forward pass. |
| `src/73-gpu-render.js` | **GR**: deferred HDR renderer: G-buffer → lighting (PBR, shadows, SSR water) → forward → post → tone map. |
| `src/74-gpu-terrain.js` | **GTerrain**: GPU-generated terrain for the two places, CDLOD mesh, surface shading, water. |
| `src/75-gpu-shadow.js` | **GShadow**: 4 stabilised shadow cascades. |
| `src/76-gpu-trees.js` | **GTrees**: GPU-placed instanced trees and far impostors. |
| `src/77-gpu-post.js` | **GPost**: GTAO, TAA, auto-exposure, bloom, lens flare. |
| `src/78-gpu-clouds.js` | **GClouds**: ray-marched volumetric cumulus + cirrus, quarter-res with temporal reprojection. |
| `src/79-gpu-scene.js` | **EnvGPU / Scene3DGPU**: places and light presets, camera, animation, wingtip vortex/contrail trails, force arrows, adaptive quality. |
| `src/80-facade.js` | Picks WebGPU or WebGL at start-up. |
| `src/55-content.js` | **Content**: icons, plain-language info cards, part pictures. |
| `src/60-ui.js` | **UI**: panels, controls, pickers, toasts, start-up and the main loop. |

### How a WebGPU frame is put together

`GR.frame()` in `73-gpu-render.js` calls each registered module's hooks in this order: `pre → shadow → gbuffer → preLight → (lighting) → postLight → forward → post → overlay`.

- G-buffer: `gA` = albedo + cavity, `gN` = normal + roughness, `gM` = velocity, metalness, material id + clearcoat. Material ids: 0 standard, 1 water, 2 terrain, 3 foliage, 4 emissive.
- Depth is reverse-Z: 1 is near, 0 is sky.
- To add a per-frame value to the shaders, add it to the `FRAME` list in `70-gpu-core.js`. The WGSL struct is generated from that list.
- Quality adapts to frame time through `LEVELS` in `79-gpu-scene.js`, which sets render scale, cloud steps and trees.

## Link options (after `#`)

`#place=islands|canyon&time=morning|midday|golden&ac=stearman|spitfire|ventus|epic|b737|concorde|overture&h=3000`

- `fly=0` and `charts=0` start with the Fly panel or the charts drawer closed.
- `gl` forces the WebGL renderer.
- `lite` uses the lowest quality.
- `readback&frames=N` is for automated screenshots: it renders N frames, then stops. See `tools/screenshot.py`.
- For debugging, in the console: `window.GDBG = { noAtmos, noMesh, noLight, noFinal }`, set to `true` to skip a stage.

## Known limits

- The terrain is procedural. It is designed to look like the two places but is not real elevation or satellite data.
- The current revision was exercised in the Codex in-app browser on this Mac, including WebGPU and the forced WebGL fallback. Broader hardware/browser coverage remains to be done.
- These are procedural approximations inspired by the references, not photographic reconstructions. Cloud detail, terrain erosion, vegetation and the procedural aircraft meshes remain below the supplied reference-image quality.
- Cloud scattering uses a real-time multiple-scattering approximation, not path-traced light transport. Aircraft wake distortion and air motes are an analytic visualization, not a CFD solver.
- The 3D flight path is a presentation of the selected flight condition, not a fully integrated flight simulator. The camera/aircraft are kept above the generated terrain.
- WebGL has simpler clouds/terrain and does not include the WebGPU wake-volume interaction.

## September 2026 visual/UI revision

- Ray-marched cloud volumes with overlapping cumulus shapes, 3D erosion, sunlight attenuation, approximate multiple scattering, shadows and temporal accumulation. The full intersected cloud layer is sampled to avoid premature ray cutoffs.
- Wingtip-vortex disturbance in nearby cloud density and advected illuminated air motes; reduced-motion support.
- CC0 scanned stone detail with normal/roughness channels, triplanar canyon shading, layered cliff profiles, depth-coloured water, waves, Fresnel reflection and shoreline foam.
- One in-flight WebGPU frame, a 30 fps submission cap, hidden-page suspension and adaptive render quality. This limits work; it does not establish the cause of any previous Mac crash.
- Design-system inspector tabs, a single analysis chart, force pairs, data tables, mobile sheets, camera safe-frame animation, precise numeric inputs, unit selection and keyboard navigation.

### Controls

Drag the aircraft view to orbit; scroll/pinch to zoom. Keyboard: 1–4 chooses camera views, Shift+1–4 chooses charts, I toggles inspector, C toggles analysis, F focuses the chart, Space pauses, Escape dismisses menus. The top-right **Autopilot / Manual** button (P) switches navigation mode without teleporting. Manual selects the Back chase camera and shows a translucent keyboard guide. Hold ←/→ to bank into a turn, ↑/↓ to climb/dive, and W/S to increase/decrease throttle. Pitch and roll build smoothly; releasing the arrows gradually levels the aircraft. Higher speed gives a wider turn. Press 3 for Back or P for Autopilot. Touch devices show direction and throttle buttons. Force arrows are hidden on entering Manual and restored on returning to Autopilot; they remain available in Overlays. The flight-status capsule reports actual navigation speed and vertical speed in Manual. Terrain clearance is assisted. With the canvas focused, Alt+arrow keys orbit in Manual; plain arrows orbit in Autopilot. +/− zooms. Tap/click a control value for precise entry; Enter commits, Escape cancels.

Asset credits and licenses are in `assets/ATTRIBUTION.md` and `assets/Inter-LICENSE.txt`. The scene picker uses two supplied reference photographs; attribution is recorded there. Aircraft references and per-model changes are in `AIRCRAFT-REFERENCES.md`.

## Scenic navigation revision

Autopilot follows the generated river centreline continuously across canyon tiles. The island route searches the generated heightmap for low channels and alternates cloud-top views, cloud passages and coastal descents on an approximately five-minute cycle. Aircraft turn and bank gradually; camera framing follows their heading. A rear three-quarter default view shows more of the approaching landscape. Scene changes wait for the matching terrain before configuring the route.

Navigation deliberately runs at a relaxed presentation pace (22–48 m/s; canyon capped at 38 m/s). The selected airspeed and force/climb calculations remain educational predictions, not the speed or vertical motion of an integrated flight simulator. Auto-Trim is independent of navigation Autopilot. The altitude control becomes available in Manual. Terrain assistance can override a descent command, including an immediate correction if the aircraft is already below the safety floor. Reduced-motion preferences and Pause stop the scenic motion.

WebGL supports the same assisted game controls and mode switch, with an approximate scenic loop and conservative altitude floor; generated-river routing and channel search require WebGPU.

Checks: `node tools/smoke-check.cjs` and `node tools/flight-check.cjs`.

## Rendering stability and previews

The aircraft chooser lazily renders the actual 3D models into antialiased preview images, then releases its temporary renderer. Scene cards use the supplied landscape photographs; their provenance is in `assets/ATTRIBUTION.md`.

WebGPU preserves at least one render pixel per CSS pixel at normal window sizes, with a 2.4-million-pixel budget for large displays. Adaptive quality reduces cloud samples before geometry resolution. Depth-tested temporal history rejects revealed background; rapid orbiting clears history without resetting exposure. Cloud layers use stable altitude-space intersections and world-space marching to reduce banding. Water reflections reject stale depth and use the HDR environment when screen-space evidence is unreliable.

The canyon has an approximately 200 m river channel, emerald shallows, ripples, shoreline vegetation, layered rock colour and triplanar scanned surface detail. WebGL has a simpler continuous river route and analytic canyon. Neither landscape is a geographical reconstruction.

## Moving flight controls

All seven models have separate, hinged control surfaces driven by the flight controller. Conventional aircraft have differential ailerons, paired elevators and a rudder. The Stearman uses lower-wing ailerons; Concorde uses combined elevons and a rudder. Meshes are cut at the hinge, with closed ends and preserved livery UVs. The aircraft can still be modified in the educational inspector.

Navigation is an assisted flight-game model, separate from the aerodynamic lesson calculations: damped pitch/roll response, coordinated bank-to-turn motion, throttle acceleration and terrain-clearance help. Manual speed is limited to 18–170 m/s; this does not reproduce each real aircraft's full flight envelope or stall behaviour.

## Licenses

Original application code is covered by the repository LICENSE. Third-party libraries, font, textures and supplied scene photos have separate terms; see [asset attribution](../assets/ATTRIBUTION.md).
