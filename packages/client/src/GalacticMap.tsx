import { useEffect, useMemo, useState } from "react";
import type { GameSnapshot } from "@bridge-sim/shared";
import { listInterstellarRoutes } from "@bridge-sim/shared";
import {
  galacticRoute, galacticSystems, jumpDestinationName, jumpEligibility,
  jumpEta, jumpPhaseLabel, linkedDestinations, selectedSystemAfterTransition
} from "./interstellarUI";

type GalacticMapProps = {
  snapshot: GameSnapshot | null;
  canCommand: boolean;
  onPlot: (systemId: string) => void;
  onClose: () => void;
  onShowJumpControls: () => void;
};

const VIEW = { width: 760, height: 460, margin: 108 };
type Point = { x: number; y: number };

function projectedChart(): Record<string, Point> {
  const xs = galacticSystems.map(s => s.galacticPositionLightYears.x);
  const zs = galacticSystems.map(s => s.galacticPositionLightYears.z);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const zmin = Math.min(...zs), zmax = Math.max(...zs);
  const span = Math.max(1, xmax - xmin, zmax - zmin);
  const scale = Math.min(
    (VIEW.width - VIEW.margin * 2) / span,
    (VIEW.height - VIEW.margin * 2) / span
  );
  const cx = (xmin + xmax) / 2, cz = (zmin + zmax) / 2;
  return Object.fromEntries(galacticSystems.map(s => [
    s.id,
    {
      x: VIEW.width / 2 + (s.galacticPositionLightYears.x - cx) * scale,
      y: VIEW.height / 2 - (s.galacticPositionLightYears.z - cz) * scale
    }
  ]));
}

