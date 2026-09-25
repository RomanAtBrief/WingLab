# Validation — 25 September 2026

- Rebuilt index.html and checked the combined module with Node `--check`.
- 42 flight/chart smoke scenarios across all seven aircraft passed. Run `node tools/smoke-check.cjs`.
- Verified 110 unique DOM IDs and resolved all explicit label/control references.
- Exercised WebGPU and the forced WebGL fallback in the Codex in-app browser on this Mac. No new warning/error entries during the final checks.
- Visually checked 1376 × 1032, 1194 × 834, 393 × 852 and 320 × 740; also exercised the 834 × 1194 inspector layout.
- Exercised environment changes, inspector tabs, all four analysis views, Show Data, dark appearance, aviation units, mobile sheet switching and exact numeric speed entry.
- Fixed chart overflow, simultaneous mobile sheets, Enter reopening the precise editor, and speed rounding found during those checks.

## Limits of these checks

No claim of crash-proof operation, sustained thermal performance or broad browser/device coverage. The previous Mac crash was not diagnosed. The renderer limits frame submissions and allows only one in-flight WebGPU frame. Visual realism remains below the supplied photographic references; see README.md for rendering and simulation limitations.

## Scenic flight / aircraft follow-up

- Rebuilt and syntax-checked the combined module. The 42 original flight/chart scenarios still pass.
- Added `tools/flight-check.cjs`: 60-minute navigation simulation, wrap continuity, no teleport on mode switching, manual yaw/climb, released keys, pause, altitude-cycle phases, finite values/bank limits and terrain clearance.
- Exercised the actual generated river path for 20 simulated minutes: maximum distance to sampled centreline was 21.8 m. This is a route-tracking test, not a physical flight-model validation.
- Live WebGPU checks: scene photo cards, scene switching, river-following flight, Manual/Autopilot switch, arrow-key response, all seven aircraft, camera controls, paused aircraft switching, and shader error logs. Fixed old-terrain route selection and stale altitude/force summaries found during these checks.
- Stable 16-tap shadow filtering compiled and rendered without new GPU errors. Subjective visual inspection does not establish physically exact penumbrae.
- Phone layout checked at 390 × 844, with visible 44 px directional buttons, manual-mode icon and readable flight hints. Temporary viewport override reset afterward.
- Forced WebGL fallback rendered the revised four-engine Overture and switched to Manual with enabled altitude control and no console errors.

Remaining limitations: procedural aircraft and landscapes, stylised terrain at close range, limited fine-detail antialiasing, approximate cloud scattering and assisted presentation-speed navigation. The WebGL route is simplified. No claim of reference-photo-level realism or exact aircraft certification geometry.

## Rendering stability / chooser follow-up

- Captured and visually reviewed seven aircraft × two places × three lighting presets (Morning, Midday, Golden hour): **42 visual combinations**, separate from the 42 physics/chart smoke cases. Full-size images and per-aircraft contact sheets are in the sibling `visual-qa` folder.
- Verified all seven chooser cards show rendered 3D aircraft, including biplane wings/struts, the glider's long span, and the different supersonic layouts.
- Checked rapid camera orbits after adding depth rejection to TAA and screen-space water reflections, independent cloud accumulation, and camera-motion history resets. No lingering duplicate aircraft outline was apparent in captured checks. This is not a quantified frame-by-frame flicker guarantee.
- The fast-orbit check exposed cloud intersection bands; replaced subtraction of Earth-radius squares with an altitude-space quadratic and stable roots, then checked low-angle clouds again.
- Confirmed widened canyon water and rock surface detail in WebGPU; checked the simpler canyon river in forced WebGL. Browser GPU error logs were empty during the 42-case matrix and motion checks.
- Reduced unrealistic long wingtip condensation ribbons found on the glider during review.
- Bundled the existing pinned Three.js version locally to remove CDN startup stalls. Its MIT licence is included at `vendor/three/LICENSE`.

Materials and exposure are visually assessed, not measured against calibrated photographs. Procedural shapes, some jagged fine edges and terrain smoothness remain below the photographic target. These checks do not certify sustained GPU performance, thermal stability, or absence of all temporal artifacts.

## Game controls and hinged surfaces

- Navigation tests cover smooth roll/pitch, turn direction, throttle acceleration, dives, release-to-level, opposite inputs, 30/60 Hz consistency, terrain protection throughout a descent, and no teleport on mode changes. The updated 20-minute canyon-route test stayed within 21.7 m of the sampled centreline.
- `node tools/control-surfaces-check.mjs` builds actual production geometry for all seven aircraft, checks finite position/normal/UV data, correct differential aileron and elevator/elevon directions, and neutral settling. Canvas painting is stubbed in this geometry-only test; screenshots cover appearance separately.
- Browser checks at 390 × 844 verified the keyboard guide, touch steering, climb and throttle: a right input banked to 23°, climb produced positive vertical speed, and throttle decrease changed 85% to 77%. The viewport override was reset after testing.
- Rear camera now frames the full wingspan. Manual status shows navigation telemetry instead of the separate lesson's calculated flight state.
- Cloud weather coverage is sampled per volume rather than cutting vertical columns through a three-dimensional cloud; cloud-neighbour coverage and empty-volume handling were corrected. Water uses normal-variance roughness to reduce distant specular shimmer.
- Captured and inspected all seven newly articulated aircraft in WebGPU; repeated the 737 in both places and all three light presets after the final cloud/water edits. Browser shader/error logs were empty.
- Forced WebGL fallback rendered the articulated Epic, rear camera and manual guide without console errors.
