import { z } from "zod";
import { getStarSystem, findInterstellarRoute, interstellarDistanceLightYears, listStarSystems } from "./registry.js";
import type { InterstellarRoute } from "./registry.js";
import type { StarSystem } from "./types.js";

/** Galactic travel is a route state machine, NOT movement through one galactic-sized metre vector. */
export const INTERSTELLAR_LIMITS = Object.freeze({
  spoolSeconds: 6,
  transitSeconds: 45
});

export type InterstellarTimings = {
  spoolSeconds: number;
  transitSeconds: number;
};

export type InterstellarPhase = "idle" | "charging" | "transit";

export type InterstellarState = {
  phase: InterstellarPhase;
  originSystemId: string | null;
  destinationSystemId: string | null;
  routeId: string | null;
  distanceLightYears: number | null;
  spoolRemainingSeconds: number;
  transitRemainingSeconds: number;
  transitTotalSeconds: number;
  etaSeconds: number | null;
  progress: number; // Server-owned transit progress, 0..1.
  lastArrivalSystemId: string | null;
  eventSequence: number; // Monotonically increasing for arrival / failure notifications.
  lastEvent: string;
};

export const InterstellarCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_interstellar_target"), systemId: z.string().min(1).max(64) }),
  z.object({ type: z.literal("engage_jump") }),
  z.object({ type: z.literal("cancel_jump_spool") })
]);
export type InterstellarCommand = z.infer<typeof InterstellarCommandSchema>;

export type InterstellarDecision = {
  state: InterstellarState;
  accepted: boolean;
  notice: string;
};

export type InterstellarStep = {
  state: InterstellarState;
  arrivalSystemId: string | null;
};

export function createInterstellarState(): InterstellarState {
  return {
    phase: "idle",
    originSystemId: null,
    destinationSystemId: null,
    routeId: null,
    distanceLightYears: null,
    spoolRemainingSeconds: 0,
    transitRemainingSeconds: 0,
    transitTotalSeconds: 0,
    etaSeconds: null,
    progress: 0,
    lastArrivalSystemId: null,
    eventSequence: 0,
    lastEvent: "Interstellar drive standing by"
  };
}

function reject(state: InterstellarState, notice: string): InterstellarDecision {
  return { state, accepted: false, notice };
}
function accept(state: InterstellarState, notice: string): InterstellarDecision {
  return { state: { ...state, lastEvent: notice }, accepted: true, notice };
}
function eligibleRoute(originId: string, destinationId: string): {
  origin: StarSystem;
  destination: StarSystem;
  route: InterstellarRoute;
  distance: number;
} | null {
  if (originId === destinationId) return null;
  const origin = listStarSystems().find(s => s.id === originId);
  const destination = listStarSystems().find(s => s.id === destinationId);
  if (!origin || !destination || !destination.interstellarArrival) return null;
  const route = findInterstellarRoute(originId, destinationId);
  if (!route) return null;
  const distance = interstellarDistanceLightYears(origin, destination);
  if (!Number.isFinite(distance) || !(distance > 0) || distance > route.maxDistanceLightYears) return null;
  return { origin, destination, route, distance };
}

/** Plot is explicit and never commences travel. Client-only map selections are not sent here. */
export function plotInterstellarTarget(
  state: InterstellarState, currentSystemId: string, targetSystemId: string, cruiseMode: string
): InterstellarDecision {
  if (state.phase !== "idle" || cruiseMode !== "local") {
    return reject(state, "Leave the active drive before plotting an interstellar route");
  }
  if (currentSystemId === targetSystemId) return reject(state, "Ship is already in that system");
  const eligible = eligibleRoute(currentSystemId, targetSystemId);
  if (!eligible) return reject(state, "Unknown, unavailable or out-of-range interstellar route");
  const notice = "Interstellar route plotted: " + eligible.origin.name + " to " + eligible.destination.name;
  return accept({
    ...state,
    originSystemId: currentSystemId,
    destinationSystemId: targetSystemId,
    routeId: eligible.route.id,
    distanceLightYears: eligible.distance,
    progress: 0,
    spoolRemainingSeconds: 0,
    transitRemainingSeconds: 0,
    transitTotalSeconds: 0,
    etaSeconds: null,
    lastArrivalSystemId: null
  }, notice);
}

