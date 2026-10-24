import { clamp, dot, length, NAV_MARKERS, rotateVector, sub, vec3, type GameSnapshot, type ShipState } from "@bridge-sim/shared";
import type { CameraMode } from "./scene";

export const toRadians = (degrees: number): number => degrees * Math.PI / 180;
export const degrees = (radians: number): string => (radians * 180 / Math.PI).toFixed(1);
export const number = (value: number, decimals = 1): string => value.toFixed(decimals);

export function Control({
  label, value, set, min, max, unit
}: { label: string; value: number; set: (value: number) => void; min: number; max: number; unit: string }) {
  return <label className="control-label">
    <span>{label}<strong>{value}{unit}</strong></span>
    <input aria-label={label} type="range" min={min} max={max} value={value} onChange={event => set(Number(event.target.value))} />
  </label>;
}

export function Telemetry({ label, value }: { label: string; value: string }) {
  return <div className="telemetry-item"><small>{label}</small><strong>{value}</strong></div>;
}

export function CameraSelector({
  mode, setMode
}: { mode: CameraMode; setMode: (mode: CameraMode) => void }) {
  return <label className="camera-select">Camera mode
    <select value={mode} onChange={event => setMode(event.target.value as CameraMode)}>
      <option value="orbit">Free orbit</option>
      <option value="chase">Chase camera</option>
      <option value="tactical">Tactical overhead</option>
      <option value="sector">Local sector / station</option>
    </select>
  </label>;
}

export function driftAngle(ship: ShipState): string {
  const speed = length(ship.velocity);
  if (speed < 0.1) return "—";
  const forward = rotateVector(ship.orientation, vec3(0, 0, 1));
  return number(Math.acos(clamp(dot(forward, ship.velocity) / speed, -1, 1)) * 180 / Math.PI) + "°";
}

export function BeaconList({ snapshot }: { snapshot: GameSnapshot | null }) {
  const ship = snapshot?.ship;
  const markers = ship
    ? NAV_MARKERS.map(marker => ({
        ...marker,
        distance: length(sub(marker.position, ship.position))
      })).sort((a, b) => a.distance - b.distance)
    : [];
  return <div className="beacon-list">
    {markers.length ? markers.map(marker => (
      <div className="beacon-row" key={marker.id}>
        <span>{marker.label}</span><strong>{number(marker.distance, 0)} m</strong>
      </div>
    )) : <p className="subtle">Awaiting telemetry...</p>}
  </div>;
}
