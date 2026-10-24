import { add, clamp, scale, shortestAngleDelta, vec3 } from "./math";
import type { HelmCommand, ShipState } from "./types";
export const createInitialShipState = (): ShipState => ({
  position: vec3(0, 0, 0),
  velocity: vec3(0, 0, 0),
  yaw: 0,
  pitch: 0,
  roll: 0,
  angularVelocity: vec3(0, 0, 0),
  desiredYaw: 0,
  desiredPitch: 0,
  desiredRoll: 0,
  desiredSpeed: 0
});
export const SHIP_LIMITS = {
  maxSpeed: 300,
  maxAcceleration: 18,
  maxAngularSpeed: 0.55,
  angularAcceleration: 0.9,
  linearDamping: 0.08,
  angularDamping: 0.35
};
export function applyHelmCommand(ship: ShipState, command: HelmCommand): void {
  switch (command.type) {
    case "set_heading":
      ship.desiredYaw = command.yaw;
      ship.desiredPitch = command.pitch;
      ship.desiredRoll = command.roll;
      break;
    case "set_speed":
      ship.desiredSpeed = clamp(command.speed, 0, SHIP_LIMITS.maxSpeed);
      break;
    case "emergency_stop":
      ship.desiredSpeed = 0;
      break;
  }
}
function stepAxis(current: number, target: number, angularVelocity: number, dt: number) {
  const delta = shortestAngleDelta(current, target);
  const desiredAngularVelocity = clamp(delta * 1.5, -SHIP_LIMITS.maxAngularSpeed, SHIP_LIMITS.maxAngularSpeed);
  const accel = clamp(desiredAngularVelocity - angularVelocity, -SHIP_LIMITS.angularAcceleration * dt, SHIP_LIMITS.angularAcceleration * dt);
  const nextAngularVelocity = (angularVelocity + accel) * (1 - SHIP_LIMITS.angularDamping * dt);
  return { value: current + nextAngularVelocity * dt, angularVelocity: nextAngularVelocity };
}
export function stepShip(ship: ShipState, dt: number): ShipState {
  const yaw = stepAxis(ship.yaw, ship.desiredYaw, ship.angularVelocity.y, dt);
  const pitch = stepAxis(ship.pitch, ship.desiredPitch, ship.angularVelocity.x, dt);
  const roll = stepAxis(ship.roll, ship.desiredRoll, ship.angularVelocity.z, dt);
  ship.yaw = yaw.value;
  ship.pitch = pitch.value;
  ship.roll = roll.value;
  ship.angularVelocity = vec3(pitch.angularVelocity, yaw.angularVelocity, roll.angularVelocity);
  // Babylon default forward is +Z for our prototype convention.
  const forward = vec3(Math.sin(ship.yaw) * Math.cos(ship.pitch), Math.sin(ship.pitch), Math.cos(ship.yaw) * Math.cos(ship.pitch));
  const currentForwardSpeed = ship.velocity.x * forward.x + ship.velocity.y * forward.y + ship.velocity.z * forward.z;
  const speedError = ship.desiredSpeed - currentForwardSpeed;
  const acceleration = clamp(speedError * 0.8, -SHIP_LIMITS.maxAcceleration, SHIP_LIMITS.maxAcceleration);
  ship.velocity = add(ship.velocity, scale(forward, acceleration * dt));
  ship.velocity = scale(ship.velocity, 1 - SHIP_LIMITS.linearDamping * dt);
  ship.position = add(ship.position, scale(ship.velocity, dt));
  return ship;
}
