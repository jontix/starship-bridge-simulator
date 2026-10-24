import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { Room } from "colyseus.js";
import { attitudeFromQuat, length, type GameSnapshot } from "@bridge-sim/shared";
import type { CameraMode } from "./scene";
import { CruisePanel } from "./CruisePanel";
import { PlanetViewControls } from "./PlanetReadout";
import type { SelectedHeading } from "./navigationVisuals";
import { BeaconList, CameraSelector, Control, degrees, driftAngle, number, Telemetry, toRadians } from "./navigationUI";

type HelmPanelProps = {
  room: Room | null;
  snapshot: GameSnapshot | null;
  cruiseNotice: string;
  heading: SelectedHeading;
  setHeading: Dispatch<SetStateAction<SelectedHeading>>;
  showSphere: boolean;
  toggleSphere: () => void;
  showAids: boolean;
  toggleAids: () => void;
  mode: CameraMode;
  setMode: (mode: CameraMode) => void;
  planetFocusId: string;
  setPlanetFocusId: (id: string) => void;
};

export function HelmPanel({
  room, snapshot, cruiseNotice, heading, setHeading,
  showSphere, toggleSphere, showAids, toggleAids, mode, setMode,
  planetFocusId, setPlanetFocusId
}: HelmPanelProps) {
  const [speed, setSpeed] = useState(0);
  const [strafe, setStrafe] = useState(0);
  const [lift, setLift] = useState(0);
  const ship = snapshot?.ship;
  const impulseEnabled = Boolean(room && snapshot?.cruise.mode === "local");
  const actual = useMemo(() => ship ? attitudeFromQuat(ship.orientation) : null, [ship]);
  const send = (command: unknown) => room?.send("helm_command", command);
  const committed = ship
    ? [ship.desiredYaw, ship.desiredPitch, ship.desiredRoll].every((value, index) =>
        Math.abs(value * 180 / Math.PI - [heading.yaw, heading.pitch, heading.roll][index]) < 0.6)
    : false;

  return (
    <section className="panel helm-panel">
      <div className="panel-heading">
        <h2>Helm</h2>
        <span className="state-pill">{snapshot?.cruise.mode !== "local" ? "CRUISE DRIVE" : ship?.emergencyStopping ? "EMERGENCY BRAKE" : "FLIGHT ASSIST"}</span>
      </div>
      <CruisePanel room={room} snapshot={snapshot} notice={cruiseNotice}/>
      {snapshot?.cruise.mode !== "local" && <p className="cruise-impulse-lock">Impulse commands are suspended while the cruise drive is engaged.</p>}
      <h3>Navigation display</h3>
      <div className="toolbar-buttons">
        <button className={showSphere ? "active" : ""} aria-pressed={showSphere} onClick={toggleSphere}>
          {showSphere ? "Hide heading sphere" : "Show heading sphere"} <kbd>H</kbd>
        </button>
        <button className={showAids ? "active" : ""} aria-pressed={showAids} onClick={toggleAids}>
          {showAids ? "Hide nav aids" : "Show nav aids"}
        </button>
      </div>
      <CameraSelector mode={mode} setMode={setMode} />
      <PlanetViewControls snapshot={snapshot} focusId={planetFocusId} setFocusId={setPlanetFocusId}/>
      <p className="subtle instruction">
        Click the world-aligned sphere to choose a heading. Set attitude sends it to the ship.
        Roll remains independently controlled.
      </p>
      <div className="selected-bearing">
        <span>Selected world heading</span>
        <strong>{heading.yaw}° bearing / {heading.pitch}° elevation</strong>
        <small>{committed ? "Matches current order" : "Pending · not sent to ship"}</small>
      </div>

      <h3>Attitude control</h3>
      <Control label="Yaw / bearing" value={heading.yaw} set={yaw => setHeading(previous => ({ ...previous, yaw }))} min={-180} max={180} unit="°" />
      <Control label="Pitch / elevation" value={heading.pitch} set={pitch => setHeading(previous => ({ ...previous, pitch }))} min={-90} max={90} unit="°" />
      <Control label="Roll" value={heading.roll} set={roll => setHeading(previous => ({ ...previous, roll }))} min={-180} max={180} unit="°" />
      <button className="engage" disabled={!impulseEnabled} onClick={() => send({
        type: "set_heading",
        yaw: toRadians(heading.yaw), pitch: toRadians(heading.pitch), roll: toRadians(heading.roll)
      })}>Set attitude · engage heading</button>

      <h3>Translation control</h3>
      <Control label="Forward speed" value={speed} set={setSpeed} min={0} max={300} unit=" m/s" />
      <button disabled={!room} onClick={() => send({ type: "set_speed", speed })}>Set forward speed</button>
      <Control label="Strafe (+ starboard)" value={strafe} set={setStrafe} min={-60} max={60} unit=" m/s" />
      <Control label="Lift (+ dorsal)" value={lift} set={setLift} min={-60} max={60} unit=" m/s" />
      <button disabled={!room} onClick={() => send({ type: "set_translation", strafe, lift })}>Set lateral / vertical</button>
      <button className="danger" disabled={!room} onClick={() => {
        send({ type: "emergency_stop" });
        setSpeed(0);
        setStrafe(0);
        setLift(0);
      }}>Emergency stop</button>

      <h3>Actual vs ordered attitude</h3>
      <div className="telemetry-table">
        <span>Axis</span><span>Actual</span><span>Ordered</span>
        <span>Yaw</span><strong>{actual ? degrees(actual.yaw) : "—"}°</strong><span>{ship ? degrees(ship.desiredYaw) : "—"}°</span>
        <span>Pitch</span><strong>{actual ? degrees(actual.pitch) : "—"}°</strong><span>{ship ? degrees(ship.desiredPitch) : "—"}°</span>
        <span>Roll</span><strong>{actual ? degrees(actual.roll) : "—"}°</strong><span>{ship ? degrees(ship.desiredRoll) : "—"}°</span>
      </div>
      <h3>Velocity and drift</h3>
      <div className="telemetry-grid">
        <Telemetry label="World speed" value={ship && snapshot?.cruise.mode === "local" ? number(length(ship.velocity)) + " m/s" : "Suspended"} />
        <Telemetry label="Off-axis drift" value={ship ? driftAngle(ship) : "—"} />
        <Telemetry label="Acceleration" value={ship ? number(length(ship.acceleration)) + " m/s²" : "—"} />
        <Telemetry label="Angular rate" value={ship ? degrees(length(ship.angularVelocity)) + " °/s" : "—"} />
      </div>
      <h3>Navigation references</h3>
      <BeaconList snapshot={snapshot} />
      <p className="subtle">Position (m): {ship
        ? [ship.position.x, ship.position.y, ship.position.z].map(value => number(value, 0)).join(" / ")
        : "—"}</p>
    </section>
  );
}
