import {
  Color3, DirectionalLight, HemisphericLight, Mesh, MeshBuilder,
  PBRMaterial, Scene, StandardMaterial, Vector3
} from "@babylonjs/core";
import { length, normalize, sub, type Vec3 } from "@bridge-sim/shared";

/**
 * Local ship illumination uses the actual direction to Aster computed in
 * double-precision system space, never a fixed stage-light direction.
 * A restrained world-side fill represents reflected planetary illumination
 * and prevents the model turning into a black silhouette above bright worlds.
 */
export function createSpaceLighting(scene: Scene) {
  const ambient = new HemisphericLight("deep-space-ambient-v2", new Vector3(0, 1, 0), scene);
  ambient.diffuse = new Color3(0.42, 0.54, 0.67);
  ambient.groundColor = new Color3(0.09, 0.13, 0.22);
  ambient.intensity = 0.74;

  const sunlight = new DirectionalLight("aster-directional-sunlight",
    new Vector3(-1, -0.1, 0), scene);
  sunlight.diffuse = new Color3(1, 0.93, 0.80);
  sunlight.specular = new Color3(1, 0.92, 0.78);
  sunlight.intensity = 1.55;

  const planetFill = new DirectionalLight("planetary-albedo-fill",
    new Vector3(0, -1, 0), scene);
  planetFill.diffuse = new Color3(0.24, 0.49, 0.75);
  planetFill.specular = new Color3(0.07, 0.13, 0.22);
  planetFill.intensity = 0.32;

  return {
    update(shipPosition: Vec3, sunPosition: Vec3,
      focusedWorldPosition: Vec3, worldRadiusMetres: number) {
      const toSun = normalize(sub(sunPosition, shipPosition));
      const toPlanet = normalize(sub(focusedWorldPosition, shipPosition));
      sunlight.direction.set(-toSun.x, -toSun.y, -toSun.z);
      // Lighting from below/planet-side, never a replacement for sunlight.
      planetFill.direction.set(-toPlanet.x, -toPlanet.y, -toPlanet.z);
      const range = Math.max(worldRadiusMetres, length(sub(focusedWorldPosition, shipPosition)));
      const apparentRadius = worldRadiusMetres / range;
      planetFill.intensity = 0.07 + Math.min(0.38, apparentRadius * 0.42);
    }
  };
}

export function upgradeShipAppearance(scene: Scene, ship: Mesh): PBRMaterial {
  const hull = new PBRMaterial("exploration-hull-PBR", scene);
  hull.albedoColor = new Color3(0.44, 0.57, 0.69);
  hull.metallic = 0.16;
  hull.roughness = 0.54;
  hull.emissiveColor = new Color3(0.014, 0.024, 0.045);

  const dark = new PBRMaterial("hull-trim-PBR", scene);
  dark.albedoColor = new Color3(0.075, 0.14, 0.22);
  dark.metallic = 0.32;
  dark.roughness = 0.40;

  const glass = new StandardMaterial("illuminated-observation-windows", scene);
  glass.diffuseColor = new Color3(0.08, 0.46, 0.68);
  glass.emissiveColor = new Color3(0.025, 0.42, 0.69);
  glass.specularColor = new Color3(0.6, 0.8, 1.0);

  const lights = new StandardMaterial("running-light-emission", scene);
  lights.disableLighting = true;
  lights.emissiveColor = new Color3(0.66, 0.95, 1);
  lights.diffuseColor = lights.emissiveColor;

  for (const side of [-1, 1]) {
    const sideRail = MeshBuilder.CreateBox("port-starboard-nacelle",
      { width: 1.0, height: 1.35, depth: 14.5 }, scene);
    sideRail.parent = ship;
    sideRail.position.set(side * 4.95, 0.2, -2.3);
    sideRail.material = dark;
    sideRail.isPickable = false;

    const windowBand = MeshBuilder.CreateBox("bridge-window-light-band",
      { width: 0.17, height: 0.25, depth: 9.0 }, scene);
    windowBand.parent = ship;
    windowBand.position.set(side * 4.07, 1.19, 1.1);
    windowBand.material = glass;
    windowBand.isPickable = false;

    const runningLight = MeshBuilder.CreateSphere("running-light", {
      diameter: 0.56, segments: 8
    }, scene);
    runningLight.parent = ship;
    runningLight.position.set(side * 6.1, 0.4, -3.6);
    runningLight.material = lights;
    runningLight.isPickable = false;
  }

  const observationDeck = MeshBuilder.CreateBox("dorsal-observation-window",
    { width: 3.4, height: 0.12, depth: 3.8 }, scene);
  observationDeck.parent = ship;
  observationDeck.position.set(0, 1.6, 5.4);
  observationDeck.material = glass;
  observationDeck.isPickable = false;

  const dorsalSpine = MeshBuilder.CreateBox("dorsal-keel",
    { width: 0.85, height: 0.31, depth: 14.3 }, scene);
  dorsalSpine.parent = ship;
  dorsalSpine.position.set(0, 1.7, -1.1);
  dorsalSpine.material = dark;
  dorsalSpine.isPickable = false;

  return hull;
}
