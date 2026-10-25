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
- `InterstellarReadout` appears on Helm and read-only on Main Screen, with authoritative system, route ID, destination, light-year distance, phase, spool countdown, ETA, progress and arrival event. The Main Screen also displays a persistent non-interactive `InterstellarStatusBanner` during charge/transit so progress and destination are visible without scrolling camera settings. No client timer invents a jump.
- Impulse controls and cruise planning are disabled during charging/transit; Helm prominently explains the correct action. Mid-transit cancellation stays unavailable because deep-space arrival has no model.
- UI and chart views reset transient selected-system previews when `universe.systemId` changes; the server's plotted destination is never confused with local preview selection.
- `interstellarUI.test.ts` checks connected destinations, distances, preview/plot readiness, state gating and progress formatting. `smoke-galactic-browser.mjs` launches a real Node/Colyseus server, one Chromium/WebGL client switching between Main Screen and Helm, and a separately connected Colyseus crew observer; checks read-only Main Screen including the always-visible jump banner, interactive Helm chart, preview versus server plot, engagement/cancellation, synchronized charge/transit and screenshots.
- CI runs the new unit suite on Windows Node 24/Linux Node 22, and the new browser scenario in a dedicated Chromium Galactic Navigation workflow. Passing claims require final workflow confirmation.

**Stage C established the navigation controls; Stage D subsequently implemented the renderer handoff.** The Stage C-only browser smoke stops in transit; Stage D/E browser smokes verify the real destination visuals and scene disposal.

## Stage D — destination-system rendering and shared jump presentation (implemented; verification in Stage E)

- `systemTransition.ts` defines deterministic client-owned handoff rules: scene keys derive **only** from authoritative `universe.systemId`; interpolation history resets when system, local reference body, local-vs-cruise mode or transit boundary changes. A stale telescope focus from the old catalog immediately maps to `auto` while state resets asynchronously.
- `main.tsx` keys `MainScene` by the authoritative system ID. **Babylon Engine, both local and planetary Scenes, cameras, lights, navigation trails and planet textures are disposed/re-created at each system change.** Role, station controls, camera selection, display preferences and Colyseus room survive. Optical zoom, target and unsent heading previews reset on arrival.
- `scene.tsx` uses the per-system key as well as interpolation-frame checking to prevent blending Aster and Vesper positions. A transit frame does not render the origin star system: the Babylon buffer is cleared instead of running the local/celestial passes in galactic deep space.
- `InterstellarTransition.tsx` adds a server-phase-driven charging view and animated jump corridor, ETA/progress indicators from server telemetry, and a short one-shot arrival flash. There is no simulated deep-space metre coordinate. CSS supports reduced-motion preferences and does not intercept Helm controls.
- `planetaryScene.ts` owns and disposes its sky textures, globes, ring meshes, shaders and starfield through the sky scene lifecycle. Each new sky is populated only from the current system's registered bodies. Development diagnostics (`window.__bridgeRendererDiagnostics`) report created/disposed/live WebGL renderers, celestial IDs and texture/mesh counts to detect leaks; these metrics do **not** control gameplay.
- `SystemMap` is also keyed by the server system ID so catalog selection and orbital time previews reset after arrival. **React sibling keys have distinct namespaces** (`babylon-scene:<systemId>` and `system-map:<systemId>`): a previous same-key collision was exposed by the roundtrip WebGL test when a local map remained open across a jump. This prevents the old canvas/engine from surviving a return. Invalid legacy optical targets are ignored synchronously, before any view tries to reference the destination's ephemerides.
- `systemTransition.test.ts` checks the system key, interpolation barriers, focus validation and arrival event identity. It runs on Windows and Linux.
- `smoke-interstellar-visual-browser.mjs` launches a real Colyseus Helm + Chromium bridge station, performs two complete **Aster Reach → Vesper → Aster Reach** voyages, inspects both Main Screen and Helm UI, checks the jump corridor, waits for destination body meshes, verifies the old world's IDs are absent and that there is exactly **one** live renderer after each switch, checks an open System Map/catalog handoff, tests new-system focus reset, verifies the Babylon WebGL context and records destination screenshots. The separate Chromium CI workflow runs this acceptance.
- Stage D is not considered passing until the latest Windows, Linux, planetary, Galactic Map and interstellar destination Chromium jobs have verified results.

**Game-play limits:** Arrivals are safe navigation anchors (250 km stand-off), not docking. Stage E continues with full connection/reconnect acceptance, camera/manual aesthetics, and user playtest before merging.

## Stage E — production-speed acceptance and visual review (automated implementation complete; human sign-off pending)

