import {
  Color3, Mesh, Quaternion, Scene, StandardMaterial, TransformNode, Vector3, VertexData
} from "@babylonjs/core";
import type { CelestialBody } from "@bridge-sim/shared";

/** Flat annular geometry, measured as multiples of real planetary radius.
 * Parent's rendering scale is R * proxyDistance / actualDistance, so the
 * ring's apparent size stays physically consistent with the planet.
 */
export function createPlanetRings(scene: Scene, body: CelestialBody, globeParent: TransformNode) {
  const appearance = body.appearance;
  if (!appearance?.rings) return null;
  const config = appearance.rings;
  const axis = new TransformNode("ring-plane-" + body.id, scene);
  axis.parent = globeParent;
  axis.rotationQuaternion = Quaternion.RotationAxis(Vector3.Forward(), appearance.axialTiltRadians);

  const bands = 9;
  const segments = 128;
  for (let band = 0; band < bands; band++) {
    const inner = config.innerRadiusRatio +
      (config.outerRadiusRatio - config.innerRadiusRatio) * band / bands;
    const outer = config.innerRadiusRatio +
      (config.outerRadiusRatio - config.innerRadiusRatio) * (band + 1) / bands;
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const theta = i * 2 * Math.PI / segments;
      const sin = Math.sin(theta), cos = Math.cos(theta);
      for (const radius of [inner, outer]) {
        positions.push(cos * radius, 0, sin * radius);
        normals.push(0, 1, 0);
        uvs.push(i / segments, radius);
      }
      if (i < segments) {
        const p = i * 2;
        indices.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
      }
    }
    const mesh = new Mesh("planetary-ring-band-" + body.id + "-" + band, scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.uvs = uvs;
    data.applyToMesh(mesh);
    const material = new StandardMaterial("planetary-ring-band-material-" + body.id + "-" + band, scene);
    const base = Color3.FromHexString(config.colorHex);
    const striation = Math.sin(band * 14.53 + appearance.seed) * 0.28;
    material.disableLighting = true;
    material.diffuseColor = base.scale(0.75 + striation);
    material.emissiveColor = base.scale(0.30 + striation * 0.18);
    material.alpha = (band === 0 || band === bands - 1 ? 0.2 : 0.42) *
      (0.8 + 0.2 * Math.sin(band * 4.7));
    material.backFaceCulling = false;
    mesh.material = material;
    mesh.parent = axis;
    mesh.isPickable = false;
  }
  return axis;
}
