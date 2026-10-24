import {
  Color3, DynamicTexture, Mesh, MeshBuilder, Quaternion, Scene,
  StandardMaterial, TransformNode, Vector3
} from "@babylonjs/core";
import {
  directionToHeading, headingToDirection, NAV_MARKERS,
  type ShipState
} from "@bridge-sim/shared";

export type SelectedHeading = { yaw: number; pitch: number; roll: number }; // Degrees in the Helm UI
export type PickedHeading = { yaw: number; pitch: number };                // Radians to UI boundary
export type VisualPose = { position: Vector3; orientation: Quaternion };

const SPHERE_RADIUS = 52;
const traceCapacity = 90;
const toVector = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.y, v.z);
const angle = (degrees: number) => degrees * Math.PI / 180;

function emissive(scene: Scene, name: string, color: Color3, alpha = 1): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveColor = color;
  material.diffuseColor = color;
  material.alpha = alpha;
  material.backFaceCulling = false;
  return material;
}

function curveAtLatitude(latitude: number, radius: number): Vector3[] {
  const points: Vector3[] = [];
  for (let step = 0; step <= 96; step++) {
    const longitude = step * 2 * Math.PI / 96;
    points.push(new Vector3(
      radius * Math.cos(latitude) * Math.sin(longitude),
      radius * Math.sin(latitude),
      radius * Math.cos(latitude) * Math.cos(longitude)
    ));
  }
  return points;
}

function curveAtLongitude(longitude: number, radius: number): Vector3[] {
  const points: Vector3[] = [];
  for (let step = 0; step <= 64; step++) {
    const latitude = -Math.PI / 2 + step * Math.PI / 64;
    points.push(new Vector3(
      radius * Math.cos(latitude) * Math.sin(longitude),
      radius * Math.sin(latitude),
      radius * Math.cos(latitude) * Math.cos(longitude)
    ));
  }
  return points;
}

function createStars(scene: Scene): Mesh {
  // Deterministic procedural stars: a single draw call rather than hundreds of tiny meshes.
  let seed = 0x41339;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const lines: Vector3[][] = [];
  for (let index = 0; index < 1250; index++) {
    const azimuth = random() * Math.PI * 2;
    const altitude = Math.asin(random() * 2 - 1);
    const distance = 430 + random() * 2250;
    const center = new Vector3(
      distance * Math.cos(altitude) * Math.sin(azimuth),
      distance * Math.sin(altitude),
      distance * Math.cos(altitude) * Math.cos(azimuth)
    );
    const length = 0.8 + random() * 2;
    lines.push([center, center.add(new Vector3(length, length * 0.4, 0))]);
  }
  const stars = MeshBuilder.CreateLineSystem("fixed-stars", { lines }, scene);
  stars.color = new Color3(0.67, 0.79, 1);
  stars.alpha = 0.8;
  stars.isPickable = false;
  return stars;
}

function createGrid(scene: Scene): TransformNode {
  const node = new TransformNode("navigation-grid-root", scene);
  const lines: Vector3[][] = [];
  const reach = 1400;
  for (let coordinate = -reach; coordinate <= reach; coordinate += 100) {
    lines.push([new Vector3(-reach, 0, coordinate), new Vector3(reach, 0, coordinate)]);
    lines.push([new Vector3(coordinate, 0, -reach), new Vector3(coordinate, 0, reach)]);
  }
  const mesh = MeshBuilder.CreateLineSystem("world-horizontal-reference-grid", { lines }, scene);
  mesh.color = new Color3(0.15, 0.42, 0.57);
  mesh.alpha = 0.28;
  mesh.isPickable = false;
  mesh.parent = node;
  return node;
}

function createBeacons(scene: Scene): void {
  const ringMaterial = emissive(scene, "nav-beacon-rings", new Color3(0.16, 0.85, 1));
  const coreMaterial = emissive(scene, "nav-beacon-core", new Color3(1, 0.71, 0.35));
  for (const beacon of NAV_MARKERS) {
    const root = new TransformNode(`beacon-${beacon.id}`, scene);
    root.position.copyFrom(toVector(beacon.position));
    const core = MeshBuilder.CreateSphere(`beacon-${beacon.id}-core`, { diameter: 7, segments: 12 }, scene);
    core.material = coreMaterial;
    core.parent = root;
    core.isPickable = false;
    const ring = MeshBuilder.CreateTorus(`beacon-${beacon.id}-ring`, { diameter: 23, thickness: 0.45, tessellation: 48 }, scene);
    ring.material = ringMaterial;
    ring.parent = root;
    ring.isPickable = false;
    const second = MeshBuilder.CreateTorus(`beacon-${beacon.id}-vertical`, { diameter: 23, thickness: 0.45, tessellation: 48 }, scene);
    second.rotation.x = Math.PI / 2;
    second.parent = root;
    second.material = ringMaterial;
    second.isPickable = false;

    const texture = new DynamicTexture(`beacon-${beacon.id}-text`, { width: 512, height: 128 }, scene, true);
    texture.hasAlpha = true;
    texture.drawText(`NAV ${beacon.id}`, null, 88, "bold 72px monospace", "#b7f6ff", "transparent", true);
    const textMat = new StandardMaterial(`beacon-${beacon.id}-label-material`, scene);
    textMat.diffuseTexture = texture;
    textMat.useAlphaFromDiffuseTexture = true;
    textMat.disableLighting = true;
    textMat.backFaceCulling = false;
    const label = MeshBuilder.CreatePlane(`beacon-${beacon.id}-label`, { width: 48, height: 12 }, scene);
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.material = textMat;
    label.position.y = 22;
    label.parent = root;
    label.isPickable = false;
  }
}

