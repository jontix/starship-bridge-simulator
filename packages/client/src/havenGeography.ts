/**
 * Authored fictional continent layout for Haven.
 * Each continent is an elliptical patch projected onto the unit sphere.
 * Multiscale noise perturbs the coast in planetTextures.ts. The result is
 * deterministic, free of longitude seams and more legible than plain noise.
 *
 * Directions use (cos latitude cos longitude, sin latitude,
 * cos latitude sin longitude).
 */
type Continent = {
  latitude: number;
  longitude: number;
  eastRadius: number;
  northRadius: number;
  tilt: number;
  strength: number;
};

const CONTINENTS: readonly Continent[] = [
  { latitude: 0.38, longitude: -2.20, eastRadius: 0.77, northRadius: 0.88, tilt: -0.22, strength: 1.0 },
  { latitude: -0.64, longitude: -1.92, eastRadius: 0.53, northRadius: 0.55, tilt: 0.34, strength: 0.95 },
  { latitude: 0.22, longitude: 0.66, eastRadius: 1.02, northRadius: 0.61, tilt: 0.39, strength: 1.02 },
  { latitude: -0.68, longitude: 1.63, eastRadius: 0.66, northRadius: 0.64, tilt: -0.16, strength: 0.94 },
  { latitude: 0.81, longitude: 2.55, eastRadius: 0.42, northRadius: 0.31, tilt: 0.43, strength: 0.76 },
  { latitude: -0.14, longitude: -0.28, eastRadius: 0.38, northRadius: 0.31, tilt: -0.55, strength: 0.83 },
  { latitude: -0.89, longitude: 2.80, eastRadius: 0.45, northRadius: 0.34, tilt: 0.18, strength: 0.83 }
];

const UNIT_PATCHES = CONTINENTS.map(continent => {
  const c = Math.cos(continent.latitude);
  const cx = c * Math.cos(continent.longitude);
  const cy = Math.sin(continent.latitude);
  const cz = c * Math.sin(continent.longitude);
  return {
    ...continent,
    cx, cy, cz,
    ex: -Math.sin(continent.longitude),
    ez: Math.cos(continent.longitude),
    nx: -Math.sin(continent.latitude) * Math.cos(continent.longitude),
    ny: c,
    nz: -Math.sin(continent.latitude) * Math.sin(continent.longitude),
    sinTilt: Math.sin(continent.tilt),
    cosTilt: Math.cos(continent.tilt)
  };
});

export function authoredContinentMask(x: number, y: number, z: number): number {
  let height = 0;
  for (const patch of UNIT_PATCHES) {
    const facing = x * patch.cx + y * patch.cy + z * patch.cz;
    if (facing <= 0.34) continue;
    const east = x * patch.ex + z * patch.ez;
    const north = x * patch.nx + y * patch.ny + z * patch.nz;
    const u = (east * patch.cosTilt - north * patch.sinTilt) / patch.eastRadius;
    const v = (east * patch.sinTilt + north * patch.cosTilt) / patch.northRadius;
    const radial = Math.sqrt(u * u + v * v);
    const value = Math.max(0, (1 - radial) * patch.strength);
    height = Math.max(height, value);
  }
  return height;
}

export function fictionalOceanTerrain(
  x: number, y: number, z: number,
  broadNoise: number, detailNoise: number
): number {
  const continent = authoredContinentMask(x, y, z);
  // Coastline distortion affects the shallow shores more than inland plains.
  const coast = (broadNoise - 0.49) * 0.45 + (detailNoise - 0.5) * 0.17;
  return continent + coast - 0.16;
}
