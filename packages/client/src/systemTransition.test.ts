import assert from "node:assert/strict";
import test from "node:test";
import {
  createCruiseState, createInitialShipState, createInterstellarState,
  getStarSystem, type GameSnapshot
} from "@bridge-sim/shared";
import {
  arrivalEventKey, isInterstellarTransit, rendererSystemKey,
  shouldResetPoseHistory, visibleFocusId
} from "./systemTransition.js";

function snap(systemId: string): GameSnapshot {
  const system = getStarSystem(systemId);
  return {
    tick: 2, serverTime: 20,
    ship: createInitialShipState(),
    cruise: createCruiseState(),
    interstellar: createInterstellarState(),
    universe: {
      systemId, epochSeconds: system.epochUnixSeconds,
      referenceBodyId: system.start.referenceBodyId,
      frameOffsetMeters: { ...system.start.offsetFromReferenceMeters }
    }
  };
}

test("renderer's resource key changes only for the authoritative system ID", () => {
  const aster = snap("aster-reach");
  const vesper = snap("vesper");
  assert.equal(rendererSystemKey(null), "awaiting-system");
  assert.equal(rendererSystemKey(aster), "aster-reach");
  assert.equal(rendererSystemKey(vesper), "vesper");
  aster.ship.position.x = 5322;
  aster.tick += 100;
  assert.equal(rendererSystemKey(aster), "aster-reach");
});

test("interpolation never blends across systems, reference frames or transit", () => {
  const aster = snap("aster-reach");
  const vesper = snap("vesper");
  assert.equal(shouldResetPoseHistory(aster, vesper), true);
  assert.equal(shouldResetPoseHistory(vesper, aster), true);
  assert.equal(shouldResetPoseHistory(aster, { ...aster, tick: 3 }), false);
  const cruise = snap("aster-reach");
  cruise.cruise.mode = "cruise";
  assert.equal(shouldResetPoseHistory(aster, cruise), true);
  const frame = snap("aster-reach");
  frame.universe.referenceBodyId = "selene-observatory";
  assert.equal(shouldResetPoseHistory(aster, frame), true);
  const transit = snap("aster-reach");
  transit.interstellar.phase = "transit";
  assert.equal(shouldResetPoseHistory(aster, transit), true);
  assert.equal(shouldResetPoseHistory(transit, aster), true);
});

test("stale telescopes resolve to a current-system body on the first arrival frame", () => {
  const aster = snap("aster-reach");
  const vesper = snap("vesper");
  assert.equal(visibleFocusId(aster, "haven"), "haven");
  assert.equal(visibleFocusId(vesper, "haven"), "auto");
  assert.equal(visibleFocusId(vesper, "umbra"), "umbra");
  assert.equal(visibleFocusId(vesper, "vesper-gateway"), "auto");
  assert.equal(visibleFocusId(null, "haven"), "auto");
  assert.equal(visibleFocusId(aster, "auto"), "auto");
  assert.equal(visibleFocusId(aster, "nonexistent"), "auto");
});

test("arrival is an authoritative one-shot event, not a local jump estimate", () => {
  const vesper = snap("vesper");
  assert.equal(arrivalEventKey(vesper), null);
  assert.equal(isInterstellarTransit(vesper), false);
  vesper.interstellar.phase = "transit";
  vesper.interstellar.destinationSystemId = "vesper";
  assert.equal(isInterstellarTransit(vesper), true);
  assert.equal(arrivalEventKey(vesper), null);
  vesper.interstellar.phase = "idle";
  vesper.interstellar.lastArrivalSystemId = "vesper";
  vesper.interstellar.eventSequence = 1;
  assert.equal(arrivalEventKey(vesper), "vesper:1");
  vesper.interstellar.lastArrivalSystemId = "aster-reach";
  assert.equal(arrivalEventKey(vesper), null);
});
