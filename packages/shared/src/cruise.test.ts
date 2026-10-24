import assert from "node:assert/strict";
import { test } from "node:test";
import {
  add, length, sub, vec3, type Vec3
} from "./math.js";
import { createInitialShipState } from "./simulation.js";
import {
  beginCruise, createCruiseState, CruiseCommandSchema, arrivalStandOffMetres,
  estimateTravelSeconds, requestCruiseDrop, selectCruiseTarget, setCruiseThrottle,
  shipPositionFromSnapshot, stepCruise, systemPositionOfShip,
  CRUISE_LIMITS, SPEED_OF_LIGHT_MPS, type LocalFrame
} from "./universe/cruise.js";
import { ASTER_REACH } from "./universe/aster-reach.js";
import { bodyPositionAt } from "./universe/orbits.js";
import { getBody } from "./universe/registry.js";

const system = ASTER_REACH;
const start = system.epochUnixSeconds;
const dt = 1 / 30;
const startFrame = (): LocalFrame => ({
  referenceBodyId: system.start.referenceBodyId,
  offsetFromReferenceMeters: { ...system.start.offsetFromReferenceMeters }
});

test("cruise commands are validated at network boundary", () => {
  for (const cmd of [
    { type: "set_cruise_target", targetId: "" },
    { type: "set_cruise_throttle", throttle: Infinity },
    { type: "set_cruise_throttle", throttle: 0 },
    { type: "set_cruise_throttle", throttle: 2 },
    { type: "set_cruise_target", targetId: "x".repeat(100) }
  ]) assert.equal(CruiseCommandSchema.safeParse(cmd).success, false);
  assert.equal(CruiseCommandSchema.safeParse({ type: "engage_cruise" }).success, true);
  assert.equal(CruiseCommandSchema.safeParse({ type: "request_drop" }).success, true);
});

test("can't cruise to current nearby station or unknown object", () => {
  const state = createCruiseState();
  const ship = createInitialShipState();
  const frame = startFrame();
  assert.match(beginCruise(state, system, frame, ship, start), /Select/);
  assert.match(selectCruiseTarget(state, system, "invalid"), /Unknown/);
  assert.equal(state.targetId, null);
  selectCruiseTarget(state, system, "haven-highport");
  assert.match(beginCruise(state, system, frame, ship, start), /Too close/);
  assert.equal(state.mode, "local");
});

test("spool cancellation preserves ship coordinates and original reference frame", () => {
  const state = createCruiseState();
  const ship = createInitialShipState();
  const frame = startFrame();
  selectCruiseTarget(state, system, "selene-observatory");
  const oldPos = systemPositionOfShip(system, frame, ship.position, start);
  beginCruise(state, system, frame, ship, start);
  assert.equal(state.mode, "spooling");
  assert.match(requestCruiseDrop(state, ship, system, start, frame), /cancelled/);
  assert.equal(state.mode, "local");
  assert.equal(frame.referenceBodyId, "haven-highport");
  assert.equal(length(sub(systemPositionOfShip(system, frame, ship.position, start), oldPos)), 0);
});

