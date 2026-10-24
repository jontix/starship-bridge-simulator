import { DynamicTexture, type Scene } from "@babylonjs/core";
import type { CelestialBody, PlanetAppearance } from "@bridge-sim/shared";
import { fictionalOceanTerrain } from "./havenGeography";
import { craterField } from "./craterTerrain";

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

  const detail = fractal(x * 29, y * 29, z * 29, seed + 101, 3);
  const terrain = appearance.archetype === "ocean"
    ? fictionalOceanTerrain(x, y, z, w, detail)
    : w;

  if (appearance.archetype === "ocean") {
    const isPolarIce = absLat > 1.38 && detail > 0.29;
    const land = terrain > 0;
    if (!land) {
      // Deep navy ocean, turquoise continental shelves and gradual polar ice.
      const shelf = saturate((terrain + 0.14) / 0.14);
      let color = palette([4, 22, 55], [16, 113, 137], shelf * 0.83 + detail * 0.12);
      if (absLat > 1.26) color = palette(color, [201, 226, 235],
        (absLat - 1.26) * 3.7 * (0.3 + detail * 0.7));
      return { color, ocean: isPolarIce ? 0 : 1, land: false };
    }

    const height = saturate(terrain * 4.4);
    const ridge = 1 - Math.abs(fractal(x * 17, y * 17, z * 17, seed + 107, 3) * 2 - 1);
    const mountainous = saturate((height - 0.41) * 1.6 + (ridge - 0.50) * 0.68);
    const latitudeClimate = Math.abs(Math.sin(latitude * 3.7));
    const aridity = saturate(0.12 + latitudeClimate * 0.6 +
      (fractal(x * 7, y * 7, z * 7, seed + 903, 3) - 0.5) * 2.6);
    let color = palette([50, 130, 85], [24, 68, 42], height * 0.8 + detail * 0.18);
    color = palette(color, [187, 145, 88], aridity * 0.67);
    const shoreline = 1 - saturate(terrain * 43);
    color = palette(color, [174, 170, 121], shoreline * 0.63);
    color = palette(color, [112, 120, 118], mountainous * 0.85);
    const ice = saturate((absLat - 1.13) * 2.8 + (mountainous - 0.8) * 1.5);
    color = palette(color, [220, 228, 229], ice);
    return { color, ocean: 0, land: true };
  }
  if (appearance.archetype === "rocky") {
    const rust = 0.25 + terrain * 0.65 + detail * 0.2;
    const color = palette([63, 53, 55], [197, 146, 104], rust);
    const bright = Math.pow(saturate((detail - 0.42) * 2), 3);
    return { color: palette(color, [223, 191, 151], bright * 0.3), ocean: 0, land: true };
  }
  if (appearance.archetype === "airless") {
    const impacts = craterField(x, y, z, seed);
    const terrainShade = Math.max(0.0, terrain + detail * 0.32 + impacts * 1.5);
    const grey = 48 + terrainShade * 111;
    const rimHighlight = saturate(impacts * 4.1);
    const shade = grey + rimHighlight * 35;
    return { color: [shade * 0.92, shade * 0.96, shade + 7], ocean: 0, land: true };
  }

  // Differentially rotating gas bands and coherent, elliptical major storms.
  // The texture is generated on a unit sphere to avoid longitude seams.
  const jet = latitude * (appearance.archetype === "ice-giant" ? 25 : 53)
    + (terrain - 0.5) * 11
    + Math.sin(longitude * 4 + latitude * 12) * 0.5;
  const jetBand = Math.sin(jet) * 0.24 + Math.sin(jet * 2.23) * 0.10;
  const turbulence = fractal(x * 19, y * 19, z * 19, seed + 829, 3) - 0.5;
  const ripple = saturate(0.54 + jetBand + turbulence * 0.26);
  if (appearance.archetype === "gas-giant") {
    let color = palette([108, 72, 67], [232, 193, 136], ripple);
    const longitudeDiff = Math.atan2(Math.sin(longitude - 1.3), Math.cos(longitude - 1.3));
    const stormRadius = Math.sqrt(
      (longitudeDiff / 0.31) ** 2 + ((latitude + 0.34) / 0.17) ** 2
    );
    const stormCore = Math.exp(-Math.pow(stormRadius, 3.2));
    const stormRim = Math.exp(-Math.pow((stormRadius - 1.1) / 0.29, 2));
    color = palette(color, [175, 71, 52], stormCore * 0.9);
    color = palette(color, [237, 208, 174], stormRim * 0.56);
    return { color, ocean: 0, land: false };
  }
  return {
    color: palette([21, 82, 133], [132, 213, 226], ripple * 0.88),
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
        // Settlements are concentrated near coastlines and moderate latitudes.
        const nearCoast = Math.abs(fictionalOceanTerrain(x, y, z, shape, density));
        const potential = Math.max(0, 1 - nearCoast * 13);
        const brightness = result.land && Math.abs(latitude) < 1.20 &&
          cluster > 0.49 && density > 0.50
            ? saturate((density - 0.50) * 9) * potential * 235
            : 0;
        nightData[p] = brightness;
        nightData[p + 1] = result.ocean ? 255 : 0; // Ocean mask packed into G.
        nightData[p + 2] = brightness;
        nightData[p + 3] = 255;
      }
      if (cloudData && a.clouds) {
        // One coherent low-pressure weather field with narrow filamentary edges.
        // Keeps oceans and continents recognisable beneath thin clouds.
        const curl = fractal(x * 4.2, y * 4.2, z * 4.2, seed + 901, 4);
        const displacement = (curl - 0.5) * 0.33;
        const clouds = fractal((x + displacement) * 11,
          (y - displacement) * 11, (z + displacement * 0.5) * 11,
          seed + 911, 4);
        const filament = fractal(x * 32, y * 32, z * 32, seed + 111, 2);
        const band = Math.sin(latitude * 11 + 4 * (curl - 0.5)) * 0.055;
        const threshold = 0.54 + (0.5 - a.clouds.coverage) * 0.23;
        const density = clouds + (filament - 0.5) * 0.26 + band - threshold;
        const alpha = saturate(density * 7.5);
        cloudData[p] = 224 + 26 * filament;
        cloudData[p + 1] = 232 + 19 * filament;
        cloudData[p + 2] = 239 + 14 * filament;
        cloudData[p + 3] = alpha * 193;
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
