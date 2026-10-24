import React, { useEffect, useRef } from "react";
import { ArcRotateCamera, Color3, Engine, HemisphericLight, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { GameSnapshot } from "@bridge-sim/shared";
export function MainScene({ snapshot }: { snapshot: GameSnapshot | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotRef = useRef<GameSnapshot | null>(snapshot);
  snapshotRef.current = snapshot;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor.set(0.01, 0.012, 0.02, 1);
    const camera = new ArcRotateCamera("camera", Math.PI / 4, Math.PI / 3, 180, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 20;
    new HemisphericLight("light", new Vector3(0, 1, 0), scene).intensity = 0.8;
    const ship = MeshBuilder.CreateBox("ship", { width: 8, height: 3, depth: 18 }, scene);
    const mat = new StandardMaterial("ship-mat", scene);
    mat.diffuseColor = new Color3(0.5, 0.7, 1);
    ship.material = mat;
    const nose = MeshBuilder.CreateCylinder("nose", { diameterTop: 0, diameterBottom: 7, height: 7, tessellation: 4 }, scene);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 12;
    nose.material = mat;
    nose.parent = ship;
    const grid = MeshBuilder.CreateGround("grid", { width: 1000, height: 1000, subdivisions: 20 }, scene);
    const gridMat = new StandardMaterial("grid-mat", scene);
    gridMat.diffuseColor = new Color3(0.08, 0.1, 0.15);
    gridMat.alpha = 0.25;
    grid.material = gridMat;
    grid.position.y = -20;
    engine.runRenderLoop(() => {
      const latest = snapshotRef.current;
      if (latest) {
        const { position, yaw, pitch, roll } = latest.ship;
        ship.position.set(position.x, position.y, position.z);
        ship.rotation.set(pitch, yaw, roll);
        camera.target = Vector3.Lerp(camera.target, ship.position, 0.04);
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
