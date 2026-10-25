# Interstellar Travel v1 — implementation record

Status: **in progress on `feature/interstellar-travel-v1`**. Do not merge into `main` without user approval.

## Goal

A shared Helm/Main Screen crew can plot and engage a jump from Aster Reach to a distinct star system, witness server-authoritative spool and transit, and arrive safely in the destination local reference frame. Return jumps and normal interplanetary cruise must continue to work.

## Stage A — second system and route registration (implemented)

- `vesper` is a real catalogued system, not a planet-art preset. It includes an orange K-type primary, Ember, Caldera, Umbra, moon Shard, and the Vesper Gateway station.
- `aster-reach` and `vesper` have catalog galactic positions measured in light-years. The actual corridor length is derived from those coordinates (~5.04 ly), never converted into one global metre-based scene.
- `interstellarArrival` is a per-system safe reference-frame anchor, **separate from `start`**. Aster Reach uses Haven Highport; Vesper uses Vesper Gateway. Both jump anchors have a 250 km local offset from their stations; ordinary start remains 300 m.
- The undirected, explicitly authored `aster-vesper` route has a 6 ly range cap, valid in both directions. Invalid/unregistered destinations and routes are excluded by the registry.
- `validateStarCatalog` checks unique system/route IDs, finite galactic positions, catalogued station arrival anchors, minimum 75 km local offset, valid route endpoints, duplicate links, and actual corridor range. It runs during server room creation.
- `interstellar.test.ts` covers registry, arrival anchor safety, route reciprocity/range failures and deterministic Keplerian ephemerides at a shared arrival epoch.
- The existing two-client `smoke-universe.mjs` accepts a system ID argument, so CI checks **both** Aster Reach and Vesper as independent Colyseus room startup systems.
- Windows Node 24/Linux Node 22 CI and Chromium workflows are enabled for this feature branch. Passing status must be confirmed from workflow runs; commits alone do not prove green CI.

This is **content and graph scaffolding only**: Helm cannot issue a jump and the room still has its original fixed `starSystem` property. Do not represent Stage A as functional interstellar travel.

## Stage B — server-authoritative jump contract (not implemented)

- A dedicated `InterstellarState` and `interstellar_command` schema separate from existing `CruiseState`.
- Helm-only plot/engage/cancel, with invalid target and simultaneous cruise/impulse guards.
- Explicit charge countdown, timed transit, server-owned progress/ETA and cancellation during charge.
- Atomic destination-system change with validated safe local frame, cleared cruise state and target, coherent broadcast and monotonic `universe.epochSeconds`.
- Never feed light-years into system-relative `positionSystemMeters`, Babylon meshes or local physics.

## Stage C — game screens (not implemented)

- Dedicated Galactic Map distinct from the existing local System Map. Selected, plotted, and engaged commands must remain distinct.
- Helm drive panel with current/destination, eligibility, route length, spool/ETA and Engage Jump.
- Main Screen is read-only for jump commands, showing the same replicated phase, progress and arrival.

## Stage D — cross-system rendering (not implemented)

- Reset snapshot interpolation on `universe.systemId` changes. Rebuild star and planet assets, lights, camera/focus and previous-system caches without memory growth.
- Use a dedicated cinematic transit mode driven by replicated state, not a cosmetic instant teleport.

## Stage E — acceptance (not implemented)

- Bidirectional real multiplayer voyage, client reconnection during transit, Helm command restrictions, safe arrival and post-arrival 6DOF/cruise.
- Windows/Linux tests, Colyseus room smoke and actual Chromium/WebGL tests including multiple returns.
- Manual game-feel review before any merge.

## Local verification

```powershell
npm.cmd install
npm.cmd run build
npm.cmd test
node scripts/smoke-universe.mjs
node scripts/smoke-universe.mjs vesper
```

The smoke scripts require built workspaces. To manually preview Vesper as a *starting* system before the jump protocol exists, run with `BRIDGE_SYSTEM_ID=vesper` in the server process environment (see the repository README for the normal local server/client launch).

Design reference: `STARSHIP_BRIDGE_SIMULATOR_MASTER_PLAN_AND_HANDOVER(1).md` supplied for the October 2026 handover, sections 7–10. The actual repository and verified tests remain the source of implementation truth.
