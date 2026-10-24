# Starship Bridge Simulator

A cooperative browser-based **3D starship bridge simulator**, inspired by the crew coordination
of Artemis, with six-degrees-of-freedom navigation and an authoritative multiplayer ship simulation.

## Current prototype: Flight Model v1

- TypeScript monorepo with Babylon.js, React and Colyseus
- Separate browser stations: **Helm** and **Main Screen**
- Ship attitude commanded using yaw, pitch and roll; quaternion physics in world space
- Forward speed, starboard strafe and dorsal lift with acceleration-limited flight assist
- Rotational inertia and genuine deceleration on emergency stop
- Interpolated snapshots and orbit, chase, and tactical camera views
- Simulation unit tests (see [design and manual test plan](docs/flight-model-v1.md))

## Requirements

Node.js >= 20.19.0, npm >= 7 (Node.js 22 or 24 recommended).

## Run on Windows or macOS/Linux

```sh
npm install
npm run dev
```

Open **http://localhost:5173** in two browser windows. Select **Helm** in one and
**Main Screen** in the other. Both connect to the server on port 2567.

```sh
npm run build
npm test
```

## If the browser cannot connect (Windows)

If the browser reports `ERR_CONNECTION_REFUSED` on port 2567, the game server has
not started successfully. Start only the server to see the underlying error:

```cmd
npm --prefix packages/server run dev
```

Open http://localhost:2567/health — it should return `{"ok":true}`.

If starting the server throws `TypeError: WebSocket.Server is not a constructor`,
especially after upgrading Node.js or npm, your local `node_modules` may contain
an inconsistent Colyseus/`ws` dependency tree. A clean install is worth trying:

```cmd
rmdir /s /q node_modules
rmdir /s /q packages\server\node_modules
rmdir /s /q packages\shared\node_modules
rmdir /s /q packages\client\node_modules
del package-lock.json
npm install
npm run build
npm run check:server
npm run dev
```

Missing directories/lockfile can be ignored. Do not remove the source code or `.git`.
If it still fails, capture `node --version`, `npm --version`, and
`npm ls colyseus @colyseus/ws-transport ws` for diagnosis.

The CI workflow checks both **Node 22 on Linux** and **Node 24 on Windows**.
The server smoke test starts the compiled bundle and the TypeScript development
loader, verifying `/health` on two temporary ports. This catches startup errors
that TypeScript compilation alone would miss.

## Navigation visuals (experimental branch)

Use `feature/navigation-visuals` to test the ship's handling with better spatial references.
The flight physics constants are **unchanged**.

- At Helm, press **H** to show/hide a world-aligned **heading sphere** around the ship.
- Click the sphere to **select** a bearing and elevation. Press **Set attitude** to send
  the order to the server. Roll remains an independent control.
- Cyan sphere marker: selected heading; amber: commanded heading; white: actual bow.
- Green arrow: world velocity; violet path: past positions. Watch the off-axis drift angle
  while turning at speed.
- Reference grid, procedural starfield, training beacons (NAV A–D) with distance readouts,
  and acceleration-responsive engine exhaust.
- Orbit, chase and tactical cameras with improved follow/framing, plus nav aid visibility toggle.

Full walkthrough: [Navigation Visuals manual test plan](docs/navigation-visuals.md).

## Milestone 2A: Aster Reach star system

On `feature/first-star-system`, our multiplayer prototype now inhabits a fictional
astronomically scaled star system. **Aster Reach** has one star, four planets, the moon
Selene, and three stations whose positions come from hierarchical Keplerian orbits.

Press **M** (or **System Map** in the header) from Helm or Main Screen:

- Click celestial objects in the orbit chart or hierarchy to inspect them.
- Preview orbital motion from -365 to +730 days without changing live server time.
- See a logarithmic AU-scale orbital map, real radii/periods, and live ship distances.
- Switch Main Screen / Helm camera to **Local sector / station** to see Haven Highport.
- The local 3D renderer now uses a floating origin to preserve metres at large ranges.

The existing ship controls still operate in the local station-relative frame.
Interplanetary cruise, star-to-star jumps, orbital gravity and physical collisions are
**future milestones**, not features of this prototype.

See [First Star System architecture and test plan](docs/first-star-system.md).
New systems are registered in `packages/shared/src/universe/registry.ts`.

## Milestone 2B: Interplanetary Cruise

The `feature/interplanetary-cruise` branch adds a **third-person, server-authoritative
interplanetary drive** to Aster Reach without changing the existing impulse
ship handling:

- Plot a planet, moon or station from **Helm** or **System Map (M)**.
- Engage an effective FTL cruise drive after a four-second spool.
- Flight computer tracks the moving Keplerian destination, accelerates,
  decelerates, and exits to a local reference frame near the target.
- Throttle, ETA, course progress and safe manual drop controls at Helm.
- Main Screen shares real-time voyage telemetry, cinematic star streaks,
  and a moving route line on the system map.
