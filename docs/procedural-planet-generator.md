# Milestone: Procedural Planet Generator v1

**Objective:** make the source material for Haven convincing and repeatable,
before tuning more atmospheric shaders. This is **art-directed, seeded,
build-time** generation; not a new flight mechanic or a new engine.

The current simulator still uses Babylon.js, the same star-system data,
physical radii, six-degree-of-freedom flight and Colyseus cruise model.
No ship, orbit, or world has been teleported or rescaled by this work.

## Quick start (Windows PowerShell)

```powershell
cd C:\Users\jonti\bridgesim\starship-bridge-simulator
git fetch origin
git switch --track origin/feature/procedural-planet-generator-v1
npm.cmd install
npm.cmd run dev
```

Open **<http://127.0.0.1:5173/planet-lab.html>** or click **Planet Lab**
in the Bridge header. The default startup command generates a first set
of Haven assets when none exist and reuses them across subsequent starts.

The lab shows three fixed reference images (daylight, terminator and
night side) and equirectangular maps, all derived from the same planet seed.
It also offers seed, ocean coverage, continental scale, mountain strength,
moisture, cloud coverage, polar cooling and output-resolution controls.

**Important:** Changing lab sliders composes a terminal command; it does
not secretly regenerate high-resolution terrain in the browser. Use
**Copy command**, paste into PowerShell, wait for asset generation to
finish, then refresh the lab and reload the simulator. The generated
values will persist across subsequent `npm.cmd run dev` restarts.

### Editing Haven

```powershell
npm.cmd run generate:planets -- --seed 48271 --width 1024 --ocean 0.68 --continental 1.6 --mountains 0.68 --moisture 0.60 --clouds 0.42 --polar 0.84
```

For rapid iteration, use `--width 512`; for more detailed maps, `--width
2048`. Other available options: `--config path/to/planet.json`,
`--preset haven|verdant`, `--id <catalog-body-id>` and `--help`.

A second **Verdant** preset proves that a new seed and parameters generate
a recognisably different terrestrial world. Generate its assets with

```powershell
npm.cmd run generate:planets -- --preset verdant --width 512
```

and choose Verdant inside the lab. This is a visual-generation sandbox
only; Verdant has not yet been placed into the astronomical catalog.

**The simulator always loads Haven's generated maps, not Verdant's,** as
long as they are present. To regenerate Haven after experimenting with
Verdant, pass `--preset haven` explicitly.

## Asset pipeline

The generator lives in `scripts/planet-generator/core.mjs` and
`scripts/planet-generator/cli.mjs` and runs in Node before Vite starts.
It outputs deterministic 2:1 equirectangular PNG textures:

| Map | Meaning | Current renderer usage |
|---|---|---|
| `albedo.png` | Opaque sRGB colour: deep ocean, shelves, forest, desert, mountains, ice | Yes: surface shader |
| `night.png` | R = city emission, G = water specular mask, A = opaque | Yes: surface shader |
| `clouds.png` | RGB cloud colour, alpha = cloud density | Yes: transparent cloud shader |
| `height.png` | Greyscale diagnostic of elevation and ocean depth, sea level ≈128 | Exported for future terrain/shading |
| `normal.png` | Tangent-space normal approximation from height gradients | Exported; advanced bump shader is future work |
| `roughness.png` | Low values for water, high for land | Exported; roughness-driven material is future work |
| `biome.png` | Diagnostic map of biome classification | Displayed in Planet Lab |

Generated files (intentionally ignored by git):

- `packages/client/src/assets/generated-planets/haven/` — game textures
- `packages/client/public/planet-lab/haven/` — review previews,
  diagnostic map copies and manifest

The JSON `manifest.json` records generator version, seed, parameters,
measured ocean/cloud fractions and SHA-256 hashes for every PNG. It can be
used to reproduce or identify a specific planetary design.

Existing manually curated imagery in
`packages/client/src/assets/planets/<body-id>/` takes precedence over
generated maps. Worlds without prebuilt assets retain the existing
browser-side procedural fallback. If prebuilt assets exist at Vite
initialisation, the planetary sky instead uses tiny placeholder maps while
the exported PNGs load: it does **not** generate 1536-pixel high-detail maps
synchronously on the browser's main thread.

## How the generation works

1. Generate warped multi-octave continental elevation and a ridged mountain
   field from 3D unit-sphere noise. No seam at longitude 0/360°.
2. Choose sea level from a calibrated histogram, achieving the requested
   ocean fraction despite differences in the noise seed.
3. Use latitude, altitude and correlated humidity fields to approximate
   temperature, ice, vegetation and deserts. This is not a physical
   tectonics or climate simulation.
4. Derive ocean shelves and coastal settlement-light masks from the same
   elevation and biome fields. Generate the separate cloud-density field
   from a distinct seed.
5. Generate the albedo, height, normal, roughness, cloud, night and biome
   maps, plus the three deterministic reference lighting views.
6. Vite discovers the generated assets during build and bundles them into
   the same client. The renderer continues using its existing planet radius,
   spherical mesh and day/night shader.

For similar reasons, our daylight/terminator/night previews are **fixed
CPU look-development previews**, rather than authoritative Babylon
screenshots of real orbital geometry. The separate headless Chromium test
continues to check Babylon shader compilation and actual in-game rendering.

## CI and acceptance tests

`npm.cmd test` checks reproducibility across seeds, controlled ocean
coverage, spherical coordinate continuity at the longitude seam, PNG
format and hashes, map channel contracts and lighting-view separation.
The existing Windows/Linux flight, cruise, and orbital tests must
continue to pass.

`scripts/smoke-planet-lab.mjs` launches the actual Vite page in Chromium,
checks generated maps and all three preview images, edits the seed, resets
the parameters and saves a gallery screenshot to CI artifacts. The
existing `scripts/smoke-planet-browser.mjs` still exercises Babylon's
live WebGL renderer and telescope.

### Manual quality review

1. Open the lab and compare the three fixed lighting images.
2. Change seed and ocean fraction. Regenerate, refresh and confirm
   noticeably different geography with ocean coverage matching the setting.
3. Compare generated albedo and biome maps. Oceans, ice, highlands and
   vegetation should correlate, not simply appear as random colours.
4. Compare Haven at Highport in the existing game: the planet must retain
   its *correct physical angular size*, ship silhouettes and orbital view.
5. Check that camera movements and multiplayer cruise remain unaffected.
6. Repeat for 512 and 2048 resolution. Assess texture quality against
   generation time and browser memory.

## Deliberate limitations

This v1 generates only **terrestrial/oceanic worlds**. Airless moons, gas
giants and stars currently retain their specialised existing renderers
and will get their own art-directed generators in later milestones.
The climate model does not calculate true tectonics, ocean currents,
atmospheric circulation, erosion, rivers, weather fronts, or physical
biospheres. Normal and roughness textures are emitted but not yet used
by the production shader.

The seed and parameter controls, reproducible previews, and cached asset
loading are foundational tools to iteratively improve our planet art.
They are not a guarantee of commercial-game photorealism.
