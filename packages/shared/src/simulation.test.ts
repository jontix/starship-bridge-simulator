import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attitudeFromQuat, dot, length, quatFromAttitude, rotateVector, vec3
} from "./math.js";
import { applyHelmCommand, createInitialShipState, SHIP_LIMITS, stepShip } from "./simulation.js";
import { HelmCommandSchema } from "./types.js";
import { directionToHeading, headingToDirection, sub } from "./math.js";
import { ASTER_REACH } from "./universe/aster-reach.js";
import { bodyPositionAt, localShipToSystemPosition, solveEccentricAnomaly, systemPositionsAt, cameraRelativeMetres } from "./universe/orbits.js";
import { getBody, getStarSystem, listStarSystems, validateStarSystem } from "./universe/registry.js";
import { METRES_PER_AU, SECONDS_PER_DAY } from "./universe/units.js";
import { computeFloatingOrigin, localToRenderPosition } from "./universe/floating-origin.js";

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

test("first system is a valid, reusable parent-child orbital catalog", () => {
  validateStarSystem(ASTER_REACH);
  assert.equal(getStarSystem("aster-reach"), ASTER_REACH);
  assert.ok(listStarSystems().length >= 1);
  assert.equal(getBody(ASTER_REACH, "selene").parentId, "haven");
  assert.equal(getBody(ASTER_REACH, "selene-observatory").parentId, "selene");
  assert.equal(getBody(ASTER_REACH, "haven-highport").kind, "station");
  assert.throws(() => getStarSystem("unregistered-system"), /Unknown star system/);
});

test("Keplerian orbit has correct periapsis, apoapsis and periodicity", () => {
  const orbit = {
    semiMajorAxisMeters: 1_000_000,
    eccentricity: 0.2,
    inclinationRadians: 0,
    ascendingNodeRadians: 0,
    periapsisArgumentRadians: 0,
    meanAnomalyAtEpochRadians: 0,
    periodSeconds: SECONDS_PER_DAY
  };
  const system = {
    ...ASTER_REACH,
    bodies: [
      { id: "test-star", name: "Test star", kind: "star" as const, parentId: null, radiusMeters: 1000, mapColor: "#fff", description: "test", orbit: null },
      { id: "test-planet", name: "Test planet", kind: "planet" as const, parentId: "test-star", radiusMeters: 100, mapColor: "#fff", description: "test", orbit }
    ],
    start: { referenceBodyId: "test-star", offsetFromReferenceMeters: vec3() }
  };
  const start = bodyPositionAt(system, "test-planet", system.epochUnixSeconds);
  near(length(start), 800_000, 0.0001);
  const half = bodyPositionAt(system, "test-planet", system.epochUnixSeconds + orbit.periodSeconds / 2);
  near(length(half), 1_200_000, 0.0001);
  const repeat = bodyPositionAt(system, "test-planet", system.epochUnixSeconds + orbit.periodSeconds);
  near(length(sub(start, repeat)), 0, 0.00001);
  near(solveEccentricAnomaly(0, orbit.eccentricity), 0, 0.000001);
});

test("planet and moons move independently; station remains close to its parent", () => {
  const time = ASTER_REACH.epochUnixSeconds;
  const positions = systemPositionsAt(ASTER_REACH, time);
  near(length(positions.aster), 0);
  const havenDistance = length(positions.haven);
  assert.ok(havenDistance > 0.9 * METRES_PER_AU && havenDistance < 1.1 * METRES_PER_AU);
  near(length(sub(positions.selene, positions.haven)), 384_400_000, 0.055 * 384_400_000 + 100);
  near(length(sub(positions["haven-highport"], positions.haven)), 6_800_000, 0.01);
  const later = systemPositionsAt(ASTER_REACH, time + SECONDS_PER_DAY * 15);
  assert.ok(length(sub(later.haven, positions.haven)) > 1_000_000_000);
  assert.ok(length(sub(later.selene, positions.selene)) > 1_000_000_000);
  assert.ok(Math.abs(later.cinder.y - positions.cinder.y) > 1_000_000);
});

test("start frame positions stay astronomically precise while preserving local metre offsets", () => {
  const time = ASTER_REACH.epochUnixSeconds;
  const ref = bodyPositionAt(ASTER_REACH, ASTER_REACH.start.referenceBodyId, time);
  const shipAtZero = localShipToSystemPosition(ASTER_REACH, vec3(), time);
  near(length(sub(shipAtZero, ref)), 300, 0.0001);
  const local = vec3(1400, 200, -850);
  const global = localShipToSystemPosition(ASTER_REACH, local, time);
  const recovered = cameraRelativeMetres(global, shipAtZero);
  near(length(sub(recovered, local)), 0, 0.0001);
  const snapshot = systemPositionsAt(ASTER_REACH, time);
  assert.ok(Object.values(snapshot).every(pos => Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)));
});

test("floating origin preserves metre detail after a long local manoeuvre", () => {
  const shipPosition = vec3(7_654_321.235, -20_000.125, 98_765_431.875);
  const origin = computeFloatingOrigin(shipPosition);
  const render = localToRenderPosition(shipPosition, origin);
  assert.ok(Math.abs(render.x) <= 1024 && Math.abs(render.y) <= 1024 && Math.abs(render.z) <= 1024);
  near(length(sub(vec3(render.x + origin.x, render.y + origin.y, render.z + origin.z), shipPosition)), 0, 0.000001);
  const second = computeFloatingOrigin(vec3(shipPosition.x + 5000, shipPosition.y, shipPosition.z));
  const moved = localToRenderPosition(shipPosition, second);
  near(length(sub(vec3(moved.x + second.x, moved.y + second.y, moved.z + second.z), shipPosition)), 0, 0.000001);
});

test("all orbital elements are finite across centuries and hierarchical stations follow", () => {
  for (const yearsFromEpoch of [-300, -10, 0, 10, 300]) {
    const epoch = ASTER_REACH.epochUnixSeconds + yearsFromEpoch * 365.256 * SECONDS_PER_DAY;
    const positions = systemPositionsAt(ASTER_REACH, epoch);
    assert.equal(Object.keys(positions).length, ASTER_REACH.bodies.length);
    assert.ok(Object.values(positions).every(p => [p.x,p.y,p.z].every(Number.isFinite)));
    near(length(sub(positions["selene-observatory"], positions.selene)), 1_950_000, 0.01);
    near(length(sub(positions["bastion-platform"], positions.bastion)), 105_000_000, 1_050_000);
  }
});
