import { ASTER_REACH } from "./aster-reach.js";
import { VESPER } from "./vesper.js";
import type { CelestialBody, StarSystem } from "./types.js";

export const DEFAULT_SYSTEM_ID = ASTER_REACH.id;

/** Register new system definitions here. A stable system ID is used over the network. */
const SYSTEMS: Readonly<Record<string, StarSystem>> = Object.freeze({
  [ASTER_REACH.id]: ASTER_REACH,
  [VESPER.id]: VESPER
});

/** Undirected route: links are reciprocal by construction; no galaxy-sized metre positions. */
export type InterstellarRoute = {
  id: string;
  systemAId: string;
  systemBId: string;
  maxDistanceLightYears: number;
};

const INTERSTELLAR_ROUTES: readonly InterstellarRoute[] = Object.freeze([
  Object.freeze({
    id: "aster-vesper",
    systemAId: ASTER_REACH.id,
    systemBId: VESPER.id,
    maxDistanceLightYears: 6
  })
]);

export function listInterstellarRoutes(): readonly InterstellarRoute[] {
  return INTERSTELLAR_ROUTES;
}

export function findInterstellarRoute(fromId: string, toId: string): InterstellarRoute | null {
  return INTERSTELLAR_ROUTES.find(route =>
    (route.systemAId === fromId && route.systemBId === toId) ||
    (route.systemAId === toId && route.systemBId === fromId)
  ) ?? null;
}

export function interstellarDistanceLightYears(a: StarSystem, b: StarSystem): number {
  const p = a.galacticPositionLightYears;
  const q = b.galacticPositionLightYears;
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
}

export function listStarSystems(): readonly StarSystem[] {
  return Object.values(SYSTEMS);
}

export function getStarSystem(id: string): StarSystem {
  const system = SYSTEMS[id];
  if (!system) throw new Error("Unknown star system: " + id);
  return system;
}

export function getBody(system: StarSystem, bodyId: string): CelestialBody {
  const body = system.bodies.find(candidate => candidate.id === bodyId);
  if (!body) throw new Error("Unknown celestial body " + bodyId + " in " + system.id);
  return body;
}

