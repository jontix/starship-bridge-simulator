import { useEffect, useRef } from "react";
import {
  ArcRotateCamera, Color3, Engine, FreeCamera, MeshBuilder,
  PointerEventTypes, Quaternion, Scene, StandardMaterial, Vector3
} from "@babylonjs/core";
import {
  apparentBodyGeometry, bodyPositionAt, choosePlanetFocus, computeFloatingOrigin, getStarSystem,
  normalize, rotateVector, scale, shipPositionFromSnapshot, sub, vec3,
  type GameSnapshot, type Quat
} from "@bridge-sim/shared";
import {
  attachEngineEffects, createNavigationVisuals,
  type PickedHeading, type SelectedHeading
} from "./navigationVisuals";
import { createReferenceStation } from "./celestialScene";
import { createPlanetaryBackground } from "./planetaryScene";
import { createSpaceLighting, upgradeShipAppearance } from "./shipLighting";

export type CameraMode = "orbit" | "chase" | "tactical" | "sector" | "planet";
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
    orientation: Quaternion.Slerp(toQuaternion(before.snapshot.ship.orientation), toQuaternion(after.snapshot.ship.orientation), fraction),
    cruisePosition: Vector3.Lerp(
      toVector(before.snapshot.cruise.positionSystemMeters),
      toVector(after.snapshot.cruise.positionSystemMeters), fraction
    ),
    epochSeconds: before.snapshot.universe.epochSeconds +
      (after.snapshot.universe.epochSeconds - before.snapshot.universe.epochSeconds) * fraction
  };
}

type MainSceneProps = {
  snapshot: GameSnapshot | null;
  mode: CameraMode;
  showHeadingSphere: boolean;
  showNavigationAids: boolean;
  selectedHeading: SelectedHeading;
  onHeadingPicked: (heading: PickedHeading) => void;
  planetFocusId: string;
  opticalZoom: number;
};

