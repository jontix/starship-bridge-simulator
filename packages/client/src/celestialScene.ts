import {
  Color3, DynamicTexture, Mesh, MeshBuilder, Scene,
  StandardMaterial, TransformNode, Vector3
} from "@babylonjs/core";
import { getBody, length, type StarSystem, type Vec3 } from "@bridge-sim/shared";

function light(scene: Scene, name: string, hex: string, alpha = 1): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.diffuseColor = Color3.FromHexString(hex);
  material.emissiveColor = Color3.FromHexString(hex);
  material.alpha = alpha;
  material.backFaceCulling = false;
  return material;
}

function label(scene: Scene, text: string, parent: TransformNode, offsetY: number, width = 58): Mesh {
  const texture = new DynamicTexture("label-" + text, { width: 512, height: 90 }, scene, true);
  texture.hasAlpha = true;
  texture.drawText(text.toUpperCase(), null, 65, "bold 43px monospace", "#c9f4ff", "transparent", true);
  const material = new StandardMaterial("label-material-" + text, scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.disableLighting = true;
  material.backFaceCulling = false;
  const plane = MeshBuilder.CreatePlane("label-mesh-" + text, { width, height: width / 5.7 }, scene);
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.position.y = offsetY;
  plane.parent = parent;
  plane.material = material;
  plane.isPickable = false;
  return plane;
}

/**
 * Near-space reference station, not a collision object or gravity source.
 * Its absolute astronomical orbit is provided by StarSystem; the local ship
 * frame co-moves with it. Only the few-hundred-metre offset reaches WebGL.
 */
export function createReferenceStation(scene: Scene) {
  const root = new TransformNode("local-frame-orbital-station", scene);
  const metal = new StandardMaterial("station-hull", scene);
  metal.diffuseColor = new Color3(0.33, 0.53, 0.64);
  metal.specularColor = new Color3(0.28, 0.48, 0.6);
  const trim = light(scene, "station-trim", "#71e5d6");
  const ring = MeshBuilder.CreateTorus("station-habitat-ring", {
    diameter: 74, thickness: 3.4, tessellation: 80
  }, scene);
  ring.parent = root;
  ring.material = metal;
  ring.isPickable = false;
  const crossArm = MeshBuilder.CreateBox("station-cross-spindle", { width: 85, height: 2.2, depth: 2.2 }, scene);
  crossArm.parent = root;
  crossArm.material = metal;
  crossArm.isPickable = false;
  const mainHub = MeshBuilder.CreateCylinder("station-docking-hub", {
    height: 18, diameter: 11, tessellation: 16
  }, scene);
  mainHub.rotation.x = Math.PI / 2;
  mainHub.parent = root;
  mainHub.material = metal;
  mainHub.isPickable = false;
  for (const x of [-37, 37]) {
    const beacon = MeshBuilder.CreateSphere("station-position-light", { diameter: 4.8 }, scene);
    beacon.position.set(x, 0, 0);
    beacon.parent = root;
    beacon.material = trim;
    beacon.isPickable = false;
  }
  const dockAxis = MeshBuilder.CreateLines("station-docking-axis", {
    points: [Vector3.Zero(), new Vector3(0, 0, 88)]
  }, scene);
  dockAxis.color = new Color3(0.43, 0.94, 0.73);
  dockAxis.parent = root;
  dockAxis.isPickable = false;
  const dockingLabel = label(scene, "LOCAL FRAME STATION", root, 59, 86);

  return {
    update(system: StarSystem, referenceBodyId: string, frameOffset: Vec3,
      originMetres: Vector3, visible: boolean) {
      const parent = getBody(system, referenceBodyId);
      const range = length(frameOffset);
      root.setEnabled(visible && parent.kind === "station" && range < 40_000);
      if (!root.isEnabled()) return;
      root.position.set(
        -frameOffset.x - originMetres.x,
        -frameOffset.y - originMetres.y,
        -frameOffset.z - originMetres.z
      );
      dockingLabel.isVisible = visible;
    }
  };
}
