import { sub, vec3, type Vec3 } from "../math.js";

/**
 * Snap a LOCAL metre-valued reference point to a nearby grid.
 * Babylon.js only sees differences from this origin, never AU-sized positions.
 * Preserve camera continuity by subtracting the origin delta when it changes.
 */
export function computeFloatingOrigin(shipLocalMetres: Vec3, spacingMetres = 2_048): Vec3 {
  if (!(spacingMetres > 0)) throw new Error("Invalid floating-origin spacing");
  return vec3(
    Math.round(shipLocalMetres.x / spacingMetres) * spacingMetres,
    Math.round(shipLocalMetres.y / spacingMetres) * spacingMetres,
    Math.round(shipLocalMetres.z / spacingMetres) * spacingMetres
  );
}

export function localToRenderPosition(localMetres: Vec3, originMetres: Vec3): Vec3 {
  return sub(localMetres, originMetres);
}