### Production-time two-way crew voyage
- `scripts/smoke-interstellar-production.mjs` starts an actual Colyseus room at the catalog's deterministic ephemeris epoch, **without the accelerated jump-time option**. It measures two real Aster Reach ↔ Vesper legs against the normal **6 s charge / 45 s transit** configuration, in Windows Node 24 and Linux Node 22 CI.
- The acceptance deliberately **disconnects and reconnects Main Screen during the charging phase**, **disconnects and reconnects Helm during transit**, rejoins Main Screen after arrival and during the return transit, and confirms each new connection uses the **same Colyseus room** and the *ongoing* server phase/ETA rather than restarting the drive.
- The server's phase snapshots are validated for monotonic epoch, decreasing countdowns, increasing transit progress, current-system stability before arrival, 250 km arrival frame, cleared old cruise orders and restored post-arrival Helm controls. Spoofed Main Screen orders remain rejected after reconnect.
- First successful full-speed run: [Stage E acceptance 40197179859](https://github.com/jontix/starship-bridge-simulator/actions/runs/40197179859) — **Linux and Windows passed**. Linux measured Aster→Vesper spool **6.00 s**, transit **44.72 s**, and Vesper→Aster spool **5.98 s**, transit **44.79 s**. These are observed wall-clock times, not animation estimates.

### Browser-based UX, reconnection and evidence
- `scripts/smoke-interstellar-acceptance-browser.mjs` launches the actual Babylon/React bridge in Chromium alongside a separate authoritative crew client, using the real 6/45-second timers. It verifies **Main Screen's read-only Galactic Map**, Helm's explicit **plot → engage**, disabled impulse during charging, six-second spool, spectator mode, live server progress and a **full-page reload during transit**.
- After browser reload the Main Screen must reconnect, show continuing authoritative transit progress, then load the Vesper renderer with one active Babylon engine and no stale Aster bodies. The acceptance captures three screenshots: Helm charging, Main Screen transit, and Vesper arrival.
- The first full-speed Chromium test **passed** in [Stage E acceptance 40197179859](https://github.com/jontix/starship-bridge-simulator/actions/runs/40197179859). [Screenshot archive](https://github.com/jontix/starship-bridge-simulator/actions/runs/40197179859/artifacts/12600592652).
- Screenshot review: Vesper has a visually distinct warm, sandy planet and correctly labeled arrival; the server-driven transit tunnel and always-visible Main Screen status/ETA are legible. Noted an overly long optics explanation dominating the 900 px Main Screen sidebar. Changed it into an accessible **collapsed-by-default disclosure**, so interstellar telemetry is above the fold without deleting optional training help. Removed stale Stage D text from the status banner.
- A repeated WebGL regression surfaced one intermittent `postProcessManager` disposal-time exception despite reaching all four correct destination scenes; added a render-loop disposal guard so queued Babylon frames cannot access a torn-down scene. **The new commit must pass the full regression matrix before Stage E is marked green.**

### Final hands-on playtest — needs a human crew
Automated snapshots/browser scripts establish behavior and basic presentation, but cannot substitute for judging the **feel** of a 51-second voyage, ease of locating the correct button, readability across monitors, motion comfort, and camera aesthetics.

On Windows (using the existing local checkout of `feature/interstellar-travel-v1`, without discarding uncommitted work):

```powershell
npm.cmd install
npm.cmd run build
npm.cmd test
npm.cmd run dev
```

Open `http://localhost:5173` in **two separate browser windows**, leaving one as Main Screen and choosing **Helm** for the other. In Helm, open **Galactic Map (G)** and inspect the route, select Vesper (preview only), **Plot Route**, then in **Jump Drive** press **Engage Jump**. Check the 6-second charge, 45-second tunnel, ETA and shared Main Screen overlay. Try **Cancel Charge** on a separate attempt; verify it returns to the plotted route. Reload Main Screen while the server is in transit, confirm the countdown resumes, then view Vesper at arrival. Fly locally, plot a Vesper target, return to Aster Reach, and inspect local **System Map (M)** and planet focus. Confirm the old system never remains on screen. If motion/legibility or control placement feels wrong, record the screenshot and the step before approving the PR.

**Stage E exit rule:** all current-head Windows/Linux/Chromium jobs pass, plus human acceptance of gameplay and presentation. PR #10 stays **draft and unmerged** until the owner expressly approves a merge.

## Local verification

```powershell
npm.cmd install
npm.cmd run build
npm.cmd test
node scripts/smoke-universe.mjs
node scripts/smoke-universe.mjs vesper
node scripts/smoke-interstellar.mjs
node scripts/smoke-galactic-browser.mjs
node scripts/smoke-interstellar-visual-browser.mjs
```

The smoke scripts require built workspaces. To manually preview Vesper as a *starting* system without a crew jump, run with `BRIDGE_SYSTEM_ID=vesper` in the server process environment (see the repository README for the normal local server/client launch).

Design reference: `STARSHIP_BRIDGE_SIMULATOR_MASTER_PLAN_AND_HANDOVER(1).md` supplied for the October 2026 handover, sections 7–10. The actual repository and verified tests remain the source of implementation truth.