- Up to **3c** effective cruise speed for testing; this is intentionally
  fictional travel technology, not Newtonian thrust.
- Impulse commands are locked while in cruise; they resume on return to
  local space. Interstellar jumps come later.

**Quick test:** Choose **Selene Observatory** (a short trip from the initial
Haven Highport), press **Plot destination**, then **Engage interplanetary
cruise** and follow the moving system-map marker.

See [Interplanetary Cruise notes and test plan](docs/interplanetary-cruise.md).

## Planet Rendering — True astronomical scale

Branch `feature/planetary-rendering` upgrades Aster Reach's symbolic 3D
planet markers to **correct-angular-size spherical worlds**, using actual
catalogued planet radii and Keplerian positions.

**First visual test:** choose **Planet / orbital panorama** camera (the new
default) beside Haven Highport. Haven's radius is 6,370 km, and the station
orbits about 430 km above its surface; it should fill much of the visible sky
behind the station, with a convincing curved horizon.

- Dedicated planetary sky scene, rendering behind the local ship/station
  geometry so huge projection spheres never clip local objects.
- Physically accurate angular sizes over billions of kilometres, a separate
  astronomical map with clearly labelled schematic/log-scale symbols.
- Procedural, seam-free textures and custom sunlight shaders: oceans,
  continents, airless craters, gas bands, rotating clouds, day/night
  boundaries, atmospheric rims and night-side settlement lights.
- Reusable appearance presets stored directly in the system catalog, ready
  for future authored and procedural star systems.
- Camera focus selector on **Helm and Main Screen**: choose a specific planet,
  moon or star, or automatically follow the local world/cruise destination.
- Physical radius, range, surface altitude and apparent angular diameter
  telemetry to help us evaluate visual scale.

No planet landing/terrain collision or full atmospheric flight physics yet.
See [Planet Rendering design and acceptance tests](docs/planetary-rendering.md).

## Planet Rendering v2 — Babylon.js visual overhaul

The `feature/planetary-rendering-v2` branch is an experimental
**planetary and stellar art overhaul**, retaining every astronomical and
flight-model scale.

- Haven gains authored fictional continents, distinctive coastlines, ocean
  shallows, biome variation, thinner rotating clouds and coastal city lights.
- Atmosphere is calculated by integrating scattering-like density along the
  camera ray through a spherical shell, with smooth atmospheric falloff.
- Selene has proper circular craters; Bastion has gas bands and an elliptical
  storm; Aster has its own animated granulation shader and a soft corona.
- The ship gains directional light from Aster's actual ephemeris, subtle
  planetary fill, a matte PBR hull and illuminated observation details.
- Optionally bundle professionally produced equirectangular `albedo`,
  `clouds` and `night` maps in
  `packages/client/src/assets/planets/<body-id>/`.
  Generated textures remain an offline fallback.
- Runs both flight/unit CI and a real Chromium/WebGL visual smoke that
  uploads Haven and Aster screenshots as build artifacts.

These are **look-development approximations**, not yet full photorealistic
scattering or close-range planetary terrain.

Full renderer architecture and manual checks:
[Planet Rendering v2](docs/planetary-rendering-v2.md).

## Procedural Planet Generator v1 — art-directed worlds

The `feature/procedural-planet-generator-v1` branch adds a **reproducible,
seed-driven procedural planet asset pipeline** for Haven and future terrestrial
worlds. It keeps Babylon.js, true astronomical scales and all ship/flight
mechanics unchanged.

```powershell
npm.cmd run dev
```

The root startup generates any missing Haven PNGs **once** and reuses the
cache rather than rebuilding them on every browser connection. Explore
`http://127.0.0.1:5173/planet-lab.html` or select **Planet Lab** from the
Bridge header. This separate workspace offers **fixed daylight, terminator
and night previews**, a surface/biome map gallery, ocean coverage readout,
seed and environment parameters. Copy the generated command to apply changes:

```powershell
npm.cmd run generate:planets -- --seed 48271 --width 1024 --ocean 0.68
```

Generated ocean coverage is calibrated per seed. The output includes albedo,
cloud, night-light/ocean masks, height, roughness, normals and biomes. Our
existing Babylon planetary shader loads the precomputed surface/cloud/night
PNGs instead of regenerating expensive browser textures on each session;
the other diagnostic maps are reserved for future renderer improvements.
Generated binaries are intentionally git-ignored, but the generator,
presets and tests are versioned. For details see
[Procedural Planet Generator guide](docs/procedural-planet-generator.md).

## Monorepo

- `packages/shared` — flight math, simulation, commands and tests
- `packages/server` — Colyseus room and authoritative 30Hz loop
- `packages/client` — Vite/React station UI and Babylon.js display

This is an early prototype. Ship geometry and physics constants are placeholders.
Do not merge experimental feature branches without testing the multiplayer flow.
