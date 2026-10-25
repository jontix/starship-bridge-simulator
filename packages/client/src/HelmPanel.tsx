import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Room } from "colyseus.js";
import {
  getStarSystem, length, type GameSnapshot, type HelmCommand
} from "@bridge-sim/shared";
import type { CameraMode } from "./scene";
import { CruisePanel, formatFlightTime } from "./CruisePanel";
import { InterstellarPanel } from "./InterstellarPanel";
import { PlanetViewControls } from "./PlanetReadout";
import type { SurfaceDetailMode } from "./surfaceDetail";
import type { SelectedHeading } from "./navigationVisuals";
import { BeaconList, CameraSelector } from "./navigationUI";
import {
  AxisStepper, ConvergenceBar, FlightMotionGlyph,
  HeadingDial, ModuleHeader, StatusMetric
} from "./HelmWidgets";
import {
  bearingDistance, clampHelmSpeed, clampHelmTranslation,
  currentHeadingFromShip, headingErrorDegrees,
  isHeadingDraftCommitted, localVelocity, offAxisDriftDegrees,
  orderedHeadingFromShip, setHeadingAxis, toRadians, velocityHeading
} from "./helmInstruments";

type HelmPanelProps = {
  room: Room | null;
  snapshot: GameSnapshot | null;
  cruiseNotice: string;
  interstellarNotice: string;
  openGalacticMap: () => void;
  jumpTabRequest: number;
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
  opticalZoom: number;
  setOpticalZoom: (value: number) => void;
  surfaceDetailMode: SurfaceDetailMode;
  setSurfaceDetailMode: (mode: SurfaceDetailMode) => void;
};

const format = (value: number, decimals = 1) => value.toFixed(decimals);
const sign = (value: number, decimals = 0) =>
  (value > 0 ? "+" : "") + value.toFixed(decimals);
const ratio = (value: number, maximum: number) =>
  Math.min(100, Math.max(0, Math.abs(value) / maximum * 100)) + "%";

