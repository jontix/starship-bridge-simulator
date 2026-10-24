import assert from "node:assert/strict";
import { test } from "node:test";
import { vec3 } from "./math.js";
import { ASTER_REACH } from "./universe/aster-reach.js";
import { validateStarSystem } from "./universe/registry.js";
import { apparentBodyGeometry, choosePlanetFocus, discDiameterPixels, lineOfSightBlocker } from "./universe/planet-geometry.js";
import { systemPositionsAt } from "./universe/orbits.js";

test("true-scale Haven horizon at Highport altitude", () => {
  const radius = 6_370_000;
  const altitude = 430_000;
  const a = apparentBodyGeometry(radius, vec3(0, 0, 0), vec3(0, 0, radius + altitude));
  assert.ok(Math.abs(a.apparentAngularRadiusRadians * 180 / Math.PI - 69.5) < 0.4);
  assert.ok(a.proxyRadiusMetres / a.proxyDistanceMetres > 0.936 && a.proxyRadiusMetres / a.proxyDistanceMetres < 0.938);
  assert.equal(a.cameraInsideBody, false);
  assert.equal(a.altitudeMeters, altitude);
});

test("perspective projection preserves angular diameter at vastly different astronomical distances", () => {
  const surfaceRadius = 6_370_000;
  for (const distance of [6_800_000, 4e8, 149_597_870_700, 2e12]) {
    const a = apparentBodyGeometry(surfaceRadius, vec3(0, 0, 0), vec3(distance, 0, 0), 8_000);
    const physicalAngle = Math.asin(surfaceRadius / distance);
    const proxyAngle = Math.asin(a.proxyRadiusMetres / a.proxyDistanceMetres);
    assert.ok(Math.abs(physicalAngle - proxyAngle) < 1e-12);
    assert.ok(a.altitudeMeters >= 0);
  }
  const close = apparentBodyGeometry(surfaceRadius, vec3(), vec3(0, 0, 6_800_000));
  const far = apparentBodyGeometry(surfaceRadius, vec3(), vec3(0, 0, 149_597_870_700));
  assert.ok(discDiameterPixels(close.apparentAngularRadiusRadians, 0.8, 900) > 2_000);
  assert.ok(discDiameterPixels(far.apparentAngularRadiusRadians, 0.8, 900) < 1);
});

test("planet focus follows parent body and supports selecting other star-system objects", () => {
  assert.equal(choosePlanetFocus(ASTER_REACH, "haven-highport", null).id, "haven");
  assert.equal(choosePlanetFocus(ASTER_REACH, "haven-highport", "selene-observatory").id, "selene");
  assert.equal(choosePlanetFocus(ASTER_REACH, "selene-observatory", null).id, "selene");
  assert.equal(choosePlanetFocus(ASTER_REACH, "haven-highport", null, "bastion").id, "bastion");
});

test("bad planet-projection parameters are rejected", () => {
  assert.throws(() => apparentBodyGeometry(0, vec3(), vec3(0, 0, 1)), /Invalid/);
  assert.throws(() => apparentBodyGeometry(100, vec3(), vec3()), /Invalid/);
});

test("visual definitions are system-data reusable and physically bounded", () => {
  validateStarSystem(ASTER_REACH);
  const haven = ASTER_REACH.bodies.find(body => body.id === "haven")!;
  assert.equal(haven.appearance?.archetype, "ocean");
  assert.ok((haven.appearance?.atmosphere?.thicknessMeters ?? 0) > 0);
  const bastion = ASTER_REACH.bodies.find(body => body.id === "bastion")!;
  assert.equal(bastion.appearance?.archetype, "gas-giant");
  assert.ok((bastion.appearance?.rings?.innerRadiusRatio ?? 0) > 1);
  assert.ok((bastion.appearance?.rings?.outerRadiusRatio ?? 0) >
    (bastion.appearance?.rings?.innerRadiusRatio ?? 0));
  const bastionStation = ASTER_REACH.bodies.find(body => body.id === "bastion-platform")!;
  assert.ok((bastionStation.orbit?.semiMajorAxisMeters ?? 0) >
    bastion.radiusMeters * (bastion.appearance?.rings?.outerRadiusRatio ?? Infinity),
    "orbital station should not sit within the physical radial extent of Bastion's rings");

  const invalidSystem = {
    ...ASTER_REACH,
    bodies: ASTER_REACH.bodies.map(body => body.id === "bastion" ? {
      ...body,
      appearance: {
        ...body.appearance!,
        rings: { innerRadiusRatio: 1.7, outerRadiusRatio: 1.4, colorHex: "#ffffff" }
      }
    } : body)
  };
  assert.throws(() => validateStarSystem(invalidSystem), /Invalid ring geometry/);
});

test("Aster can be occulted by Haven from Highport, depending on orbital phase", () => {
  // Station orbits Haven once every 0.065 d. An apparently blank telescope
  // during eclipse is physical, not a missing stellar shader.
  const visibleEpoch = Date.UTC(2026, 9, 24, 20, 0, 0) / 1000;
  const occultedEpoch = Date.UTC(2026, 9, 24, 20, 23, 0) / 1000;
  const visiblePositions = systemPositionsAt(ASTER_REACH, visibleEpoch);
  const occultedPositions = systemPositionsAt(ASTER_REACH, occultedEpoch);
  const offset = ASTER_REACH.start.offsetFromReferenceMeters;
  const viewpoint = (p: typeof visiblePositions) => ({
    x: p["haven-highport"].x + offset.x,
    y: p["haven-highport"].y + offset.y,
    z: p["haven-highport"].z + offset.z
  });

  assert.equal(lineOfSightBlocker(ASTER_REACH, visiblePositions,
    viewpoint(visiblePositions), "aster"), null);
  assert.equal(lineOfSightBlocker(ASTER_REACH, occultedPositions,
    viewpoint(occultedPositions), "aster")?.id, "haven");
  // The obstructing planet's own centre is never treated as a blocker.
  assert.equal(lineOfSightBlocker(ASTER_REACH, occultedPositions,
    viewpoint(occultedPositions), "haven"), null);
});

test("ray-sphere blockers distinguish directions and nearest intersections", () => {
  const synthetic = {
    ...ASTER_REACH,
    bodies: ASTER_REACH.bodies.filter(body => ["aster", "haven", "selene"].includes(body.id))
      .map(body => ({ ...body, radiusMeters: body.id === "haven" ? 2 : 1 }))
  };
  const positions = {
    aster: vec3(0, 0, 100),
    haven: vec3(0, 0, 10),
    selene: vec3(15, 0, 30)
  };
  assert.equal(lineOfSightBlocker(synthetic, positions, vec3(), "aster")?.id, "haven");
  assert.equal(lineOfSightBlocker(synthetic, positions, vec3(8, 0, 0), "aster"), null);
  assert.equal(lineOfSightBlocker(synthetic, positions, vec3(), "selene"), null);
});
