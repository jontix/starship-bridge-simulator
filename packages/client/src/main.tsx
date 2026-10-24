import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Client, type Room } from "colyseus.js";
import type { GameSnapshot, PlayerRole } from "@bridge-sim/shared";
import { MainScene, type CameraMode } from "./scene";
import { HelmPanel } from "./HelmPanel";
import { MainScreenPanel } from "./MainScreenPanel";
import type { PickedHeading, SelectedHeading } from "./navigationVisuals";
import "./styles.css";

const serverUrl = import.meta.env.VITE_SERVER_URL ?? `ws://${window.location.hostname}:2567`;

function App() {
  const [role, setRole] = useState<PlayerRole>("main-screen");
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [room, setRoom] = useState<Room | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [status, setStatus] = useState("Connecting...");
  const [showHeadingSphere, setShowHeadingSphere] = useState(false);
  const [showNavigationAids, setShowNavigationAids] = useState(true);
  const [selectedHeading, setSelectedHeading] = useState<SelectedHeading>({ yaw: 0, pitch: 0, roll: 0 });

  // A sphere click previews a new world heading; Helm must explicitly engage it.
  const pickHeading = useCallback(({ yaw, pitch }: PickedHeading) => {
    setSelectedHeading(previous => ({
      ...previous,
      yaw: Math.round(yaw * 180 / Math.PI),
      pitch: Math.round(pitch * 180 / Math.PI)
    }));
  }, []);

  useEffect(() => {
    if (role !== "helm") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "h" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const focused = event.target;
      if (focused instanceof HTMLElement && focused.closest("input,select,textarea,[contenteditable='true']")) return;
      event.preventDefault();
      setShowHeadingSphere(value => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [role]);

  useEffect(() => {
    let alive = true;
    let joined: Room | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    setRoom(null);
    setSnapshot(null);
    const client = new Client(serverUrl);

    const retry = () => {
      if (!alive) return;
      attempts++;
      const delayMs = Math.min(5000, 1000 * 2 ** Math.min(attempts - 1, 3));
      setStatus(`Server unavailable · retry in ${delayMs / 1000}s (${serverUrl})`);
      reconnectTimer = setTimeout(() => { void connect(); }, delayMs);
    };

    const connect = async () => {
      if (!alive) return;
      setStatus(`Connecting to ${serverUrl}...`);
      try {
        const newRoom = await client.joinOrCreate("bridge", { role });
        if (!alive) { void newRoom.leave(); return; }
        joined = newRoom;
        attempts = 0;
        setRoom(newRoom);
        setStatus(`Connected · ${role === "helm" ? "Helm" : "Main Screen"}`);
        newRoom.onMessage("snapshot", (message: GameSnapshot) => {
          if (alive) setSnapshot(message);
        });
        newRoom.onLeave(() => {
          if (!alive) return;
          joined = null;
          setRoom(null);
          setSnapshot(null);
          retry();
        });
        newRoom.onError((code, message) => {
          if (alive) console.error("Bridge room error", code, message);
        });
      } catch (error) {
        if (!alive) return;
        console.warn("Could not join bridge room", serverUrl, error);
        retry();
      }
    };

    void connect();
    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
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
        <MainScene
          snapshot={snapshot}
          mode={cameraMode}
          showHeadingSphere={role === "helm" && showHeadingSphere}
          showNavigationAids={showNavigationAids}
          selectedHeading={selectedHeading}
          onHeadingPicked={pickHeading}
        />
        {role === "helm" ? (
          <HelmPanel
            room={room}
            snapshot={snapshot}
            heading={selectedHeading}
            setHeading={setSelectedHeading}
            showSphere={showHeadingSphere}
            toggleSphere={() => setShowHeadingSphere(value => !value)}
            showAids={showNavigationAids}
            toggleAids={() => setShowNavigationAids(value => !value)}
            mode={cameraMode}
            setMode={setCameraMode}
          />
        ) : (
          <MainScreenPanel
            snapshot={snapshot}
            mode={cameraMode}
            setMode={setCameraMode}
            showAids={showNavigationAids}
            toggleAids={() => setShowNavigationAids(value => !value)}
          />
        )}
        <div className="scene-caption">NAVIGATION TRAINING · 6DOF · WORLD +Y UP · 30 Hz SERVER</div>
        {role === "helm" && showHeadingSphere && (
          <div className="nav-legend" aria-label="Heading sphere legend">
            <strong>WORLD HEADING SPHERE</strong>
            <span><i className="swatch preview" /> Cyan · selected (not sent)</span>
            <span><i className="swatch ordered" /> Amber · ordered heading</span>
            <span><i className="swatch bow" /> White · actual bow</span>
            <span><i className="swatch velocity" /> Green · velocity vector</span>
            <small>Drag to orbit · click sphere to select · Set attitude to engage</small>
          </div>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
