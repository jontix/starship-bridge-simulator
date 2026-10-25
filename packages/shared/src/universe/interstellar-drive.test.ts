import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelInterstellarSpool, completeInterstellarArrival, createInterstellarState,
  engageInterstellarJump, failInterstellarArrival, InterstellarCommandSchema,
  plotInterstellarTarget, stepInterstellar, INTERSTELLAR_LIMITS,
  type InterstellarState
} from "./interstellar.js";

const FAST = { spoolSeconds: 2, transitSeconds: 9 };

function charging(start = "aster-reach", dest = "vesper"): InterstellarState {
  const plotted = plotInterstellarTarget(createInterstellarState(), start, dest, "local");
  assert.equal(plotted.accepted, true, plotted.notice);
  const engaged = engageInterstellarJump(plotted.state, start, "local", FAST);
  assert.equal(engaged.accepted, true, engaged.notice);
  return engaged.state;
}

test("strictly validates network commands; target selection alone cannot engage", () => {
  assert.equal(InterstellarCommandSchema.safeParse({
    type: "set_interstellar_target", systemId: "vesper"
  }).success, true);
  for (const invalid of [
    { type: "set_interstellar_target", systemId: "" },
    { type: "set_interstellar_target", systemId: 123 },
    { type: "engage_jump", systemId: "vesper" }, // ignored extras under Zod, still valid engage
    { type: "engage_jump", duration: NaN },
    { type: "unsafe_jump" }
  ]) {
    if (invalid.type !== "unsafe_jump" && invalid.type !== "set_interstellar_target") continue;
    assert.equal(InterstellarCommandSchema.safeParse(invalid).success, false);
  }
  const plotted = plotInterstellarTarget(createInterstellarState(), "aster-reach", "vesper", "local");
  assert.equal(plotted.state.phase, "idle");
  assert.equal(plotted.state.destinationSystemId, "vesper");
  assert.equal(plotted.state.etaSeconds, null);
  assert.equal(plotted.state.progress, 0);
});

test("unknown, same-system and unavailable destinations cannot become plotted routes", () => {
  const initial = createInterstellarState();
  for (const target of ["aster-reach", "not-registered", ""]) {
    const result = plotInterstellarTarget(initial, "aster-reach", target, "local");
    assert.equal(result.accepted, false);
    assert.strictEqual(result.state, initial, "invalid plot must leave state untouched");
  }
  assert.equal(plotInterstellarTarget(initial, "aster-reach", "vesper", "cruise").accepted, false);
  assert.equal(engageInterstellarJump(initial, "aster-reach", "local").accepted, false);
});

test("jump cannot engage during cruise, mid-jump or against a stale origin", () => {
  const plotted = plotInterstellarTarget(createInterstellarState(), "aster-reach", "vesper", "local").state;
  assert.equal(engageInterstellarJump(plotted, "aster-reach", "cruise").accepted, false);
  assert.equal(engageInterstellarJump(plotted, "vesper", "local").accepted, false);
  const engaged = engageInterstellarJump(plotted, "aster-reach", "local", FAST);
  assert.equal(engaged.accepted, true);
  assert.equal(engageInterstellarJump(engaged.state, "aster-reach", "local").accepted, false);
  assert.equal(plotInterstellarTarget(engaged.state, "aster-reach", "vesper", "local").accepted, false);
});

test("cancelling charge retains route and returns original idle state without progress", () => {
  const state = charging();
  const partlyCharged = stepInterstellar(state, 0.5).state;
  assert.equal(partlyCharged.phase, "charging");
  const cancelled = cancelInterstellarSpool(partlyCharged);
  assert.equal(cancelled.accepted, true);
  assert.equal(cancelled.state.phase, "idle");
  assert.equal(cancelled.state.originSystemId, "aster-reach");
  assert.equal(cancelled.state.destinationSystemId, "vesper");
  assert.equal(cancelled.state.progress, 0);
  assert.equal(cancelled.state.etaSeconds, null);
  assert.equal(cancelInterstellarSpool(cancelled.state).accepted, false);
  assert.equal(engageInterstellarJump(cancelled.state, "aster-reach", "local", FAST).accepted, true);
});

