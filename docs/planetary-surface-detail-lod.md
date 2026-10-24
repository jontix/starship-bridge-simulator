# Planetary Surface Detail LOD v1

## Goal

Keep the accurate planetary size and generated large-scale geography that
already look convincing from far away, while preventing obvious 1024×512
texture blur from high orbit. This is a **Babylon.js surface/detail shader
upgrade**, not a new terrain engine. It does not affect the ship's 6DOF
physics, Colyseus authoritative simulation, planetary radii, ephemerides,
navigation distances or collision geometry.

## Why the original textures blur

At Haven's physical radius of **6,370 km**, the 1,024-pixel-wide
equirectangular map covers roughly **39 km per texel at the equator**.
Increasing the map size is useful for continents, but a simple global
8,192px map would still use around 5 km per texel and more memory.

Instead, this milestone adds **camera-distance-aware, seeded 3D fractal
detail in the GPU shader** on top of the generated maps.

## Fractal detail bands

Three body-local 3D noise bands are currently tuned to:

| Frequency per unit radius | Approximate equatorial wavelength at Haven |
|---|---|
| 140 | 286 km |
| 620 | 64.6 km |
| 2500 | 16 km |

The planet's albedo, ocean mask, cloud density, sea level, night-light mask,
and baked surface elevation still define its geography. Noise is anchored to
the **rotating planet's local spherical coordinates**, not the camera or
screen pixels. Its seed matches the build-time cached planet manifest (when
present), so manually generating a new Haven also changes its fractal detail
consistently.

Land uses ridged/multifractal-inspired colour and normal modulation. Height
and roughness maps temper how rocky and pronounced the variation becomes:
highlands have the strongest simulated relief; grassy plains stay smoother.
Oceans use significantly subtler noise and remain reflective, not mottled
with artificial mountain ridges. Cloud density gets a thin additional,
independently seeded wisp layer.

### Distance-dependent anti-aliasing

Let the camera-space fragment distance be `d`, projected globe radius
`Rproxy`, vertical camera FOV `fov`, and framebuffer height `H`:

```
pixelFootprintOnUnitSphere ≈ (2 × d × tan(fov / 2)) / (H × Rproxy)
bandVisibility = 1 - smoothstep(0.28, 0.95, frequency × pixelFootprint)
```

This estimate is evaluated **per pixel in the planetary sky scene**.
At an orbital horizon, fragments close to the camera therefore get more
detail than the far limb. As individual wavelengths shrink below a screen
pixel, the corresponding fractal bands fade continuously to a neutral
sample, preventing distant planets from turning into unstable noise.

Magnifying a distant object with the telescope naturally reveals detail
only when its projected pixel footprint supports it. No artificial globe
scaling or distance manipulation is involved.

### Performance limits

There are just three value-noise samples per sunlit terrestrial fragment
(and one per visible cloud fragment), rather than computing enormous
planetary textures in the browser. Shader detail is disabled on stars and
gas giants, which retain their specialised materials. Unknown rocky worlds
use their catalogued seed and existing texture fallback.

These are **surface-shading normals**, not true mesh displacement; the
physical silhouette remains spherical. Close terrain flight, mountains
that extend above the horizon, shadows from elevated features, collisions
with the ground and atmospheric entry are intentionally deferred.

## Bridge controls

Both Main Screen and Helm expose **Fractal orbital surface detail**:

- **Off** — original generated PNG maps only (baseline).
- **Balanced** — reduced fractal strength for weaker devices.
- **High** — full terrain, sea and cloud detail (the default).

The selector is local to the browser station and does not send a Helm
command or alter multiplayer simulation state. The normal view and
telescope continue to use correct apparent angular sizes.

## Planet Lab: real matched GPU comparisons

Open `http://127.0.0.1:5173/planet-lab.html` to inspect the existing
pre-generated daylight/terminator/night-side references **and** the new
**Orbital surface detail LOD** comparison below them.

The two panels use **the real Babylon.js surface and cloud shaders**, the
same cached generated maps, seed, globe rotation, fixed sunlight direction,
and camera orientation. Only the fractal detail changes:

- Left: baked maps, detail OFF.
- Right: adjustable detail intensity and frequency scale.

Choose fixed altitudes at 20,000 km, 2,500 km, 430 km (Highport),
or 100 km (future low-orbit stress test). Toggle clouds on/off to compare
the independent weather detail. This does not move the actual game ship
and does not modify any station's UTC time or orbital position.

The original day/terminator/night **CPU** previews remain unchanged;
unlike those reference images, the new orbital side-by-side panes are
actual **Babylon/WebGL** outputs. The comparison uses the physical radius
of Haven as a reference sphere, including when experimenting with a
Verdant terrain preset which has not yet been added to the star catalog.

## Implementation points

- `packages/client/src/surfaceDetail.ts`: quality presets, CPU-reference
  frequency/footprint/anti-alias math, seed.
- `packages/client/src/surfaceDetailShader.ts`: GLSL 3D value-noise,
  pixel-size filtering, land/water detail and cloud wisps.
- `packages/client/src/planetMaterials.ts`: applies the GLSL details
  after colour/ocean map sampling and before directional illumination.
- `packages/client/src/planetAssetOverrides.ts`: loads generated height
  and roughness textures and cached seed from manifest.
- `packages/client/src/planetaryScene.ts`: updates shader FOV, pixel size,
  globe radius, mode and seed every frame.
- `packages/client/src/orbitalDetailLab.ts`: standalone matched Babylon
  before/after scenes independent of Colyseus and ship position.
- `packages/client/src/surfaceDetail.test.ts`: octave fade-out,
  telescope resolution, seed determinism and shader/CPU math contract.

## Visual test checklist

1. Pull `feature/planetary-surface-detail-lod-v1` and run
   `npm.cmd install`, then `npm.cmd run dev` in PowerShell.
2. Open Main Screen at `http://127.0.0.1:5173`; at Haven Highport
   compare **Off**, **Balanced**, **High** detail with the normal 1×
   orbital camera. The globe's horizon must not jump as mode changes.
3. Open Planet Lab. At 430 km compare baked maps on the left and fractal
   terrain on the right. Move the strength slider from 0 to 1.5.
4. Repeat at 20,000 km and at 2,500 km. The far view should stay smooth;
   detail must not shimmer or crawl as you change altitude.
5. Disable clouds to inspect terrain; enable them to compare finer cloud
   structure. Oceans should look subtler than mountains.
6. Regenerate Haven from a different seed in Planet Lab, restart Vite and
   ensure cached macro geography and the fine detail change consistently.
7. Confirm the system map, cruise approach, tactical camera, orbital horizon
   and 2-client multiplayer still function unchanged.
8. Inspect browser DevTools for GLSL/WebGL errors and performance,
   particularly on integrated GPUs.

### Automated checks

CI builds and runs the existing shared flight/universe/cruise tests on
Linux Node 22 and Windows Node 24. A new pure TypeScript test validates
the octave coverage at orbital distances, the anti-alias function,
changing seed and filtering frequencies.

The Chromium workflow now additionally captures the live Planet Lab
before/after canvases at 430 km, checks that WebGL contexts remain
healthy, and requires a measurable visual difference. It retains the
original game screenshot and telescope regression.

## Next artistic work

This upgrade can add plausible relief and break up blocky large maps,
but procedural detail cannot invent a believable continent or forest from
an otherwise flat, badly lit source texture. The best follow-on work is
art-directed procedural geography (erosion/valley networks), better normals
and scattering, and finally a true height-aware cube-sphere terrain
quadtree **if we decide to support close atmospheric flight or landing**.
