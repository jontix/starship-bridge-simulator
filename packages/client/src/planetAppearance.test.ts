import assert from "node:assert/strict";
import { test } from "node:test";
import { authoredContinentMask, fictionalOceanTerrain } from "./havenGeography";
import { craterField } from "./craterTerrain";

const sphere = (latitude: number, longitude: number) => ({
  x: Math.cos(latitude) * Math.cos(longitude),
  y: Math.sin(latitude),
  z: Math.cos(latitude) * Math.sin(longitude)
});

test("Haven continents remain continuous across the 0/360° seam", () => {
  for (const latitude of [-1.2, -0.5, 0, 0.65, 1.35]) {
    const a = sphere(latitude, 0);
    const b = sphere(latitude, 2 * Math.PI);
    assert.ok(Math.abs(authoredContinentMask(a.x, a.y, a.z) -
      authoredContinentMask(b.x, b.y, b.z)) < 1e-10);
  }
});

test("author-defined continents, coasts and deep oceans occupy distinct regions", () => {
  const sampled = [];
  for (let j = -80; j <= 80; j += 8) {
    for (let i = -180; i < 180; i += 8) {
      const p = sphere(j * Math.PI / 180, i * Math.PI / 180);
      const terrain = fictionalOceanTerrain(p.x, p.y, p.z, 0.5, 0.5);
      assert.ok(Number.isFinite(terrain));
      sampled.push(terrain);
    }
  }
  const land = sampled.filter(v => v > 0).length / sampled.length;
  assert.ok(land > 0.08 && land < 0.65,
    "A fictional ocean world should contain substantial land and deep water, got " + land);
  assert.ok(sampled.some(v => v < -0.15));
  assert.ok(sampled.some(v => v > 0.32));
});

test("impact crater field is repeatable on a sphere, including poles and seam", () => {
  const points = [
    sphere(0, -Math.PI), sphere(0.7, 2.2), sphere(-0.5, 0),
    sphere(Math.PI / 2, 0), sphere(-Math.PI / 2, 1)
  ];
  const first = points.map(p => craterField(p.x, p.y, p.z, 6383));
  assert.deepEqual(first, points.map(p => craterField(p.x, p.y, p.z, 6383)));
  for (const value of first) assert.ok(Number.isFinite(value));
  const left = sphere(0.4, 0);
  const right = sphere(0.4, 2 * Math.PI);
  assert.ok(Math.abs(craterField(left.x, left.y, left.z, 6383) -
    craterField(right.x, right.y, right.z, 6383)) < 1e-10);
});
