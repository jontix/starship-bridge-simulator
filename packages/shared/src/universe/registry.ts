import { ASTER_REACH } from "./aster-reach.js";
import type { CelestialBody, StarSystem } from "./types.js";

export const DEFAULT_SYSTEM_ID = ASTER_REACH.id;

/** Register new system definitions here. A stable system ID is used over the network. */
const SYSTEMS: Readonly<Record<string, StarSystem>> = Object.freeze({
  [ASTER_REACH.id]: ASTER_REACH
});

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
    const visited = new Set<string>();
    let cursor: CelestialBody | undefined = body;
    while (cursor) {
      if (visited.has(cursor.id)) throw new Error("Orbit cycle involving " + cursor.id);
      visited.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
  if (!byId.has(system.start.referenceBodyId)) throw new Error("Unknown start frame reference");
}
