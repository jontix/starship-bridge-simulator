import {
  Color3, Color4, Engine, FreeCamera, Mesh, MeshBuilder, Quaternion,
  Scene, ShaderMaterial, StandardMaterial, TransformNode, Vector3,
  type Camera
} from "@babylonjs/core";
import {
  add, apparentBodyGeometry, choosePlanetFocus, discDiameterPixels,
  getStarSystem, length, normalize, scale, shipPositionFromSnapshot, sub, systemPositionsAt,
  type CelestialBody, type GameSnapshot, type StarSystem, type Vec3
} from "@bridge-sim/shared";
import { atmosphereMaterial, cloudMaterial, placeholderMaterial, surfaceMaterial } from "./planetMaterials";
import { generatePlanetTextures } from "./planetTextures";

const PROXY_DISTANCE = 8_000;
const TAU = Math.PI * 2;
const toVector = (v: Vec3) => new Vector3(v.x, v.y, v.z);

type Globe = {
  root: TransformNode;
  surface: Mesh;
  globeRotation: TransformNode;
  clouds: Mesh | null;
  cloudRotation: TransformNode | null;
  atmosphere: Mesh | null;
  glint: Mesh;
  loaded: boolean;
  sunMaterials: { setVector3: (name: string, value: Vector3) => unknown }[];
};

function starfield(scene: Scene): void {
  let seed = 154733;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const lines: Vector3[][] = [];
  for (let i = 0; i < 1700; i++) {
    const longitude = next() * TAU;
    const height = next() * 2 - 1;
    const root = Math.sqrt(1 - height * height);
    const distance = 35_000 + next() * 18_000;
    const p = new Vector3(
      Math.cos(longitude) * root * distance,
      height * distance,
      Math.sin(longitude) * root * distance
    );
    const apparentSize = next();
    const tail = (0.8 + apparentSize * 4.2) * (distance / 25_000);
    lines.push([p, p.add(new Vector3(tail, tail * 0.25, 0))]);
  }
  const stars = MeshBuilder.CreateLineSystem("fixed-distant-constellation-field", { lines }, scene);
  stars.color = new Color3(0.66, 0.79, 0.98);
  stars.alpha = 0.75;
  stars.isPickable = false;
}

function createGlobe(scene: Scene, body: CelestialBody): Globe {
  const root = new TransformNode("actual-angular-size-" + body.id, scene);
  const globeRotation = new TransformNode("rotating-world-" + body.id, scene);
  globeRotation.parent = root;
  globeRotation.rotationQuaternion = Quaternion.Identity();

  const surface = MeshBuilder.CreateSphere("planet-surface-" + body.id, {
    diameter: 2, segments: 96
  }, scene);
  surface.parent = globeRotation;
  surface.material = placeholderMaterial(scene, body);
  surface.isPickable = false;

  let clouds: Mesh | null = null;
  let cloudRotation: TransformNode | null = null;
  if (body.appearance?.clouds) {
    cloudRotation = new TransformNode("cloud-rotation-" + body.id, scene);
    cloudRotation.parent = root;
    cloudRotation.rotationQuaternion = Quaternion.Identity();
    clouds = MeshBuilder.CreateSphere("planet-clouds-" + body.id, { diameter: 2, segments: 96 }, scene);
    clouds.parent = cloudRotation;
    clouds.scaling.setAll(1 + body.appearance.clouds.altitudeMeters / body.radiusMeters);
    clouds.isPickable = false;
    clouds.setEnabled(false);
  }

  let atmosphere: Mesh | null = null;
  if (body.appearance?.atmosphere) {
    atmosphere = MeshBuilder.CreateSphere("planet-atmosphere-" + body.id, {
      diameter: 2, segments: 96
    }, scene);
    atmosphere.parent = root;
    atmosphere.scaling.setAll(1 + body.appearance.atmosphere.thicknessMeters / body.radiusMeters);
    atmosphere.material = atmosphereMaterial(scene, body);
    atmosphere.isPickable = false;
  }

  const glint = MeshBuilder.CreateSphere("unresolved-disc-glint-" + body.id, {
    diameter: 11, segments: 10
  }, scene);
  const mat = new StandardMaterial(body.id + "-glint-material", scene);
  mat.disableLighting = true;
  mat.emissiveColor = Color3.FromHexString(body.mapColor);
  mat.diffuseColor = mat.emissiveColor;
  glint.material = mat;
  glint.isPickable = false;
  glint.setEnabled(false);
  root.setEnabled(false);
  return {
    root, surface, globeRotation, cloudRotation, clouds, atmosphere,
    glint, loaded: false, sunMaterials: []
  };
}

/** Camera-relative background in a separate render scene:
 * foreground geometry (ships, stations, grids) always uses its own depth
 * buffer; no false clipping against a nearby proxy planet surface.
 */
