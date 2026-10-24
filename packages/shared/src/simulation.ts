import {
  add, clamp, identityQuat, length, limitMagnitude, normalize, normalizeQuat,
  quatFromAttitude, quatFromAxisAngle, quatMultiply, rotateVector,
  rotationError, scale, sub, vec3
} from "./math.js";
import type { HelmCommand, ShipState } from "./types.js";

export const SHIP_LIMITS = Object.freeze({
  maxSpeed: 300,                   // m/s
  maxStrafeSpeed: 60,             // m/s
  maxAcceleration: 15,           // m/s²
  emergencyAcceleration: 32,     // m/s²
  maxAngularSpeed: 0.45,         // rad/s
  angularAcceleration: 0.22,    // rad/s²
  velocityResponse: 0.7,        // 1/s
  attitudeResponse: 1.8         // 1/s
});

export const createInitialShipState = (): ShipState => ({
  position: vec3(),
  velocity: vec3(),
  acceleration: vec3(),
  orientation: identityQuat(),
  angularVelocity: vec3(),
  desiredYaw: 0,
  desiredPitch: 0,
  desiredRoll: 0,
  desiredSpeed: 0,
  desiredStrafe: 0,
  desiredLift: 0,
  emergencyStopping: false
});

export function applyHelmCommand(ship: ShipState, command: HelmCommand): void {
  switch (command.type) {
    case "set_heading":
      ship.desiredYaw = command.yaw;
      ship.desiredPitch = command.pitch;
      ship.desiredRoll = command.roll;
      return;
    case "set_speed":
      ship.desiredSpeed = clamp(command.speed, 0, SHIP_LIMITS.maxSpeed);
      ship.emergencyStopping = false;
      return;
    case "set_translation":
      ship.desiredStrafe = clamp(command.strafe, -SHIP_LIMITS.maxStrafeSpeed, SHIP_LIMITS.maxStrafeSpeed);
      ship.desiredLift = clamp(command.lift, -SHIP_LIMITS.maxStrafeSpeed, SHIP_LIMITS.maxStrafeSpeed);
      ship.emergencyStopping = false;
      return;
    case "emergency_stop":
      ship.desiredSpeed = 0;
      ship.desiredStrafe = 0;
      ship.desiredLift = 0;
      ship.emergencyStopping = true;
      return;
  }
}

// Shared attitude controller: cruise may rotate the hull while its drive
// controls barycentric translation separately from impulse thrusters.
export function stepShipAttitude(ship: ShipState, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const step = Math.min(dt, 0.1);
  const target = quatFromAttitude(ship.desiredYaw, ship.desiredPitch, ship.desiredRoll);
  const error = rotationError(ship.orientation, target);

  // Braking-limited rotation: turn hard when far away, then decelerate to avoid overshoot.
  const brakingRate = Math.sqrt(2 * SHIP_LIMITS.angularAcceleration * error.radians);
  const targetRate = Math.min(SHIP_LIMITS.maxAngularSpeed, brakingRate, error.radians * SHIP_LIMITS.attitudeResponse);
  const desiredOmega = scale(error.axis, targetRate);
  const omegaChange = limitMagnitude(sub(desiredOmega, ship.angularVelocity), SHIP_LIMITS.angularAcceleration * step);
  ship.angularVelocity = add(ship.angularVelocity, omegaChange);
  const angleTravelled = length(ship.angularVelocity) * step;
  if (angleTravelled > 1e-10) {
    const rotation = quatFromAxisAngle(normalize(ship.angularVelocity), angleTravelled);
    ship.orientation = normalizeQuat(quatMultiply(rotation, ship.orientation));
  }
}

// Fixed-step, renderer-independent impulse flight model.
export function stepShip(ship: ShipState, dt: number): ShipState {
  if (!Number.isFinite(dt) || dt <= 0) return ship;
  const step = Math.min(dt, 0.1);
  stepShipAttitude(ship, step);

  // Flight assist controls a desired ship-relative velocity, not instantaneous position.
  // If the vessel is already drifting, it must use real acceleration to cancel that drift.
  const requestedLocal = ship.emergencyStopping
    ? vec3()
    : vec3(ship.desiredStrafe, ship.desiredLift, ship.desiredSpeed);
  const desiredWorldVelocity = rotateVector(ship.orientation, limitMagnitude(requestedLocal, SHIP_LIMITS.maxSpeed));
  const velocityError = sub(desiredWorldVelocity, ship.velocity);
  const accelerationLimit = ship.emergencyStopping ? SHIP_LIMITS.emergencyAcceleration : SHIP_LIMITS.maxAcceleration;
  ship.acceleration = limitMagnitude(scale(velocityError, SHIP_LIMITS.velocityResponse), accelerationLimit);

  // Semi-implicit Euler. Fixed 30 Hz server timestep; no artificial velocity reset.
  ship.velocity = add(ship.velocity, scale(ship.acceleration, step));
  ship.velocity = limitMagnitude(ship.velocity, SHIP_LIMITS.maxSpeed);
  ship.position = add(ship.position, scale(ship.velocity, step));
  return ship;
}
