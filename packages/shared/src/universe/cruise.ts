import { z } from "zod";
import {
  add, clamp, directionToHeading, length, normalize, scale, sub, vec3, type Vec3
} from "../math.js";
import { stepShipAttitude } from "../simulation.js";
import type { ShipState } from "../types.js";
import { bodyPositionAt } from "./orbits.js";
import { getBody } from "./registry.js";
import type { CelestialBody, StarSystem } from "./types.js";

export const SPEED_OF_LIGHT_MPS = 299_792_458;
export const CRUISE_LIMITS = Object.freeze({
  maxSpeedMps: SPEED_OF_LIGHT_MPS * 3,
  accelerationMps2: 35_000_000,
  spoolSeconds: 4,
  safeDropSpeedMps: 2_000,
  finalToleranceMetres: 7_500
});

export type TravelMode = "local" | "spooling" | "cruise" | "dropping";

export type CruiseState = {
  mode: TravelMode;
  targetId: string | null;
  throttle: number;                       // 0.1 to 1
  positionSystemMeters: Vec3;              // barycentric metres; authoritative in cruise
  speedMetersPerSecond: number;            // drive speed along intercept vector
  remainingMeters: number | null;
  etaSeconds: number | null;
  arrivalDistanceMeters: number | null;
  progress: number;                        // 0–1, approximate
  initialDistanceMeters: number;
  approachDirection: Vec3;                 // fixed safe side relative to destination
  spoolRemainingSeconds: number;
  lastEvent: string;
};

export type LocalFrame = {
  referenceBodyId: string;
  offsetFromReferenceMeters: Vec3;
};

export const CruiseCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_cruise_target"), targetId: z.string().min(1).max(64) }),
  z.object({ type: z.literal("set_cruise_throttle"), throttle: z.number().finite().min(0.1).max(1) }),
  z.object({ type: z.literal("engage_cruise") }),
  z.object({ type: z.literal("request_drop") })
]);
export type CruiseCommand = z.infer<typeof CruiseCommandSchema>;

export function createCruiseState(): CruiseState {
  return {
    mode: "local",
    targetId: null,
    throttle: 1,
    positionSystemMeters: vec3(),
    speedMetersPerSecond: 0,
    remainingMeters: null,
    etaSeconds: null,
    arrivalDistanceMeters: null,
    progress: 0,
    initialDistanceMeters: 0,
    approachDirection: vec3(0, 0, 1),
    spoolRemainingSeconds: 0,
    lastEvent: "Local impulse controls available"
  };
}

export function arrivalStandOffMetres(body: CelestialBody): number {
  switch (body.kind) {
    case "station": return Math.max(75_000, body.radiusMeters * 120);
    case "moon": return Math.max(10_000_000, body.radiusMeters * 4);
    case "planet": return Math.max(45_000_000, body.radiusMeters * 3);
    case "star": return Math.max(4_000_000_000, body.radiusMeters * 6);
  }
}

export function systemPositionOfShip(
  system: StarSystem, frame: LocalFrame, localPosition: Vec3, epochSeconds: number
): Vec3 {
  return add(
    add(bodyPositionAt(system, frame.referenceBodyId, epochSeconds), frame.offsetFromReferenceMeters),
    localPosition
  );
}

/** For use in renderers/maps with a network snapshot. No astronomical absolute
 * coordinates are passed directly to GPU geometry. */
export function shipPositionFromSnapshot(
  system: StarSystem,
  snapshot: {
    universe: { epochSeconds: number; referenceBodyId: string; frameOffsetMeters: Vec3 };
    ship: { position: Vec3 };
    cruise: CruiseState;
  }
): Vec3 {
  return snapshot.cruise.mode === "local"
    ? systemPositionOfShip(system, {
        referenceBodyId: snapshot.universe.referenceBodyId,
        offsetFromReferenceMeters: snapshot.universe.frameOffsetMeters
      }, snapshot.ship.position, snapshot.universe.epochSeconds)
    : snapshot.cruise.positionSystemMeters;
}

export function selectCruiseTarget(state: CruiseState, system: StarSystem, id: string): string {
  const body = system.bodies.find(candidate => candidate.id === id);
  if (!body) return "Unknown destination";
  if (state.mode !== "local") return "Disengage cruise before choosing a different destination";
  state.targetId = id;
  state.remainingMeters = null;
  state.progress = 0;
  state.lastEvent = "Course target: " + body.name;
  return state.lastEvent;
}

export function setCruiseThrottle(state: CruiseState, throttle: number): void {
  state.throttle = clamp(throttle, 0.1, 1);
  state.lastEvent = "Cruise drive ordered to " + Math.round(state.throttle * 100) + "%";
}

