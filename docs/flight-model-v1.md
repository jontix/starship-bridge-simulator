# Flight Model v1 — design and test plan

## Coordinate convention

- 1 world unit = **1 metre**
- **+Y** is world up, **+Z** points along the ship's bow, **+X** is starboard
- Quaternion in the network snapshot is `{x,y,z,w}`; rotations are authoritative server-side
- Commanded yaw positive rotates the bow toward +X; pitch positive raises the bow; roll positive banks toward starboard
- Attitude command order is yaw → pitch → roll; *orientation remains a quaternion during simulation*, avoiding Euler gimbal lock

## Control philosophy

Helm does not directly teleport or translate the ship. It commands target attitude, forward speed,
starboard translation and dorsal translation. Flight assist uses a bounded acceleration toward a
ship-relative target velocity in world space. Rotational control uses quaternion error, bounded
angular velocity and angular acceleration, and a braking-limited controller.

Emergency stop commands zero velocity and allows a stronger maximum acceleration but is **not**
an instantaneous reset. Changing forward or lateral speed releases emergency braking. Rotating
the ship does not cancel an emergency stop.

Simulation uses a fixed **30 Hz** timestep, and the server publishes snapshots at **15 Hz**.
The browser buffers snapshots for 115ms and interpolates positions/quaternions; it never predicts
authoritative movement.

## Helm commands

- `set_heading {yaw, pitch, roll}` (radians)
- `set_speed {speed}` (m/s)
- `set_translation {strafe, lift}` (m/s; ship-local axes)
- `emergency_stop`

The server checks the player's role and validates all command input before applying it.
All clients observe the same authoritative state.

## Test procedure

1. Open two windows, one Helm and one Main Screen.
2. Order **yaw +90°, pitch +15°, roll +30°** and confirm the ship rotates in all axes with visible lag.
3. Order forward speed **120 m/s** and watch the real speed ramp up rather than jump.
4. Apply strafe **+30 m/s** and lift **+20 m/s** and verify diagonal motion.
5. While moving, order another 90° heading change; world-space velocity should drift during the turn.
6. Issue **Emergency stop** and verify the ship decelerates over several seconds.
7. Switch Main Screen between **Orbit**, **Chase**, and **Tactical** and verify no packet-to-packet judder.

## Scope limits

- This is an assisted command flight model, not a thruster-by-thruster rigid-body physics solver.
- Physics is currently isolated and deterministic for a fixed command/timestep sequence; no collisions or mass/inertia tensors.
- Roll/pitch/yaw readings at precisely vertical pitch remain subject to Euler display singularity; quaternion motion is unaffected.
- Multiple Helm clients can join a room in this prototype, without station ownership arbitration.