/** Schematic projection of authored galactic LY positions, not a physical WebGL flight scene. */
export function GalacticMap({
  snapshot, canCommand, onPlot, onClose, onShowJumpControls
}: GalacticMapProps) {
  const systemId = snapshot?.universe.systemId ?? galacticSystems[0].id;
  const [selectedId, setSelectedId] = useState(() => linkedDestinations(systemId)[0]?.id ?? systemId);
  const points = useMemo(projectedChart, []);
  const selection = galacticSystems.find(s => s.id === selectedId) ?? galacticSystems[0];
  const route = galacticRoute(systemId, selectedId);
  const state = snapshot?.interstellar;
  const eligibility = jumpEligibility(snapshot, canCommand);
  const plotted = state?.destinationSystemId === selectedId && state.originSystemId === systemId &&
    state.routeId === route?.link.id;
  const canPlot = canCommand && eligibility.canPlot && Boolean(route);
  const routes = listInterstellarRoutes();

  useEffect(() => {
    setSelectedId(previous => selectedSystemAfterTransition(previous, systemId));
  }, [systemId]);

  return <div className="galactic-map-shade" role="presentation">
    <section className="galactic-map-dialog" role="dialog" aria-modal="true" aria-label="Galactic Navigation map">
      <header className="galactic-map-heading">
        <div>
          <span className="galactic-overline">ASTROGRAPHY / INTERSTELLAR OPERATIONS</span>
          <h2>GALACTIC NAVIGATION</h2>
          <p>Connected systems are plotted in light-years. Selection does not move the ship.</p>
        </div>
        <button onClick={onClose} aria-label="Close Galactic Navigation">CLOSE ×</button>
      </header>
      <div className="galactic-map-body">
        <div className="galactic-chart-column">
          <div className="galactic-chart-meta">
            <span>SECTOR CHART · X/Z PROJECTION</span>
            <span>OUT-OF-PLANE Y SHOWN IN SYSTEM DETAILS</span>
          </div>
          <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} className="galactic-chart"
            role="img" aria-label="Galactic route chart showing authored star-system positions">
            <defs>
              <pattern id="sectorGrid" patternUnits="userSpaceOnUse" width="46" height="46">
                <path d="M 46 0 L 0 0 0 46" fill="none" stroke="#28465c" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width={VIEW.width} height={VIEW.height} fill="url(#sectorGrid)"/>
            {routes.map(link => {
              const a = points[link.systemAId], b = points[link.systemBId];
              if (!a || !b) return null;
              const chosen = link.id === route?.link.id;
              return <line key={link.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={chosen ? "#68dfe9" : "#426a83"} strokeWidth={chosen ? 3 : 2}
                strokeDasharray="8 7" opacity={chosen ? 1 : .65}/>;
            })}
            {galacticSystems.map(s => {
              const p = points[s.id];
              const current = s.id === systemId;
              const selected = s.id === selectedId;
              const ordered = s.id === state?.destinationSystemId;
              return <g key={s.id} className="galactic-star-marker">
                {selected && <circle cx={p.x} cy={p.y} r="29" fill="none" stroke="#72f6ff" strokeWidth="2"/>}
                {ordered && <circle cx={p.x} cy={p.y} r="23" fill="none" stroke="#ffbd77"
                  strokeDasharray="5 4" strokeWidth="2"/>}
                <circle cx={p.x} cy={p.y} r={current ? 15 : 12} fill={current ? "#ffe0ac" : "#a1d6ff"}
                  stroke="#0b253a" strokeWidth="4"/>
                <text x={p.x} y={p.y + 44} textAnchor="middle" fill="#d9f0fc"
                  fontSize="16" fontWeight="700">{s.name}</text>
                {current && <text x={p.x} y={p.y - 30} textAnchor="middle" fill="#9ee8c2"
                  fontSize="12">SHIP HERE</text>}
              </g>;
            })}
          </svg>
          <div className="galactic-map-legend">
            <span><i className="selected"/> SELECTED PREVIEW</span>
            <span><i className="plotted"/> SERVER-PLOTTED</span>
            <span><i className="current"/> CURRENT SYSTEM</span>
          </div>
          <p>Positions use the catalog's X/Z light-year coordinates; route distances use all three dimensions. Not an AU- or metre-scale map.</p>
        </div>
        <aside className="galactic-map-aside">
          <h3>REGISTERED SYSTEMS</h3>
          <div className="galactic-system-options">
            {galacticSystems.map(s => <button key={s.id}
              className={selectedId === s.id ? "selected" : ""}
              onClick={() => setSelectedId(s.id)} aria-pressed={selectedId === s.id}>
              <span>{s.name}{systemId === s.id ? " · CURRENT" : ""}</span>
              <small>{linkedDestinations(systemId).some(x => x.id === s.id) ? "DIRECT JUMP LINK" :
                s.id === systemId ? "LOCAL SYSTEM" : "NO DIRECT LINK"}</small>
            </button>)}
          </div>
          <div className="galactic-selection">
            <span className="galactic-overline">01 / SELECTED · NOT PLOTTED</span>
            <h3>{selection.name}</h3>
            <p>{selection.description}</p>
            <div className="galactic-facts">
              <div><span>Catalog X/Y/Z</span><strong>{
                Object.values(selection.galacticPositionLightYears).map(v => v.toFixed(1)).join(" / ")
              } ly</strong></div>
              <div><span>Route distance</span><strong>{route ? route.distanceLightYears.toFixed(2) + " ly" : "UNAVAILABLE"}</strong></div>
              <div><span>Drive range</span><strong>{route ? route.link.maxDistanceLightYears.toFixed(1) + " ly" : "—"}</strong></div>
              <div><span>Server-plotted</span><strong>{jumpDestinationName(snapshot)}</strong></div>
              <div><span>Drive state</span><strong>{jumpPhaseLabel(snapshot)}</strong></div>
              <div><span>Server ETA</span><strong>{jumpEta(state?.etaSeconds)}</strong></div>
            </div>
          </div>
          {canCommand ? <>
            <button className="galactic-plot-button" disabled={!canPlot || Boolean(plotted)}
              onClick={() => onPlot(selectedId)}>
              {plotted ? "ROUTE PLOTTED ✓" : "PLOT SELECTED ROUTE"}
            </button>
            <p className="galactic-readiness">{plotted ? "Server-confirmed course. Engage from Helm Jump Drive." :
              eligibility.reason}</p>
            <button className="galactic-return-button" onClick={onShowJumpControls}>
              RETURN TO HELM JUMP CONTROLS
            </button>
          </> : <div className="galactic-observer-note">
            MAIN SCREEN · READ ONLY. Helm controls interstellar route plotting and jump engagement.
          </div>}
          <div className="galactic-stage-note">
            Voyages switch to a freshly rebuilt destination star scene on server-confirmed arrival. No galactic metre coordinates are rendered.
          </div>
        </aside>
      </div>
    </section>
  </div>;
}
