import { useEffect, useRef } from "react";
import {
  ArcRotateCamera, Color3, Engine, FreeCamera, HemisphericLight, MeshBuilder,
  PointerEventTypes, Quaternion, Scene, StandardMaterial, Vector3
} from "@babylonjs/core";
import { rotateVector, vec3, type GameSnapshot, type Quat } from "@bridge-sim/shared";
import {
  attachEngineEffects, createNavigationVisuals,
  type PickedHeading, type SelectedHeading
} from "./navigationVisuals";

export type CameraMode = "orbit" | "chase" | "tactical";
type Sample = { snapshot: GameSnapshot; receivedAt: number };
const INTERPOLATION_DELAY_MS = 115;

const toVector = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.y, v.z);
const toQuaternion = (q: Quat) => new Quaternion(q.x, q.y, q.z, q.w);

function interpolatedPose(samples: Sample[], target: number) {
  if (!samples.length) return null;
  let before = samples[0];
  let after = samples[samples.length - 1];
  if (target <= before.receivedAt) after = before;
  else if (target >= after.receivedAt) before = after;
  else {
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].receivedAt >= target) {
        before = samples[i - 1];
        after = samples[i];
        break;
      }
    }
  }
  const fraction = before === after ? 0 : Math.max(0, Math.min(1,
    (target - before.receivedAt) / (after.receivedAt - before.receivedAt)
  ));
  return {
    position: Vector3.Lerp(toVector(before.snapshot.ship.position), toVector(after.snapshot.ship.position), fraction),
    orientation: Quaternion.Slerp(toQuaternion(before.snapshot.ship.orientation), toQuaternion(after.snapshot.ship.orientation), fraction)
  };
}

type MainSceneProps = {
  snapshot: GameSnapshot | null;
  mode: CameraMode;
  showHeadingSphere: boolean;
  showNavigationAids: boolean;
  selectedHeading: SelectedHeading;
  onHeadingPicked: (heading: PickedHeading) => void;
};

