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

Stage A is implemented and covered by CI.

## Stage B — server-authoritative jump contract (implemented, pending final CI verification)

- `packages/shared/src/universe/interstellar.ts` adds the separate `InterstellarState`, validated `InterstellarCommandSchema`, deterministic plot/engage/cancel/step transitions and completion/failure outcomes. The wire command types are:
  - `{type: "set_interstellar_target", systemId: string}` — validates and plots a linked, noncurrent system without departing.
  - `{type: "engage_jump"}` — explicitly begins charging only in local mode.
  - `{type: "cancel_jump_spool"}` — allowed only while charging; the plotted course is retained.
- `BridgeRoom` accepts these on `interstellar_command` from the **Helm** role only, replies to that Helm client on `interstellar_notice`, and replicates `GameSnapshot.interstellar` to all stations.
- The server owns `idle → charging → transit → idle/arrived`; default gameplay timing is **6 seconds charging plus 45 seconds transit**. `eventSequence` increments on arrival/failure and `lastArrivalSystemId` persists for the arrival event.
- Charging and transit hold local ship pose and orders. Both local `helm_command` and all `cruise_command` messages are rejected during active jump phases. No impulse or cruise state machine writes ship translation while jump is active. A cancelled charge retains ship pose/reference and does not teleport.
- Transit progress and ETA are server-owned. Transit cannot be cancelled in v1, since deep-space local reference frames do not exist.
- On completion, the room verifies the destination system, station anchor, stand-off distance and finite orbital position at the **current shared epoch** before committing destination `starSystem`, `frame`, reset ship motion/orders, reset `CruiseState`, and completed jump state as **one server-side transaction**. On a failure, the original system/frame remains; a failure event is replicated.
- The same Colyseus room and crew remain connected, and `universe.epochSeconds` never resets. Galactic distance remains route metadata in **light-years**; local/barycentric positions remain in metres inside one registered system.
- For fast, deterministic *server smoke tests only*, `BRIDGE_TEST_JUMP_TIME_SCALE` (0.01–1) may scale spool/transit durations **only when `BRIDGE_TEST_START_EPOCH_SECONDS` is set**. Production always uses the normal durations.
- `interstellar-drive.test.ts` covers state-machine validation, cancellation, exclusivity, deterministic progress/ETA, arrival/failure and the reverse link. `scripts/smoke-interstellar.mjs` exercises two real Colyseus crew clients and a transit-time late join, invalid/unauthorised commands, spool cancellation, conflicts with local/cruise orders, Vesper arrival, restored local control, and return to Aster Reach.
- The Windows/Linux flight checks run the new multiplayer smoke and all existing suites. Do not call CI passing until the new commits have verified results.

**Stage B is the backend/network protocol, not a usable Helm jump UI yet.** Clients may receive the new system ID, but safe asset/cache/interpolation switching belongs to Stage D. Do not manually use live jumps in the Babylon interface until Stage D is complete.

## Stage C — Galactic Navigation and bridge stations (implemented; verify current CI)

- `GalacticMap.tsx` is a dedicated sector chart separate from `SystemMap.tsx`. It uses the catalog's three-dimensional light-year coordinates to calculate distance and route eligibility, with an X/Z projection and explicit Y metadata; it never renders galactic metres.
- Accessible through **GALACTIC MAP (G)** in the shared header, with Escape to close. The existing within-system map remains **System Map (M)**. Both Helm and Main Screen can inspect the catalog and its connected route.
- The route list and star markers distinguish **current**, **locally selected preview**, and **server-plotted target**. Helm's **Plot Selected Route** is noncommittal travel planning, sending only `set_interstellar_target`. Main Screen does not receive plot/engage/cancel controls.
- `InterstellarPanel.tsx` adds a third **JUMP DRIVE** Helm tab alongside LOCAL NAV and FTL PLANNER. Its dropdown is an unsent preview; separate **PLOT ROUTE**, **ENGAGE JUMP**, and **CANCEL CHARGE** buttons reflect server-side drive eligibility, lockouts and `interstellar_notice` validation messages. Chart-to-Helm navigation opens this tab.
- `InterstellarReadout` appears on Helm and read-only on Main Screen, with authoritative system, route ID, destination, light-year distance, phase, spool countdown, ETA, progress and arrival event. No client timer invents a jump.
- Impulse controls and cruise planning are disabled during charging/transit; Helm prominently explains the correct action. Mid-transit cancellation stays unavailable because deep-space arrival has no model.
- UI and chart views reset transient selected-system previews when `universe.systemId` changes; the server's plotted destination is never confused with local preview selection.
- `interstellarUI.test.ts` checks connected destinations, distances, preview/plot readiness, state gating and progress formatting. `smoke-galactic-browser.mjs` launches a real Node/Colyseus server, one Chromium/WebGL client switching between Main Screen and Helm, and a separately connected Colyseus crew observer; checks read-only Main Screen, interactive Helm chart, preview versus server plot, engagement/cancellation, synchronized charge/transit and screenshots.
- CI runs the new unit suite on Windows Node 24/Linux Node 22, and the new browser scenario in a dedicated Chromium Galactic Navigation workflow. Passing claims require final workflow confirmation.

**Stage C is the UI and command bridge, NOT the destination-system Babylon renderer handoff.** While the server can jump, the existing scene may retain old-system textures, local trails or pose interpolation on arrival. The controls display a Stage D limitation notice, and the browser smoke stops during transit rather than claiming a rendered Vesper arrival. Do not call the browser transition fully safe until Stage D passes.

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
node scripts/smoke-interstellar.mjs
```

The smoke scripts require built workspaces. To manually preview Vesper as a *starting* system before the jump protocol exists, run with `BRIDGE_SYSTEM_ID=vesper` in the server process environment (see the repository README for the normal local server/client launch).

Design reference: `STARSHIP_BRIDGE_SIMULATOR_MASTER_PLAN_AND_HANDOVER(1).md` supplied for the October 2026 handover, sections 7–10. The actual repository and verified tests remain the source of implementation truth.