test("ship transits to the moving target, decelerates and matches its local frame", () => {
  const state = createCruiseState();
  const ship = createInitialShipState();
  let frame = startFrame();
  const target = getBody(system, "selene-observatory");
  const targetAtDeparture = bodyPositionAt(system, target.id, start);
  const departure = systemPositionOfShip(system, frame, ship.position, start);
  assert.ok(length(sub(targetAtDeparture, departure)) > 100_000_000);

  assert.match(selectCruiseTarget(state, system, target.id), /Course/);
  assert.match(beginCruise(state, system, frame, ship, start), /charging/);
  assert.equal(state.mode, "spooling");
  const oldGlobal = { ...state.positionSystemMeters };
  assert.equal(length(sub(oldGlobal, departure)), 0);

  let arrivedAt = -1;
  let peakSpeed = 0;
  let sawCruise = false;
  let previousProgress = 0;
  for (let tick = 1; tick < 30 * 90; tick++) {
    const now = start + tick * dt;
    const outcome = stepCruise(state, ship, system, now, dt, frame);
    if (String(state.mode) === "cruise") {
      sawCruise = true;
      peakSpeed = Math.max(peakSpeed, state.speedMetersPerSecond);
      assert.ok(state.progress >= 0 && state.progress <= 1);
      // Progress is only approximate due to the target's moving orbit.
      assert.ok(state.progress + 0.06 >= previousProgress);
      previousProgress = state.progress;
    }
    if (outcome.dropped) {
      frame = outcome.frame;
      arrivedAt = now;
      break;
    }
  }
  assert.ok(sawCruise, "drive should engage after spool");
  assert.ok(peakSpeed > 100_000, "drive should reach meaningful interplanetary speed");
  assert.ok(peakSpeed <= CRUISE_LIMITS.maxSpeedMps + 1);
  assert.ok(arrivedAt > start && arrivedAt < start + 90, "short moon/station cruise should finish promptly");
  assert.equal(state.mode, "local");
  assert.equal(frame.referenceBodyId, target.id);
  assert.equal(length(ship.velocity), 0);
  assert.equal(length(ship.position), 0);
  const targetAtArrival = bodyPositionAt(system, target.id, arrivedAt);
  const arrival = systemPositionOfShip(system, frame, ship.position, arrivedAt);
  const standoff = arrivalStandOffMetres(target);
  assert.ok(Math.abs(length(sub(arrival, targetAtArrival)) - standoff) < 100_000,
    "ship should exit at safe stand-off from MOVING destination");
  assert.ok(length(sub(targetAtArrival, targetAtDeparture)) > 1_000,
    "destination must have moved while travelling");

  const recovered = shipPositionFromSnapshot(system, {
    cruise: state,
    universe: { epochSeconds: arrivedAt, referenceBodyId: frame.referenceBodyId,
      frameOffsetMeters: frame.offsetFromReferenceMeters },
    ship
  });
  assert.ok(length(sub(recovered, arrival)) < 0.001);
});

test("manual disengage brakes drive, then restores local co-moving control", () => {
  const state = createCruiseState();
  const ship = createInitialShipState();
  let frame = startFrame();
  selectCruiseTarget(state, system, "cinder");
  beginCruise(state, system, frame, ship, start);
  let now = start;
  for (let i = 0; i < 30 * 12; i++) {
    now += dt;
    stepCruise(state, ship, system, now, dt, frame);
  }
  assert.equal(state.mode, "cruise");
  assert.ok(state.speedMetersPerSecond > 0);
  const beforeDrop = state.positionSystemMeters;
  assert.match(requestCruiseDrop(state, ship, system, now, frame), /shutting down/);
  assert.equal(state.mode, "dropping");
  let finished = false;
  for (let i = 0; i < 30 * 65; i++) {
    now += dt;
    const outcome = stepCruise(state, ship, system, now, dt, frame);
    if (outcome.dropped) {
      frame = outcome.frame;
      finished = true;
      break;
    }
  }
  assert.equal(finished, true);
  assert.equal(state.mode, "local");
  assert.ok(length(sub(state.positionSystemMeters, beforeDrop)) > 0);
  assert.equal(length(ship.velocity), 0);
  const recovered = systemPositionOfShip(system, frame, ship.position, now);
  assert.ok(length(sub(recovered, state.positionSystemMeters)) < 0.005);
});

test("throttle changes drive cap and travel estimates remain finite", () => {
  const state = createCruiseState();
  setCruiseThrottle(state, 0.25);
  assert.equal(state.throttle, 0.25);
  const estimateFull = estimateTravelSeconds(250_000_000_000, 0, 1);
  const estimateQuarter = estimateTravelSeconds(250_000_000_000, 0, 0.25);
  assert.ok(estimateFull < estimateQuarter);
  assert.ok(estimateQuarter < 10_000);
  assert.ok(CRUISE_LIMITS.maxSpeedMps > SPEED_OF_LIGHT_MPS);
  assert.equal(state.speedMetersPerSecond, 0);
});

test("future system jump can replace catalog without changing cruise schema", () => {
  const body = getBody(system, "bastion");
  assert.equal(body.kind, "planet");
  const cloned = { ...system, id: "different-system", galacticPositionLightYears: vec3(5, 2, 0) };
  const local = createInitialShipState();
  const frame = startFrame();
  const a = systemPositionOfShip(cloned, frame, local.position, start);
  assert.ok([a.x, a.y, a.z].every(Number.isFinite));
});
