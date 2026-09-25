# Rendering and mobile reliability follow-up

## Findings fixed

The island species preset had a tree density of zero. Adaptive quality also switched off all trees at its lowest setting. Islands now have a denser broadleaf canopy and all quality levels retain vegetation, reducing density and switching distant trees to impostors instead.

The averaged terrain water mask discarded fragments on steep coasts, creating holes beneath islands. Submerged terrain now clips against water through the depth buffer. Canyon collision queries previously used coarse block maxima intended for terrain bounds. Flight/camera queries now use the full-resolution height field; conservative block bounds remain for terrain culling. The camera retracts along a checked sight line when a cliff obstructs it.

Autopilot now aims along a continuous look-ahead on the river, smooths turn rate and travels at up to 28 m/s through the canyon. The generated-river test measured 21.6 m maximum distance to sampled route points and 0.070 rad/s² peak yaw acceleration.

Phone framing previously measured the inspector during its off-screen opening transition. Measuring its final layout position keeps the aircraft above the sheet. Menus close the sheet, sheet corners are clipped to 24 px, every sheet has an explicit close button, and the redundant chart toolbar icon was removed. Flight mode uses a circular icon button. WebKit selection/callout rules apply directly to all control descendants; numeric input remains editable.

Loading now uses a blurred, animated overlay and waits for a completed GPU frame, terrain readback and route configuration. Renderer failure switches to WebGL in place instead of reloading the page. Early module errors reveal a retry control.

Motion input requests orientation and accelerometer permissions from the Enable tilt gesture. Gravity input supports devices without orientation events. Input no longer depends on document focus after an OS permission prompt. Touch controls suppress long-press selection, hold and release their key state, and remain available when sensors are denied or absent.

## Graphics research and implementation

- [NVIDIA GPU Gems: Effective Water Simulation from Physical Models](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models) separates geometric waves from finer normal-map waves. Wing Lab keeps this approach, with depth absorption, Fresnel reflections and filtered surface roughness. This update removes frame-random reflection ray starts, reduces oversized distant ripples and adjusts river color/roughness. This is an approximation, not a full ocean simulation.
- [NVIDIA GPU Gems: Generating Complex Procedural Terrains Using the GPU](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-1-generating-complex-procedural-terrains-using-gpu) describes procedural density and surface texturing techniques. Wing Lab uses world-space triplanar materials so cliffs do not stretch like a top-down texture. The bundled CC0 scanned rock now contributes full-color detail at two scales, alongside its normal and roughness channels; procedural sediment band contrast is reduced.
- [Apple Safari event handling](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html) documents touch and orientation interaction. The application keeps touch flight controls separate from orbit-camera gestures and uses screen orientation when calibrating tilt.

Photographic reference quality remains a separate target: this landscape is procedural, not scanned geography. Real elevation data plus authored/scanned cliff meshes, vegetation assets and measured materials would improve recognizable geology and close-range detail further. The WebGL compatibility renderer remains simpler than WebGPU.

## Validation

All seven automated suites pass: flight/charts, seven aircraft control surfaces, navigation, tilt/gravity, waterfalls, UI content and renderer startup recovery. Browser checks cover first-load WebGPU startup for all seven aircraft without errors or a second refresh, lightweight island rendering, forced WebGL startup, manual steering/release, empty text selection after a drag, circular 44 × 44 px phone flight-mode button, and mutually exclusive menus/sheets. Phone/tablet panel checks at 320 × 740, 393 × 852, 852 × 393 and 834 × 1194 found no horizontal overflow, and close controls remained inside the viewport. Desktop rendering was checked at 1194 × 834.

These are desktop browser viewport and input tests. Physical iPhone/iPad Safari permission prompts, sensor response and thermal performance are not verified by them.
