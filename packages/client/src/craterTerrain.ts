/** Deterministic 3D impact-crater field, sampled by a spherical surface texture.
 * Unlike stripes in latitude/longitude, craters are localised circular basins
 * and have no seams at 0/360 degrees or distortion at the poles.
 */
function hash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x + seed, 374761393) ^ Math.imul(y - seed, 668265263) ^
    Math.imul(z + seed * 3, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function craterAtFrequency(
  x: number, y: number, z: number, frequency: number, seed: number
): number {
  const px = x * frequency, py = y * frequency, pz = z * frequency;
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let value = 0;
  // Evaluate neighbouring lattice cells, each with zero or one seeded impact.
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const prob = hash(cx, cy, cz, seed);
      if (prob < 0.77) continue;
      const centreX = cx + hash(cx, cy, cz, seed + 111);
      const centreY = cy + hash(cx, cy, cz, seed + 223);
      const centreZ = cz + hash(cx, cy, cz, seed + 337);
      const distance = Math.hypot(px - centreX, py - centreY, pz - centreZ);
      const craterRadius = 0.30 + hash(cx, cy, cz, seed + 571) * 0.16;
      const radial = distance / craterRadius;
      if (radial > 1.5) continue;
      const basin = Math.exp(-Math.pow(radial / 0.84, 4));
      const rim = Math.exp(-Math.pow((radial - 1) / 0.16, 2));
      value += 0.20 * rim - 0.22 * basin;
    }
  }
  return value;
}

export function craterField(x: number, y: number, z: number, seed: number): number {
  return craterAtFrequency(x, y, z, 13, seed) +
    craterAtFrequency(x, y, z, 39, seed + 1013) * 0.46;
}