export function beginCruise(
  state: CruiseState, system: StarSystem, frame: LocalFrame, ship: ShipState, epochSeconds: number
): string {
  if (state.mode !== "local") return "Cruise drive already engaged";
  if (!state.targetId) return "Select a destination first";
  const target = getBody(system, state.targetId);
  const shipPosition = systemPositionOfShip(system, frame, ship.position, epochSeconds);
  const targetPosition = bodyPositionAt(system, target.id, epochSeconds);
  const distance = length(sub(shipPosition, targetPosition));
  const standoff = arrivalStandOffMetres(target);
  if (distance < standoff + 15_000) {
    return "Too close to " + target.name + " for a cruise approach";
  }

  state.positionSystemMeters = shipPosition;
  state.mode = "spooling";
  state.spoolRemainingSeconds = CRUISE_LIMITS.spoolSeconds;
  state.speedMetersPerSecond = 0;
  state.remainingMeters = distance - standoff;
  state.arrivalDistanceMeters = standoff;
  state.progress = 0;
  state.initialDistanceMeters = state.remainingMeters;
  state.approachDirection = normalize(sub(shipPosition, targetPosition));
  state.etaSeconds = estimateTravelSeconds(state.remainingMeters, 0, state.throttle);
  state.lastEvent = "Cruise drive charging for " + target.name;
  return state.lastEvent;
}

/** Time estimate for a one-axis accelerate / coast / decelerate profile;
 * moving-target orbits may change the actual ETA. */
export function estimateTravelSeconds(distance: number, currentSpeed: number, throttle: number): number {
  const d = Math.max(0, distance);
  if (d === 0) return 0;
  const accel = CRUISE_LIMITS.accelerationMps2;
  const cap = CRUISE_LIMITS.maxSpeedMps * clamp(throttle, 0.1, 1);
  const speed = Math.max(0, Math.min(cap, currentSpeed));
  const brakingDistance = speed * speed / (2 * accel);
  if (d <= brakingDistance) return speed / accel + 2; // rough braking-only estimate
  const accelerationDistance = (cap * cap - speed * speed) / (2 * accel);
  const decelerationDistance = cap * cap / (2 * accel);
  if (accelerationDistance + decelerationDistance >= d) {
    const peak = Math.sqrt(Math.max(0, accel * d + speed * speed / 2));
    return (peak - speed) / accel + peak / accel;
  }
  return (cap - speed) / accel + cap / accel +
    (d - accelerationDistance - decelerationDistance) / cap;
}

export type CruiseStepOutcome = { dropped: false } | { dropped: true; frame: LocalFrame };

/** Each tick uses the target's future Keplerian position rather than steering at
 * a frozen coordinate. Cruise movement is a gameplay FTL navigation abstraction,
 * NOT Newtonian thrust or physically plausible relativity.
 *
 * The arrival direction is fixed relative to the target based on the ship's
 * approach side at engagement. Keeping the direction stable avoids sudden
 * flips in the final approach while the destination orbits.
 */
