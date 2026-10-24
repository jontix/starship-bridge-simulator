/**
 * Procedural *appearance* of sub-texture terrain. Samples are anchored to
 * the body-local unit sphere (not latitude/longitude UV, screen pixels or
 * camera position) so details stay stable while planets spin or the ship moves.
 *
 * Using fixed-frequency, band-limited 3D noise avoids a sharp latitude seam.
 * Only 3 relatively cheap value-noise lookups are required per fragment.
 * All frequencies and filter thresholds mirror surfaceDetail.ts.
 */
export const surfaceDetailNoiseGLSL = `
uniform float detailStrength;
uniform float detailScale;
uniform float detailPixelRadians;
uniform float detailProxyRadius;
uniform vec3 detailSeed;
uniform sampler2D heightSampler;
uniform sampler2D roughnessSampler;

float detailHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float detailNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = detailHash(i);
  float b = detailHash(i + vec3(1.0, 0.0, 0.0));
  float c = detailHash(i + vec3(0.0, 1.0, 0.0));
  float d = detailHash(i + vec3(1.0, 1.0, 0.0));
  float e = detailHash(i + vec3(0.0, 0.0, 1.0));
  float g = detailHash(i + vec3(1.0, 0.0, 1.0));
  float h = detailHash(i + vec3(0.0, 1.0, 1.0));
  float j = detailHash(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),
             mix(mix(e,g,f.x),mix(h,j,f.x),f.y),f.z);
}
// A feature with less than ~1 pixel of projected wavelength fades smoothly;
// far/very small objects receive no high-frequency noise or unstable sparkle.
float detailBandWeight(float frequency, float footprint) {
  return 1.0 - smoothstep(0.28, 0.95, frequency * footprint);
}
float detailFootprint(vec3 worldPoint) {
  return max(0.0, length(worldPoint)) * detailPixelRadians /
    max(0.001, detailProxyRadius);
}
vec3 detailNoiseOctaves(vec3 localNormal, float footprint) {
  vec3 coord = normalize(localNormal);
  float f0 = 140.0 * detailScale;
  float f1 = 620.0 * detailScale;
  float f2 = 2500.0 * detailScale;
  float w0 = detailBandWeight(f0, footprint);
  float w1 = detailBandWeight(f1, footprint);
  float w2 = detailBandWeight(f2, footprint);
  return vec3(
    mix(0.5, detailNoise3(coord * f0 + detailSeed), w0),
    mix(0.5, detailNoise3(coord * f1 + detailSeed * 1.51), w1),
    mix(0.5, detailNoise3(coord * f2 + detailSeed * 2.37), w2)
  );
}
`;

/**
 * Body-surface detail: keep large continental albedo untouched, add smaller
 * scale colour/relief restricted by real terrain and ocean masks.
 * Shading normal is perturbed tangentially, never changing surface geometry.
 */
export const surfaceDetailApplyGLSL = `
  float footprint = detailFootprint(vWorldPosition);
  vec3 detailBands = detailStrength > 0.0001
    ? detailNoiseOctaves(vLocalPosition, footprint) : vec3(0.5);
  float waterMask = secondary.g * oceanIntensity;
  float ground = 1.0 - waterMask;
  float macroElevation = texture2D(heightSampler, vUV).r;
  float materialRoughness = texture2D(roughnessSampler, vUV).r;
  float highland = smoothstep(0.54, 0.82, macroElevation);
  float rockiness = clamp(0.18 + 0.5 * highland +
    0.32 * materialRoughness, 0.15, 1.0);

  // Three octaves: continental-scale ridges, valleys/strata, fine fractured
  // rock. Higher frequency disappears naturally as projected pixels grow.
  float ridge = 1.0 - abs(detailBands.x * 2.0 - 1.0);
  float contour = (ridge - 0.50) * 0.42 +
    (detailBands.y - 0.5) * 0.48 + (detailBands.z - 0.5) * 0.16;
  float landVariation = contour * detailStrength * rockiness;
  albedo *= 1.0 + ground * landVariation;

  // Water needs subtle multi-scale depth/current structure, not rock noise.
  float oceanCurrent = (detailBands.x - 0.5) * 0.35 +
    (detailBands.y - 0.5) * 0.20 + (detailBands.z - 0.5) * 0.09;
  albedo *= 1.0 + waterMask * detailStrength * oceanCurrent;

  // Procedural tangent perturbation is stable on the sphere and contributes
  // visible terrain relief under directional sunlight. Fine detail cannot
  // affect the normal once filtered out by the projected pixel footprint.
  vec3 perturb = vec3(detailBands.y - 0.5,
    detailBands.z - 0.5, detailBands.x - 0.5);
  perturb -= n * dot(perturb, n);
  n = normalize(n + ground * detailStrength *
    (0.13 + 0.15 * highland) * rockiness * perturb);
`;

/** Thin cloud wisps are distinct from the lower resolution authored weather.
 * A single additional high-frequency band is sufficient to break up blocks.
 */
export const cloudDetailApplyGLSL = `
  if (detailStrength > 0.0001) {
    float pixelFootprint = detailFootprint(vWorldPosition);
    float cloudFrequency = 660.0 * detailScale;
    float visibility = detailBandWeight(cloudFrequency, pixelFootprint);
    if (visibility > 0.005) {
      float filaments = detailNoise3(normalize(vLocalPosition) *
        cloudFrequency + detailSeed * 3.73);
      float wisps = (filaments - 0.5) * 0.38 * visibility * detailStrength;
      opacity *= clamp(1.0 + wisps, 0.75, 1.25);
    }
  }
`;
