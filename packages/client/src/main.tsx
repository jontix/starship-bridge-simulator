import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Client, Room } from "colyseus.js";
import type { GameSnapshot, PlayerRole } from "@bridge-sim/shared";
import { MainScene } from "./scene";
import "./styles.css";
const serverUrl = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
function App() {
  const [role, setRole] = useState<PlayerRole>("main-screen");
  const [room, setRoom] = useState<Room | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [status, setStatus] = useState("Disconnected");
  useEffect(() => {
    let active = true;
    const client = new Client(serverUrl);
    setStatus("Connecting...");
    client.joinOrCreate("bridge", { role }).then((joinedRoom) => {
      if (!active) { joinedRoom.leave(); return; }
      setRoom(joinedRoom);
      setStatus(`Connected as ${role}`);
      joinedRoom.send("role", role);
      joinedRoom.onMessage("snapshot", (message: GameSnapshot) => setSnapshot(message));
      joinedRoom.onLeave(() => setStatus("Disconnected"));
    }).catch((error) => {
      console.error(error);
      setStatus("Could not connect to server");
    });
    return () => {
      active = false;
      setRoom((current) => { current?.leave(); return null; });
    };
  }, [role]);
  return (
    <div className="app">
      <header>
        <strong>Bridge Sim Prototype</strong>
        <span>{status}</span>
        <select value={role} onChange={(event) => setRole(event.target.value as PlayerRole)}>
          <option value="main-screen">Main Screen</option>
          <option value="helm">Helm</option>
        </select>
      </header>
      <main>
        <MainScene snapshot={snapshot} />
        {role === "helm" && room && <HelmPanel room={room} snapshot={snapshot} />}
        {role === "main-screen" && <MainScreenOverlay snapshot={snapshot} />}
      </main>
    </div>
  );
}
function HelmPanel({ room, snapshot }: { room: Room; snapshot: GameSnapshot | null }) {
  const [yawDeg, setYawDeg] = useState(0);
  const [pitchDeg, setPitchDeg] = useState(0);
  const [speed, setSpeed] = useState(0);
  const sendHeading = () => {
    room.send("helm_command", { type: "set_heading", yaw: yawDeg * Math.PI / 180, pitch: pitchDeg * Math.PI / 180, roll: 0 });
  };
  const sendSpeed = () => {
    room.send("helm_command", { type: "set_speed", speed });
  };
  return (
    <section className="panel helm-panel">
      <h2>Helm</h2>
      <label>Yaw / bearing: {yawDeg}°</label>
      <input type="range" min="-180" max="180" value={yawDeg} onChange={(e) => setYawDeg(Number(e.target.value))} />
      <label>Pitch: {pitchDeg}°</label>
      <input type="range" min="-60" max="60" value={pitchDeg} onChange={(e) => setPitchDeg(Number(e.target.value))} />
      <button onClick={sendHeading}>Set Heading</button>
      <label>Speed: {speed} m/s</label>
      <input type="range" min="0" max="300" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
      <button onClick={sendSpeed}>Set Speed</button>
      <button className="danger" onClick={() => room.send("helm_command", { type: "emergency_stop" })}>Emergency Stop</button>
      <pre>{snapshot ? JSON.stringify({ position: snapshot.ship.position, velocity: snapshot.ship.velocity }, null, 2) : "Awaiting telemetry..."}</pre>
    </section>
  );
}
function MainScreenOverlay({ snapshot }: { snapshot: GameSnapshot | null }) {
  return (
    <section className="panel readout">
      <h2>Main Screen</h2>
      <p>External tactical view</p>
      <p>Speed: {snapshot ? Math.hypot(snapshot.ship.velocity.x, snapshot.ship.velocity.y, snapshot.ship.velocity.z).toFixed(1) : "—"} m/s</p>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
