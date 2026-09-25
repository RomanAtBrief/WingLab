# Mobile flight and canyon validation

## Automated checks

- 42 flight/chart cases across all seven aircraft.
- All seven aircraft: split control-surface geometry, finite attributes, correct aileron/elevator/elevon deflections and neutral return.
- One-hour continuous river route; 20 minutes on the actual generated centreline (maximum sampled-centreline deviation: 21.7 m).
- Tight river bend bounded by 300 m cliffs: flight remains below 150 m, with route-aware terrain look-ahead.
- Manual pitch/roll inertia, throttle, opposing inputs, pause, release-to-level and 30/60 Hz consistency.
- Faster dive: more than 300 m lost in ten seconds at the tested lesson airspeed of 105 m/s, with terrain clearance retained.
- Tilt: portrait and both landscape rotations, calibration, dead zone, smoothing, stale/missing events and input reset.
- Cascade geometry: finite vertices above the terrain, river endpoints, no waterfalls over flat terrain.
- 17 complete help topics, unique UI IDs, and hidden initial panels/force arrows in both renderers.

## Browser checks

Viewport sizes: 320 × 740, 393 × 852, 852 × 393, 834 × 1194, 1194 × 834 and 1376 × 1032.

Checked hidden defaults, menu and panel close buttons, Escape, shared phone sheet tabs, chart selection, data tables, help popovers, safe panel bounds, 24 px bottom corners, absence of horizontal page overflow and disabled page text selection. Held touch steering changed bank from −0.037 to +0.208 radians; touch targets measured at least 44 × 44 px on the iPhone layout. A Mac without motion sensors reports a fallback message and retains touch control. WebGPU compiled the cascade shader without console errors and placed eight cascades in the generated canyon.

Also checked morning, midday and golden-hour canyon lighting, the mobile lightweight renderer, persistent precision throttle entry, and manual target altitude distinct from live altitude. A 500 m target remained stable while the aircraft descended toward it.

## Limits

Viewport emulation does not test Safari’s physical sensor permission prompt, actual iPhone/iPad orientation sensors, the on-screen keyboard, notches, or sustained device thermals. Those need a real-device check on the HTTPS site. Canyon geography and cascades are procedural, inspired by the references rather than geographically exact. Advanced vegetation and cascades use WebGPU; the WebGL fallback retains simpler terrain.

## Repository access

Audited 25 September 2026: RomanAtBrief is the only repository collaborator; no pending invitations or deploy keys. Public visitors can clone, fork and propose changes, but cannot push into the original repository or deploy its Pages site. The existing MIT license is unchanged.