function createSphere(scene: Scene) {
  // Root intentionally stays aligned to world axes. Only its centre follows the vessel.
  const root = new TransformNode("world-heading-sphere-root", scene);
  const pickSurface = MeshBuilder.CreateSphere("clickable-heading-sphere", {
    diameter: SPHERE_RADIUS * 2, segments: 40
  }, scene);
  pickSurface.parent = root;
  const pickMat = emissive(scene, "transparent-picking-surface", new Color3(0.07, 0.43, 0.65), 0.025);
  pickMat.disableDepthWrite = true;
  pickSurface.material = pickMat;
  pickSurface.isPickable = true;

  const parallels = [-60, -30, 0, 30, 60].map(degrees => curveAtLatitude(angle(degrees), SPHERE_RADIUS));
  const meridians = Array.from({ length: 12 }, (_, index) => curveAtLongitude(index * Math.PI / 6, SPHERE_RADIUS));
  const sphereLines = MeshBuilder.CreateLineSystem("sphere-meridians-and-parallels", { lines: [...parallels, ...meridians] }, scene);
  sphereLines.color = new Color3(0.22, 0.7, 0.94);
  sphereLines.alpha = 0.45;
  sphereLines.parent = root;
  sphereLines.isPickable = false;
  const equator = MeshBuilder.CreateLines("sphere-equator", { points: curveAtLatitude(0, SPHERE_RADIUS + 0.2) }, scene);
  equator.color = new Color3(0.58, 0.89, 1);
  equator.alpha = 0.78;
  equator.parent = root;
  equator.isPickable = false;

  const vertical = MeshBuilder.CreateLines("sphere-world-up", {
    points: [new Vector3(0, -SPHERE_RADIUS, 0), new Vector3(0, SPHERE_RADIUS, 0)]
  }, scene);
  vertical.color = new Color3(0.5, 0.8, 0.5);
  vertical.parent = root;
  vertical.isPickable = false;
  const forwardAxis = MeshBuilder.CreateLines("sphere-world-forward", {
    points: [Vector3.Zero(), new Vector3(0, 0, SPHERE_RADIUS)]
  }, scene);
  forwardAxis.color = new Color3(0.4, 0.56, 0.96);
  forwardAxis.parent = root;
  forwardAxis.isPickable = false;

  function marker(name: string, color: Color3, diameter: number) {
    const mesh = MeshBuilder.CreateSphere(name, { diameter, segments: 12 }, scene);
    mesh.parent = root;
    mesh.material = emissive(scene, `${name}-material`, color);
    mesh.isPickable = false;
    return mesh;
  }
  const selected = marker("selected-preview-cyan", new Color3(0.22, 0.96, 1), 5.5);
  const ordered = marker("engaged-command-amber", new Color3(1, 0.59, 0.18), 3.6);
  const bow = marker("actual-bow-white", new Color3(1, 1, 1), 3.1);

  root.setEnabled(false);
  return { root, pickSurface, selected, ordered, bow };
}

