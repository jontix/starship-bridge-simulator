import assert from "node:assert/strict";
import test from "node:test";
import { vec3 } from "../math.js";
import { bodyPositionAt, systemPositionsAt } from "./orbits.js";
import {
  findInterstellarRoute, getStarSystem, interstellarDistanceLightYears,
  listInterstellarRoutes, listStarSystems, validateStarCatalog, validateStarSystem
} from "./registry.js";
import type { InterstellarRoute } from "./registry.js";
import type { StarSystem } from "./types.js";

const aster = getStarSystem("aster-reach");
const vesper = getStarSystem("vesper");

test("two real registered systems have distinctive celestial catalogs", () => {
  const systems = listStarSystems();
  assert.equal(systems.length, 2);
  assert.deepEqual(systems.map(s => s.id), ["aster-reach", "vesper"]);
  assert.ok(aster.bodies.some(b => b.id === "haven-highport"));
  assert.ok(vesper.bodies.some(b => b.id === "vesper-gateway"));
  assert.ok(vesper.bodies.filter(b => b.kind === "planet").length >= 2);
  assert.ok(vesper.bodies.some(b => b.kind === "moon"));
  for (const system of systems) {
    assert.doesNotThrow(() => validateStarSystem(system));
    assert.ok(system.interstellarArrival);
    assert.notDeepEqual(system.interstellarArrival, system.start);
  }
  assert.doesNotThrow(() => validateStarCatalog());
});

test("both star systems produce finite deterministic ephemerides at arrival epoch", () => {
  const arrivalEpoch = aster.epochUnixSeconds + 987_654;
  for (const system of listStarSystems()) {
    const first = systemPositionsAt(system, arrivalEpoch);
    assert.equal(Object.keys(first).length, system.bodies.length);
    assert.deepEqual(systemPositionsAt(system, arrivalEpoch), first);
    for (const body of system.bodies) {
      assert.ok([first[body.id].x, first[body.id].y, first[body.id].z].every(Number.isFinite));
    }
    const arrival = system.interstellarArrival!;
    assert.ok(bodyPositionAt(system, arrival.referenceBodyId, arrivalEpoch));
    assert.ok(Math.hypot(...Object.values(arrival.offsetFromReferenceMeters)) >= 75_000);
  }
});

test("5-light-year-class corridor is truly bidirectional and derives range from catalog positions", () => {
  const d = interstellarDistanceLightYears(aster, vesper);
  assert.ok(d > 4 && d < 6);
  assert.equal(listInterstellarRoutes().length, 1);
  const forward = findInterstellarRoute(aster.id, vesper.id);
  const backward = findInterstellarRoute(vesper.id, aster.id);
  assert.equal(forward?.id, "aster-vesper");
  assert.equal(backward?.id, forward?.id);
  assert.ok(d <= forward!.maxDistanceLightYears);
  assert.equal(findInterstellarRoute(aster.id, aster.id), null);
  assert.equal(findInterstellarRoute(aster.id, "nonexistent"), null);
});

test("reject unsafe anchors and non-finite galactic coordinates", () => {
  const invalidPosition: StarSystem = { ...vesper, galacticPositionLightYears: vec3(Infinity, 0, 0) };
  assert.throws(() => validateStarSystem(invalidPosition), /galactic position/);
  const tooClose: StarSystem = { ...vesper, interstellarArrival: {
    referenceBodyId: "vesper-gateway", offsetFromReferenceMeters: vec3(0, 0, 300)
  } };
  assert.throws(() => validateStarSystem(tooClose), /Unsafe interstellar/);
  const unknown: StarSystem = { ...vesper, interstellarArrival: {
    referenceBodyId: "not-a-real-body", offsetFromReferenceMeters: vec3(0, 0, 250_000)
  } };
  assert.throws(() => validateStarSystem(unknown), /registered station/);
  const missing: StarSystem = { ...vesper, interstellarArrival: undefined };
  assert.throws(() => validateStarCatalog([aster, missing]), /Missing interstellar arrival/);
});

test("reject duplicate identities, unknown endpoints and over-range routes", () => {
  const realRoute = listInterstellarRoutes()[0];
  assert.throws(() => validateStarCatalog([aster, { ...vesper, id: aster.id }]), /Duplicate star system/);
  assert.throws(() => validateStarCatalog([aster, vesper], [
    { ...realRoute, systemBId: "ghost" }
  ]), /Unknown or identical/);
  assert.throws(() => validateStarCatalog([aster, vesper], [
    { ...realRoute, maxDistanceLightYears: 4 }
  ]), /Out-of-range/);
  const duplicate: InterstellarRoute = {
    ...realRoute, id: "vesper-aster", systemAId: vesper.id, systemBId: aster.id
  };
  assert.throws(() => validateStarCatalog([aster, vesper], [realRoute, duplicate]), /Duplicate bidirectional/);
  assert.throws(() => validateStarCatalog([aster, vesper], [realRoute, realRoute]), /Duplicate\/empty interstellar route ID/);
});
