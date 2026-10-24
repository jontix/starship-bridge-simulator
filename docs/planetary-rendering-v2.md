# Planet Rendering v2 — Visual-quality prototype

This branch is a **Babylon.js visual overhaul**, not a change in the authoritative
flight simulation, physical scales, orbital ephemerides, or interplanetary cruise.
The goal is to evaluate whether Babylon.js can present a convincing space-based
star system before considering an engine migration.

## Renderer / art pipeline

The existing camera-relative dual-scene compositor and true-size planet
projection are retained. In an actual 3D scene, the planet disc remains
identical in angular size to a physically sized sphere, including Haven's
~139° apparent diameter from approximately 430 km above the surface.

The renderer now has distinct material paths:

- **Haven**: authored fictional continent distributions projected onto a
  unit sphere, noise-distorted coastlines, oceans with continental shelves,
  climatic/biome variation, polar ice and restricted coastal city lighting.
- **Selene**: deterministic unit-sphere Voronoi impact fields with circular
  basins and brighter raised rims, rather than striped fake craters.
- **Cinder**: rocky mineral colourations.
- **Bastion**: layered shear-flow-inspired cloud bands, a dominant storm and
  a physically proportioned ring system.
- **Tundra**: colder ice giant bands.
- **Aster**: its own stellar shader, animated convection granulation,
  simulated sunspots, limb darkening and a subtle camera-facing corona.

Haven's high-resolution generated texture is a first **fictional look
development** baseline, not a NASA photoreal map. Its graphics may still
benefit from commissioned surface art, licensed imagery and normal maps.

### Art-asset overrides (ready for future assets)

Optional equirectangular surface assets can be bundled under

`packages/client/src/assets/planets/<body-id>/`

with the following conventional file names:

- `albedo.jpg`, `albedo.png` or `albedo.webp` — sRGB diffuse surface colour
- `clouds.png` — RGBA cloud colour with cloud density in alpha
- `night.png` — red = night lights; green = ocean-reflectance mask

Vite discovers these at build time and bundles their URLs. The renderer
starts from a deterministic procedural fallback and only changes to a
loaded asset after a successful image load. Missing images never stop the
world from rendering.

These override file slots are **empty in v2**: this branch doesn't redistribute
NASA/other third-party imagery or require internet access to render planets.
Real high-resolution, legally reviewed art assets can be dropped in later
without changing flight physics or shaders.

## Atmosphere — why a custom integration for now?

The v1 atmosphere was a translucent shell whose alpha was based only on
surface angle. This creates thick, hard-edged horizon bands.

The new approximation traces each **camera ray** through a finite spherical
atmosphere and samples 14 points of an exponentially thinning density field.
It integrates an optical-depth-inspired transparency and a day/night
illumination term, stopping the ray at the solid planet surface.
The outer limit falls off smoothly, rather than looking like an opaque
second planetary sphere.

This is **Rayleigh/Mie-inspired atmospheric scattering**, not yet a
spectrally accurate full multiple-scattering solution.

Babylon's maintained atmosphere addon is worth evaluating for a later
milestone. We have not bolted it directly onto the renderer because our
celestial scene uses physically equivalent **projection proxy radii** and
a separate sky render pass; standard near-surface atmosphere assumptions
and physical distances must first be adapted and tested. The new material
path is self-contained and compatible with our current Babylon 8 engine.

## Lighting and ship silhouette

The local scene now receives a directional solar light derived from Aster's
**actual ephemeris**. The ship receives a modest hemispherical space fill
and restrained planet-side reflected light, avoiding an almost black hull
against a bright terrestrial world.

The placeholder ship keeps its physical geometry but gains matte PBR hull
material, darker trim, illuminated observation windows and running lights.
This is not a finished ship art asset.

Cloud opacity is reduced and the cloud shader's backside is culled, fixing
the white, doubled layers previously hiding most of Haven.

## Optical inspection camera

A Sun-like star at approximately 1 AU is only about **0.5° wide**. That is
correct at 1× magnification, but not enough to inspect its granulation.
Both bridge stations now expose **Optical magnification (1×–32×)** when using
`Planet / orbital panorama`:

