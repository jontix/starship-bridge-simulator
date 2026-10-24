import { useEffect, useRef } from "react";
import {
  ArcRotateCamera, Color3, Engine, FreeCamera, HemisphericLight,
  MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3
} from "@babylonjs/core";
import { rotateVector, vec3, type GameSnapshot, type Quat } from "@bridge-sim/shared";

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
  const position = Vector3.Lerp(toVector(before.snapshot.ship.position), toVector(after.snapshot.ship.position), fraction);
  const orientation = Quaternion.Slerp(toQuaternion(before.snapshot.ship.orientation), toQuaternion(after.snapshot.ship.orientation), fraction);
  return { position, orientation };
}

export function MainScene({ snapshot, mode }: { snapshot: GameSnapshot | null; mode: CameraMode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const samplesRef = useRef<Sample[]>([]);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (!snapshot) { samplesRef.current = []; return; }
    const samples = samplesRef.current;
    // Ignore out-of-order packets, including the first snapshot from an old room.
    if (samples.length > 0 && snapshot.tick <= samples[samples.length - 1].snapshot.tick) return;
    samples.push({ snapshot, receivedAt: performance.now() });
    if (samples.length > 12) samples.splice(0, samples.length - 12);
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor.set(0.008, 0.012, 0.025, 1);
    const orbit = new ArcRotateCamera("orbit", -Math.PI / 4, Math.PI / 2.9, 120, Vector3.Zero(), scene);
    const tactical = new ArcRotateCamera("tactical", -Math.PI / 4, 0.45, 270, Vector3.Zero(), scene);
    const chase = new FreeCamera("chase", new Vector3(0, 25, -100), scene);
    orbit.lowerRadiusLimit = 30;
    orbit.upperRadiusLimit = 650;
    tactical.lowerRadiusLimit = 75;
    tactical.upperRadiusLimit = 800;
    for (const camera of [orbit, tactical, chase]) camera.maxZ = 8000;
    let selected: CameraMode | null = null;
    const chooseCamera = () => {
      if (selected === modeRef.current) return;
      scene.activeCamera?.detachControl();
      selected = modeRef.current;
      scene.activeCamera = selected === "chase" ? chase : selected === "tactical" ? tactical : orbit;
      if (selected !== "chase") scene.activeCamera.attachControl(canvas, true);
    };

    new HemisphericLight("ambient", new Vector3(0.4, 1, 0.2), scene).intensity = 0.85;
    const ship = MeshBuilder.CreateBox("ship-hull", { width: 8, height: 3, depth: 18 }, scene);
    ship.rotationQuaternion = Quaternion.Identity();
    const hullMaterial = new StandardMaterial("hull-material", scene);
    hullMaterial.diffuseColor = new Color3(0.45, 0.72, 1);
    ship.material = hullMaterial;
    const nose = MeshBuilder.CreateCylinder("bow", { diameterTop: 0, diameterBottom: 7, height: 8, tessellation: 4 }, scene);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 13;
    nose.parent = ship;
    nose.material = hullMaterial;
    const engineMaterial = new StandardMaterial("engine-glow", scene);
    engineMaterial.emissiveColor = new Color3(0.2, 0.75, 1);
    const engines = MeshBuilder.CreateBox("engine-exhaust", { width: 5, height: 1.6, depth: 0.4 }, scene);
    engines.position.z = -9.2;
    engines.parent = ship;
    engines.material = engineMaterial;

    const reference = MeshBuilder.CreateGround("reference-plane", { width: 1000, height: 1000, subdivisions: 24 }, scene);
    reference.position.y = -25;
    const planeMaterial = new StandardMaterial("reference-material", scene);
    planeMaterial.diffuseColor = new Color3(0.075, 0.105, 0.18);
    planeMaterial.alpha = 0.23;
    reference.material = planeMaterial;

    engine.runRenderLoop(() => {
      chooseCamera();
      const pose = interpolatedPose(samplesRef.current, performance.now() - INTERPOLATION_DELAY_MS);
      if (pose) {
        ship.position.copyFrom(pose.position);
        ship.rotationQuaternion?.copyFrom(pose.orientation);
        orbit.target = Vector3.Lerp(orbit.target, pose.position, 0.08);
        tactical.target = Vector3.Lerp(tactical.target, pose.position, 0.12);
        const q = { x: pose.orientation.x, y: pose.orientation.y, z: pose.orientation.z, w: pose.orientation.w };
        const offset = toVector(rotateVector(q, vec3(0, 24, -85)));
        chase.position = Vector3.Lerp(chase.position, pose.position.add(offset), 0.07);
        const lookAhead = toVector(rotateVector(q, vec3(0, 0, 40)));
        chase.setTarget(pose.position.add(lookAhead));
      }
      scene.render();
    });
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      engine.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="scene" />;
}