export function stepCruise(
  state: CruiseState, ship: ShipState, system: StarSystem,
  epochSeconds: number, dt: number, frame: LocalFrame
): CruiseStepOutcome {
  if (!(dt > 0) || !Number.isFinite(dt) || state.mode === "local") return { dropped: false };
  const deltaTime = Math.min(dt, 0.1);

  // Safe manual drop request: decelerate to low drive speed before converting to
  // a local co-moving frame, at the current barycentric position.
  if (state.mode === "dropping") {
    state.speedMetersPerSecond = Math.max(0, state.speedMetersPerSecond - CRUISE_LIMITS.accelerationMps2 * deltaTime);
    const targetPosition = state.targetId
      ? bodyPositionAt(system, state.targetId, epochSeconds)
      : state.positionSystemMeters;
    const target = state.targetId ? getBody(system, state.targetId) : null;
    const safePoint = target
      ? add(targetPosition, scale(state.approachDirection, arrivalStandOffMetres(target)))
      : targetPosition;
    const remaining = sub(safePoint, state.positionSystemMeters);
    const movement = scale(normalize(remaining),
      Math.min(length(remaining), state.speedMetersPerSecond * deltaTime));
    state.positionSystemMeters = add(state.positionSystemMeters, movement);
    state.etaSeconds = state.speedMetersPerSecond / CRUISE_LIMITS.accelerationMps2;
    if (state.speedMetersPerSecond <= CRUISE_LIMITS.safeDropSpeedMps) {
      return finishDrop(state, ship, system, epochSeconds, frame, "Manual cruise exit: local flight restored");
    }
    return { dropped: false };
  }

  if (!state.targetId) throw new Error("Cruise active without target");
  const target = getBody(system, state.targetId);
  const currentTarget = bodyPositionAt(system, target.id, epochSeconds);
  const standoff = state.arrivalDistanceMeters ?? arrivalStandOffMetres(target);
  const safeAway = state.approachDirection;

  // Heading toward the target is independently handled by the flight computer.
  // We do not change the ship's local thruster translation while the drive runs.
  const toward = scale(safeAway, -1);
  const heading = directionToHeading(toward);
  if (heading) {
    ship.desiredYaw = heading.yaw;
    ship.desiredPitch = heading.pitch;
    ship.desiredRoll = 0;
  }
  stepShipAttitude(ship, deltaTime);

  if (state.mode === "spooling") {
    // Spooling remains co-moving with the original local orbital reference frame.
    state.positionSystemMeters = systemPositionOfShip(system, frame, ship.position, epochSeconds);
    state.spoolRemainingSeconds = Math.max(0, state.spoolRemainingSeconds - deltaTime);
    if (state.spoolRemainingSeconds <= 0) {
      state.mode = "cruise";
      state.lastEvent = "Interplanetary cruise engaged";
    }
    return { dropped: false };
  }

  const speedCap = state.throttle * CRUISE_LIMITS.maxSpeedMps;
  const tentativeDistance = Math.max(0, length(sub(currentTarget, state.positionSystemMeters)) - standoff);
  const approximateEta = Math.min(6000, estimateTravelSeconds(tentativeDistance, state.speedMetersPerSecond, state.throttle));
  // Lead the orbiting target using its ephemeris, recomputed every simulation tick.
  const futureTarget = bodyPositionAt(system, target.id, epochSeconds + approximateEta);
  const approachPosition = add(futureTarget, scale(safeAway, standoff));
  const toAim = sub(approachPosition, state.positionSystemMeters);
  const distance = length(toAim);
  const direction = normalize(toAim);
  const brakingLimited = Math.sqrt(2 * CRUISE_LIMITS.accelerationMps2 * distance);
  const desiredSpeed = Math.min(speedCap, brakingLimited);
  const deltaSpeed = clamp(desiredSpeed - state.speedMetersPerSecond,
    -CRUISE_LIMITS.accelerationMps2 * deltaTime,
    CRUISE_LIMITS.accelerationMps2 * deltaTime);
  state.speedMetersPerSecond = Math.max(0, state.speedMetersPerSecond + deltaSpeed);
  const traveled = Math.min(distance, state.speedMetersPerSecond * deltaTime);
  state.positionSystemMeters = add(state.positionSystemMeters, scale(direction, traveled));
  state.remainingMeters = Math.max(0, distance - traveled);
  state.etaSeconds = estimateTravelSeconds(state.remainingMeters, state.speedMetersPerSecond, state.throttle);
  state.progress = clamp(1 - state.remainingMeters /
    Math.max(1, state.initialDistanceMeters), 0, 1);

  if (state.remainingMeters <= CRUISE_LIMITS.finalToleranceMetres &&
      state.speedMetersPerSecond <= Math.max(1_000_000, CRUISE_LIMITS.accelerationMps2 * deltaTime * 2)) {
    return finishDrop(state, ship, system, epochSeconds, frame,
      "Arrival at " + target.name + ": flight assist and local reference frame active");
  }
  return { dropped: false };
}

export function requestCruiseDrop(state: CruiseState, ship: ShipState, system: StarSystem,
  epochSeconds: number, frame: LocalFrame): string {
  if (state.mode === "local") return "Already using local flight";
  if (state.mode === "spooling") {
    state.mode = "local";
    state.speedMetersPerSecond = 0;
    state.spoolRemainingSeconds = 0;
    state.etaSeconds = null;
    state.remainingMeters = null;
    state.progress = 0;
    state.lastEvent = "Cruise spool cancelled; original local reference retained";
    return state.lastEvent;
  }
  if (state.mode !== "dropping") {
    state.mode = "dropping";
    state.etaSeconds = state.speedMetersPerSecond / CRUISE_LIMITS.accelerationMps2;
    state.lastEvent = "Drive shutting down — decelerating to local-flight speed";
  }
  return state.lastEvent;
}

function finishDrop(
  state: CruiseState, ship: ShipState, system: StarSystem, epochSeconds: number,
  frame: LocalFrame, message: string
): { dropped: true; frame: LocalFrame } {
  const anchorId = state.targetId ?? frame.referenceBodyId;
  const anchorPosition = bodyPositionAt(system, anchorId, epochSeconds);
  // Rebase to an exact local point near the ship, avoiding huge local numbers.
  // The jump drive matches the reference body's velocity at drop (gameplay rule).
  const newFrame: LocalFrame = {
    referenceBodyId: anchorId,
    offsetFromReferenceMeters: sub(state.positionSystemMeters, anchorPosition)
  };
  ship.position = vec3();
  ship.velocity = vec3();
  ship.acceleration = vec3();
  ship.desiredSpeed = 0;
  ship.desiredStrafe = 0;
  ship.desiredLift = 0;
  ship.emergencyStopping = false;
  state.mode = "local";
  state.speedMetersPerSecond = 0;
  state.remainingMeters = null;
  state.etaSeconds = null;
  state.spoolRemainingSeconds = 0;
  state.progress = 1;
  state.initialDistanceMeters = 0;
  state.lastEvent = message;
  // Preserve the selected target so the crew can read the arrival location.
  return { dropped: true, frame: newFrame };
}
