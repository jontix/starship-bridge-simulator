# Milestone 2A — First Star System (Aster Reach)

## Goals

Make the existing multiplayer ship inhabit a small but correctly dimensioned fictional
star system, without forcing our current 6DOF combat/docking simulation to operate at
astronomical distances or adding speculative cruise/jump mechanics prematurely.

The source is data-driven: adding a future system requires a new `StarSystem` catalog
entry plus registration. System IDs and celestial-body IDs are stable references,
distinct from station role IDs or local ship entities.

## Content

**Aster Reach** is a fictional G-star system with realistic astronomical scales:
one G-type primary, four orbiting planets (Cinder, Haven, Bastion, Tundra),
the moon Selene orbiting Haven, and three orbital stations
(Haven Highport, Selene Observatory, Bastion Platform). Bodies are not to scale in
the system map: the chart explicitly uses logarithmically compressed orbital radii.

The ship begins in a 300-metre-offset local frame co-moving with Haven Highport.
The rest of our previous NAV A–D test beacons are still fixed **in the local frame**.
A grey-box station ring is rendered near the ship; it is not collidable yet.

### Units

- Authoritative astronomical positions: **metres**, double-precision JavaScript numbers.
- Time: **Unix seconds**; server seeds time on room creation and advances exactly with
  its 30 Hz simulation tick.
- Interstellar registry positions: **light-years**, separate from system-local coordinates.
- Local flight: **metres** and **metres/second**, same flight model as before.
- The renderer only sees **camera-relative local metre offsets**, rebased on a 2048m grid.
- Star-system map: **AU** with log radial projection; angles retained, icon sizes exaggerated.

## Flight frames (important)

`shipLocalPosition` is the ship's existing local simulation position.

```
systemPosition(ship, t) =
    positionOf(referenceStation, t)
    + shipStartOffset
    + shipLocalPosition
```

The reference station's analytic Keplerian orbit is computed at time `t`. This
local frame **translates with** the station but does not rotate with it.
This is an intentional early-stage approximation: velocity is a local relative
velocity, so explicit orbital/Coriolis accelerations are NOT calculated. Matching
velocity when leaving/entering another frame will belong to Milestone 2C.

The same world-position resolver can eventually support:
- ship local manoeuvring in a planet or station reference frame,
- cruise with an independent, barycentric ship frame,
- re-anchoring to a new object on a close approach,
- system transitions via a star-system ID.

We must not naively set Babylon objects to AU-valued absolute positions.

## Orbits

`packages/shared/src/universe/orbits.ts` implements a pure hierarchical
**two-body Keplerian ephemeris**, using mean anomaly and a Newton solve of
Kepler's equation. A body orbits its declared parent, and children inherit
their parent's computed position. The orbit is evaluated for any time without
integrating millions of simulation frames. It is deterministic for a fixed
catalog and epoch.

Current constraints: no N-body perturbations, moons do not generate gravity
on ships, and orbital periods are explicitly catalog-defined, not derived
dynamically from body mass.

## Browser interface

Press **M** or click **System Map** in the app header. Main Screen and Helm
see the same catalog and current server time.

- Orbit chart shows actual orbital azimuths and elliptic paths, but
  logarithmically compressed radii and exaggerated icon sizes.
- Click a world to inspect radius, parent, orbit radius, period, and
  current live distance from the ship.
- Moon and stations are selectable in the hierarchy even though they are
  too close to their parent to draw as independent dots at system-map scale.
- Timeline slider previews from **365 days before** to **730 days after**
  current server time. This is a **local visualization only**: it cannot
  change authoritative gameplay time, ship position, or the other browser.
- **Return to live** sets offset to zero.
- **Local sector / station** camera lets players see the nearby station model.
- Small bright direction-only 3D sky markers show the angles of the star and
  planets as seen from the ship. Their displayed distances and diameters
  are **schematic** — they are not physical-scale meshes.

## Adding a second system

1. Create `packages/shared/src/universe/<id>.ts` exporting a `StarSystem`.
2. Give the system a new stable `id`, galactic coordinates (light-years), and
   an `epochUnixSeconds`. Assign stable IDs and a valid acyclic parent hierarchy
   with exactly one root star. Keep orbits in metres/seconds/radians.
3. Register that definition in `packages/shared/src/universe/registry.ts`.
4. Set `start.referenceBodyId` to a known station/planet and choose a safe
   offset. Run catalog and orbit regression tests.
5. For prototype testing only, start the server with
   `BRIDGE_SYSTEM_ID=<new-id>` (or use the new system in the registry as default).
   Later, the lobby/session will select the system; we won't hard-code it per server.

The registry currently has **one authored system**. Galactic travel and the
player-selectable interstellar jump are future milestones.

## Manual acceptance test

1. Run `npm install && npm run dev` on this feature branch.
2. Open two clients, one Main Screen and one Helm; check both show
   `Aster Reach` in the header.
3. Press **M**; see Aster, four orbiting planets, selectable moon and
   stations. Zoom/list view shows no impossible full-scale planet icons.
4. Click Haven Highport: its parent is Haven, its orbit is measured in
   thousands of kilometres, and live ship distance begins about 300 m.
5. Select Selene and confirm the moon lists Haven as parent.
6. Move the time preview forward 100–300 days: worlds move along their orbit
   paths, including their non-zero inclinations. Click **Return to live**.
7. While previewing, move Helm and check the Main Screen ship still responds
   normally. The preview must not alter the live simulation.
8. Select **Local sector / station** camera and look for the nearby station.
9. With navigation aids enabled, note distant planets appear as *direction
   markers* only, while stations and NAV A–D remain local.
10. Cruise at 120 m/s in local mode for a while and confirm the camera tracks
    smoothly as the floating origin rebases. Verify the heading sphere H
    shortcut and Helm telemetry still work.
11. Refresh one tab to verify reconnect and shared authoritative time.

## Upcoming milestone: Interplanetary cruise (2B)

Do not implement it before confirming this mapping. The future cruise mode
will move in a **star-system barycentric frame**, plot approaches to moving
objects using the ephemeris, and use an explicit mode transition into a
local co-moving frame. Interstellar travel will be separate and will load a
different StarSystem catalog entry.
