import {
  attitudeFromQuat, directionToHeading, dot, length, rotateVector, vec3,
  quatFromAttitude, rotationError,
  type ShipState, type Vec3
} from "@bridge-sim/shared";

/** All control previews are degrees; wire commands remain radians and use
 * the server's existing bounded set_heading / set_speed / set_translation API.
 */
export type HelmDraftHeading = { yaw: number; pitch: number; roll: number };
export const toRadians = (degrees: number) => degrees * Math.PI / 180;
export const toDegrees = (radians: number) => radians * 180 / Math.PI;

export function wrapHeading(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 && value > 0 ? 180 : wrapped;
}

export function setHeadingAxis(
  heading: HelmDraftHeading, axis: keyof HelmDraftHeading, value: number
): HelmDraftHeading {
  const degrees = axis === "pitch"
    ? Math.max(-90, Math.min(90, value))
    : wrapHeading(value);
  return { ...heading, [axis]: Math.round(degrees) };
}

export function clampHelmSpeed(value: number): number {
  return Math.max(0, Math.min(300, Number.isFinite(value) ? value : 0));
}
export function clampHelmTranslation(value: number): number {
  return Math.max(-60, Math.min(60, Number.isFinite(value) ? value : 0));
}

export function bearingDistance(a: number, b: number): number {
  return Math.abs(wrapHeading(a - b));
}

export function orderedHeadingFromShip(ship: ShipState): HelmDraftHeading {
  return {
    yaw: Math.round(toDegrees(ship.desiredYaw)),
    pitch: Math.round(toDegrees(ship.desiredPitch)),
    roll: Math.round(toDegrees(ship.desiredRoll))
  };
}

export function currentHeadingFromShip(ship: ShipState): HelmDraftHeading {
  const attitude = attitudeFromQuat(ship.orientation);
  return {
    yaw: toDegrees(attitude.yaw),
    pitch: toDegrees(attitude.pitch),
    roll: toDegrees(attitude.roll)
  };
}

export function isHeadingDraftCommitted(draft: HelmDraftHeading, ship: ShipState): boolean {
  const committed = orderedHeadingFromShip(ship);
  return bearingDistance(draft.yaw, committed.yaw) < 0.6 &&
    Math.abs(draft.pitch - committed.pitch) < 0.6 &&
    bearingDistance(draft.roll, committed.roll) < 0.6;
}

export function headingErrorDegrees(ship: ShipState): number {
  // True shortest 6DOF quaternion rotation; Euler axis differences can
  // overstate error near ±180 degrees or at steep pitch.
  const ordered = quatFromAttitude(ship.desiredYaw, ship.desiredPitch, ship.desiredRoll);
  return rotationError(ship.orientation, ordered).radians * 180 / Math.PI;
}

/** World-space motion is different from the ship's forward velocity.
 * All three components of actual motion must use the current ship frame.
 */
export function localVelocity(ship: ShipState): { forward: number; strafe: number; lift: number } {
  const axes = {
    forward: rotateVector(ship.orientation, vec3(0, 0, 1)),
    strafe: rotateVector(ship.orientation, vec3(1, 0, 0)),
    lift: rotateVector(ship.orientation, vec3(0, 1, 0))
  };
  return {
    forward: dot(ship.velocity, axes.forward),
    strafe: dot(ship.velocity, axes.strafe),
    lift: dot(ship.velocity, axes.lift)
  };
}

export function velocityHeading(velocity: Vec3): HelmDraftHeading | null {
  if (length(velocity) < 0.1) return null;
  const result = directionToHeading(velocity);
  return result ? { yaw: toDegrees(result.yaw), pitch: toDegrees(result.pitch), roll: 0 } : null;
}

export function offAxisDriftDegrees(ship: ShipState): number | null {
  const speed = length(ship.velocity);
  if (speed < 0.1) return null;
  const forward = rotateVector(ship.orientation, vec3(0, 0, 1));
  return Math.acos(Math.max(-1, Math.min(1, dot(forward, ship.velocity) / speed))) * 180 / Math.PI;
}
