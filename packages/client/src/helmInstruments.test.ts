import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyHelmCommand, createInitialShipState, quatFromAttitude, vec3
} from "@bridge-sim/shared";
import {
  bearingDistance, clampHelmSpeed, clampHelmTranslation,
  currentHeadingFromShip, headingErrorDegrees, isHeadingDraftCommitted,
  localVelocity, offAxisDriftDegrees, orderedHeadingFromShip,
  setHeadingAxis, velocityHeading, wrapHeading
} from "./helmInstruments";

test("heading selection wraps yaw and roll, clamps pitch and remains preview-only", () => {
  const initial = { yaw: 0, pitch: 0, roll: 0 };
  assert.deepEqual(setHeadingAxis(initial, "yaw", 185), { ...initial, yaw: -175 });
  assert.deepEqual(setHeadingAxis(initial, "yaw", -185), { ...initial, yaw: 175 });
  assert.equal(setHeadingAxis(initial, "pitch", 108).pitch, 90);
  assert.equal(setHeadingAxis(initial, "pitch", -101).pitch, -90);
  assert.equal(setHeadingAxis(initial, "roll", 270).roll, -90);
  assert.equal(wrapHeading(360), 0);
  assert.equal(bearingDistance(179, -179), 2);

  const ship = createInitialShipState();
  const draft = setHeadingAxis(initial, "yaw", 75);
  assert.equal(isHeadingDraftCommitted(draft, ship), false);
  assert.equal(ship.desiredYaw, 0, "Preview must not mutate authoritative ship");
  applyHelmCommand(ship, { type: "set_heading", yaw: 75 * Math.PI / 180,
    pitch: 0, roll: 0 });
  assert.equal(isHeadingDraftCommitted(draft, ship), true);
});

test("speed and 6DOF trim match server command validation bounds", () => {
  assert.equal(clampHelmSpeed(-12), 0);
  assert.equal(clampHelmSpeed(320), 300);
  assert.equal(clampHelmTranslation(80), 60);
  assert.equal(clampHelmTranslation(-80), -60);
  assert.equal(clampHelmSpeed(Number.NaN), 0);
  assert.equal(clampHelmTranslation(Infinity), 0);
  const ship = createInitialShipState();
  applyHelmCommand(ship, { type: "set_speed", speed: 60 });
  applyHelmCommand(ship, { type: "set_translation", strafe: -15, lift: 25 });
  assert.equal(ship.desiredSpeed, 60);
  assert.equal(ship.desiredStrafe, -15);
  assert.equal(ship.desiredLift, 25);
  applyHelmCommand(ship, { type: "emergency_stop" });
  assert.equal(ship.emergencyStopping, true);
  assert.equal(ship.desiredSpeed, 0);
  assert.equal(ship.desiredStrafe, 0);
  assert.equal(ship.desiredLift, 0);
});

test("velocity differs from facing and is projected onto ship body axes", () => {
  const ship = createInitialShipState();
  ship.velocity = vec3(12, 0, 0);
  assert.equal(Math.round(offAxisDriftDegrees(ship)!), 90);
  assert.equal(Math.round(velocityHeading(ship.velocity)!.yaw), 90);
  assert.equal(localVelocity(ship).strafe, 12);
  assert.equal(localVelocity(ship).forward, 0);
  ship.orientation = quatFromAttitude(Math.PI / 2, 0, 0);
  assert.ok(Math.abs(localVelocity(ship).forward - 12) < 1e-6);
  assert.ok(offAxisDriftDegrees(ship)! < 0.001);
  assert.ok(Math.abs(currentHeadingFromShip(ship).yaw - 90) < 0.001);
});

test("ordered course converges to actual attitude while retaining draft", () => {
  const ship = createInitialShipState();
  applyHelmCommand(ship, { type: "set_heading",
    yaw: Math.PI / 2, pitch: 0, roll: 0 });
  assert.ok(headingErrorDegrees(ship) > 80);
  assert.deepEqual(orderedHeadingFromShip(ship), { yaw: 90, pitch: 0, roll: 0 });
  ship.orientation = quatFromAttitude(Math.PI / 2, 0, 0);
  assert.ok(headingErrorDegrees(ship) < .01);
  assert.equal(velocityHeading(vec3()), null);
  assert.equal(offAxisDriftDegrees(createInitialShipState()), null);
});
