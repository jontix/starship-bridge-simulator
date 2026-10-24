import assert from "node:assert/strict";
import { test } from "node:test";
import { vec3 } from "./math.js";
import { ASTER_REACH } from "./universe/aster-reach.js";
import { apparentBodyGeometry, choosePlanetFocus, discDiameterPixels } from "./universe/planet-geometry.js";

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
