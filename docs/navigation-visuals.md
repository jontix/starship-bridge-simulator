# Navigation Visuals (experimental)

This layer provides **debuggable spaceflight** before we tune the handling constants.
Physics and movement remain server-authoritative and unchanged from Flight Model v1.

## Heading sphere

On **Helm**, press **H** or click **Show heading sphere**.

- The sphere follows the ship's position but **does not rotate with it**. It represents
  a **world-aligned navigation frame**: +Y is dorsal/up, +Z is zero yaw, +X is +90° bearing.
- Drag on empty space to orbit the camera, use the scroll wheel to zoom.
- **Click a point on the sphere** to select a world-space direction. The cyan marker is
  the pending direction, amber is the **engaged/ordered** direction, and white is the
  actual forward/bow vector.
- The click updates only the *local Helm selection*. It **does not** change the vessel.
  Press **Set attitude · engage heading** to send yaw/pitch/roll to the server.
- Roll stays independently controlled by the roll slider; sphere picking selects
  bearing/elevation (yaw/pitch), not roll.
- Clicks on the visible camera-facing hemisphere can be selected. Orbit around the
  sphere to choose headings on its opposite side.
- At the north/south poles yaw is mathematically arbitrary; simply use the bearing
  slider if you need an exact vertical-pitch orientation.

This is a **heading selection instrument**, not a destination or position control.
A later waypoint tool could reuse the same visual interaction but use a different
world-space target entity/position.

## Navigation aids

- **Green world-velocity arrow:** direction of current motion (which may differ
  substantially from the actual bow direction).
- **Violet breadcrumb trail:** past world positions, sampled from server snapshots.
- **World-aligned reference grid:** fixed altitude plane with 100-metre subdivisions;
  tiles repeat as the ship moves. It is only a reference (no collision).
- **Fixed labelled NAV A–D beacons:** non-colliding manoeuvring reference markers;
  distances are shown on both stations, nearest first.
- **Starfield:** deterministic renderer-only sky geometry, subtly parallax-shifted.
- **Engine glow and plumes:** visual indicators driven by server acceleration,
  not physics thrust calculations.
- **Camera improvements:** closer orbit framing, orbit/tactical tracking, and
  a ship-relative cinematic chase camera.
- **Off-axis drift telemetry:** angle between ship-forward and world velocity.
- Navigation aids can be hidden independently from the heading sphere.

The server holds neither the heading sphere nor the training markers. Neither
affects gravity, collision, navigation speed, or authority.

## Manual browser acceptance test

1. Run `npm install`, `npm run dev` on branch `feature/navigation-visuals`.
2. Open two browser windows on http://127.0.0.1:5173; choose Main Screen and Helm.
3. At Helm, press **H**; verify a translucent latitude/longitude globe surrounds the ship.
4. Click a point near the upper-right part of the globe; watch the pending bearing
   and elevation update, while **ordered** stays unchanged.
5. Press **Set attitude**. Watch the amber marker move, then the white marker/ship
   gradually converge toward it. Confirm Main Screen sees the same turn.
6. While travelling at 100 m/s, command a 90° turn. The green velocity arrow
   should initially point in the old direction while the bow rotates; the drift
   angle grows then falls as flight assist gradually aligns motion.
7. Pass a NAV beacon and confirm the reported distance decreases and then increases.
8. Try chase, orbit and tactical cameras. The ship should remain framed, and the
   sphere can be rotated by orbiting the camera.
9. Hide nav aids, then hide the sphere; confirm the 3D ship remains fully visible.
10. Press **Emergency stop**, watch the speed gradually decrease without teleportation.
11. Check a refreshed browser automatically reconnects if the server starts later.

## What to evaluate before changing physics

- Does yaw/pitch/roll response feel slow enough to represent a large vessel?
- Does the green velocity vector lag noticeably when turning?
- Do long curved approaches to beacons feel controllable and predictable?
- Is the camera-follow behaviour comfortable while accelerating and rotating?
- Would dedicated *point-at-bearing* and *maintain-relative-velocity* helm modes help?

Record observations, then tune the server's `SHIP_LIMITS` independently from
navigation visuals. This branch intentionally preserves existing flight constants.
