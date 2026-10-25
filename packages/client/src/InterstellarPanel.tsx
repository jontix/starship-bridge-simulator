import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import type { GameSnapshot, InterstellarCommand } from "@bridge-sim/shared";
import {
  currentSystemName, galacticRoute, jumpDestinationName, jumpEligibility,
  jumpEta, jumpPhaseLabel, jumpProgressPercent, linkedDestinations,
  selectedSystemAfterTransition
} from "./interstellarUI";

export function InterstellarReadout({ snapshot }: { snapshot: GameSnapshot | null }) {
  const jump = snapshot?.interstellar;
  const progress = jumpProgressPercent(snapshot);
  const active = jump?.phase === "charging" || jump?.phase === "transit";
  return <section className="interstellar-readout" aria-label="Interstellar travel telemetry">
    <div className="jump-metric"><span>Active system</span><strong>{currentSystemName(snapshot)}</strong></div>
    <div className="jump-metric"><span>Jump drive</span><strong>{jumpPhaseLabel(snapshot)}</strong></div>
    <div className="jump-metric"><span>Plotted destination</span><strong>{jumpDestinationName(snapshot)}</strong></div>
    <div className="jump-metric"><span>Route / separation</span>
      <strong>{jump?.routeId ?? "—"} · {jump?.distanceLightYears == null ?
        "—" : jump.distanceLightYears.toFixed(2) + " ly"}</strong></div>
    {jump?.phase === "charging" && <div className="jump-metric">
      <span>Charge remaining</span><strong>{jumpEta(jump.spoolRemainingSeconds)}</strong>
    </div>}
    {active && <div className="jump-metric">
      <span>{jump.phase === "charging" ? "Departure ETA" : "Arrival ETA"}</span>
      <strong>{jumpEta(jump.etaSeconds)}</strong>
    </div>}
    {jump?.phase === "transit" && <>
      <div className="jump-progress-titles"><span>Transit's server-confirmed progress</span><strong>{progress}%</strong></div>
      <div className="jump-progress" role="progressbar" aria-label="Interstellar transit progress"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span style={{ width: progress + "%" }}/>
      </div>
    </>}
    {jump?.lastArrivalSystemId && <div className="jump-arrival" role="status">
      Arrival confirmed · {currentSystemName(snapshot)}
    </div>}
    <p className="jump-event" aria-live="polite">{jump?.lastEvent ?? "Awaiting navigation computer"}</p>
  </section>;
}

export function InterstellarPanel({
  room, snapshot, notice, openGalacticMap
}: {
  room: Room | null;
  snapshot: GameSnapshot | null;
  notice: string;
  openGalacticMap: () => void;
}) {
  const systemId = snapshot?.universe.systemId ?? "aster-reach";
  const [selectedId, setSelectedId] = useState(() => linkedDestinations(systemId)[0]?.id ?? systemId);
  const options = linkedDestinations(systemId);
  const eligibility = jumpEligibility(snapshot, Boolean(room));
  const serverTarget = snapshot?.interstellar.destinationSystemId ?? null;
  const active = snapshot?.interstellar.phase !== "idle";
  const selectedRoute = galacticRoute(systemId, selectedId);

  useEffect(() => {
    setSelectedId(previous => selectedSystemAfterTransition(previous, systemId));
  }, [systemId]);

  useEffect(() => {
    if (serverTarget) setSelectedId(serverTarget);
  }, [serverTarget]);

  const send = (command: InterstellarCommand) => room?.send("interstellar_command", command);
  return <section className="interstellar-panel" aria-label="Interstellar jump drive controls">
    <h3>Interstellar jump drive</h3>
    <InterstellarReadout snapshot={snapshot}/>
    <div className="jump-controls">
      <button type="button" onClick={openGalacticMap} className="jump-open-chart">
        OPEN GALACTIC CHART
      </button>
      <label htmlFor="jump-destination">Destination preview · not plotted</label>
      <select id="jump-destination" aria-label="Interstellar destination preview" value={selectedId}
        disabled={!eligibility.canPlot} onChange={e => setSelectedId(e.target.value)}>
        {options.length ? options.map(system =>
          <option key={system.id} value={system.id}>{system.name}</option>) :
          <option value={systemId}>No linked destinations</option>}
      </select>
      <div className="jump-selected-route">
        {selectedRoute ? <>
          <strong>{selectedRoute.from.name} → {selectedRoute.to.name}</strong>
          <span>{selectedRoute.distanceLightYears.toFixed(2)} ly · Route {selectedRoute.link.id}</span>
          <span>Authorised jump range {selectedRoute.link.maxDistanceLightYears.toFixed(1)} ly</span>
        </> : "No valid route selected"}
      </div>
      <button type="button" className="jump-plot"
        disabled={!eligibility.canPlot || !selectedRoute}
        onClick={() => send({ type: "set_interstellar_target", systemId: selectedId })}>
        PLOT ROUTE
      </button>
      <button type="button" className="jump-engage"
        disabled={!eligibility.canEngage || active || !serverTarget}
        onClick={() => send({ type: "engage_jump" })}>
        ENGAGE JUMP
      </button>
      <button type="button" className="jump-cancel" disabled={!eligibility.canCancel}
        onClick={() => send({ type: "cancel_jump_spool" })}>CANCEL CHARGE</button>
      <p className="jump-readiness">{eligibility.reason}</p>
      {notice && <p className="jump-notice" role="status">{notice}</p>}
    </div>
    <p className="jump-stage-warning">
      Stage C bridge controls are experimental. Destination rendering and old-system
      asset reset will be completed in Stage D. Arrival is already authoritative.
    </p>
  </section>;
}
