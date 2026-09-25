# Canyon waterfalls — 25 September 2026

The pale, evenly stepped canyon reported in Safari was the WebGL compatibility environment. It had no waterfall renderer. The WebGPU environment had only narrow streams glued to the terrain.

## What changed

- The compatibility canyon now uses depth-tested terrain meshes with scanned stone colour and normal maps, triplanar colour mapping, sediment detail, real foliage geometry, shadows and distance haze.
- Three large falls descend from cliff brinks into carved, water-filled basins. Water curtains, detached droplets and impact mist occupy a three-dimensional density field. Explicit ballistic particles surround the WebGL curtains.
- The same animated density kernel is used by the WebGPU renderer, which locates tall, unobstructed falls on its own generated canyon. Placement rejects trajectories that intersect the rock.
- Mist integration stops at the actual opaque scene depth, including the aircraft. The camera and plane can pass through it. Neither renderer uses temporal history for the waterfall, so there is no old-frame silhouette in its spray.
- The compatibility river reflects the current scene with a planar reflection pass. Its small ripples are irregular and animated.
- The compatibility scenic route enters the first waterfall basin and passes through the curtain. Canyon startup uses the rear view. The WebGPU tour begins near its first valid large waterfall; manual flight can enter it.
- Terrain textures finish loading before the compatibility loading overlay clears. GPU adapter/device requests have bounded waits, and any device that arrives after timeout is released.

The falls are a procedural, ballistically advected rendering effect, not a Navier–Stokes fluid simulation. The scenery is fictional and not a geographical reconstruction of the Grand Canyon. It remains visibly a real-time game environment; the supplied photographs remain the visual target, not a claim of achieved photographic fidelity.

## Verification

- Actual browser views: reproduced the old pale compatibility canyon; inspected the rebuilt cliffs and river, the approach, inside the curtain, and a wider view with a Boeing 737.
- Morning, midday and golden-hour views inspected at a fixed waterfall position. An unedited golden-hour screenshot was saved in the local `outputs/wing-lab-qa` directory.
- Layout and renderer checked at 393 × 852. This is browser viewport testing, not an actual iPhone hardware/performance or sensor test.
- The new WebGPU volume compiled and rendered with two generated large falls during desktop testing. Later fresh GPU sessions on the host stalled at device acquisition; the new timeout was observed opening the compatibility scene successfully. The final presentation captures use WebGL.
- `tools/canyon-world-check.cjs`: three cliff-attached brinks, submerged plunge basins, unobstructed falling trajectories, and autopilot spray encounters with four aircraft sizes.
- `tools/gpu-probe-check.cjs`: hanging adapter and device requests return to fallback; late devices are destroyed.
- Existing navigation, flight/control-surface, startup-recovery, waterfall and UI checks pass.

Compact viewports use fewer tree cards/instances and a smaller reflection target. Real mobile frame rate still needs device testing.

## Rendering reference

The volume uses ray integration through a bounded density field, with depth termination and light attenuation. See NVIDIA's [GPU Gems 3 chapter on rendering three-dimensional fluids](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids), section 30.3. We use that rendering approach with a procedural density field, rather than implementing its fluid solver.
