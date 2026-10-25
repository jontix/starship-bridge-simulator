import assert from "node:assert/strict";
import test from "node:test";
import {
  createCruiseState, createInitialShipState, createInterstellarState,
  getStarSystem, type GameSnapshot
} from "@bridge-sim/shared";
import {
  galacticRoute, jumpDestinationName, jumpEligibility, jumpEta, jumpPhaseLabel,
  jumpProgressPercent, linkedDestinations, selectedSystemAfterTransition
} from "./interstellarUI.js";

function snapshot(): GameSnapshot {
  const system = getStarSystem("aster-reach");
  return {
    tick: 0, serverTime: 0,
    universe: {
      systemId: system.id, epochSeconds: system.epochUnixSeconds,
      referenceBodyId: system.start.referenceBodyId,
      frameOffsetMeters: { ...system.start.offsetFromReferenceMeters }
    },
    cruise: createCruiseState(),
    interstellar: createInterstellarState(),
    ship: createInitialShipState()
  };
}

test("galactic chart uses registered route data and preserves real 3-axis distances", () => {
  assert.deepEqual(linkedDestinations("aster-reach").map(s => s.id), ["vesper"]);
  assert.deepEqual(linkedDestinations("vesper").map(s => s.id), ["aster-reach"]);
  const outward = galacticRoute("aster-reach", "vesper");
  assert.ok(outward);
  assert.equal(outward.link.id, "aster-vesper");
  assert.ok(outward.distanceLightYears > 4 && outward.distanceLightYears < 6);
  assert.equal(galacticRoute("aster-reach", "aster-reach"), null);
  assert.equal(galacticRoute("aster-reach", "imaginary"), null);
});

test("readiness separates local-only preview, server plot, charge, transit and cruise", () => {
  const snap = snapshot();
  assert.equal(jumpEligibility(null, false).canEngage, false);
  assert.equal(jumpEligibility(snap, false).canPlot, false);
  assert.equal(jumpEligibility(snap, true).canPlot, true);
  assert.equal(jumpEligibility(snap, true).canEngage, false);
  snap.interstellar.originSystemId = "aster-reach";
  snap.interstellar.destinationSystemId = "vesper";
  snap.interstellar.routeId = "aster-vesper";
  assert.equal(jumpEligibility(snap, true).canEngage, true);
  assert.equal(jumpPhaseLabel(snap), "ROUTE PLOTTED");
  assert.equal(jumpDestinationName(snap), "Vesper");
  snap.interstellar.phase = "charging";
  assert.equal(jumpEligibility(snap, true).canPlot, false);
  assert.equal(jumpEligibility(snap, true).canEngage, false);
  assert.equal(jumpEligibility(snap, true).canCancel, true);
  snap.interstellar.phase = "transit";
  assert.equal(jumpEligibility(snap, true).canCancel, false);
  snap.interstellar.phase = "idle";
  snap.cruise.mode = "cruise";
  assert.equal(jumpEligibility(snap, true).canEngage, false);
  assert.match(jumpEligibility(snap, true).reason, /interplanetary cruise/);
});

test("jump ETA and progress only reflect replicated values", () => {
  const snap = snapshot();
  assert.equal(jumpEta(null), "—");
  assert.equal(jumpEta(0), "0s");
  assert.equal(jumpEta(61.1), "1m 2s");
  snap.interstellar.phase = "transit";
  snap.interstellar.progress = 0.348;
  assert.equal(jumpProgressPercent(snap), 35);
  assert.equal(jumpPhaseLabel(snap), "INTERSTELLAR TRANSIT");
  snap.interstellar.progress = 1.5;
  assert.equal(jumpProgressPercent(snap), 100);
});

test("selected preview is transient across a system switch", () => {
  assert.equal(selectedSystemAfterTransition("vesper", "aster-reach"), "vesper");
  assert.equal(selectedSystemAfterTransition("vesper", "vesper"), "aster-reach");
  assert.equal(selectedSystemAfterTransition("aster-reach", "vesper"), "aster-reach");
});