export function MainScene({
  snapshot, mode, showHeadingSphere, showNavigationAids,
  selectedHeading, onHeadingPicked, planetFocusId, opticalZoom
}: MainSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const samplesRef = useRef<Sample[]>([]);
  const latestRef = useRef(snapshot);
  latestRef.current = snapshot;
  const propsRef = useRef({
    mode, showHeadingSphere, showNavigationAids, selectedHeading, onHeadingPicked, planetFocusId, opticalZoom
  });
  propsRef.current = { mode, showHeadingSphere, showNavigationAids, selectedHeading, onHeadingPicked, planetFocusId, opticalZoom };

  useEffect(() => {
    if (!snapshot) { samplesRef.current = []; return; }
    const samples = samplesRef.current;
    const previous = samples.at(-1)?.snapshot;
    // Impulse frames are intentionally local; a drop from cruise establishes a
    // new local origin. Never interpolate old-frame and new-frame coordinates.
    if (previous && (previous.universe.referenceBodyId !== snapshot.universe.referenceBodyId ||
      previous.cruise.mode === "local" !== (snapshot.cruise.mode === "local"))) {
      samplesRef.current = [];
    }
    const currentSamples = samplesRef.current;
    if (currentSamples.length > 0 && snapshot.tick <= currentSamples[currentSamples.length - 1].snapshot.tick) return;
    currentSamples.push({ snapshot, receivedAt: performance.now() });
    if (currentSamples.length > 12) currentSamples.splice(0, currentSamples.length - 12);
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    const planetarySky = createPlanetaryBackground(engine);
    // Sky first, then clear depth (but NOT colour) before rendering local
    // ship/station geometry: a projection proxy planet cannot clip a station.
    scene.autoClear = false;
    scene.autoClearDepthAndStencil = true;
    scene.clearColor.set(0.008, 0.011, 0.024, 1);
    const orbit = new ArcRotateCamera("orbit", -Math.PI / 4, Math.PI / 2.75, 78, Vector3.Zero(), scene);
    const tactical = new ArcRotateCamera("tactical", -Math.PI / 4, 0.47, 245, Vector3.Zero(), scene);
    const sector = new ArcRotateCamera("sector", -Math.PI / 4, Math.PI / 2.8, 560, Vector3.Zero(), scene);
    const chase = new FreeCamera("chase", new Vector3(0, 20, -85), scene);
    const planetCamera = new FreeCamera("planet-orbital-view", new Vector3(0, 30, -145), scene);
    orbit.lowerRadiusLimit = 62;
    orbit.upperRadiusLimit = 650;
    tactical.lowerRadiusLimit = 80;
    tactical.upperRadiusLimit = 900;
    sector.lowerRadiusLimit = 140;
    sector.upperRadiusLimit = 1500;
    for (const camera of [orbit, tactical, sector, chase, planetCamera]) camera.maxZ = 12000;

    let selectedCamera: CameraMode | null = null;
    let spherePreviouslyVisible = false;
    const chooseCamera = () => {
      const wanted = propsRef.current.mode;
      if (selectedCamera !== wanted) {
        scene.activeCamera?.detachControl();
        selectedCamera = wanted;
        scene.activeCamera = wanted === "chase" ? chase :
          wanted === "planet" ? planetCamera :
          wanted === "tactical" ? tactical : wanted === "sector" ? sector : orbit;
        if (wanted !== "chase" && wanted !== "planet") scene.activeCamera.attachControl(canvas, true);
      }
      if (propsRef.current.showHeadingSphere !== spherePreviouslyVisible) {
        spherePreviouslyVisible = propsRef.current.showHeadingSphere;
        // Open the globe at a useful scale without locking away subsequent manual zoom.
        orbit.radius = spherePreviouslyVisible ? Math.max(orbit.radius, 135) : Math.min(orbit.radius, 82);
      }
    };

    const illumination = createSpaceLighting(scene);
    const ship = MeshBuilder.CreateBox("ship-hull", { width: 8, height: 3, depth: 18 }, scene);
    ship.rotationQuaternion = Quaternion.Identity();
    const hullMaterial = upgradeShipAppearance(scene, ship);
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
    const orbitalStation = createReferenceStation(scene);
    // Stylised ship-relative star streaks, only a visual feedback cue for
    // effective cruise velocity (not literal nearby stars or 3D travel distance).
    let rng = 423143;
    const random = () => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng / 0x100000000;
    };
    const streakSegments = Array.from({ length: 180 }, () => {
      const x = (random() - 0.5) * 160;
      const y = (random() - 0.5) * 120;
      const z = (random() - 0.5) * 450;
      return [new Vector3(x, y, z), new Vector3(x, y, z + 18)];
    });
    const streaks = MeshBuilder.CreateLineSystem("superluminal-drive-streaks", {
      lines: streakSegments
    }, scene);
    streaks.parent = ship;
    streaks.color = new Color3(0.22, 0.85, 1);
    streaks.alpha = 0.63;
    streaks.isPickable = false;
    // The physics remains in stable double-valued local metres, but Babylon gets
    // rebased coordinates within about 1km of the camera to preserve GPU precision.
    const renderOrigin = Vector3.Zero();
    let lastRenderFrameKey = "";

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
        // Planet directions must interpolate the astronomical cruise position,
        // not step at the server's 15 Hz snapshot rate. Keep these visual
        // samples separate from authoritative movement or Helm controls.
        const visualSnapshot: GameSnapshot = {
          ...latest,
          universe: { ...latest.universe, epochSeconds: pose.epochSeconds },
          ship: {
            ...latest.ship,
            position: { x: pose.position.x, y: pose.position.y, z: pose.position.z }
          },
          cruise: {
            ...latest.cruise,
            positionSystemMeters: {
              x: pose.cruisePosition.x, y: pose.cruisePosition.y, z: pose.cruisePosition.z
            }
          }
        };
        const frameKey = latest.universe.referenceBodyId + ":" +
          (latest.cruise.mode === "local" ? "local" : "cruise");
        if (frameKey !== lastRenderFrameKey) {
          lastRenderFrameKey = frameKey;
          nav.resetTrail();
          // Start the new local scene without extrapolating from an old frame.
          orbit.target.copyFrom(pose.position);
          tactical.target.copyFrom(pose.position);
          sector.target.copyFrom(pose.position);
        }
        const nearOrigin = computeFloatingOrigin({
          x: pose.position.x, y: pose.position.y, z: pose.position.z
        });
        const nextOrigin = toVector(nearOrigin);
        if (!nextOrigin.equalsWithEpsilon(renderOrigin, 0.00001)) {
          const shift = renderOrigin.subtract(nextOrigin);
          orbit.target.addInPlace(shift);
          tactical.target.addInPlace(shift);
          sector.target.addInPlace(shift);
          chase.position.addInPlace(shift);
          planetCamera.position.addInPlace(shift);
          renderOrigin.copyFrom(nextOrigin);
        }
        const renderPosition = pose.position.subtract(renderOrigin);
        ship.position.copyFrom(renderPosition);
        ship.rotationQuaternion?.copyFrom(pose.orientation);
        const frameDt = Math.min(engine.getDeltaTime() / 1000, 0.05);
        const follow = 1 - Math.exp(-10 * frameDt);
        orbit.target = Vector3.Lerp(orbit.target, renderPosition, follow);
        tactical.target = Vector3.Lerp(tactical.target, renderPosition, follow);
        sector.target = Vector3.Lerp(sector.target, renderPosition, follow);
        const q = {
          x: pose.orientation.x, y: pose.orientation.y,
          z: pose.orientation.z, w: pose.orientation.w
        };
        const offset = toVector(rotateVector(q, vec3(0, 20, -80)));
        chase.position = Vector3.Lerp(chase.position, renderPosition.add(offset), follow);
        chase.upVector.copyFrom(toVector(rotateVector(q, vec3(0, 1, 0))));
        const lookAhead = toVector(rotateVector(q, vec3(0, 0, 60)));
        chase.setTarget(renderPosition.add(lookAhead));
        const liveSystem = getStarSystem(latest.universe.systemId);
        const focusedWorld = choosePlanetFocus(
          liveSystem, latest.universe.referenceBodyId, latest.cruise.targetId,
          propsRef.current.planetFocusId
        );
        const absoluteShip = shipPositionFromSnapshot(liveSystem, visualSnapshot);
        const starId = liveSystem.bodies.find(body => body.kind === "star")?.id;
        const starPosition = starId
          ? bodyPositionAt(liveSystem, starId, visualSnapshot.universe.epochSeconds)
          : { x: 0, y: 0, z: 0 };
        const bodySystemPosition = bodyPositionAt(
          liveSystem, focusedWorld.id, visualSnapshot.universe.epochSeconds
        );
        illumination.update(
          absoluteShip, starPosition, bodySystemPosition, focusedWorld.radiusMeters
        );
        const focusDirection = normalize(sub(bodySystemPosition, absoluteShip));
        // In low orbit the planet subtends >100 degrees: aim near the limb
        // rather than the centre to keep a curved horizon in the frame.
        const angularRadius = apparentBodyGeometry(
          focusedWorld.radiusMeters, bodySystemPosition, absoluteShip
        ).apparentAngularRadiusRadians;
        const planetUnit = toVector(focusDirection);
        const up = Vector3.Up().subtract(planetUnit.scale(Vector3.Dot(planetUnit, Vector3.Up())));
        if (up.lengthSquared() < 0.001) up.copyFrom(Vector3.Right());
        up.normalize();
        const isTelescope = propsRef.current.mode === "planet" && propsRef.current.opticalZoom >= 4;
        // Telescope targets the resolved surface/disc itself. At 1x, frame the
        // limb and ship together for a cinematic but still accurate panorama.
        const framingOffset = isTelescope ? 0 :
          Math.max(0, Math.min(1.43, angularRadius - 0.17));
        const planetAimDirection = planetUnit.scale(Math.cos(framingOffset))
          .add(up.scale(Math.sin(framingOffset))).normalize();
        // Position the camera *behind this aim direction*, not behind the
        // ship's nose. Otherwise the ship often falls outside the field of
        // view when a planet's limb is far off the ship-forward axis.
        const cameraArm = planetAimDirection.scale(-190)
          .add(toVector(rotateVector(q, vec3(35, 22, 0))));
        planetCamera.position = Vector3.Lerp(
          planetCamera.position, renderPosition.add(cameraArm), follow
        );
        planetCamera.setTarget(renderPosition.add(planetAimDirection.scale(10_000)));
        // Physical planet radius, range and angular diameter never change.
        // Magnification narrows the *optical field of view*; when telescopic,
        // hide local ship/station silhouettes to simulate a dedicated sensor.
        planetCamera.fov = 0.8 / Math.max(1, propsRef.current.opticalZoom);
        ship.setEnabled(!isTelescope);
        const local = latest.cruise.mode === "local";
        nav.update(pose, latest.ship, latest.tick, renderOrigin, {
          sphere: local && !isTelescope && propsRef.current.showHeadingSphere,
          aids: local && !isTelescope && propsRef.current.showNavigationAids && propsRef.current.mode !== "planet",
          selected: propsRef.current.selectedHeading
        });
        plumes.update(latest.ship.acceleration, performance.now() / 1000);
        orbitalStation.update(
          getStarSystem(latest.universe.systemId), latest.universe.referenceBodyId,
          latest.universe.frameOffsetMeters, renderOrigin, local && !isTelescope
        );
        const activeCamera = scene.activeCamera!;
        const cameraOffset = activeCamera.globalPosition.subtract(renderPosition);
        planetarySky.update(
          visualSnapshot, activeCamera, { x: cameraOffset.x, y: cameraOffset.y, z: cameraOffset.z },
          propsRef.current.planetFocusId, engine.getRenderHeight(),
          propsRef.current.showNavigationAids
        );
        const cruiseSpeed = latest.cruise.speedMetersPerSecond;
        streaks.setEnabled(!local && cruiseSpeed > 5_000);
        if (!local && cruiseSpeed > 5_000) {
          streaks.scaling.z = 0.4 + Math.min(5, cruiseSpeed / 180_000_000);
          streaks.position.z = ((performance.now() / 12) % 450) - 225;
        }
      }
      planetarySky.render();
      scene.render();
    });

    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (pickObserver) scene.onPointerObservable.remove(pickObserver);
      scene.dispose();
      planetarySky.dispose();
      engine.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="scene" aria-label="3D navigation and ship view" />;
}
