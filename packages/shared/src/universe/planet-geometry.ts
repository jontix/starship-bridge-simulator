import { length, sub, type Vec3 } from "../math.js";
import type { CelestialBody, StarSystem } from "./types.js";

/** Physics uses full astronomical coordinates. Rendering may use a uniformly
 * scaled background sphere so its angular diameter is identical from the camera.
 * This is NOT a game-world position or a collision radius.
 */
export function apparentBodyGeometry(
  bodyRadiusMeters: number,
  bodyCenterSystemMeters: Vec3,
  cameraSystemMeters: Vec3,
  proxyDistanceMetres = 8_000
) {
  if (!(bodyRadiusMeters > 0) || !(proxyDistanceMetres > 0)) {
    throw new Error("Invalid physical or proxy radius");
  }
  const distanceMeters = length(sub(bodyCenterSystemMeters, cameraSystemMeters));
  if (!(distanceMeters > 0) || !Number.isFinite(distanceMeters)) {
    throw new Error("Invalid planet-to-camera distance");
  }
  const ratio = bodyRadiusMeters / distanceMeters;
  return {
    distanceMeters,
    altitudeMeters: distanceMeters - bodyRadiusMeters,
    apparentAngularRadiusRadians: Math.asin(Math.min(1, ratio)),
    proxyDistanceMetres,
    // For cameras outside the body this is EXACTLY the same perspective angular
    // size as the physical body, including low-orbit/horizon views.
    proxyRadiusMetres: proxyDistanceMetres * ratio,
    cameraInsideBody: ratio >= 1
  };
}

export function discDiameterPixels(angularRadiusRadians: number, verticalFovRadians: number, canvasHeightPx: number): number {
  if (!(verticalFovRadians > 0 && verticalFovRadians < Math.PI) || !(canvasHeightPx > 0)) return 0;
  if (angularRadiusRadians >= Math.PI / 2) return canvasHeightPx * 100;
  return 2 * Math.tan(angularRadiusRadians) / Math.tan(verticalFovRadians / 2) * (canvasHeightPx / 2);
}

/** Select the navigational world associated with an orbital station or moon.
 * Prefer the current cruise target, otherwise the co-moving local frame.
 */
export function choosePlanetFocus(
  system: StarSystem, referenceBodyId: string, cruiseTargetId: string | null,
  requestedBodyId?: string
): CelestialBody {
  const selectedId = requestedBodyId && requestedBodyId !== "auto"
    ? requestedBodyId
    : cruiseTargetId ?? referenceBodyId;
  const found = system.bodies.find(body => body.id === selectedId);
  let current = found ?? system.bodies.find(body => body.kind === "star")!;
  const visited = new Set<string>();
  while (current.kind === "station" && current.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    current = system.bodies.find(body => body.id === current.parentId) ?? current;
  }
  return current;
}
