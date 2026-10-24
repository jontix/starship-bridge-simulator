import {
  DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Texture,
  Vector3, type Scene
} from "@babylonjs/core";

/** Renderer-only corona. Both the star disc and halo get their size from
 * the same exact angular projection; they never affect collision or navigation.
 */
export function createStellarCorona(scene: Scene, id: string): Mesh {
  const canvas = new DynamicTexture("corona-gradient-" + id, {
    width: 512, height: 512
  }, scene, false);
  const ctx = canvas.getContext() as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 250);
  gradient.addColorStop(0.00, "rgba(255,244,186,0.16)");
  gradient.addColorStop(0.10, "rgba(255,205,112,0.20)");
  gradient.addColorStop(0.18, "rgba(255,165,65,0.13)");
  gradient.addColorStop(0.35, "rgba(255,133,36,0.065)");
  gradient.addColorStop(0.65, "rgba(255,111,28,0.018)");
  gradient.addColorStop(1.00, "rgba(255,96,23,0)");
  ctx.clearRect(0, 0, 512, 512);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);
  canvas.hasAlpha = true;
  canvas.wrapU = Texture.CLAMP_ADDRESSMODE;
  canvas.wrapV = Texture.CLAMP_ADDRESSMODE;
  canvas.update(false);

  const material = new StandardMaterial("stellar-corona-mat-" + id, scene);
  material.diffuseTexture = canvas;
  material.useAlphaFromDiffuseTexture = true;
  material.disableLighting = true;
  material.emissiveColor.set(1.0, 0.65, 0.32);
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.alpha = 0.9;

  const halo = MeshBuilder.CreatePlane("stellar-corona-" + id, {
    size: 1
  }, scene);
  halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
  halo.material = material;
  halo.isPickable = false;
  halo.setEnabled(false);
  return halo;
}

/** Corona is behind the opaque stellar disc and uses the *actual* projected
 * stellar radius. Clamping applies to purely artistic halo extent, not to
 * the resolved physical surface.
 */
export function updateStellarCorona(
  mesh: Mesh,
  starPosition: Vector3,
  proxyRadiusMetres: number,
  proxyDistanceMetres: number,
  visible: boolean
): void {
  mesh.setEnabled(visible);
  if (!visible) return;
  // Slightly farther away so the opaque star disc occludes the halo centre.
  mesh.position.copyFrom(starPosition.scale(1.004));
  const apparent = proxyRadiusMetres / proxyDistanceMetres;
  const radius = proxyDistanceMetres * Math.min(0.7, apparent);
  const width = radius * 9.5;
  mesh.scaling.set(width, width, 1);
}
