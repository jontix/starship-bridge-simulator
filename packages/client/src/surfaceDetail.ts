/**
 * Orbital surface detail is a *shading* LOD: the authoritative body radius,
 * collisions, star-system coordinates and coarse albedo never change.
 *
 * Each octave is expressed in cycles across a unit-radius 3D globe. A feature
 * is filtered away when its projected wavelength falls below a screen pixel.
 * This is also a CPU-side reference for shader octave visibility and tests.
 */
export type SurfaceDetailMode = "off" | "balanced" | "high";

export const SURFACE_DETAIL_MODES: readonly SurfaceDetailMode[] =
  ["off", "balanced", "high"];

export const DETAIL_BASE_FREQUENCIES = [140, 420, 1190] as const;

export const SURFACE_DETAIL_FACTORS: Record<SurfaceDetailMode, number> = {
  off: 0,
  balanced: 0.47,
  high: 1
};

export function surfacePixelFootprint(
  cameraDistanceProxy: number,
  radiusProxy: number,
  fovRadians: number,
  viewportHeightPixels: number
): number {
  if (!(cameraDistanceProxy > 0) || !(radiusProxy > 0) ||
      !(fovRadians > 0) || !(viewportHeightPixels > 0)) return Infinity;
  return 2 * cameraDistanceProxy * Math.tan(fovRadians / 2) /
    (viewportHeightPixels * radiusProxy);
}

function smoothstep(a: number, b: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function octaveVisibility(frequency: number, pixelFootprint: number): number {
  if (!(pixelFootprint >= 0) || !(frequency > 0)) return 0;
  return 1 - smoothstep(0.28, 0.95, frequency * pixelFootprint);
}

export function activeOctaveWeights(
  radiusMeters: number,
  altitudeMeters: number,
  fovRadians: number,
  viewportHeightPixels: number,
  detailScale = 1
): number[] {
  const pixel = surfacePixelFootprint(
    Math.max(0.01, altitudeMeters), radiusMeters, fovRadians, viewportHeightPixels
  );
  return DETAIL_BASE_FREQUENCIES.map(freq => octaveVisibility(freq * detailScale, pixel));
}

/** Seed passed as an offset to 3D noise coordinates. Stay within moderately
 * sized floats to avoid precision loss on older GPU devices.
 */
export function gpuDetailSeed(seed: number): { x: number; y: number; z: number } {
  const s = (Math.trunc(seed) >>> 0);
  return {
    x: (s % 997) / 17 + 3.31,
    y: (Math.floor(s / 997) % 1009) / 19 + 7.93,
    z: (Math.floor(s / 1005973) % 1013) / 23 + 11.67
  };
}
