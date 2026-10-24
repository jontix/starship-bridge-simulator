import { useState } from "react";
import type { Room } from "colyseus.js";
import {
  CRUISE_LIMITS, SPEED_OF_LIGHT_MPS, formatAstronomicalDistance,
  getStarSystem, type GameSnapshot
} from "@bridge-sim/shared";

export function formatFlightTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return Math.max(0, Math.ceil(seconds)) + " sec";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m " + Math.ceil(seconds % 60) + "s";
  return Math.floor(seconds / 3600) + "h " + Math.ceil(seconds % 3600 / 60) + "m";
}

export function CruiseReadout({ snapshot }: { snapshot: GameSnapshot | null }) {
  if (!snapshot) return <p className="subtle">Awaiting navigation computer…</p>;
  const { cruise } = snapshot;
  const system = getStarSystem(snapshot.universe.systemId);
  const target = system.bodies.find(body => body.id === cruise.targetId);
  const speedInC = cruise.speedMetersPerSecond / SPEED_OF_LIGHT_MPS;
  return (
    <div className="cruise-readout" aria-live="off">
      <div className="cruise-line"><span>Drive</span><strong>{cruise.mode.toUpperCase()}</strong></div>
      <div className="cruise-line"><span>Destination</span><strong>{target?.name ?? "Not selected"}</strong></div>
      <div className="cruise-line"><span>Effective speed</span><strong>{speedInC.toFixed(3)} c</strong></div>
      <div className="cruise-line"><span>Distance to arrival</span><strong>{cruise.remainingMeters === null ? "—" : formatAstronomicalDistance(cruise.remainingMeters)}</strong></div>
      <div className="cruise-line"><span>Estimated arrival</span><strong>{formatFlightTime(cruise.etaSeconds)}</strong></div>
      {cruise.mode === "spooling" && <div className="cruise-charge">Spooling: {cruise.spoolRemainingSeconds.toFixed(1)}s</div>}
      {(cruise.mode === "cruise" || cruise.mode === "dropping") &&
        <div className="cruise-progress-track" role="progressbar" aria-label="Cruise route progress"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(cruise.progress * 100)}>
          <div style={{ width: Math.round(cruise.progress * 100) + "%" }}/>
        </div>}
      <p className="cruise-last-event">{cruise.lastEvent}</p>
    </div>
  );
}

export function CruisePanel({
  room, snapshot, notice
}: { room: Room | null; snapshot: GameSnapshot | null; notice: string }) {
  const [selectedId, setSelectedId] = useState("selene-observatory");
  const [throttle, setThrottle] = useState(100);
  const system = snapshot ? getStarSystem(snapshot.universe.systemId) : null;
  const cruise = snapshot?.cruise;
  const cruising = cruise?.mode !== "local";
  const canControl = Boolean(room && snapshot);
  const send = (command: unknown) => room?.send("cruise_command", command);
  return (
    <section className="cruise-panel" aria-label="Interplanetary cruise navigation">
      <h3>Interplanetary cruise</h3>
      <CruiseReadout snapshot={snapshot}/>
      <label className="cruise-field">Destination
        <select value={selectedId} disabled={!canControl || cruising} onChange={event => setSelectedId(event.target.value)}>
          {system?.bodies.map(body => (
            <option key={body.id} value={body.id}>{body.name} ({body.kind})</option>
          )) ?? <option value="selene-observatory">Selene Observatory</option>}
        </select>
      </label>
      <button disabled={!canControl || cruising} onClick={() => send({ type: "set_cruise_target", targetId: selectedId })}>
        Plot destination
      </button>
      <label className="cruise-field">Drive throttle <strong>{throttle}%</strong>
        <input type="range" aria-label="Cruise drive throttle" min="10" max="100" step="5"
          value={throttle} onChange={event => setThrottle(Number(event.target.value))}/>
      </label>
      <button disabled={!canControl} onClick={() =>
        send({ type: "set_cruise_throttle", throttle: throttle / 100 })
      }>Set cruise power</button>
      <button className="engage cruise-engage" disabled={!canControl || cruising || !cruise?.targetId}
        onClick={() => send({ type: "engage_cruise" })}>
        Engage interplanetary cruise
      </button>
      <button className="danger" disabled={!canControl || cruise?.mode === "local"}
        onClick={() => send({ type: "request_drop" })}>
        {cruise?.mode === "spooling" ? "Cancel spool" : "Request safe drop"}
      </button>
      {notice && <p className="cruise-notice" role="status">{notice}</p>}
      <p className="subtle">Helm retains command authority. Cruise drive speed is an effective FTL rate, not impulse speed. The drive matches target-frame velocity on exit.</p>
    </section>
  );
}

export function CruiseStatusBanner({ snapshot }: { snapshot: GameSnapshot | null }) {
  if (!snapshot || snapshot.cruise.mode === "local") return null;
  const cruise = snapshot.cruise;
  const target = getStarSystem(snapshot.universe.systemId).bodies.find(body => body.id === cruise.targetId);
  return <div className="cruise-banner" aria-live="polite">
    <div className="cruise-banner-title">
      <span>INTERPLANETARY {cruise.mode === "spooling" ? "DRIVE SPOOL" : cruise.mode === "dropping" ? "DRIVE SHUTDOWN" : "CRUISE"}</span>
      <strong>{target?.name ?? "Uncharted"}</strong>
    </div>
    <div className="cruise-banner-metrics">
      <span>{(cruise.speedMetersPerSecond / SPEED_OF_LIGHT_MPS).toFixed(2)} c</span>
      <span>{cruise.remainingMeters === null ? "—" : formatAstronomicalDistance(cruise.remainingMeters)}</span>
      <span>ETA {formatFlightTime(cruise.etaSeconds)}</span>
    </div>
    <div className="cruise-progress-track"><div style={{ width: Math.round(cruise.progress * 100) + "%" }}/></div>
    <small>{cruise.mode === "spooling" ? "Charging drive coils" : cruise.mode === "dropping" ?
      "Braking to reference-frame matching speed" : "Autopilot tracking moving orbital destination"}</small>
  </div>;
}
