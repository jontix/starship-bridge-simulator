import {
  findInterstellarRoute, getStarSystem, interstellarDistanceLightYears,
  listStarSystems, type GameSnapshot, type StarSystem
} from "@bridge-sim/shared";

export const galacticSystems = listStarSystems();

export function linkedDestinations(currentId: string): StarSystem[] {
  return galacticSystems.filter(system =>
    system.id !== currentId && findInterstellarRoute(currentId, system.id) !== null);
}

export function galacticRoute(currentId: string, targetId: string) {
  const link = findInterstellarRoute(currentId, targetId);
  if (!link || currentId === targetId) return null;
  const from = galacticSystems.find(s => s.id === currentId);
  const to = galacticSystems.find(s => s.id === targetId);
  if (!from || !to) return null;
  const distanceLightYears = interstellarDistanceLightYears(from, to);
  if (!Number.isFinite(distanceLightYears) || distanceLightYears > link.maxDistanceLightYears) return null;
  return { link, from, to, distanceLightYears };
}

/** The UI never makes an optimistic journey or infers authorization from a selected marker. */
export function jumpEligibility(snapshot: GameSnapshot | null, connected: boolean): {
  canPlot: boolean; canEngage: boolean; canCancel: boolean; reason: string;
} {
  if (!connected || !snapshot) return {
    canPlot: false, canEngage: false, canCancel: false, reason: "Waiting for authoritative Helm connection"
  };
  const jump = snapshot.interstellar;
  if (jump.phase === "charging") return {
    canPlot: false, canEngage: false, canCancel: true, reason: "Jump drive charging"
  };
  if (jump.phase === "transit") return {
    canPlot: false, canEngage: false, canCancel: false, reason: "In transit — spool cancellation no longer available"
  };
  if (snapshot.cruise.mode !== "local") return {
    canPlot: false, canEngage: false, canCancel: false, reason: "Exit interplanetary cruise before a jump"
  };
  const route = jump.destinationSystemId ?
    galacticRoute(snapshot.universe.systemId, jump.destinationSystemId) : null;
  const valid = Boolean(route && jump.routeId === route.link.id);
  return {
    canPlot: true,
    canEngage: valid,
    canCancel: false,
    reason: valid ? "Plotted route ready — Engage Jump to depart" : "Choose and plot a connected destination"
  };
}

export function jumpPhaseLabel(snapshot: GameSnapshot | null): string {
  if (!snapshot) return "AWAITING TELEMETRY";
  if (snapshot.interstellar.phase === "charging") return "CHARGING";
  if (snapshot.interstellar.phase === "transit") return "INTERSTELLAR TRANSIT";
  if (snapshot.interstellar.destinationSystemId) return "ROUTE PLOTTED";
  return "JUMP DRIVE STANDBY";
}

export function jumpDestinationName(snapshot: GameSnapshot | null): string {
  const id = snapshot?.interstellar.destinationSystemId;
  if (!id) return "NO ROUTE PLOTTED";
  return galacticSystems.find(s => s.id === id)?.name ?? "UNKNOWN SYSTEM";
}

export function jumpEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds <= 0) return "0s";
  const rounded = Math.ceil(seconds);
  return rounded >= 60 ? Math.floor(rounded / 60) + "m " + (rounded % 60) + "s" : rounded + "s";
}

/** Called only when a new authoritative system is observed; transient map previews are not cross-system state. */
export function selectedSystemAfterTransition(previous: string, currentId: string): string {
  return linkedDestinations(currentId).find(system => system.id === previous)?.id ??
    linkedDestinations(currentId)[0]?.id ?? currentId;
}

/** Validate receiving an active jump snapshot from server, not a client-side timer. */
export function jumpProgressPercent(snapshot: GameSnapshot | null): number {
  return Math.round(100 * Math.max(0, Math.min(1, snapshot?.interstellar.progress ?? 0)));
}

export function currentSystemName(snapshot: GameSnapshot | null): string {
  return getStarSystem(snapshot?.universe.systemId ?? galacticSystems[0].id).name;
}
