import {
  apparentBodyGeometry, choosePlanetFocus, getStarSystem, lineOfSightBlocker,
  shipPositionFromSnapshot, systemPositionsAt, type GameSnapshot
} from "@bridge-sim/shared";

/** A telescope magnifies angular dimensions by narrowing its FOV. It never
 * changes the astronomical body's radius, orbit or 3D projected diameter.
 */
export function assessPlanetView(snapshot: GameSnapshot, focusId: string, opticalZoom: number) {
  const system = getStarSystem(snapshot.universe.systemId);
  const body = choosePlanetFocus(system, snapshot.universe.referenceBodyId,
    snapshot.cruise.targetId, focusId);
  const positions = systemPositionsAt(system, snapshot.universe.epochSeconds);
  const observer = shipPositionFromSnapshot(system, snapshot);
  const geometry = apparentBodyGeometry(body.radiusMeters, positions[body.id], observer);
  const blocker = lineOfSightBlocker(system, positions, observer, body.id);
  const zoom = Number.isFinite(opticalZoom) ? Math.max(1, opticalZoom) : 1;
  const fieldOfViewDegrees = 0.8 / zoom * 180 / Math.PI;
  const angularDiameterDegrees = geometry.apparentAngularRadiusRadians * 360 / Math.PI;
  const isSurfaceCloseup = body.kind !== "star" && zoom >= 4 &&
    angularDiameterDegrees > fieldOfViewDegrees * 2;

  const primary = system.bodies.find(world => world.kind === "star");
  let surfaceIllumination: "day side" | "night side" | "terminator" | null = null;
  if (primary && body.kind !== "star") {
    const camera = observer;
    const center = positions[body.id];
    const star = positions[primary.id];
    const fromBodyToObserver = {
      x: camera.x - center.x, y: camera.y - center.y, z: camera.z - center.z
    };
    const fromBodyToStar = {
      x: star.x - center.x, y: star.y - center.y, z: star.z - center.z
    };
    const a = Math.hypot(fromBodyToObserver.x, fromBodyToObserver.y, fromBodyToObserver.z);
    const b = Math.hypot(fromBodyToStar.x, fromBodyToStar.y, fromBodyToStar.z);
    if (a > 0 && b > 0) {
      const cosPhase = (fromBodyToObserver.x * fromBodyToStar.x +
        fromBodyToObserver.y * fromBodyToStar.y +
        fromBodyToObserver.z * fromBodyToStar.z) / (a * b);
      surfaceIllumination = cosPhase < -0.15 ? "night side" :
        cosPhase > 0.15 ? "day side" : "terminator";
    }
  }
  return {
    body, geometry, blocker, system,
    opticalZoom: zoom, fieldOfViewDegrees,
    angularDiameterDegrees, isSurfaceCloseup, surfaceIllumination
  };
}
