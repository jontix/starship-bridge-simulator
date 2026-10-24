export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const identityQuat = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });
export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const normalize = (a: Vec3): Vec3 => {
  const len = length(a);
  return len < 1e-12 ? vec3() : scale(a, 1 / len);
};
export const limitMagnitude = (a: Vec3, maximum: number): Vec3 => {
  const magnitude = length(a);
  return magnitude > maximum && magnitude > 0 ? scale(a, maximum / magnitude) : a;
};
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const quatMultiply = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
});
export const quatConjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export const normalizeQuat = (q: Quat): Quat => {
  const magnitude = Math.hypot(q.x, q.y, q.z, q.w);
  return magnitude < 1e-12 ? identityQuat() : { x: q.x / magnitude, y: q.y / magnitude, z: q.z / magnitude, w: q.w / magnitude };
};
export const quatFromAxisAngle = (axis: Vec3, radians: number): Quat => {
  const normal = normalize(axis);
  const s = Math.sin(radians / 2);
  return normalizeQuat({ x: normal.x * s, y: normal.y * s, z: normal.z * s, w: Math.cos(radians / 2) });
};

// World +Y up, ship +Z forward, ship +X starboard.
// Positive pitch raises the bow; positive roll drops the starboard side.
// Intrinsic yaw (Y), pitch (-X), roll (-Z) in ship coordinates.
export const quatFromAttitude = (yaw: number, pitch: number, roll: number): Quat =>
  normalizeQuat(quatMultiply(
    quatMultiply(quatFromAxisAngle(vec3(0, 1, 0), yaw), quatFromAxisAngle(vec3(1, 0, 0), -pitch)),
    quatFromAxisAngle(vec3(0, 0, 1), -roll)
  ));

// Used for the Helm attitude readout. The underlying physics never uses Euler angles.
export const attitudeFromQuat = (q: Quat): { yaw: number; pitch: number; roll: number } => {
  const forwardX = 2 * (q.x * q.z + q.w * q.y);
  const forwardY = 2 * (q.y * q.z - q.w * q.x);
  const forwardZ = 1 - 2 * (q.x * q.x + q.y * q.y);
  const rightY = 2 * (q.x * q.y + q.w * q.z);
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
  return {
    yaw: Math.atan2(forwardX, forwardZ),
    pitch: Math.asin(clamp(forwardY, -1, 1)),
    roll: Math.atan2(-rightY, upY)
  };
};
export const rotateVector = (q: Quat, v: Vec3): Vec3 => {
  const r = quatMultiply(quatMultiply(q, { ...v, w: 0 }), quatConjugate(q));
  return vec3(r.x, r.y, r.z);
};

// World-space shortest-axis rotation from current attitude to desired attitude.
export const rotationError = (current: Quat, desired: Quat): { axis: Vec3; radians: number } => {
  let delta = normalizeQuat(quatMultiply(desired, quatConjugate(current)));
  if (delta.w < 0) delta = { x: -delta.x, y: -delta.y, z: -delta.z, w: -delta.w };
  const sinHalf = Math.hypot(delta.x, delta.y, delta.z);
  return {
    axis: sinHalf < 1e-10 ? vec3() : vec3(delta.x / sinHalf, delta.y / sinHalf, delta.z / sinHalf),
    radians: 2 * Math.atan2(sinHalf, delta.w)
  };
};

/** Convert a world-frame bearing/elevation into a unit direction.
 *  Zero yaw/pitch aims along +Z; +90° yaw points toward +X; positive pitch aims up.
 */
export const headingToDirection = (yaw: number, pitch: number): Vec3 =>
  vec3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));

/** Convert a clicked point on a world-aligned direction sphere to a Helm heading.
 *  The direction is from the sphere centre toward the point, not from the camera.
 *  A zero-length selection is invalid (rather than silently turning the ship).
 */
export const directionToHeading = (direction: Vec3): { yaw: number; pitch: number } | null => {
  const magnitude = length(direction);
  if (!Number.isFinite(magnitude) || magnitude < 1e-10) return null;
  const horizontal = Math.hypot(direction.x, direction.z);
  return {
    yaw: Math.atan2(direction.x, direction.z),
    pitch: Math.atan2(direction.y, horizontal)
  };
};
