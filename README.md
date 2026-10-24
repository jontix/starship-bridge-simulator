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

## Monorepo

- `packages/shared` — flight math, simulation, commands and tests
- `packages/server` — Colyseus room and authoritative 30Hz loop
- `packages/client` — Vite/React station UI and Babylon.js display

This is an early prototype. Ship geometry and physics constants are placeholders.
Do not merge experimental feature branches without testing the multiplayer flow.
