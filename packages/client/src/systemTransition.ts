import { getStarSystem, type GameSnapshot } from "@bridge-sim/shared";

/** Only the server's registered system ID can select the active astronomical scene.
 * Role, camera mode and other controls must not rebuild Babylon/WebGL resources.
 */
export function rendererSystemKey(snapshot: GameSnapshot | null): string {
  return snapshot?.universe.systemId ?? "awaiting-system";
}

/** A local frame, interplanetary-drive handoff or interstellar handoff can never
 * share one coordinate interpolator with its predecessor.
 */
export function shouldResetPoseHistory(previous: GameSnapshot, next: GameSnapshot): boolean {
  return previous.universe.systemId !== next.universe.systemId ||
    previous.universe.referenceBodyId !== next.universe.referenceBodyId ||
    (previous.cruise.mode === "local") !== (next.cruise.mode === "local") ||
    previous.interstellar.phase === "transit" !== (next.interstellar.phase === "transit");
}

/** A telescope target from the old system is *not* a target in the new system.
 * This takes effect synchronously on the first arriving React render.
 */
export function visibleFocusId(snapshot: GameSnapshot | null, requestedId: string): string {
  if (!snapshot || requestedId === "auto") return "auto";
  const system = getStarSystem(snapshot.universe.systemId);
  return system.bodies.some(body => body.id === requestedId && body.kind !== "station")
    ? requestedId : "auto";
}

export function isInterstellarTransit(snapshot: GameSnapshot | null): boolean {
  return snapshot?.interstellar.phase === "transit";
}

export function arrivalEventKey(snapshot: GameSnapshot | null): string | null {
  if (!snapshot || snapshot.interstellar.phase !== "idle" ||
      !snapshot.interstellar.lastArrivalSystemId) return null;
  if (snapshot.interstellar.lastArrivalSystemId !== snapshot.universe.systemId) return null;
  return snapshot.universe.systemId + ":" + snapshot.interstellar.eventSequence;
}