export function createNavigationVisuals(scene: Scene) {
  const stars = createStars(scene);
  const grid = createGrid(scene);
  createBeacons(scene);
  const sphere = createSphere(scene);

  const zeroes = Array.from({ length: 5 }, () => Vector3.Zero());
  const velocity = MeshBuilder.CreateLines("world-velocity-vector", { points: zeroes, updatable: true }, scene);
  velocity.color = new Color3(0.4, 1, 0.55);
  velocity.alpha = 1;
  velocity.isPickable = false;

  const history: Vector3[] = [];
  const trail = MeshBuilder.CreateLines("ship-flight-history", {
    points: Array.from({ length: traceCapacity }, () => Vector3.Zero()), updatable: true
  }, scene);
  trail.color = new Color3(0.78, 0.5, 1);
  trail.alpha = 0.6;
  trail.isPickable = false;
  let lastTraceTick = -1;

  const pickHeading = (pointerX: number, pointerY: number): PickedHeading | null => {
    if (!sphere.root.isEnabled()) return null;
    const picked = scene.pick(pointerX, pointerY, candidate => candidate === sphere.pickSurface);
    if (!picked?.hit || !picked.pickedPoint) return null;
    const direction = picked.pickedPoint.subtract(sphere.root.getAbsolutePosition());
    return directionToHeading({ x: direction.x, y: direction.y, z: direction.z });
  };

  const update = (
    pose: VisualPose, ship: ShipState, tick: number,
    options: { sphere: boolean; aids: boolean; selected: SelectedHeading }
  ) => {
    sphere.root.position.copyFrom(pose.position);
    sphere.root.setEnabled(options.sphere);
    if (options.sphere) {
      const selectedDirection = headingToDirection(angle(options.selected.yaw), angle(options.selected.pitch));
      sphere.selected.position.copyFrom(toVector(selectedDirection).scale(SPHERE_RADIUS));
      const commandedDirection = headingToDirection(ship.desiredYaw, ship.desiredPitch);
      sphere.ordered.position.copyFrom(toVector(commandedDirection).scale(SPHERE_RADIUS - 0.2));
      const forward = Vector3.TransformCoordinates(Vector3.Forward(), pose.orientation.toRotationMatrix());
      sphere.bow.position.copyFrom(forward.normalize().scale(SPHERE_RADIUS - 0.5));
    }

    // Celestial field follows loosely; translating creates mild parallax at high speed.
    stars.position.copyFrom(pose.position.scale(0.78));
    grid.setEnabled(options.aids);
    grid.position.set(Math.round(pose.position.x / 200) * 200, -45, Math.round(pose.position.z / 200) * 200);
    velocity.setEnabled(options.aids);
    trail.setEnabled(options.aids);

    const speed = Math.hypot(ship.velocity.x, ship.velocity.y, ship.velocity.z);
    if (speed > 0.1) {
      const forward = toVector(ship.velocity).normalize();
      const end = pose.position.add(forward.scale(Math.max(6, Math.min(155, speed * 0.8))));
      let side = Vector3.Cross(forward, Vector3.Up());
      if (side.lengthSquared() < 0.001) side = Vector3.Cross(forward, Vector3.Right());
      side.normalize().scaleInPlace(5);
      const back = forward.scale(10);
      MeshBuilder.CreateLines("world-velocity-vector", {
        points: [
          pose.position, end,
          end.subtract(back).add(side),
          end,
          end.subtract(back).subtract(side)
        ],
        instance: velocity
      }, scene);
    }
    velocity.setEnabled(options.aids && speed > 0.1);

    if (tick < lastTraceTick) { history.length = 0; lastTraceTick = -1; }
    if (tick >= 0 && tick !== lastTraceTick && (tick - lastTraceTick >= 6 || lastTraceTick === -1)) {
      lastTraceTick = tick;
      history.push(pose.position.clone());
      if (history.length > traceCapacity) history.shift();
      const points = Array.from({ length: traceCapacity }, (_, index) =>
        (history[Math.max(0, history.length - traceCapacity + index)] ?? history[history.length - 1]).clone()
      );
      MeshBuilder.CreateLines("ship-flight-history", { points, instance: trail }, scene);
    }
  };

  return { pickHeading, update };
}

/** Decorative thrust visualization, not an input to the simulation. */
export function attachEngineEffects(scene: Scene, shipMesh: Mesh) {
  const plumeMaterial = emissive(scene, "engine-plume-material", new Color3(0.13, 0.63, 1), 0.56);
  const plumes: Mesh[] = [];
  for (const x of [-2.3, 2.3]) {
    const plume = MeshBuilder.CreateCylinder("impulse-exhaust-plume", {
      diameterTop: 0.2, diameterBottom: 2.6, height: 15, tessellation: 14
    }, scene);
    plume.rotation.x = -Math.PI / 2;
    plume.position.set(x, 0, -15);
    plume.material = plumeMaterial;
    plume.parent = shipMesh;
    plume.isPickable = false;
    plumes.push(plume);
  }
  return {
    update(acceleration: { x: number; y: number; z: number }, timeSeconds: number) {
      const thrust = Math.min(1, Math.hypot(acceleration.x, acceleration.y, acceleration.z) / 32);
      const flicker = 1 + Math.sin(timeSeconds * 23) * 0.08;
      for (const plume of plumes) {
        plume.scaling.y = (0.14 + thrust * 1.15) * flicker;
        plume.visibility = 0.18 + thrust * 0.75;
      }
    }
  };
}
