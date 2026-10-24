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

## Monorepo

- `packages/shared` — flight math, simulation, commands and tests
- `packages/server` — Colyseus room and authoritative 30Hz loop
- `packages/client` — Vite/React station UI and Babylon.js display

This is an early prototype. Ship geometry and physics constants are placeholders.
Do not merge experimental feature branches without testing the multiplayer flow.
