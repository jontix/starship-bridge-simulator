import { length, type GameSnapshot } from "@bridge-sim/shared";
import type { CameraMode } from "./scene";
import { CruiseReadout } from "./CruisePanel";
import { PlanetViewControls } from "./PlanetReadout";
import { BeaconList, CameraSelector, driftAngle, number, Telemetry } from "./navigationUI";

export function MainScreenPanel({
  snapshot, mode, setMode, showAids, toggleAids, planetFocusId, setPlanetFocusId, opticalZoom, setOpticalZoom
}: {
  snapshot: GameSnapshot | null;
  mode: CameraMode;
  setMode: (mode: CameraMode) => void;
  showAids: boolean;
  toggleAids: () => void;
  planetFocusId: string;
  setPlanetFocusId: (id: string) => void;
  opticalZoom: number;
  setOpticalZoom: (value: number) => void;
}) {
  const ship = snapshot?.ship;
  return (
    <section className="panel main-panel">
      <h2>Main Screen</h2>
      <CameraSelector mode={mode} setMode={setMode} />
      <PlanetViewControls snapshot={snapshot} focusId={planetFocusId}
        setFocusId={setPlanetFocusId} opticalZoom={opticalZoom} setOpticalZoom={setOpticalZoom}/>
      <CruiseReadout snapshot={snapshot}/>
      <button className={showAids ? "active" : ""} aria-pressed={showAids} onClick={toggleAids}>
        {showAids ? "Hide navigation overlays" : "Show navigation overlays"}
      </button>
      <div className="telemetry-grid">
        <Telemetry label="World speed" value={ship && snapshot?.cruise.mode === "local" ? number(length(ship.velocity)) + " m/s" : "CRUISE"} />
        <Telemetry label="Drift angle" value={ship ? driftAngle(ship) : "—"} />
      </div>
      <h3>Training beacons</h3>
      <BeaconList snapshot={snapshot} />
      <p className="subtle">Green: world velocity · Violet: flight trail · Beacons: fixed in space.</p>
      <p className="subtle">Orbit / tactical: drag to rotate; scroll to zoom.</p>
    </section>
  );
}