- At **1× or 2×**, the camera remains a third-person ship view with Haven's
  actual curved orbital horizon.
- At **4× to 32×**, the view is explicitly a telescope/sensor feed. It points
  at the physical disc centre and hides local ship/station geometry. This
  changes camera field of view, **not** astronomical coordinates or object size.
- At **32×** Aster should be a fully resolved stellar disc **when it is above
  the local planetary horizon**, suitable for inspecting surface shading and
  the corona. If Haven lies between Highport and Aster, the star is
  legitimately eclipsed and the view is blocked by Haven's surface.
- The new **Centre sightline** readout reports `Clear` or
  `Blocked by Haven` (or another nearer body). This is ray–sphere
  interception using true metre-valued orbits, not arbitrary visibility based
  on renderer draw order. A centreline obstruction does not imply that every
  part of a large target disc is hidden.
- Magnification is local to the browser. Helm commands, cruise navigation and
  multiplayer shared state are unaffected.

The headless Chromium smoke test captures Aster at 32× from an
**unobstructed, fixed orbital phase**: 24 October 2026, 20:00 UTC.
The normal game server still initializes ephemerides from real UTC time.
The test server alone uses `BRIDGE_TEST_START_EPOCH_SECONDS`, making visual
screenshots reproducible regardless of when CI runs. Pure tests additionally
verify that Aster *is* eclipsed by Haven at 20:23 UTC from Highport (on the
same date).

## Testing

Pure tests cover deterministic coastline geometry, spherical seam/pole
continuity, the distribution of deep ocean and continents, crater stability,
planet projection and orbital physics.

Normal GitHub Actions checks run on **Windows Node 24** and **Linux Node 22**
and include the full simulation tests and real multiplayer cruise tests.

A separate Chromium workflow installs Playwright and runs
`node scripts/smoke-planet-browser.mjs`, then uploads screenshots
(`haven-highport-v2.png` and `aster-v2.png`) as CI artifacts.
This additionally checks that WebGL is usable, shader compilation succeeds
and the Main Screen connects to the real multiplayer server.

## Manual browser evaluation

1. Pull `feature/planetary-rendering-v2`, run `npm.cmd install` then
   `npm.cmd run dev` in PowerShell.
2. Open `http://127.0.0.1:5173` in Main Screen and Helm windows.
3. In **Planet / orbital panorama**, inspect Haven from Highport.
   Confirm deep blue ocean, recognizable coasts, partial cloud cover,
   thin luminous atmosphere, proper dark/bright terminator and visible ship.
4. In **System Map (M)** select Aster → **View in 3D orbital camera**.
   From far away it should look like a luminous star with a restrained halo,
   not an over-large solid globe.
5. Select Selene and cruise to **Selene Observatory**.
   Confirm the moon has recognisable crater basins and a sharp terminator,
   and no blue Earth-like atmosphere.
6. Focus Bastion and Tundra. Verify gas-band colour contrast, storms and
   Bastion's proportionate ring structure.
7. Toggle the other cameras; the planetary angular size must not jump
   arbitrarily. The system map remains schematic/logarithmic by design.
8. Check the browser console for shader errors, lag or WebGL context loss.
9. If necessary, compare the same screenshot against the previous
   `feature/planetary-rendering` branch.

If the initial generated texture causes a pause or the browser struggles
with SwiftShader, report device/browser details. Texture budgets and
streaming/LOD remain intentional future improvements.

## Known limitations and future work

This is a substantial prototype, but not a photoreal final planet renderer.
It lacks true volumetric cloud shadows, multiple atmospheric scattering,
HDR environment probes, ground/terrain closeups, eclipses, orbit-based
light attenuation, planetary landing and authored studio-quality maps.
The quality of the mathematical planetary scales is not a substitute
for the art direction of a finished game.

For now, the focus is space-based orbital and approach visuals. The engine
switch decision should be based on **measured** visual and performance
quality, not the appearance of our original temporary shaders.