export function HelmPanel({
  room, snapshot, cruiseNotice, interstellarNotice, openGalacticMap, jumpTabRequest, heading, setHeading,
  showSphere, toggleSphere, showAids, toggleAids, mode, setMode,
  planetFocusId, setPlanetFocusId, opticalZoom, setOpticalZoom,
  surfaceDetailMode, setSurfaceDetailMode
}: HelmPanelProps) {
  const [speed, setSpeed] = useState(0);
  const [strafe, setStrafe] = useState(0);
  const [lift, setLift] = useState(0);
  const [rightTab, setRightTab] = useState<"local" | "cruise" | "jump">("local");
  const [showDisplay, setShowDisplay] = useState(false);
  const initializedRoom = useRef<Room | null>(null);
  const previousDriveMode = useRef<string | null>(null);

  useEffect(() => {
    if (jumpTabRequest > 0) setRightTab("jump");
  }, [jumpTabRequest]);

  const ship = snapshot?.ship;
  const cruise = snapshot?.cruise;
  const isLocal = cruise?.mode === "local";
  const jumpPhase = snapshot?.interstellar.phase ?? "idle";
  const jumpActive = jumpPhase !== "idle";
  const canOrder = Boolean(room && ship && isLocal && !jumpActive);
  const system = snapshot ? getStarSystem(snapshot.universe.systemId) : null;
  const target = system?.bodies.find(body => body.id === cruise?.targetId);

  // Sync from the authoritative order once per connection, never on each
  // 15Hz snapshot (which would overwrite an uncommitted player input).
  useEffect(() => {
    if (!room || !ship) {
      initializedRoom.current = null;
      return;
    }
    if (initializedRoom.current === room) return;
    initializedRoom.current = room;
    setSpeed(Math.round(ship.desiredSpeed));
    setStrafe(Math.round(ship.desiredStrafe));
    setLift(Math.round(ship.desiredLift));
    setHeading(orderedHeadingFromShip(ship));
  }, [room, ship, setHeading]);

  // Change the visible right-side mode when the drive actually changes,
  // but do not fight players clicking the tabs to inspect cruise planning.
  useEffect(() => {
    const drive = jumpActive ? "jump-" + jumpPhase :
      cruise?.mode !== "local" ? cruise?.mode :
      snapshot?.interstellar.destinationSystemId || snapshot?.interstellar.lastArrivalSystemId ?
        "jump-plotted" : "local";
    if (!drive) return;
    if (drive !== previousDriveMode.current) {
      previousDriveMode.current = drive;
      // A cancelled charge retains the plotted jump. Keep that console open
      // rather than returning to LOCAL NAV and hiding the re-engage action.
      setRightTab(drive.startsWith("jump") ? "jump" : drive === "local" ? "local" : "cruise");
    }
  }, [cruise?.mode, jumpActive, jumpPhase,
      snapshot?.interstellar.destinationSystemId, snapshot?.interstellar.lastArrivalSystemId]);
  useEffect(() => {
    if (snapshot?.interstellar.destinationSystemId && !jumpActive) setRightTab("jump");
  }, [snapshot?.interstellar.destinationSystemId]);

  const send = (command: HelmCommand) => {
    if (canOrder) room?.send("helm_command", command);
  };

  const actual = ship ? currentHeadingFromShip(ship) : null;
  const draftMatchesOrder = ship ? isHeadingDraftCommitted(heading, ship) : false;
  const motion = ship ? localVelocity(ship) : null;
  const drift = ship ? offAxisDriftDegrees(ship) : null;
  const turnError = ship ? headingErrorDegrees(ship) : 0;
  const worldSpeed = ship ? length(ship.velocity) : 0;
  const moving = worldSpeed > 0.1;
  const flightStatus = !room || !snapshot ? "AWAITING LINK" :
    jumpActive ? (jumpPhase === "charging" ? "JUMP CHARGING" : "INTERSTELLAR TRANSIT") :
    !isLocal ? "CRUISE ACTIVE" :
    ship?.emergencyStopping ? "EMERGENCY BRAKING" :
    turnError > 2 ? "TURNING TO COURSE" :
    drift !== null && drift > 12 ? "VELOCITY OFF-AXIS" :
    moving ? "ON COURSE" : "STATIONARY";
  const statusTone = ship?.emergencyStopping ? "alert" :
    !room || !snapshot ? "muted" : jumpActive || turnError > 2 ? "amber" : "nominal";
  const targetReady = Boolean(target);
  const cruiseLabel = jumpActive ? (jumpPhase === "charging" ? "JUMP · CHARGING" : "JUMP · TRANSIT") :
    !cruise ? "AWAITING NAV LINK" :
    cruise.mode === "local" ? "IMPULSE / LOCAL" :
    cruise?.mode === "spooling" ? "FTL · SPOOLING" :
    cruise?.mode === "dropping" ? "FTL · DECELERATING" : "FTL · CRUISE";

  const setAxis = (axis: keyof SelectedHeading, value: number) =>
    setHeading(previous => setHeadingAxis(previous, axis, value));

  const alignPreviewToVelocity = () => {
    if (!ship) return;
    const targetHeading = velocityHeading(ship.velocity);
    if (!targetHeading) return;
    setHeading(previous => ({ ...previous, yaw: Math.round(targetHeading.yaw),
      pitch: Math.round(targetHeading.pitch) }));
  };

  const emergencyStop = () => {
    if (!canOrder) return;
    send({ type: "emergency_stop" });
    setSpeed(0);
    setStrafe(0);
    setLift(0);
  };

  return <section className="helm-workstation" aria-label="Helm workstation">
    <div className="helm-command-header">
      <div className="helm-station-brand">
        <span className="helm-bridge-emblem" aria-hidden="true">◇</span>
        <div><small>BRIDGE OPERATIONS / FLIGHT DECK</small>
          <h1>HELM <span>CONSOLE</span></h1>
        </div>
        <span className="helm-console-version">02</span>
      </div>
      <div className="helm-command-header-center">
        <span className={`helm-signal-dot ${room ? "connected" : ""}`}/>
        <span>{room ? "COMMAND LINK ONLINE" : "NO COMMAND LINK"}</span>
        <i aria-hidden="true"/>
        <strong>{cruiseLabel}</strong>
      </div>
      <div className={`helm-flight-state ${statusTone}`} role="status">
        <span className="helm-status-led"/>
        <span>{flightStatus}</span>
      </div>
    </div>

    <div className="helm-command-layout">
      <aside className="helm-sidebar helm-navigation" aria-label="Heading and attitude">
        <section className="helm-module">
          <ModuleHeader index="01" title="ATTITUDE / NAVIGATION"
            extra={<span className="helm-minitag">WORLD FRAME</span>}/>
          <div className="helm-bearing-readout">
            <div><small>SELECTED BEARING</small>
              <strong>{sign(heading.yaw, 0)}<sup>°</sup></strong></div>
            <div><small>ELEVATION</small>
              <strong>{sign(heading.pitch, 0)}<sup>°</sup></strong></div>
          </div>
          <HeadingDial ship={ship} heading={heading}
            onPick={bearing => setAxis("yaw", bearing)} disabled={!canOrder}/>
          <div className="helm-axis-stack">
            <AxisStepper label="Yaw / bearing" value={heading.yaw}
              actual={actual?.yaw ?? null} step={5} min={-180} max={180}
              onChange={value => setAxis("yaw", value)}/>
            <AxisStepper label="Pitch / elevation" value={heading.pitch}
              actual={actual?.pitch ?? null} step={5} min={-90} max={90}
              onChange={value => setAxis("pitch", value)}/>
            <AxisStepper label="Roll trim" value={heading.roll}
              actual={actual?.roll ?? null} step={5} min={-180} max={180}
              onChange={value => setAxis("roll", value)}/>
          </div>
          <div className="helm-inline-actions">
            <button disabled={!canOrder || !ship}
              onClick={() => ship && setHeading(orderedHeadingFromShip(ship))}>
              Load order
            </button>
            <button disabled={!canOrder || !ship}
              onClick={() => ship && setHeading({
                ...heading,
                yaw: Math.round(currentHeadingFromShip(ship).yaw),
                pitch: Math.round(currentHeadingFromShip(ship).pitch),
                roll: Math.round(currentHeadingFromShip(ship).roll)
              })}>Use facing</button>
            <button disabled={!canOrder || !moving}
              onClick={alignPreviewToVelocity}>Align to motion</button>
          </div>
          <div className={`helm-order-preview ${draftMatchesOrder ? "committed" : "pending"}`}>
            <span className="helm-order-indicator"/>
            {draftMatchesOrder ? "SELECTED HEADING MATCHES ORDER" :
              "PREVIEW ONLY — NOT SENT TO SHIP"}
          </div>
          <button className="helm-primary-button" disabled={!canOrder}
            onClick={() => send({
              type: "set_heading", yaw: toRadians(heading.yaw),
              pitch: toRadians(heading.pitch), roll: toRadians(heading.roll)
            })}>ENGAGE HEADING <span aria-hidden="true">⌁</span></button>
          <ConvergenceBar ship={ship}/>
        </section>
      </aside>

      <div className="helm-center">
        <div className="helm-viewport" aria-label="Interactive 3D navigation viewport">
          <div className="helm-view-corner tl"/><div className="helm-view-corner tr"/>
          <div className="helm-view-corner bl"/><div className="helm-view-corner br"/>
          <div className="helm-viewport-top">
            <span>EXTERNAL NAVIGATION VIEW</span>
            <span className="helm-view-live"><i/> LIVE FEED</span>
          </div>
          <div className="helm-view-reticle" aria-hidden="true">
            <span/><span/><span/><span/>
          </div>
          <div className="helm-viewport-bottom">
            <span>{showSphere && canOrder && mode === "orbit" ?
              "SELECT ON 3D HEADING SPHERE · THEN ENGAGE" :
              "NAVIGATION CAMERA · SHOW SPHERE TO PICK A COURSE"}</span>
            <span>+X STBD / +Y DORSAL / +Z FWD</span>
          </div>
          <div className="helm-view-controls">
            <button className={mode === "orbit" && showSphere ? "selected" : ""}
              aria-pressed={mode === "orbit" && showSphere}
              onClick={() => {
                if (mode !== "orbit") {
                  setMode("orbit");
                  if (!showSphere) toggleSphere();
                } else toggleSphere();
              }}
              title="Toggle interactive 3D heading sphere in the main viewport">
              3D HEADING {showSphere && mode === "orbit" ? "ON" : "OFF"}
            </button>
            <button className={showAids ? "selected" : ""} aria-pressed={showAids}
              onClick={toggleAids}>NAV AIDS {showAids ? "ON" : "OFF"}</button>
          </div>
        </div>

        <div className="helm-orders" aria-label="Flight maneuver orders">
          <section className="helm-module helm-speed-module">
            <ModuleHeader index="02" title="FORWARD / IMPULSE"
              extra={<span className="helm-minitag">0–300 M/S</span>}/>
            <div className="helm-speed-comparison">
              <div><small>ORDER PREVIEW</small>
                <strong>{format(speed, 0)}<span>m/s</span></strong></div>
              <div><small>ACTUAL FORWARD</small>
                <strong>{motion ? sign(motion.forward, 1) : "—"}<span>m/s</span></strong></div>
            </div>
            <div className="helm-meter"><div style={{ width: ratio(motion?.forward ?? 0, 300) }}/></div>
            <div className="helm-step-buttons" aria-label="Adjust speed order">
              {[-100, -10, -1, 1, 10, 100].map(change =>
                <button key={change} onClick={() => setSpeed(previous => clampHelmSpeed(previous + change))}
                  disabled={!canOrder} aria-label={`Adjust speed by ${change} metres per second`}>
                  {change > 0 ? "+" : ""}{change}
                </button>)}
            </div>
            <div className="helm-preset-row" aria-label="Impulse speed presets">
              {[{ value: 0, name: "STOP" }, { value: 10, name: "MANOEUVRE" },
                { value: 60, name: "APPROACH" }, { value: 150, name: "TRANSIT" },
                { value: 300, name: "MAX" }].map(preset =>
                <button key={preset.value} className={speed === preset.value ? "selected" : ""}
                  disabled={!canOrder} onClick={() => setSpeed(preset.value)}
                  title={`Prepare ${preset.value} metres per second. Engage to transmit.`}>
                  {preset.name}
                </button>)}
            </div>
            <button className="helm-primary-button" disabled={!canOrder}
              onClick={() => send({ type: "set_speed", speed })}>
              ENGAGE SPEED ORDER <span aria-hidden="true">⌁</span>
            </button>
            <small className="helm-assist-caption">Presets prepare an order; Engage transmits. Flight assist accelerates toward ordered velocity.</small>
          </section>

          <section className="helm-module helm-translation-module">
            <ModuleHeader index="03" title="TRANSLATION / 6DOF"
              extra={<span className="helm-minitag">SHIP FRAME</span>}/>
            <div className="helm-translation-body">
              <div className="helm-translation-pad" aria-label="Translation trim controls">
                <button className="dorsal" disabled={!canOrder}
                  onClick={() => setLift(value => clampHelmTranslation(value + 5))}
                  aria-label="Increase dorsal lift">▲</button>
                <button className="port" disabled={!canOrder}
                  onClick={() => setStrafe(value => clampHelmTranslation(value - 5))}
                  aria-label="Increase port strafe">◀</button>
                <span className="helm-translation-origin">SHIP<br/>0 · 0</span>
                <button className="starboard" disabled={!canOrder}
                  onClick={() => setStrafe(value => clampHelmTranslation(value + 5))}
                  aria-label="Increase starboard strafe">▶</button>
                <button className="ventral" disabled={!canOrder}
                  onClick={() => setLift(value => clampHelmTranslation(value - 5))}
                  aria-label="Increase ventral lift">▼</button>
                <span className="helm-pad-dorsal">DORSAL +Y</span>
                <span className="helm-pad-stbd">STBD +X</span>
              </div>
              <div className="helm-translation-readouts">
                <label>STRAFE / ORDER <span>+ STBD</span>
                  <div><input type="number" aria-label="Strafe order" min={-60} max={60} step={1}
                    value={strafe} onChange={event => setStrafe(clampHelmTranslation(Number(event.target.value)))}/>
                    <span>m/s</span></div>
                  <small>Actual {motion ? sign(motion.strafe, 1) : "—"} · ordered {ship ? sign(ship.desiredStrafe, 0) : "—"} m/s</small>
                </label>
                <label>LIFT / ORDER <span>+ DORSAL</span>
                  <div><input type="number" aria-label="Lift order" min={-60} max={60} step={1}
                    value={lift} onChange={event => setLift(clampHelmTranslation(Number(event.target.value)))}/>
                    <span>m/s</span></div>
                  <small>Actual {motion ? sign(motion.lift, 1) : "—"} · ordered {ship ? sign(ship.desiredLift, 0) : "—"} m/s</small>
                </label>
              </div>
            </div>
            <div className="helm-translation-actions">
              <button disabled={!canOrder} onClick={() => { setStrafe(0); setLift(0); }}>
                ZERO TRIM PREVIEW
              </button>
              <button className="helm-primary-button" disabled={!canOrder}
                onClick={() => send({ type: "set_translation", strafe, lift })}>
                ENGAGE VECTOR
              </button>
            </div>
          </section>
        </div>
      </div>

      <aside className="helm-sidebar helm-situation" aria-label="Drive and navigation situation">
        <section className="helm-module helm-drive-module">
          <ModuleHeader index="04" title="SITUATION / DRIVE"
            extra={<span className={`helm-minitag ${isLocal && !jumpActive ? "nominal" : "amber"}`}>
              {jumpActive ? "JUMP" : isLocal ? "LOCAL" : "FTL"}</span>}/>
          <div className="helm-drive-mode">
            <span className="helm-drive-pulse" aria-hidden="true"/>
            <div><small>DRIVE CONFIGURATION</small><strong>{cruiseLabel}</strong></div>
          </div>
          <div className="helm-context-rows">
            <div><span>Reference frame</span><strong>{snapshot?.universe.referenceBodyId ?? "—"}</strong></div>
            <div><span>Destination</span><strong>{target?.name ?? "NO TARGET"}</strong></div>
            <div><span>Range to destination</span><strong>{cruise?.remainingMeters === null || cruise?.remainingMeters === undefined ? "—" :
              cruise.remainingMeters > 1e6 ? (cruise.remainingMeters / 1e6).toFixed(1) + " Mm" :
              (cruise.remainingMeters / 1e3).toFixed(1) + " km"}</strong></div>
            <div><span>Arrival estimate</span><strong>{formatFlightTime(cruise?.etaSeconds ?? null)}</strong></div>
          </div>
          <div className="helm-situation-tabs" role="group" aria-label="Drive controls view">
            <button className={rightTab === "local" ? "selected" : ""} aria-pressed={rightTab === "local"}
              onClick={() => setRightTab("local")}>LOCAL NAV</button>
            <button className={rightTab === "cruise" ? "selected" : ""} aria-pressed={rightTab === "cruise"}
              onClick={() => setRightTab("cruise")}>FTL PLANNER</button>
            <button className={rightTab === "jump" ? "selected" : ""} aria-pressed={rightTab === "jump"}
              onClick={() => setRightTab("jump")}>JUMP DRIVE</button>
          </div>
          <div className="helm-situation-content">
            {rightTab === "cruise" ?
              <CruisePanel room={room} snapshot={snapshot} notice={cruiseNotice}/> :
              rightTab === "jump" ?
              <InterstellarPanel room={room} snapshot={snapshot} notice={interstellarNotice}
                openGalacticMap={openGalacticMap}/> :
              <>
                <div className="helm-subhead">RELATIVE MOTION</div>
                <FlightMotionGlyph ship={ship}/>
                <div className="helm-situation-facts">
                  <div><span>World velocity</span><strong>{format(worldSpeed, 1)} m/s</strong></div>
                  <div><span>Off-axis drift</span><strong>{drift === null ? "—" : format(drift, 1) + "°"}</strong></div>
                  <div><span>Angular rate</span><strong>{ship ? format(length(ship.angularVelocity) * 180 / Math.PI, 1) + "°/s" : "—"}</strong></div>
                  <div><span>Course delta</span><strong>{ship ? format(turnError, 1) + "°" : "—"}</strong></div>
                </div>
                <div className="helm-subhead">NEARBY NAVIGATION BEACONS</div>
                <BeaconList snapshot={snapshot}/>
                <button onClick={() => setRightTab("cruise")}
                  className="helm-route-link">OPEN INTERPLANETARY PLANNER ↗</button>
              </>}
          </div>
        </section>

        <details className="helm-display-settings" open={showDisplay}
          onToggle={event => setShowDisplay(event.currentTarget.open)}>
          <summary>DISPLAY &amp; ADVANCED SETTINGS <span>⌄</span></summary>
          <div className="helm-settings-body">
            <p>Choose what the viewscreen shows. These options do not issue flight orders.</p>
            <CameraSelector mode={mode} setMode={setMode}/>
            <button onClick={() => {
              setMode("orbit");
              if (!showSphere) toggleSphere();
            }}>Show 3D navigation sphere</button>
            <PlanetViewControls snapshot={snapshot} focusId={planetFocusId}
              setFocusId={id => { setPlanetFocusId(id); setMode("planet"); }}
              opticalZoom={opticalZoom}
              setOpticalZoom={zoom => { setOpticalZoom(zoom); setMode("planet"); }}
              surfaceDetailMode={surfaceDetailMode}
              setSurfaceDetailMode={setSurfaceDetailMode}/>
          </div>
        </details>
      </aside>
    </div>

    <footer className="helm-flight-strip" aria-label="Live flight telemetry and emergency controls">
      <StatusMetric label="WORLD SPEED" value={ship ? format(worldSpeed, 1) + " m/s" : "—"}
        foot="Actual inertial motion"/>
      <StatusMetric label="ORDERED FORWARD" value={ship ? format(ship.desiredSpeed, 0) + " m/s" : "—"}
        foot="Confirmed by server"/>
      <StatusMetric label="OFF-AXIS DRIFT" value={drift === null ? "—" : format(drift, 1) + "°"}
        intent={drift !== null && drift > 12 ? "warning" : "normal"} foot="Velocity vs bow"/>
      <StatusMetric label="ACCELERATION" value={ship ? format(length(ship.acceleration), 1) + " m/s²" : "—"}
        foot="Actual thrust response"/>
      <StatusMetric label="HEADING DELTA" value={ship ? format(turnError, 1) + "°" : "—"}
        intent={turnError > 2 ? "warning" : "good"} foot="Actual vs order"/>
      <div className="helm-emergency-block">
        <button className="helm-emergency-stop" disabled={!canOrder}
          onClick={emergencyStop}
          title="Braking-limited stop: cancel ordered forward, strafe and lift velocity.">
          <strong>■ EMERGENCY BRAKE</strong>
          <small>Cancel velocity orders · maximum braking</small>
        </button>
      </div>
    </footer>
    {(!isLocal || jumpActive) && <div className="helm-cruise-lockout" role="status">
      {jumpActive ? <>
        <span>INTERSTELLAR DRIVE ACTIVE</span> Local and cruise orders are locked.
        {jumpPhase === "charging" ? "Charge cancellation is available in Jump Drive." :
          "Transit continues to the plotted destination; no mid-jump abort in v1."}
        <button onClick={() => setRightTab("jump")}>OPEN JUMP DRIVE</button>
      </> : <>
        <span>FTL DRIVE ACTIVE</span> Local impulse orders are suspended.
        Use the FTL Planner to request a safe drop.
        <button onClick={() => setRightTab("cruise")}>OPEN PLANNER</button>
      </>}
    </div>}
  </section>;
}
