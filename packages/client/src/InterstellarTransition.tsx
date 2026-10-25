import { useEffect, useRef, useState } from "react";
import { getStarSystem, type GameSnapshot } from "@bridge-sim/shared";
import { jumpDestinationName, jumpEta, jumpProgressPercent } from "./interstellarUI";
import { arrivalEventKey } from "./systemTransition";

/** A visualisation of the SERVER jump phase. No guessed galactic position,
 * estimated progress timers or impossible deep-space camera coordinates.
 * Main Screen and Helm share identical authoritative progress and phase.
 */
export function InterstellarTransition({ snapshot }: { snapshot: GameSnapshot | null }) {
  const [arrival, setArrival] = useState<{ event: string; systemName: string } | null>(null);
  const previousEvent = useRef<string | null | undefined>(undefined);
  const currentEvent = arrivalEventKey(snapshot);
  const phase = snapshot?.interstellar.phase ?? "idle";
  const active = phase === "charging" || phase === "transit";

  useEffect(() => {
    // No replayed arrival animation when first joining an already-idle ship.
    if (previousEvent.current === undefined) {
      previousEvent.current = currentEvent;
      return;
    }
    if (currentEvent && currentEvent !== previousEvent.current) {
      setArrival({ event: currentEvent, systemName: getStarSystem(snapshot!.universe.systemId).name });
    }
    previousEvent.current = currentEvent;
  }, [currentEvent, snapshot?.universe.systemId]);

  useEffect(() => {
    if (!arrival) return;
    const timeout = window.setTimeout(() => setArrival(current =>
      current?.event === arrival.event ? null : current), 4200);
    return () => window.clearTimeout(timeout);
  }, [arrival]);

  useEffect(() => {
    if (active) setArrival(null);
  }, [active]);

  if (!snapshot) return null;
  const progress = jumpProgressPercent(snapshot);
  if (active) {
    return <div className={"interstellar-cinematic phase-" + phase}
      data-jump-phase={phase} role="region" aria-label="Interstellar voyage visual">
      <div className="interstellar-cinematic-backdrop" aria-hidden="true">
        <div className="jump-lane lane-a"/><div className="jump-lane lane-b"/>
        <div className="jump-lane lane-c"/><div className="jump-lane lane-d"/>
        <div className="jump-lane lane-e"/><div className="jump-lane lane-f"/>
        <div className="jump-tunnel-ring ring-a"/><div className="jump-tunnel-ring ring-b"/>
        <div className="jump-tunnel-ring ring-c"/>
        <div className="jump-core"/>
      </div>
      <div className="interstellar-cinematic-caption">
        <span>{phase === "charging" ? "INTERSTELLAR DRIVE / CHARGE SEQUENCE" :
          "INTERSTELLAR DRIVE / EXTRASOLAR TRANSIT"}</span>
        <strong>{phase === "charging" ? "PREPARING THE CORRIDOR" : "IN TRANSIT"}</strong>
        <p>{phase === "charging" ?
          "Current local astronomical view retained until the corridor opens." :
          "No local position exists between systems. Real-space rendering suspended."}</p>
        <div className="jump-cinematic-route">
          <small>ROUTE</small>
          <b>{getStarSystem(snapshot.interstellar.originSystemId ?? snapshot.universe.systemId).name}
            {" → "}{jumpDestinationName(snapshot)}</b>
          <small>SERVER ETA</small><b>{jumpEta(snapshot.interstellar.etaSeconds)}</b>
        </div>
        {phase === "transit" ? <>
          <div className="jump-cinematic-progress-head"><span>TRANSIT PROGRESS</span><b>{progress}%</b></div>
          <div className="jump-cinematic-progress" role="progressbar"
            aria-label="Voyage cinematic transit progress" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={progress}><span style={{ width: progress + "%" }}/></div>
        </> : <div className="jump-cinematic-countdown">
          CORRIDOR CHARGE {jumpEta(snapshot.interstellar.spoolRemainingSeconds)}
        </div>}
      </div>
    </div>;
  }
  if (arrival) return <div className="interstellar-arrival-flash" role="status"
    aria-label="Interstellar arrival confirmed" data-arrival-system={snapshot.universe.systemId}>
    <div className="interstellar-arrival-halo" aria-hidden="true"/>
    <span>LOCAL REFERENCE FRAME ACQUIRED</span>
    <strong>ARRIVAL / {arrival.systemName.toUpperCase()}</strong>
    <small>Destination starfield and celestial resources loaded from the new system</small>
  </div>;
  return null;
}
