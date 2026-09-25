# Mobile flight and canyon update

1. [x] Responsive panels, safe areas, dismissal and hidden defaults.
2. [x] Complete control explanations and accessible touch interactions.
3. [x] Opt-in calibrated tilt controls, fallback and faster descent.
4. [x] Audit GitHub write access.
5. [x] River-following autopilot, natural canyon materials, vegetation and waterfalls.
6. [x] Test layouts, controls, navigation and rendering; publish the verified build.

User-requested hidden defaults supersede the document’s open desktop panels. Back camera remains in place of the document’s Front camera. Sensor permission requires a tap; physical iPhone/iPad testing remains separate from browser layout and simulated input tests.

## Follow-up from physical iPhone screenshots

- [x] Remove the extra chart toolbar icon; use a circular flight-mode icon.
- [x] Make menus and sheets mutually exclusive; retain an explicit close control and four rounded corners.
- [x] Prevent WebKit selection/callouts on control descendants; retain numeric editing.
- [x] Add accelerometer input fallback, request both sensor permissions from a tap, remove the document-focus sensor gate.
- [x] Wait for a rendered aircraft and generated terrain before fading the blurred loading screen; recover renderer failures in place.
- [x] Continuous river look-ahead, reduced scenic speed, precise terrain height queries and unobstructed orbit camera.
- [x] Restore island vegetation; retain a reduced tree density at the lowest quality.
- [x] Full-color scanned triplanar stone, subtler bedding, stable water reflection sampling and smaller distant ripples.
- [x] Check fresh loads, responsive interactions, terrain and flight regressions; publish.

Physical-device Safari validation still cannot be inferred from desktop viewport testing.