/** Validate author-created definitions at startup/test-time, not in the 30Hz simulation loop. */
export function validateStarSystem(system: StarSystem): void {
  if (!system.id || !system.name || !Number.isFinite(system.epochUnixSeconds)) throw new Error("Invalid system identity");
  if (![system.galacticPositionLightYears.x, system.galacticPositionLightYears.y,
    system.galacticPositionLightYears.z].every(Number.isFinite)) {
    throw new Error("Non-finite galactic position in " + system.id);
  }
  const ids = new Set<string>();
  for (const body of system.bodies) {
    if (!body.id || ids.has(body.id)) throw new Error("Duplicate/empty body ID: " + body.id);
    ids.add(body.id);
  }
  const roots = system.bodies.filter(body => body.parentId === null);
  if (roots.length !== 1 || roots[0].kind !== "star") throw new Error("Expected one primary star root");
  const byId = new Map(system.bodies.map(body => [body.id, body]));
  for (const body of system.bodies) {
    if (!(body.radiusMeters > 0) || !Number.isFinite(body.radiusMeters)) throw new Error("Invalid radius for " + body.id);
    if (body.parentId === null && body.orbit !== null) throw new Error("Root cannot orbit: " + body.id);
    if (body.parentId !== null) {
      if (!byId.has(body.parentId) || !body.orbit) throw new Error("Invalid parent/orbit for " + body.id);
      const { semiMajorAxisMeters, eccentricity, periodSeconds } = body.orbit;
      if (!(semiMajorAxisMeters > 0) || !(periodSeconds > 0) || !(eccentricity >= 0 && eccentricity < 1)) {
        throw new Error("Invalid Keplerian elements for " + body.id);
      }
      if (![
        body.orbit.inclinationRadians, body.orbit.ascendingNodeRadians,
        body.orbit.periapsisArgumentRadians, body.orbit.meanAnomalyAtEpochRadians
      ].every(Number.isFinite)) throw new Error("Non-finite orbital angle for " + body.id);
    }
    if (body.appearance) {
      const visual = body.appearance;
      if (!(visual.rotationPeriodSeconds > 0) || !Number.isFinite(visual.axialTiltRadians)
        || !Number.isSafeInteger(visual.seed)) throw new Error("Invalid appearance for " + body.id);
      if (visual.atmosphere &&
        (!(visual.atmosphere.thicknessMeters > 0) ||
        !/^#[0-9a-fA-F]{6}$/.test(visual.atmosphere.colorHex))) {
        throw new Error("Invalid atmosphere for " + body.id);
      }
      if (visual.clouds && (!(visual.clouds.altitudeMeters > 0) ||
        !(visual.clouds.coverage >= 0 && visual.clouds.coverage <= 1))) {
        throw new Error("Invalid clouds for " + body.id);
      }
      if (visual.rings && (!(visual.rings.innerRadiusRatio > 1) ||
        !(visual.rings.outerRadiusRatio > visual.rings.innerRadiusRatio) ||
        !/^#[0-9a-fA-F]{6}$/.test(visual.rings.colorHex))) {
        throw new Error("Invalid ring geometry for " + body.id);
      }
    }
    const visited = new Set<string>();
    let cursor: CelestialBody | undefined = body;
    while (cursor) {
      if (visited.has(cursor.id)) throw new Error("Orbit cycle involving " + cursor.id);
      visited.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
  if (!byId.has(system.start.referenceBodyId)) throw new Error("Unknown start frame reference");
  const finiteVector = (v: { x: number; y: number; z: number }) =>
    [v.x, v.y, v.z].every(Number.isFinite);
  if (!finiteVector(system.start.offsetFromReferenceMeters)) throw new Error("Invalid start frame offset");
  if (system.interstellarArrival) {
    const arrival = system.interstellarArrival;
    const anchor = byId.get(arrival.referenceBodyId);
    if (!anchor || anchor.kind !== "station") throw new Error("Jump arrival must reference a registered station");
    const offset = arrival.offsetFromReferenceMeters;
    if (!finiteVector(offset) || Math.hypot(offset.x, offset.y, offset.z) < 75_000) {
      throw new Error("Unsafe interstellar arrival offset for " + system.id);
    }
  }
}

/** Whole-galaxy validation happens at startup/test time, not in each simulation tick. */
export function validateStarCatalog(
  systems: readonly StarSystem[] = listStarSystems(),
  routes: readonly InterstellarRoute[] = INTERSTELLAR_ROUTES
): void {
  const byId = new Map<string, StarSystem>();
  for (const system of systems) {
    validateStarSystem(system);
    if (byId.has(system.id)) throw new Error("Duplicate star system ID: " + system.id);
    if (!system.interstellarArrival) throw new Error("Missing interstellar arrival in " + system.id);
    byId.set(system.id, system);
  }
  const routeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const route of routes) {
    if (!route.id || routeIds.has(route.id)) throw new Error("Duplicate/empty interstellar route ID");
    routeIds.add(route.id);
    const a = byId.get(route.systemAId);
    const b = byId.get(route.systemBId);
    if (!a || !b || a.id === b.id) throw new Error("Unknown or identical route endpoints: " + route.id);
    const pair = [a.id, b.id].sort().join("::");
    if (pairs.has(pair)) throw new Error("Duplicate bidirectional jump link: " + route.id);
    pairs.add(pair);
    const actualDistance = interstellarDistanceLightYears(a, b);
    if (!(actualDistance > 0) || !Number.isFinite(actualDistance) ||
      !(route.maxDistanceLightYears > 0) || !Number.isFinite(route.maxDistanceLightYears) ||
      actualDistance > route.maxDistanceLightYears) {
      throw new Error("Out-of-range or invalid interstellar route: " + route.id);
    }
  }
}
