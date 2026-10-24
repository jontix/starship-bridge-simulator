import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attitudeFromQuat, dot, length, quatFromAttitude, rotateVector, vec3
} from "./math.js";
import { applyHelmCommand, createInitialShipState, SHIP_LIMITS, stepShip } from "./simulation.js";
import { HelmCommandSchema } from "./types.js";
import { directionToHeading, headingToDirection, quatFromAttitude, rotateVector, sub } from "./math.js";

const tick = 1 / 30;
const advance = (ship: ReturnType<typeof createInitialShipState>, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / tick); i++) stepShip(ship, tick);
};
const near = (actual: number, expected: number, tolerance = 0.001) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} ≈ ${expected}`);
};

test("attitude is genuinely three-dimensional and round trips through quaternion telemetry", () => {
  const target = { yaw: 0.8, pitch: 0.35, roll: -0.5 };
  const q = quatFromAttitude(target.yaw, target.pitch, target.roll);
  const actual = attitudeFromQuat(q);
  near(actual.yaw, target.yaw);
  near(actual.pitch, target.pitch);
  near(actual.roll, target.roll);
  const forward = rotateVector(q, vec3(0, 0, 1));
  assert.ok(forward.x > 0 && forward.y > 0, "Heading and pitch both affect movement");
  near(Math.hypot(q.x, q.y, q.z, q.w), 1);
});

test("ship rotates gradually and approaches all three attitude targets", () => {
  const ship = createInitialShipState();
  applyHelmCommand(ship, { type: "set_heading", yaw: Math.PI / 2, pitch: 0.25, roll: 0.5 });
  stepShip(ship, tick);
  assert.ok(length(ship.angularVelocity) <= SHIP_LIMITS.angularAcceleration * tick + 1e-8);
  const instant = attitudeFromQuat(ship.orientation);
  assert.ok(Math.abs(instant.yaw) < 0.05);
  advance(ship, 14);
  const actual = attitudeFromQuat(ship.orientation);
  near(actual.yaw, Math.PI / 2, 0.025);
  near(actual.pitch, 0.25, 0.025);
  near(actual.roll, 0.5, 0.025);
  assert.ok(length(ship.angularVelocity) < 0.025);
});

test("forward and lateral velocity are achieved through bounded acceleration", () => {
  const ship = createInitialShipState();
  applyHelmCommand(ship, { type: "set_speed", speed: 120 });
  applyHelmCommand(ship, { type: "set_translation", strafe: 30, lift: 20 });
  stepShip(ship, tick);
  assert.ok(length(ship.acceleration) <= SHIP_LIMITS.maxAcceleration + 1e-8);
  assert.ok(length(ship.velocity) < 3, "Ship cannot jump to commanded velocity");
  advance(ship, 18);
  assert.ok(ship.velocity.z > 115);
  assert.ok(ship.velocity.x > 27);
  assert.ok(ship.velocity.y > 17);
});

test("a turn preserves momentum instead of redirecting velocity instantly", () => {
  const ship = createInitialShipState();
  applyHelmCommand(ship, { type: "set_speed", speed: 90 });
  advance(ship, 8);
  const originalVelocity = { ...ship.velocity };
  applyHelmCommand(ship, { type: "set_heading", yaw: Math.PI / 2, pitch: 0, roll: 0 });
  stepShip(ship, tick);
  assert.ok(ship.velocity.z > 0.95 * originalVelocity.z);
  assert.ok(length(ship.velocity) > 60);
});

test("emergency stop cancels all target motion and decelerates without teleportation", () => {
  const ship = createInitialShipState();
  applyHelmCommand(ship, { type: "set_speed", speed: 100 });
  advance(ship, 6);
  const speedBefore = length(ship.velocity);
  applyHelmCommand(ship, { type: "emergency_stop" });
  assert.equal(ship.emergencyStopping, true);
  assert.equal(ship.desiredSpeed, 0);
  assert.equal(ship.desiredStrafe, 0);
  stepShip(ship, tick);
  assert.ok(length(ship.velocity) > 0);
  assert.ok(length(ship.velocity) < speedBefore);
  assert.ok(dot(ship.velocity, ship.acceleration) <= 0);
  assert.ok(length(ship.acceleration) <= SHIP_LIMITS.emergencyAcceleration);
  advance(ship, 15);
  assert.ok(length(ship.velocity) < 0.1);
  applyHelmCommand(ship, { type: "set_speed", speed: 20 });
  assert.equal(ship.emergencyStopping, false);
});

test("rejects non-finite and out-of-range inputs", () => {
  assert.equal(HelmCommandSchema.safeParse({ type: "set_heading", yaw: Infinity, pitch: 0, roll: 0 }).success, false);
  assert.equal(HelmCommandSchema.safeParse({ type: "set_speed", speed: 999 }).success, false);
  assert.equal(HelmCommandSchema.safeParse({ type: "set_translation", strafe: -70, lift: 0 }).success, false);
  assert.equal(HelmCommandSchema.safeParse({ type: "emergency_stop" }).success, true);
});

test("never integrates a giant wall-clock hitch as a giant flight step", () => {
  const ship = createInitialShipState();
  applyHelmCommand(ship, { type: "set_speed", speed: 200 });
  stepShip(ship, 30);
  assert.ok(length(ship.position) < 1);
});

test("heading sphere picks world direction consistently with commanded ship orientation", () => {
  const headings = [
    { yaw: 0, pitch: 0 },
    { yaw: Math.PI / 2, pitch: 0 },
    { yaw: -Math.PI / 2, pitch: 0 },
    { yaw: Math.PI / 3, pitch: Math.PI / 4 },
    { yaw: -2.1, pitch: -0.6 },
    { yaw: 0, pitch: Math.PI / 2 }
  ];
  for (const expected of headings) {
    const direction = headingToDirection(expected.yaw, expected.pitch);
    const selected = directionToHeading(direction);
    assert.ok(selected);
    near(selected.yaw, expected.yaw, 0.000001);
    near(selected.pitch, expected.pitch, 0.000001);
    const forward = rotateVector(quatFromAttitude(selected.yaw, selected.pitch, 1.3), vec3(0, 0, 1));
    near(length(sub(forward, direction)), 0, 0.000001);
  }
});

test("heading sphere ignores invalid zero direction", () => {
  assert.equal(directionToHeading(vec3()), null);
  assert.equal(directionToHeading(vec3(Infinity, 0, 0)), null);
  const direction = directionToHeading(vec3(10, 20, 10));
  assert.ok(direction);
  assert.ok(direction.pitch > 0);
});