export function engageInterstellarJump(
  state: InterstellarState, currentSystemId: string, cruiseMode: string,
  timings: InterstellarTimings = INTERSTELLAR_LIMITS
): InterstellarDecision {
  if (state.phase !== "idle" || cruiseMode !== "local") {
    return reject(state, "Interstellar jump requires local flight and an idle jump drive");
  }
  if (!state.destinationSystemId || !state.routeId || state.originSystemId !== currentSystemId) {
    return reject(state, "Plot a valid interstellar route before engaging");
  }
  const route = eligibleRoute(currentSystemId, state.destinationSystemId);
  if (!route || route.route.id !== state.routeId) {
    return reject(state, "Plotted interstellar route is no longer available");
  }
  if (![timings.spoolSeconds, timings.transitSeconds].every(v => Number.isFinite(v) && v > 0)) {
    return reject(state, "Invalid jump drive timings");
  }
  const notice = "Jump drive charging for " + route.destination.name;
  return accept({
    ...state,
    phase: "charging",
    distanceLightYears: route.distance,
    spoolRemainingSeconds: timings.spoolSeconds,
    transitRemainingSeconds: timings.transitSeconds,
    transitTotalSeconds: timings.transitSeconds,
    etaSeconds: timings.spoolSeconds + timings.transitSeconds,
    progress: 0
  }, notice);
}

export function cancelInterstellarSpool(state: InterstellarState): InterstellarDecision {
  if (state.phase !== "charging") {
    return reject(state, "Jump spool can only be cancelled while charging");
  }
  // Preserve the plotted destination, for another explicit Engage command.
  return accept({
    ...state,
    phase: "idle",
    spoolRemainingSeconds: 0,
    transitRemainingSeconds: 0,
    etaSeconds: null,
    progress: 0
  }, "Jump charge cancelled; original local reference and ship state retained");
}

/** Pure step: the server commits the destination's frame/system/ship in one operation
 * BEFORE completeInterstellarArrival is called and the full snapshot is broadcast.
 */
export function stepInterstellar(state: InterstellarState, dt: number): InterstellarStep {
  if (state.phase === "idle" || !Number.isFinite(dt) || dt <= 0) {
    return { state, arrivalSystemId: null };
  }
  if (state.phase === "charging") {
    const remaining = Math.max(0, state.spoolRemainingSeconds - dt);
    if (remaining > 0) {
      return {
        state: { ...state, spoolRemainingSeconds: remaining,
          etaSeconds: remaining + state.transitRemainingSeconds },
        arrivalSystemId: null
      };
    }
    const leftover = Math.max(0, dt - state.spoolRemainingSeconds);
    const activated: InterstellarState = {
      ...state, phase: "transit", spoolRemainingSeconds: 0,
      lastEvent: "Interstellar transit engaged"
    };
    return leftover ? stepInterstellar(activated, leftover) :
      { state: { ...activated, etaSeconds: activated.transitRemainingSeconds }, arrivalSystemId: null };
  }
  const remaining = Math.max(0, state.transitRemainingSeconds - dt);
  const progress = remaining <= 0 ? 1 : Math.max(state.progress,
    Math.min(1, 1 - remaining / state.transitTotalSeconds));
  const updated: InterstellarState = {
    ...state, transitRemainingSeconds: remaining, progress, etaSeconds: remaining
  };
  // Keep phase TRANSIT until the server successfully creates/commits destination frame.
  return { state: updated, arrivalSystemId: remaining <= 0 ? state.destinationSystemId : null };
}

/** Called only after the room's destination transaction succeeds. */
export function completeInterstellarArrival(state: InterstellarState, destinationId: string): InterstellarState {
  if (state.phase !== "transit" || state.progress < 1 ||
      state.destinationSystemId !== destinationId) {
    throw new Error("Interstellar arrival without completed transit");
  }
  const destination = getStarSystem(destinationId);
  return {
    ...createInterstellarState(),
    progress: 1,
    lastArrivalSystemId: destinationId,
    eventSequence: state.eventSequence + 1,
    lastEvent: "Arrived in " + destination.name + "; local flight available"
  };
}

export function failInterstellarArrival(state: InterstellarState): InterstellarState {
  return {
    ...createInterstellarState(),
    eventSequence: state.eventSequence + 1,
    lastEvent: "Interstellar arrival failed safely; original system retained"
  };
}