export function createPlanetaryBackground(engine: Engine) {
  const sky = new Scene(engine);
  sky.clearColor = new Color4(0.003, 0.006, 0.019, 1);
  const camera = new FreeCamera("planetary-sky-camera", Vector3.Zero(), sky);
  camera.minZ = 0.25;
  camera.maxZ = 75_000;
  sky.activeCamera = camera;
  starfield(sky);
  let activeSystemId: string | null = null;
  const globes = new Map<string, Globe>();

  const prepare = (system: StarSystem) => {
    if (activeSystemId === system.id) return;
    for (const globe of globes.values()) {
      globe.root.dispose(false, true);
      globe.glint.dispose(false, true);
    }
    globes.clear();
    activeSystemId = system.id;
    for (const body of system.bodies) {
      if (body.kind === "station" || !body.appearance) continue;
      globes.set(body.id, createGlobe(sky, body));
    }
  };

  const update = (
    snapshot: GameSnapshot,
    localCamera: Camera,
    cameraOffsetMetres: Vec3,
    focusedBodyId: string,
    viewportHeightPx: number,
    aidsVisible: boolean
  ) => {
    const system = getStarSystem(snapshot.universe.systemId);
    prepare(system);

    camera.fov = localCamera.fov;
    camera.upVector.copyFrom(localCamera.getDirection(Vector3.Up()));
    camera.setTarget(localCamera.getForwardRay().direction);

    const shipSystemPosition = shipPositionFromSnapshot(system, snapshot);
    const cameraSystemPosition = add(shipSystemPosition, cameraOffsetMetres);
    const positions = systemPositionsAt(system, snapshot.universe.epochSeconds);
    const primary = system.bodies.find(body => body.kind === "star")!;
    const sunPosition = positions[primary.id];

    for (const body of system.bodies) {
      const globe = globes.get(body.id);
      if (!globe) continue;
      const distanceVector = sub(positions[body.id], cameraSystemPosition);
      const distance = length(distanceVector);
      if (distance < 1) { globe.root.setEnabled(false); globe.glint.setEnabled(false); continue; }
      const geometry = apparentBodyGeometry(body.radiusMeters, positions[body.id], cameraSystemPosition, PROXY_DISTANCE);
      const direction = normalize(distanceVector);
      const skyPosition = toVector(scale(direction, PROXY_DISTANCE));
      const pixelDiameter = discDiameterPixels(geometry.apparentAngularRadiusRadians, camera.fov, viewportHeightPx);
      const resolved = pixelDiameter >= 1.8;

      globe.root.setEnabled(resolved);
      globe.glint.setEnabled(!resolved && aidsVisible);
      if (!resolved) {
        globe.glint.position.copyFrom(skyPosition);
        continue;
      }
      globe.root.position.copyFrom(skyPosition);
      globe.root.scaling.setAll(geometry.proxyRadiusMetres);
      const appearance = body.appearance!;
      const time = snapshot.universe.epochSeconds - system.epochUnixSeconds;
      const spin = (TAU * ((time / appearance.rotationPeriodSeconds) % 1) + appearance.seed % 19);
      const tilt = Quaternion.RotationAxis(Vector3.Forward(), appearance.axialTiltRadians);
      globe.globeRotation.rotationQuaternion = tilt.multiply(Quaternion.RotationAxis(Vector3.Up(), spin));
      if (globe.cloudRotation) {
        globe.cloudRotation.rotationQuaternion = tilt.multiply(Quaternion.RotationAxis(Vector3.Up(), spin * 1.028));
      }

      if (!globe.loaded && pixelDiameter >= 3.5) {
        const textures = generatePlanetTextures(sky, body);
        const old = globe.surface.material;
        const litSurface = surfaceMaterial(sky, body, textures);
        globe.surface.material = litSurface;
        old?.dispose();
        globe.sunMaterials.push(litSurface);
        if (globe.clouds) {
          const litClouds = cloudMaterial(sky, body, textures);
          globe.clouds.material = litClouds;
          globe.clouds.setEnabled(true);
          globe.sunMaterials.push(litClouds);
        }
        if (globe.atmosphere?.material instanceof ShaderMaterial) {
          globe.sunMaterials.push(globe.atmosphere.material);
        }
        globe.loaded = true;
      }
      // From a planet toward its star. Bodies carry their own terminator, rather
      // than using one global light direction for every orbit in the system.
      const lightVector = sub(sunPosition, positions[body.id]);
      const sunDirection = toVector(length(lightVector) > 1 ? normalize(lightVector) : { x: 1, y: 0, z: 0 });
      for (const material of globe.sunMaterials) material.setVector3("sunDirection", sunDirection);
      if (globe.atmosphere && !globe.loaded) globe.atmosphere.setEnabled(false);
      if (globe.atmosphere && globe.loaded) globe.atmosphere.setEnabled(true);
    }

    const focus = choosePlanetFocus(
      system, snapshot.universe.referenceBodyId, snapshot.cruise.targetId, focusedBodyId
    );
    const focusVector = sub(positions[focus.id], cameraSystemPosition);
    return {
      focusDirection: normalize(focusVector),
      focusName: focus.name
    };
  };

  return {
    scene: sky,
    update,
    render: () => sky.render(),
    dispose: () => sky.dispose()
  };
}
