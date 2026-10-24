import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASTER_REACH, createCruiseState, createInitialShipState, type GameSnapshot
} from "@bridge-sim/shared";
import { assessPlanetView } from "./planetView";

const time = (hour: number, minute: number) =>
  Date.UTC(2026, 9, 24, hour, minute, 0) / 1000;

function snapshot(epochSeconds: number): GameSnapshot {
  return {
    tick: 0,
    serverTime: epochSeconds * 1000,
    universe: {
      systemId: ASTER_REACH.id,
      epochSeconds,
      referenceBodyId: ASTER_REACH.start.referenceBodyId,
      frameOffsetMeters: { ...ASTER_REACH.start.offsetFromReferenceMeters }
    },
    ship: createInitialShipState(),
    cruise: createCruiseState()
  };
}

test("8x at Haven Highport is a 5.73-degree surface close-up, not a broken 139-degree globe", () => {
  const close = assessPlanetView(snapshot(time(20, 0)), "haven", 8);
  assert.equal(close.body.id, "haven");
  assert.equal(close.isSurfaceCloseup, true);
  assert.ok(close.fieldOfViewDegrees > 5.7 && close.fieldOfViewDegrees < 5.8);
  assert.ok(close.angularDiameterDegrees > 138 && close.angularDiameterDegrees < 141);
  assert.equal(close.blocker, null);

  const panorama = assessPlanetView(snapshot(time(20, 0)), "haven", 1);
  assert.equal(panorama.isSurfaceCloseup, false);
  assert.ok(panorama.fieldOfViewDegrees > 45 && panorama.fieldOfViewDegrees < 46);
});

test("Aster is physically occluded behind Haven at the known eclipse epoch", () => {
  const epoch = time(20, 23);
  for (const zoom of [1, 8, 16, 32]) {
    const view = assessPlanetView(snapshot(epoch), "aster", zoom);
    assert.equal(view.body.id, "aster");
    assert.equal(view.blocker?.id, "haven");
    assert.equal(view.isSurfaceCloseup, false);
  }
});

test("Aster becomes unobstructed earlier in Highport's orbit", () => {
  const visible = assessPlanetView(snapshot(time(20, 0)), "aster", 32);
  assert.equal(visible.blocker, null);
  assert.ok(visible.angularDiameterDegrees > 0.35);
  assert.ok(visible.angularDiameterDegrees < visible.fieldOfViewDegrees);
});

test("Automatic focus stays on the local planet, even when telescope is magnified", () => {
  const view = assessPlanetView(snapshot(time(20, 23)), "auto", 8);
  assert.equal(view.body.id, "haven");
  assert.equal(view.isSurfaceCloseup, true);
});
