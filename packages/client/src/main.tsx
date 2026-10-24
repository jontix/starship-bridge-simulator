import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Client, type Room } from "colyseus.js";
import { attitudeFromQuat, length, type GameSnapshot, type PlayerRole } from "@bridge-sim/shared";
import { MainScene, type CameraMode } from "./scene";
import "./styles.css";

const serverUrl = import.meta.env.VITE_SERVER_URL ?? `ws://${window.location.hostname}:2567`;
const degrees = (radians: number) => (radians * 180 / Math.PI).toFixed(1);
const number = (value: number, decimals = 1) => value.toFixed(decimals);
const toRadians = (value: number) => value * Math.PI / 180;

function App() {
  const [role, setRole] = useState<PlayerRole>("main-screen");
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [room, setRoom] = useState<Room | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [status, setStatus] = useState("Connecting...");

  useEffect(() => {
    let alive = true;
    let joined: Room | null = null;
    setRoom(null);
    setSnapshot(null);
    setStatus("Connecting...");
    const client = new Client(serverUrl);
    client.joinOrCreate("bridge", { role }).then((newRoom) => {
      if (!alive) { void newRoom.leave(); return; }
      joined = newRoom;
      setRoom(newRoom);
      setStatus(`Connected · ${role === "helm" ? "Helm" : "Main Screen"}`);
      newRoom.onMessage("snapshot", (message: GameSnapshot) => {
        if (alive) setSnapshot(message);
      });
      newRoom.onLeave(() => {
        if (alive) { setRoom(null); setStatus("Disconnected"); }
      });
    }).catch((error) => {
      console.error("Could not join bridge room", error);
      if (alive) setStatus("Could not connect to server");
    });
    return () => {
      alive = false;
      if (joined) void joined.leave();
    };
  }, [role]);

  return (
    <div className="app">
      <header>
        <strong>STARSHIP / BRIDGE</strong>
        <span className="connection-status">{status}</span>
        <label className="role-select">
          Station
          <select value={role} onChange={(event) => setRole(event.target.value as PlayerRole)}>
            <option value="main-screen">Main Screen</option>
            <option value="helm">Helm</option>
          </select>
        </label>
      </header>
      <main>
        <MainScene snapshot={snapshot} mode={cameraMode} />
        {role === "helm" ? <HelmPanel room={room} snapshot={snapshot} /> : <MainScreenPanel snapshot={snapshot} mode={cameraMode} setMode={setCameraMode} />}
        <div className="scene-caption">6DOF FLIGHT MODEL V1 · SERVER AUTHORITATIVE · 30 Hz</div>
      </main>
    </div>
  );
}

function HelmPanel({ room, snapshot }: { room: Room | null; snapshot: GameSnapshot | null }) {
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [roll, setRoll] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [strafe, setStrafe] = useState(0);
  const [lift, setLift] = useState(0);
  const ship = snapshot?.ship;
  const actual = useMemo(() => ship ? attitudeFromQuat(ship.orientation) : null, [ship]);
  const send = (command: unknown) => room?.send("helm_command", command);

  return (
    <section className="panel helm-panel">
      <div className="panel-heading"><h2>Helm</h2><span className="state-pill">{ship?.emergencyStopping ? "EMERGENCY BRAKE" : "FLIGHT ASSIST"}</span></div>
      <h3>Attitude control</h3>
      <Control label="Yaw / bearing" value={yaw} set={setYaw} min={-180} max={180} unit="°" />
      <Control label="Pitch" value={pitch} set={setPitch} min={-90} max={90} unit="°" />
      <Control label="Roll" value={roll} set={setRoll} min={-180} max={180} unit="°" />
      <button disabled={!room} onClick={() => send({ type: "set_heading", yaw: toRadians(yaw), pitch: toRadians(pitch), roll: toRadians(roll) })}>Set attitude</button>
      <h3>Translation control</h3>
      <Control label="Forward speed" value={speed} set={setSpeed} min={0} max={300} unit=" m/s" />
      <button disabled={!room} onClick={() => send({ type: "set_speed", speed })}>Set forward speed</button>
      <Control label="Strafe (+ starboard)" value={strafe} set={setStrafe} min={-60} max={60} unit=" m/s" />
      <Control label="Lift (+ dorsal)" value={lift} set={setLift} min={-60} max={60} unit=" m/s" />
      <button disabled={!room} onClick={() => send({ type: "set_translation", strafe, lift })}>Set lateral / vertical</button>
      <button className="danger" disabled={!room} onClick={() => { send({ type: "emergency_stop" }); setSpeed(0); setStrafe(0); setLift(0); }}>Emergency stop</button>
      <h3>Actual vs ordered attitude</h3>
      <div className="telemetry-table">
        <span>Axis</span><span>Actual</span><span>Ordered</span>
        <span>Yaw</span><strong>{actual ? degrees(actual.yaw) : "—"}°</strong><span>{ship ? degrees(ship.desiredYaw) : "—"}°</span>
        <span>Pitch</span><strong>{actual ? degrees(actual.pitch) : "—"}°</strong><span>{ship ? degrees(ship.desiredPitch) : "—"}°</span>
        <span>Roll</span><strong>{actual ? degrees(actual.roll) : "—"}°</strong><span>{ship ? degrees(ship.desiredRoll) : "—"}°</span>
      </div>
      <h3>Ship telemetry</h3>
      <div className="telemetry-grid">
        <Telemetry label="Speed" value={ship ? `${number(length(ship.velocity))} m/s` : "—"} />
        <Telemetry label="Acceleration" value={ship ? `${number(length(ship.acceleration))} m/s²` : "—"} />
        <Telemetry label="Angular rate" value={ship ? `${degrees(length(ship.angularVelocity))} °/s` : "—"} />
        <Telemetry label="Tick" value={snapshot ? String(snapshot.tick) : "—"} />
      </div>
      <p className="subtle">Position (m): {ship ? [ship.position.x, ship.position.y, ship.position.z].map(v => number(v, 0)).join(" / ") : "—"}</p>
    </section>
  );
}

function Control({ label, value, set, min, max, unit }: { label: string; value: number; set: (v: number) => void; min: number; max: number; unit: string }) {
  return <label className="control-label">
    <span>{label}<strong>{value}{unit}</strong></span>
    <input aria-label={label} type="range" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value))} />
  </label>;
}
function Telemetry({ label, value }: { label: string; value: string }) {
  return <div className="telemetry-item"><small>{label}</small><strong>{value}</strong></div>;
}
function MainScreenPanel({ snapshot, mode, setMode }: { snapshot: GameSnapshot | null; mode: CameraMode; setMode: (mode: CameraMode) => void }) {
  const ship = snapshot?.ship;
  return (
    <section className="panel main-panel">
      <h2>Main Screen</h2>
      <label className="camera-select">Camera mode
        <select value={mode} onChange={(e) => setMode(e.target.value as CameraMode)}>
          <option value="orbit">Free orbit</option>
          <option value="chase">Chase camera</option>
          <option value="tactical">Tactical overhead</option>
        </select>
      </label>
      <div className="telemetry-grid">
        <Telemetry label="Speed" value={ship ? `${number(length(ship.velocity))} m/s` : "—"} />
        <Telemetry label="Acceleration" value={ship ? `${number(length(ship.acceleration))} m/s²` : "—"} />
      </div>
      <p className="subtle">Orbit / tactical: drag to rotate and scroll to zoom.</p>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
