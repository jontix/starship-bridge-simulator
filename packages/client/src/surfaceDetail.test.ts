import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DETAIL_BASE_FREQUENCIES, SURFACE_DETAIL_FACTORS, activeOctaveWeights,
  gpuDetailSeed, octaveVisibility, surfacePixelFootprint
} from "./surfaceDetail";
import {
  cloudDetailApplyGLSL, surfaceDetailApplyGLSL, surfaceDetailNoiseGLSL
} from "./surfaceDetailShader";

test("LOD fades in fine detail at close orbital range without touching geometry", () => {
  const radius = 6_370_000;
  const near = activeOctaveWeights(radius, 430_000, 0.8, 900);
  const remote = activeOctaveWeights(radius, 125_000_000, 0.8, 900);
  assert.equal(near.length, DETAIL_BASE_FREQUENCIES.length);
  assert.ok(near[0] > 0.9 && near[1] > 0.75, "Highport detail should be visible");
  assert.ok(remote.every(v => v <= 0.000001), "Distant planet cannot have subpixel speckling");
  assert.ok(near.every((v, i) => v >= remote[i]));
  assert.ok(near.every(v => v >= 0 && v <= 1));
});

test("higher magnification resolves smaller features; very low quality stays disabled", () => {
  const fov = 0.8, radius = 6_370_000;
  const regular = activeOctaveWeights(radius, 3_000_000, fov, 900);
  const telescope = activeOctaveWeights(radius, 3_000_000, fov / 8, 900);
  for (let i = 0; i < regular.length; i++) {
    assert.ok(telescope[i] >= regular[i]);
  }
  assert.equal(SURFACE_DETAIL_FACTORS.off, 0);
  assert.ok(SURFACE_DETAIL_FACTORS.high > SURFACE_DETAIL_FACTORS.balanced);
});

test("fractal visibility is continuous at pixel-band boundaries", () => {
  for (const freq of DETAIL_BASE_FREQUENCIES) {
    assert.equal(octaveVisibility(freq, 0), 1);
    assert.equal(octaveVisibility(freq, 1 / freq), 0);
    assert.ok(octaveVisibility(freq, .28 / freq - .0000001) >= .99);
    assert.ok(octaveVisibility(freq, .95 / freq + .0000001) <= .01);
  }
  assert.equal(surfacePixelFootprint(0, 100, 0.8, 900), Infinity);
  assert.equal(octaveVisibility(100, Infinity), 0);
});

test("seed is deterministic but different worlds have different subtexture features", () => {
  const a = gpuDetailSeed(48271);
  assert.deepEqual(a, gpuDetailSeed(48271));
  assert.notDeepEqual(a, gpuDetailSeed(48272));
  assert.ok(Object.values(a).every(Number.isFinite));
  assert.ok(Object.values(gpuDetailSeed(2_147_483_647)).every(Number.isFinite));
});

test("GPU shader and CPU LOD use identical frequency bands and subpixel filter", () => {
  for (const freq of DETAIL_BASE_FREQUENCIES)
    assert.ok(surfaceDetailNoiseGLSL.includes(freq.toFixed(1)),
      "Missing GLSL frequency " + freq);
  assert.ok(surfaceDetailNoiseGLSL.includes("smoothstep(0.28, 0.95"));
  assert.ok(surfaceDetailApplyGLSL.includes("ground * detailStrength"));
  assert.ok(surfaceDetailApplyGLSL.includes("waterMask"));
  assert.ok(cloudDetailApplyGLSL.includes("detailFootprint"));
  assert.ok(!surfaceDetailNoiseGLSL.includes("gl_FragCoord"),
    "Fractal surface coordinates must not be screen-space");
});
