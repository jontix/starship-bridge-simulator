import {
  Color4, Engine, FreeCamera, Mesh, MeshBuilder, Scene, Texture, Vector3
} from "@babylonjs/core";
import { DEFAULT_SYSTEM_ID, getStarSystem, type CelestialBody } from "@bridge-sim/shared";
import { cloudMaterial, surfaceMaterial } from "./planetMaterials";
import { gpuDetailSeed } from "./surfaceDetail";

const PLANET_RADIUS_METRES = 6_370_000;
const SKY_DISTANCE = 8_000;
const PREVIEW_FOV = 0.8;

type Renderer = {
  scene: Scene;
  engine: Engine;
  camera: FreeCamera;
  surface: Mesh;
  clouds: Mesh;
  surfaceShader: ReturnType<typeof surfaceMaterial>;
  cloudShader: ReturnType<typeof cloudMaterial>;
  textures: Texture[];
  quality: number;
};

const haven = getStarSystem(DEFAULT_SYSTEM_ID).bodies.find(
  body => body.id === "haven"
) as CelestialBody;

function texture(scene: Scene, src: string): Texture {
  const item = new Texture(src, scene, false, false,
    Texture.TRILINEAR_SAMPLINGMODE);
  item.wrapU = Texture.WRAP_ADDRESSMODE;
  item.wrapV = Texture.CLAMP_ADDRESSMODE;
  return item;
}

function renderer(canvas: HTMLCanvasElement, quality: number, planetId: string): Renderer {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true
  });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.003, 0.007, 0.018, 1);
  const camera = new FreeCamera("fixed-orbit-camera-" + quality, Vector3.Zero(), scene);
  camera.fov = PREVIEW_FOV;
  camera.minZ = 1;
  camera.maxZ = 30_000;
  scene.activeCamera = camera;

  const base = "/planet-lab/" + planetId + "/maps/";
  const albedo = texture(scene, base + "albedo.png");
  const night = texture(scene, base + "night.png");
  const cloudTexture = texture(scene, base + "clouds.png");
  const height = texture(scene, base + "height.png");
  const roughness = texture(scene, base + "roughness.png");
  cloudTexture.hasAlpha = true;

  const textures = { surface: albedo, night, clouds: cloudTexture };
  const surfaceShader = surfaceMaterial(scene, haven, textures);
  surfaceShader.setTexture("heightSampler", height);
  surfaceShader.setTexture("roughnessSampler", roughness);
  const cloudShader = cloudMaterial(scene, haven, textures);

  const surface = MeshBuilder.CreateSphere("fixed-orbit-surface-" + quality,
    { segments: 96, diameter: 2 }, scene);
  surface.material = surfaceShader;
  surface.isPickable = false;
  surface.position.z = SKY_DISTANCE;
  surface.rotation.y = 1.45; // same art-directed longitude in both panes

  const clouds = MeshBuilder.CreateSphere("fixed-orbit-clouds-" + quality,
    { segments: 96, diameter: 2 }, scene);
  clouds.position.z = SKY_DISTANCE;
  clouds.rotation.y = 1.61;
  clouds.material = cloudShader;
  clouds.isPickable = false;
  // Earth-like high clouds, exaggerated slightly only for visibility.
  clouds.scaling.setAll(1.005);
  const sun = new Vector3(-0.24, 0.25, -0.94).normalize();
  surfaceShader.setVector3("sunDirection", sun);
  cloudShader.setVector3("sunDirection", sun);

  // Avoid a full speed render loop with two canvases and a software GPU.
  // A 12 FPS ceiling is sufficient for static scientific comparisons.
  let lastFrame = 0;
  engine.runRenderLoop(() => {
    const now = performance.now();
    if (now - lastFrame < 80) return;
    lastFrame = now;
    scene.render();
  });
  return { scene, engine, camera, surface, clouds, surfaceShader, cloudShader,
    textures: [albedo, night, cloudTexture, height, roughness], quality };
}