export function MainScene({
  snapshot, mode, showHeadingSphere, showNavigationAids,
  selectedHeading, onHeadingPicked
}: MainSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const samplesRef = useRef<Sample[]>([]);
  const latestRef = useRef(snapshot);
  latestRef.current = snapshot;
  const propsRef = useRef({
    mode, showHeadingSphere, showNavigationAids, selectedHeading, onHeadingPicked
  });
  propsRef.current = { mode, showHeadingSphere, showNavigationAids, selectedHeading, onHeadingPicked };

  useEffect(() => {
    if (!snapshot) { samplesRef.current = []; return; }
    const samples = samplesRef.current;
    if (samples.length > 0 && snapshot.tick <= samples[samples.length - 1].snapshot.tick) return;
    samples.push({ snapshot, receivedAt: performance.now() });
    if (samples.length > 12) samples.splice(0, samples.length - 12);
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor.set(0.008, 0.011, 0.024, 1);
    const orbit = new ArcRotateCamera("orbit", -Math.PI / 4, Math.PI / 2.75, 78, Vector3.Zero(), scene);
    const tactical = new ArcRotateCamera("tactical", -Math.PI / 4, 0.47, 245, Vector3.Zero(), scene);
    const chase = new FreeCamera("chase", new Vector3(0, 20, -85), scene);
    orbit.lowerRadiusLimit = 62;
    orbit.upperRadiusLimit = 650;
    tactical.lowerRadiusLimit = 80;
    tactical.upperRadiusLimit = 900;
    for (const camera of [orbit, tactical, chase]) camera.maxZ = 12000;

    let selectedCamera: CameraMode | null = null;
    let spherePreviouslyVisible = false;
    const chooseCamera = () => {
      const wanted = propsRef.current.mode;
      if (selectedCamera !== wanted) {
        scene.activeCamera?.detachControl();
        selectedCamera = wanted;
        scene.activeCamera = wanted === "chase" ? chase : wanted === "tactical" ? tactical : orbit;
        if (wanted !== "chase") scene.activeCamera.attachControl(canvas, true);
      }
      if (propsRef.current.showHeadingSphere !== spherePreviouslyVisible) {
        spherePreviouslyVisible = propsRef.current.showHeadingSphere;
        // Open the globe at a useful scale without locking away subsequent manual zoom.
        orbit.radius = spherePreviouslyVisible ? Math.max(orbit.radius, 135) : Math.min(orbit.radius, 82);
      }
    };

    new HemisphericLight("ambient", new Vector3(0.4, 1, 0.2), scene).intensity = 0.85;
    const ship = MeshBuilder.CreateBox("ship-hull", { width: 8, height: 3, depth: 18 }, scene);
    ship.rotationQuaternion = Quaternion.Identity();
    const hullMaterial = new StandardMaterial("hull-material", scene);
    hullMaterial.diffuseColor = new Color3(0.45, 0.72, 1);
    ship.material = hullMaterial;
    ship.isPickable = false;

    const nose = MeshBuilder.CreateCylinder("bow", { diameterTop: 0, diameterBottom: 7, height: 8, tessellation: 4 }, scene);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 13;
    nose.parent = ship;
    nose.material = hullMaterial;
    nose.isPickable = false;

    for (const side of [-1, 1]) {
      const fin = MeshBuilder.CreateBox("maneuvering-fin", { width: 7, height: 0.65, depth: 5.5 }, scene);
      fin.position.set(side * 5.3, 0, -4);
      fin.parent = ship;
      fin.material = hullMaterial;
      fin.isPickable = false;
    }

    const engineMaterial = new StandardMaterial("engine-glow", scene);
    engineMaterial.emissiveColor = new Color3(0.2, 0.75, 1);
    const engineCore = MeshBuilder.CreateBox("engine-exhaust", { width: 5, height: 1.6, depth: 0.4 }, scene);
    engineCore.position.z = -9.2;
    engineCore.parent = ship;
    engineCore.material = engineMaterial;
    engineCore.isPickable = false;
    const plumes = attachEngineEffects(scene, ship);
    const nav = createNavigationVisuals(scene);

    const pickObserver = scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== PointerEventTypes.POINTERPICK || !propsRef.current.showHeadingSphere) return;
      const hit = nav.pickHeading(scene.pointerX, scene.pointerY);
      if (hit) propsRef.current.onHeadingPicked(hit);
    }, PointerEventTypes.POINTERPICK);

    engine.runRenderLoop(() => {
      chooseCamera();
      const pose = interpolatedPose(samplesRef.current, performance.now() - INTERPOLATION_DELAY_MS);
      const latest = latestRef.current;
      if (pose && latest) {
        ship.position.copyFrom(pose.position);
        ship.rotationQuaternion?.copyFrom(pose.orientation);
        const frameDt = Math.min(engine.getDeltaTime() / 1000, 0.05);
        const follow = 1 - Math.exp(-10 * frameDt);
        orbit.target = Vector3.Lerp(orbit.target, pose.position, follow);
        tactical.target = Vector3.Lerp(tactical.target, pose.position, follow);
        const q = {
          x: pose.orientation.x, y: pose.orientation.y,
          z: pose.orientation.z, w: pose.orientation.w
        };
        const offset = toVector(rotateVector(q, vec3(0, 20, -80)));
        chase.position = Vector3.Lerp(chase.position, pose.position.add(offset), follow);
        chase.upVector.copyFrom(toVector(rotateVector(q, vec3(0, 1, 0))));
        const lookAhead = toVector(rotateVector(q, vec3(0, 0, 60)));
        chase.setTarget(pose.position.add(lookAhead));
        nav.update(pose, latest.ship, latest.tick, {
          sphere: propsRef.current.showHeadingSphere,
          aids: propsRef.current.showNavigationAids,
          selected: propsRef.current.selectedHeading
        });
        plumes.update(latest.ship.acceleration, performance.now() / 1000);
      }
      scene.render();
    });

    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (pickObserver) scene.onPointerObservable.remove(pickObserver);
      scene.dispose();
      engine.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="scene" aria-label="3D navigation and ship view" />;
}
