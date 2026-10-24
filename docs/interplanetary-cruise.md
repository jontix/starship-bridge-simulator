# Milestone 2B — Interplanetary Cruise

A working prototype of **intent-driven interplanetary travel** in the browser-based
starship bridge simulator. It builds on the Aster Reach star system and our 6DOF
local/impulse ship simulation.

## Travel regimes

1. **Local / impulse** — authoritative 30 Hz six-degree-of-freedom manoeuvring
   up to 300 m/s, using the existing ship flight controller.
2. **Interplanetary cruise** — a server-authoritative higher-speed navigation
   drive in star-system barycentric coordinates, with a commanded destination,
   spool, acceleration, moving-target intercept and braking.
3. **Interstellar** — deliberately NOT included in this milestone.

Cruise is a **fictional FTL gameplay drive**, not orbital-mechanics thrust:
maximum *effective* speed is **3c**, acceleration and braking are abstract
drive response settings, and travelling between planets takes seconds to
minutes depending on separation. Time is not compressed; the server continues
at the same real-time rate.

## How to fly

Start `npm run dev` on `feature/interplanetary-cruise` and connect Helm and
Main Screen in separate tabs at `http://127.0.0.1:5173`.

**Quick trip:** from Haven Highport, plot **Selene Observatory** (around the
moon Selene). Select it on Helm's destination dropdown and press **Plot
destination**, or open System Map (**M**), choose it and press **Plot cruise
course**. The course does not engage automatically.

At Helm, set cruise power (10–100%), then select **Engage interplanetary
cruise**. The drive spools for four seconds, accelerates to its speed
limit as appropriate, continuously recalculates the future position of the
orbiting target, brakes and drops near its stand-off distance. The arrival
reference frame is automatically changed to the target's co-moving orbit.

On Main Screen, the top HUD reports flight mode, speed as a fraction of `c`,
remaining distance and ETA. Open System Map while travelling to follow the
ship's moving system-scale map marker and dashed plotted route. Motion streaks
are purely visual effects near the ship: they do not pretend stars are nearby.

At any point while spooling, press **Cancel spool**. While moving,
**Request safe drop** slows the drive and exits into local control. The ship
is never teleported across a system by pressing Engage or by switching
camera views.

## Authority and data contract

`CruiseCommandSchema` validates four messages, accepted only from a Helm
session:

- `set_cruise_target {targetId}`
- `set_cruise_throttle {throttle}` (fraction 0.1 to 1)
- `engage_cruise`
- `request_drop`

The same `GameSnapshot` received by every browser contains:

- `universe.systemId`, `epochSeconds`, `referenceBodyId`, `frameOffsetMeters`
- `ship`, unchanged local ship flight state
- `cruise.mode`, `targetId`, `positionSystemMeters`,
  `speedMetersPerSecond`, `remainingMeters`, `etaSeconds`,
  `progress` and `lastEvent`

In **local** mode, the ship position is
`referencePosition(t) + frameOffset + localShip.position`.
In **cruise** mode, it is `cruise.positionSystemMeters`. All authoritative
astronomical coordinates use double-precision metres; Babylon only receives
camera-relative local-metre positions or **schematic celestial direction markers**.

The server is the only component that advances the cruise route. Clients
render state and send intents; they cannot set absolute positions or
authoritative speed.

## Navigation and orbital rendezvous

- Orbits are evaluated analytically at the server's simulated time, not
  advanced in a separate per-body physics loop.
- On engagement, the drive saves the *approach side* of the destination.
- During travel the navigation computer forecasts the target's future
  Keplerian position, based on approximate time to arrival, and steers
  toward a stand-off position on that side.
- A braking-speed envelope reduces effective velocity near arrival.
- Stations use a minimum **75 km stand-off**; moons/planets/stars use wider
  configurable distances.
- After arrival the ship adopts a **non-rotating, co-moving local frame**
  relative to the destination and begins at zero relative velocity.
- Manual drop matches the chosen target's frame at the safe stopped
  barycentric position; the engine does not simulate orbital delta-v or
  realistic relativistic braking.

Future milestones can replace the artificial drive response with more
sophisticated flight constraints without changing the protocol.

## Test checklist

1. Two clients join same room. Main Screen cannot issue cruise commands.
2. Plot Selene Observatory on the map. Confirm the selection reaches Helm
   but does **not** trigger a journey.
3. Engage. Confirm four-second spool, then shared cruise HUD and changing
   positional telemetry.
4. Keep the map open and watch the ship move relative to the orbital paths,
   rather than simply waiting behind a loading screen.
5. Check destination continues to move in its orbit while the ship flies.
6. Verify slowdown and local arrival near the destination, not at the
   destination's old coordinate.
7. After arrival the ship can rotate and manoeuvre with original 6DOF
   controls; the map reports the new reference body.
8. Launch another cruise to a different world using the same shared
   navigation catalog.
9. Cancel a spool, and separately test a safe manual drop in flight.
10. Vary throttle, check it changes speed/ETA and never alters impulse limits.
11. While cruising, ordinary Helm impulse controls should be disabled.
12. Close and reopen a browser; the authoritative route is still in progress
    on the server (a reconnecting station sees the current state).

## Deliberate limitations

- No gravity-well exclusions, collision avoidance, travel-lane hazards,
  heat/fuel requirements, interception/combat in cruise or orbital delta-v.
- Arrival uses velocity matching as a drive capability, not a feasible
  Newtonian manoeuvre; manual drops are an assisted return to local space.
- The cruise autopilot chooses routes automatically. Future crew roles can
  expose hazard scan, course quality, engine readiness and drive power.
- This prototype handles one shared ship in one loaded star system.
  Adding systems is already data-driven, but interstellar transitions are
  future work.

## Automated verification

`npm run build`, `npm test` plus `node scripts/smoke-cruise.mjs`
exercise deterministic flight model, cross-client command authority,
moving-target arrival, velocity matching and state synchronization. CI tests
Linux Node 22 and Windows Node 24.