/** Creates side-by-side real Babylon shader views. No server or current
 * station state is used: fixed sun, fixed longitude and selected real altitudes.
 * The "before" pane is always detail OFF while "after" is adjustable.
 */
export function initializeOrbitalDetailLab(): {
  configure: (planetId: string, seed: number) => void;
  refresh: () => void;
  dispose: () => void;
} {
  const left = document.getElementById("detail-before") as HTMLCanvasElement;
  const right = document.getElementById("detail-after") as HTMLCanvasElement;
  const status = document.getElementById("orbital-render-status")!;
  let preset = "haven";
  let seed = 48271;
  let views: Renderer[] = [];

  const dispose = () => {
    for (const view of views) view.engine.dispose();
    views = [];
  };

  const refresh = () => {
    if (views.length !== 2) return;
    const altitudeKm = Number((document.getElementById("detail-altitude") as HTMLSelectElement).value);
    const strength = Number((document.getElementById("detail-strength") as HTMLInputElement).value);
    const scale = Number((document.getElementById("detail-scale") as HTMLInputElement).value);
    const cloudsOn = (document.getElementById("detail-clouds") as HTMLInputElement).checked;
    const altitude = altitudeKm * 1000;
    const angularRadius = Math.asin(PLANET_RADIUS_METRES / (PLANET_RADIUS_METRES + altitude));
    const framingOffset = Math.max(0, Math.min(1.38, angularRadius - 0.27));
    for (const [index, view] of views.entries()) {
      const radius = SKY_DISTANCE * PLANET_RADIUS_METRES / (PLANET_RADIUS_METRES + altitude);
      view.surface.scaling.setAll(radius);
      view.clouds.scaling.setAll(radius * 1.005);
      view.camera.setTarget(new Vector3(0, Math.sin(framingOffset),
        Math.cos(framingOffset)).scale(SKY_DISTANCE * 100));
      view.engine.resize();
      view.clouds.setEnabled(cloudsOn);
      const q = index === 0 ? 0 : strength;
      const seedPosition = gpuDetailSeed(seed);
      for (const shader of [view.surfaceShader, view.cloudShader]) {
        shader.setFloat("detailStrength", q);
        shader.setFloat("detailScale", scale);
        shader.setFloat("detailProxyRadius", radius);
        shader.setFloat("detailPixelRadians",
          2 * Math.tan(view.camera.fov / 2) /
          Math.max(1, view.engine.getRenderHeight()));
        shader.setVector3("detailSeed", new Vector3(
          seedPosition.x, seedPosition.y, seedPosition.z));
      }
    }
    document.getElementById("detail-strength-value")!.textContent = strength.toFixed(2);
    document.getElementById("detail-scale-value")!.textContent = scale.toFixed(2) + "×";
    status.textContent = "Fixed sun and geography · " + altitudeKm.toLocaleString() +
      " km above reference sphere · generator seed " + seed +
      " · left: OFF · right: " + Math.round(strength * 100) + "%";
  };

  const configure = (planetId: string, newSeed: number) => {
    if (views.length === 2 && planetId === preset && newSeed === seed) {
      refresh(); return;
    }
    dispose();
    preset = planetId;
    seed = newSeed;
    if (!["haven", "verdant"].includes(preset)) {
      status.textContent = "No generated maps for " + preset;
      return;
    }
    try {
      views = [renderer(left, 0, preset), renderer(right, 1, preset)];
      refresh();
    } catch (error) {
      status.textContent = "WebGL orbital preview unavailable: " + String(error);
      dispose();
    }
  };
  for (const id of ["detail-altitude", "detail-strength", "detail-scale", "detail-clouds"]) {
    document.getElementById(id)?.addEventListener("input", refresh);
  }
  window.addEventListener("beforeunload", dispose);
  return { configure, refresh, dispose };
}