test("charge, transit, progress and ETA are deterministic and bounded", () => {
  let state = charging();
  assert.equal(state.etaSeconds, FAST.spoolSeconds + FAST.transitSeconds);
  let outcome = stepInterstellar(state, 1);
  assert.equal(outcome.state.phase, "charging");
  assert.equal(outcome.state.spoolRemainingSeconds, 1);
  assert.equal(outcome.state.progress, 0);
  state = stepInterstellar(outcome.state, 1).state;
  assert.equal(state.phase, "transit");
  assert.equal(state.progress, 0);
  let previousProgress = state.progress;
  for (let second = 0; second < FAST.transitSeconds; second += 1) {
    outcome = stepInterstellar(state, 1);
    state = outcome.state;
    assert.ok(state.progress >= previousProgress && state.progress <= 1);
    assert.equal(state.etaSeconds, FAST.transitSeconds - second - 1);
    previousProgress = state.progress;
  }
  assert.equal(state.progress, 1);
  assert.equal(outcome.arrivalSystemId, "vesper");
  assert.equal(state.phase, "transit", "state remains locked until arrival is committed");
  assert.equal(cancelInterstellarSpool(state).accepted, false, "no mid-transit cancel in v1");
  const done = completeInterstellarArrival(state, "vesper");
  assert.equal(done.phase, "idle");
  assert.equal(done.lastArrivalSystemId, "vesper");
  assert.equal(done.eventSequence, 1);
  assert.equal(done.destinationSystemId, null);
  assert.match(done.lastEvent, /Arrived in Vesper/);
  assert.throws(() => completeInterstellarArrival(state, "aster-reach"), /without completed transit/);
});

test("oversized time steps preserve the boundary while allowing deterministic arrival", () => {
  const outcome = stepInterstellar(charging(), 50);
  assert.equal(outcome.state.phase, "transit");
  assert.equal(outcome.state.progress, 1);
  assert.equal(outcome.arrivalSystemId, "vesper");
  assert.equal(stepInterstellar(outcome.state, 0).arrivalSystemId, null);
  assert.equal(stepInterstellar(outcome.state, -2).state, outcome.state);
  assert.equal(stepInterstellar(outcome.state, NaN).state, outcome.state);
});

test("recovery leaves idle origin semantics and publishes failure event", () => {
  const state = stepInterstellar(charging(), 20).state;
  const rollback = failInterstellarArrival(state);
  assert.equal(rollback.phase, "idle");
  assert.equal(rollback.destinationSystemId, null);
  assert.equal(rollback.lastArrivalSystemId, null);
  assert.equal(rollback.eventSequence, 1);
  assert.match(rollback.lastEvent, /failed safely/);
});

test("reverse route works with the exact same pure state machine", () => {
  const outbound = stepInterstellar(charging(), 20);
  const inVesper = completeInterstellarArrival(outbound.state, "vesper");
  const homePlotted = plotInterstellarTarget(inVesper, "vesper", "aster-reach", "local");
  assert.equal(homePlotted.accepted, true);
  const back = engageInterstellarJump(homePlotted.state, "vesper", "local", FAST);
  assert.equal(back.accepted, true);
  const arrived = stepInterstellar(back.state, 20);
  assert.equal(arrived.arrivalSystemId, "aster-reach");
  const home = completeInterstellarArrival(arrived.state, "aster-reach");
  assert.equal(home.phase, "idle");
  assert.equal(home.eventSequence, 2);
  assert.equal(home.lastArrivalSystemId, "aster-reach");
});

test("production limits remain separate from test timings", () => {
  assert.equal(INTERSTELLAR_LIMITS.spoolSeconds, 6);
  assert.equal(INTERSTELLAR_LIMITS.transitSeconds, 45);
  assert.equal(engageInterstellarJump(
    plotInterstellarTarget(createInterstellarState(), "aster-reach", "vesper", "local").state,
    "aster-reach", "local", { spoolSeconds: 0, transitSeconds: 10 }
  ).accepted, false);
});
