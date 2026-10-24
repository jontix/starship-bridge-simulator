import { add, vec3, type Vec3 } from "../math.js";
import type { OrbitalElements, StarSystem } from "./types.js";
import { getBody } from "./registry.js";

const TAU = 2 * Math.PI;

/** Solve Kepler's equation M = E - e*sin(E) by Newton iteration. Valid for bound elliptical orbits. */
export function solveEccentricAnomaly(meanAnomaly: number, eccentricity: number): number {
  if (!Number.isFinite(meanAnomaly) || !(eccentricity >= 0 && eccentricity < 1)) {
    throw new Error("Invalid bound orbit");
  }
  const M = ((meanAnomaly + Math.PI) % TAU + TAU) % TAU - Math.PI;
  let E = eccentricity < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let iteration = 0; iteration < 18; iteration++) {
    const delta = (E - eccentricity * Math.sin(E) - M) / (1 - eccentricity * Math.cos(E));
    E -= delta;
    if (Math.abs(delta) < 1e-13) break;
  }
  return E;
}

function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}
function rotateX(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

/** Body position in metres relative to its parent, at any Unix epoch (seconds). */
export function relativeOrbitalPosition(
  orbit: OrbitalElements, epochSeconds: number, systemEpochSeconds: number
): Vec3 {
  const phase = orbit.meanAnomalyAtEpochRadians +
    TAU * (epochSeconds - systemEpochSeconds) / orbit.periodSeconds;
  const E = solveEccentricAnomaly(phase, orbit.eccentricity);
  const x = orbit.semiMajorAxisMeters * (Math.cos(E) - orbit.eccentricity);
  const z = orbit.semiMajorAxisMeters *
    Math.sqrt(1 - orbit.eccentricity ** 2) * Math.sin(E);
  const periapsis = rotateY(vec3(x, 0, z), orbit.periapsisArgumentRadians);
  const inclined = rotateX(periapsis, orbit.inclinationRadians);
  return rotateY(inclined, orbit.ascendingNodeRadians);
}

/** Analytic, hierarchy-aware ephemeris with no per-tick orbit integration or time-step drift. */
export function systemPositionsAt(system: StarSystem, epochSeconds: number): Readonly<Record<string, Vec3>> {
  if (!Number.isFinite(epochSeconds)) throw new Error("Invalid ephemeris time");
  const resolved: Record<string, Vec3> = {};
  const active = new Set<string>();
  const resolve = (id: string): Vec3 => {
    if (resolved[id]) return resolved[id];
    if (active.has(id)) throw new Error("Orbit cycle involving " + id);
    active.add(id);
    const body = getBody(system, id);
    const position = body.parentId && body.orbit
      ? add(resolve(body.parentId), relativeOrbitalPosition(body.orbit, epochSeconds, system.epochUnixSeconds))
      : vec3();
    active.delete(id);
    resolved[id] = position;
    return position;
  };
  for (const body of system.bodies) resolve(body.id);
  return resolved;
}

export function bodyPositionAt(system: StarSystem, bodyId: string, epochSeconds: number): Vec3 {
  const position = systemPositionsAt(system, epochSeconds)[bodyId];
  if (!position) throw new Error("Unknown body " + bodyId);
  return position;
}

/** The ship's local coordinates are non-rotating, co-moving with the reference body.
 *  This is a provisional gameplay reference frame; it does not include Coriolis terms.
 */
export function localShipToSystemPosition(
  system: StarSystem, localShipPositionMetres: Vec3, epochSeconds: number
): Vec3 {
  const anchor = bodyPositionAt(system, system.start.referenceBodyId, epochSeconds);
  return add(add(anchor, system.start.offsetFromReferenceMeters), localShipPositionMetres);
}

/** Subtract double-precision absolute positions BEFORE converting to renderer coordinates. */
export function cameraRelativeMetres(bodySystemPosition: Vec3, cameraSystemPosition: Vec3): Vec3 {
  return vec3(
    bodySystemPosition.x - cameraSystemPosition.x,
    bodySystemPosition.y - cameraSystemPosition.y,
    bodySystemPosition.z - cameraSystemPosition.z
  );
}
