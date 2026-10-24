import { DynamicTexture, type Scene } from "@babylonjs/core";
import type { CelestialBody, PlanetAppearance } from "@bridge-sim/shared";

export type PlanetTextures = {
  surface: DynamicTexture;
  night: DynamicTexture | null;
  clouds: DynamicTexture | null;
};

/** Deterministic 3D value noise avoids the visible longitude seam common to
 * naive 2D equirectangular random textures. No external assets/network needed.
 */
function hash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^
    Math.imul(z, 2246822519) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function noise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const sx = x - xi, sy = y - yi, sz = z - zi;
  const a = sx * sx * (3 - 2 * sx), b = sy * sy * (3 - 2 * sy), c = sz * sz * (3 - 2 * sz);
  const a0 = hash(xi, yi, zi, seed) * (1 - a) + hash(xi + 1, yi, zi, seed) * a;
  const a1 = hash(xi, yi + 1, zi, seed) * (1 - a) + hash(xi + 1, yi + 1, zi, seed) * a;
  const b0 = hash(xi, yi, zi + 1, seed) * (1 - a) + hash(xi + 1, yi, zi + 1, seed) * a;
  const b1 = hash(xi, yi + 1, zi + 1, seed) * (1 - a) + hash(xi + 1, yi + 1, zi + 1, seed) * a;
  return (a0 * (1 - b) + a1 * b) * (1 - c) + (b0 * (1 - b) + b1 * b) * c;
}
function fractal(x: number, y: number, z: number, seed: number, octaves = 5): number {
  let sum = 0, amplitude = 0.55, total = 0, frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * frequency, y * frequency, z * frequency, seed + 317 * i) * amplitude;
    total += amplitude;
    frequency *= 2.09;
    amplitude *= 0.47;
  }
  return sum / total;
}
const saturate = (x: number) => Math.max(0, Math.min(1, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * saturate(t);
function palette(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}
function put(
  texture: DynamicTexture, data: Uint8ClampedArray, width: number, height: number
): void {
  const context = texture.getContext() as CanvasRenderingContext2D;
  const image = context.createImageData(width, height);
  image.data.set(data);
  context.putImageData(image, 0, 0);
  texture.update(false);
}
function newTexture(scene: Scene, id: string, width: number, height: number): DynamicTexture {
  const t = new DynamicTexture(id, { width, height }, scene, false);
  t.wrapU = 1; // Texture.WRAP_ADDRESSMODE
  t.wrapV = 0; // Texture.CLAMP_ADDRESSMODE
  return t;
}
const colorAt = (appearance: PlanetAppearance, latitude: number,
  longitude: number, x: number, y: number, z: number,
  w: number, seed: number): { color: [number, number, number]; ocean: number; land: boolean } => {
  const absLat = Math.abs(latitude);
  if (appearance.archetype === "stellar") {
    const granules = fractal(x * 40, y * 40, z * 40, seed + 49, 3);
    const dark = fractal(x * 9, y * 9, z * 9, seed + 301, 4);
    const glow = saturate((granules - 0.2) * 1.6);
    const spot = dark < 0.32 ? 0.24 : 1;
    return { color: [250 * spot, (133 + glow * 76) * spot, (35 + glow * 80) * spot], ocean: 0, land: false };
  }

  const terrain = w;
  const detail = fractal(x * 29, y * 29, z * 29, seed + 101, 3);

  if (appearance.archetype === "ocean") {
    const land = terrain > 0.515;
    if (!land) {
      const coast = saturate((terrain - 0.455) / 0.06);
      return {
        color: palette([10, 32, 79], [24, 122, 157], coast * 0.82 + detail * 0.17),
        ocean: 1, land: false
      };
    }
    const elevation = saturate((terrain - 0.515) * 9);
    let color = palette([58, 129, 91], [51, 86, 58], elevation + detail * 0.2);
    const dryness = saturate((Math.cos(latitude * 3.3) + detail - 0.55) * 1.5);
    color = palette(color, [178, 149, 91], dryness * 0.7);
    if (elevation > 0.65) color = palette(color, [136, 140, 129], (elevation - 0.65) * 2);
    if (absLat > 1.15) color = palette(color, [220, 231, 222], (absLat - 1.15) * 3.5);
    return { color, ocean: 0, land: true };
  }
  if (appearance.archetype === "rocky") {
    const rust = 0.25 + terrain * 0.65 + detail * 0.2;
    const color = palette([63, 53, 55], [197, 146, 104], rust);
    const bright = Math.pow(saturate((detail - 0.42) * 2), 3);
    return { color: palette(color, [223, 191, 151], bright * 0.3), ocean: 0, land: true };
  }
  if (appearance.archetype === "airless") {
    const crater = Math.abs(Math.sin(87 * longitude + 31 * latitude + terrain * 12));
    const grey = 65 + terrain * 105 + detail * 35 - crater * 12;
    return { color: [grey, grey + 4, grey + 8], ocean: 0, land: true };
  }

  const band = Math.sin(latitude * (appearance.archetype === "ice-giant" ? 21 : 42) +
    8 * (terrain - 0.5) + 2.5 * Math.sin(longitude * 4 + latitude * 13));
  const turbulence = fractal(x * 18, y * 18, z * 18, seed + 829, 3) - 0.5;
  const ripple = saturate(0.5 + band * 0.35 + turbulence * 0.3);
  if (appearance.archetype === "gas-giant") {
    let color = palette([117, 75, 67], [224, 180, 119], ripple);
    const storm = Math.pow(Math.max(0, Math.sin(longitude - 1.3)), 18) *
      Math.pow(Math.max(0, Math.cos((latitude + 0.36) * 6)), 7);
    color = palette(color, [181, 88, 59], storm * 0.85);
    return { color, ocean: 0, land: false };
  }
  return {
    color: palette([29, 96, 145], [132, 217, 223], ripple * 0.85),
    ocean: 0, land: false
  };
};

/** Lazy-load once a planet is actually visible; texture resolution deliberately
 * capped for browser startup/performance until adaptive texture LOD is introduced.
 */
export function generatePlanetTextures(scene: Scene, body: CelestialBody): PlanetTextures {
  const a = body.appearance;
  if (!a) throw new Error("Missing planetary visual preset for " + body.id);
  const width = a.archetype === "ocean" ? 1536 : 1024;
  const height = width / 2;
  const surfaceData = new Uint8ClampedArray(width * height * 4);
  const nightData = a.archetype === "ocean" ? new Uint8ClampedArray(surfaceData.length) : null;
  const cloudData = a.clouds ? new Uint8ClampedArray(surfaceData.length) : null;
  const seed = a.seed;

  for (let j = 0; j < height; j++) {
    const latitude = Math.PI / 2 - (j + 0.5) * Math.PI / height;
    const cosLat = Math.cos(latitude), sinLat = Math.sin(latitude);
    for (let i = 0; i < width; i++) {
      const longitude = (i + 0.5) * 2 * Math.PI / width;
      const x = cosLat * Math.cos(longitude);
      const y = sinLat;
      const z = cosLat * Math.sin(longitude);
      const shape = fractal(x * 3.9, y * 3.9, z * 3.9, seed, 5);
      const result = colorAt(a, latitude, longitude, x, y, z, shape, seed);
      const p = (j * width + i) * 4;
      surfaceData[p] = result.color[0];
      surfaceData[p + 1] = result.color[1];
      surfaceData[p + 2] = result.color[2];
      surfaceData[p + 3] = 255; // Keep land fully opaque; avoid premultiplied canvas alpha artefacts.

      if (nightData) {
        const density = fractal(x * 26, y * 26, z * 26, seed + 701, 3);
        const cluster = fractal(x * 12, y * 12, z * 12, seed + 29, 3);
        const brightness = result.land && Math.abs(latitude) < 1.14 &&
          cluster > 0.52 && density > 0.5 ? saturate((density - 0.5) * 11) * 230 : 0;
        nightData[p] = brightness;
        nightData[p + 1] = result.ocean ? 255 : 0; // Ocean mask packed into G.
        nightData[p + 2] = brightness;
        nightData[p + 3] = 255;
      }
      if (cloudData && a.clouds) {
        const clouds = fractal(x * 7.5, y * 7.5, z * 7.5, seed + 901, 5);
        const filaments = fractal(x * 30, y * 30, z * 30, seed + 111, 3);
        const threshold = 0.48 + (0.5 - a.clouds.coverage) * 0.2;
        const alpha = saturate((clouds + filaments * 0.14 - threshold - 0.05) * 10);
        cloudData[p] = 220 + 33 * filaments;
        cloudData[p + 1] = 227 + 25 * filaments;
        cloudData[p + 2] = 233 + 21 * filaments;
        cloudData[p + 3] = alpha * 220;
      }
    }
  }

  const surface = newTexture(scene, body.id + "-surface", width, height);
  put(surface, surfaceData, width, height);
  let night: DynamicTexture | null = null;
  if (nightData) {
    night = newTexture(scene, body.id + "-night", width, height);
    put(night, nightData, width, height);
  }
  let clouds: DynamicTexture | null = null;
  if (cloudData) {
    clouds = newTexture(scene, body.id + "-clouds", width, height);
    clouds.hasAlpha = true;
    put(clouds, cloudData, width, height);
  }
  return { surface, night, clouds };
}
