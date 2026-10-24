import { useMemo, useState } from "react";
import {
  METRES_PER_AU, SECONDS_PER_DAY, bodyPositionAt, formatAstronomicalDistance,
  getBody, getStarSystem, listStarSystems, localShipToSystemPosition,
  relativeOrbitalPosition, systemPositionsAt,
  type CelestialBody, type GameSnapshot, type StarSystem, type Vec3
} from "@bridge-sim/shared";

type MapProps = { snapshot: GameSnapshot | null; onClose: () => void };

const CENTRE = { x: 334, y: 310 };
const ORBIT_RADIUS = 260;
const TAU = Math.PI * 2;

/** Angular directions preserved; distances compressed logarithmically in the diagram only. */
export function mapProjection(v: Vec3, maxAu: number): { x: number; y: number } {
  const radiusAU = Math.hypot(v.x, v.z) / METRES_PER_AU;
  const radial = Math.log1p(radiusAU / 0.08) / Math.log1p(maxAu / 0.08);
  const bearing = Math.atan2(v.x, v.z);
  return {
    x: CENTRE.x + ORBIT_RADIUS * radial * Math.sin(bearing),
    y: CENTRE.y - ORBIT_RADIUS * radial * Math.cos(bearing)
  };
}

const classFor = (body: CelestialBody): string => "celestial-" + body.kind;

function chooseMapParent(system: StarSystem, body: CelestialBody): CelestialBody {
  let current = body;
  while (current.parentId && current.kind !== "planet") current = getBody(system, current.parentId);
  return current;
}

export function SystemMap({ snapshot, onClose }: MapProps) {
  const [selectionId, setSelectionId] = useState("haven");
  const [previewDays, setPreviewDays] = useState(0);
  const systemId = snapshot?.universe.systemId ?? listStarSystems()[0].id;
  const system = getStarSystem(systemId);
  const bodies = system.bodies;
  const primary = bodies.find(body => body.kind === "star");
  const outer = Math.max(...bodies.filter(body => body.kind === "planet").map(body =>
    (body.orbit?.semiMajorAxisMeters ?? 0) * (1 + (body.orbit?.eccentricity ?? 0)) / METRES_PER_AU
  ), 1);
  const maxAu = outer * 1.08;
  const universeNow = snapshot?.universe.epochSeconds ?? system.epochUnixSeconds;
  const previewTime = universeNow + previewDays * SECONDS_PER_DAY;
  const positions = useMemo(() => systemPositionsAt(system, previewTime), [system, previewTime]);
  const selected = bodies.find(body => body.id === selectionId) ?? bodies.find(body => body.id === "haven") ?? bodies[0];
  const selectedPosition = positions[selected.id];
  const selectedMapParent = chooseMapParent(system, selected);
  const orbitTracks = useMemo(() => bodies
    .filter(body => body.kind === "planet" && body.orbit)
    .map(body => {
      const orbit = body.orbit!;
      const points: string[] = [];
      for (let i = 0; i <= 160; i++) {
        const position = relativeOrbitalPosition(
          orbit, system.epochUnixSeconds + orbit.periodSeconds * i / 160, system.epochUnixSeconds
        );
        const point = mapProjection(position, maxAu);
        points.push((i === 0 ? "M" : "L") + point.x.toFixed(2) + "," + point.y.toFixed(2));
      }
      return { id: body.id, color: body.mapColor, path: points.join(" ") + " Z" };
    }), [system, maxAu]);

  const shipPosition = snapshot
    ? localShipToSystemPosition(system, snapshot.ship.position, universeNow)
    : null;
  const distance = shipPosition && selectedPosition
    ? Math.hypot(
        selectedPosition.x - shipPosition.x,
        selectedPosition.y - shipPosition.y,
        selectedPosition.z - shipPosition.z
      ) : null;
  const parent = selected.parentId ? getBody(system, selected.parentId) : null;
  const orbitalRadius = selected.orbit?.semiMajorAxisMeters;
  const periodDays = selected.orbit ? selected.orbit.periodSeconds / SECONDS_PER_DAY : null;
  const elapsedPreview = previewDays !== 0;
  const stationCount = bodies.filter(body => body.kind === "station").length;

  return (
    <div className="system-map-shade" role="dialog" aria-modal="true" aria-label="Star system navigation map">
      <div className="system-map-dialog">
        <div className="system-map-top">
          <div className="system-map-heading">
            <span className="map-kicker">ASTROGRAPHY / NAVIGATION</span>
            <h2>{system.name}</h2>
            <p>{system.description}</p>
          </div>
          <button className="system-map-close" onClick={onClose} aria-label="Close star system map">×</button>
        </div>

        <div className="system-map-layout">
          <div className="system-map-chart">
            <svg viewBox="0 0 680 630" aria-label="Logarithmically compressed star-system orbit chart" role="img">
              <defs>
                <radialGradient id="starmap-glow">
                  <stop offset="0" stopColor="#ffd08b" stopOpacity="0.6"/>
                  <stop offset="1" stopColor="#ffd08b" stopOpacity="0"/>
                </radialGradient>
              </defs>
              {[0.39, 1, 5, 10].filter(value => value <= maxAu).map(value => {
                const d = mapProjection({ x: value * METRES_PER_AU, y: 0, z: 0 }, maxAu);
                const rad = d.x - CENTRE.x;
                return <g key={value}>
                  <circle cx={CENTRE.x} cy={CENTRE.y} r={rad} fill="none" stroke="#5989a3" strokeOpacity="0.23" strokeDasharray="3 7"/>
                  <text x={CENTRE.x + 4} y={CENTRE.y - rad - 4} fill="#7b9eb8" fontSize="10">{value} AU</text>
                </g>;
              })}
              <path d="M 18 310 H 655 M 334 12 V 605" stroke="#6e8da3" strokeOpacity="0.13" strokeDasharray="4 10"/>
              {orbitTracks.map(track => (
                <path key={track.id} d={track.path} fill="none" stroke={track.color}
                  strokeWidth={selectedMapParent.id === track.id ? 1.7 : 0.9}
                  opacity={selectedMapParent.id === track.id ? 0.8 : 0.32}/>
              ))}
              <circle cx={CENTRE.x} cy={CENTRE.y} r="30" fill="url(#starmap-glow)"/>
              <circle cx={CENTRE.x} cy={CENTRE.y} r="10" fill={primary?.mapColor ?? "#fbc778"} stroke="#ffe7a0" strokeWidth="1.6"/>
              <g role="button" tabIndex={0} onClick={() => primary && setSelectionId(primary.id)}
                onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && primary) setSelectionId(primary.id); }}>
                <circle cx={CENTRE.x} cy={CENTRE.y} r="23" fill="transparent" className="body-click-target"/>
              </g>
              <text x={CENTRE.x + 14} y={CENTRE.y + 6} fontSize="12" fill="#ffe3a6">{primary?.name}</text>
              {bodies.filter(body => body.kind === "planet").map(body => {
                const point = mapProjection(positions[body.id], maxAu);
                const isSelected = selectedMapParent.id === body.id;
                const satellites = bodies.filter(other => other.parentId === body.id).length;
                return <g key={body.id} role="button" tabIndex={0} className="orbit-body"
                  onClick={() => setSelectionId(body.id)}
                  onKeyDown={event => { if (event.key === "Enter" || event.key === " ") setSelectionId(body.id); }}>
                  {isSelected && <circle cx={point.x} cy={point.y} r="18" stroke="#b9f4ff" strokeWidth="1.5" fill="none" strokeDasharray="3 3"/>}
                  <circle cx={point.x} cy={point.y} r={body.id === "bastion" ? 10 : 7}
                    fill={body.mapColor} stroke={isSelected ? "#ffffff" : "#7894a6"} strokeWidth={isSelected ? 2 : 0.6}/>
                  <circle cx={point.x} cy={point.y} r="20" fill="transparent" className="body-click-target"/>
                  <text x={point.x + 15} y={point.y - 9} fill="#e5f0f8" fontSize="12">{body.name}</text>
                  {satellites > 0 && <text x={point.x + 15} y={point.y + 5} fill="#7edec3" fontSize="9">{satellites} nearby orbits</text>}
                </g>;
              })}
              {shipPosition && (() => {
                const point = mapProjection(shipPosition, maxAu);
                return <g>
                  <circle cx={point.x} cy={point.y} r="17" fill="none" stroke="#6effd7" strokeWidth="1.2" strokeDasharray="2 4"/>
                  <path d={"M " + point.x + " " + (point.y - 5) + " L " + (point.x + 5) + " " + (point.y + 5) +
                    " L " + (point.x - 5) + " " + (point.y + 5) + " Z"} fill="#8cffe6"/>
                </g>;
              })()}
              <g transform="translate(24 576)" fontSize="11" fill="#a5bbcf">
                <text x="0" y="0">SYSTEM +Z ↑</text>
                <text x="0" y="18">APPARENT RADII COMPRESSED · PLANET ICONS EXAGGERATED</text>
              </g>
            </svg>
            <div className="map-time-controls">
              <div className="map-time-title">
                <strong>Orbital time preview</strong>
                <button onClick={() => setPreviewDays(0)} disabled={!elapsedPreview}>Return to live</button>
              </div>
              <input type="range" min="-365" max="730" step="1" value={previewDays}
                aria-label="Preview orbital days from current universe time"
                onChange={event => setPreviewDays(Number(event.target.value))}/>
              <div className="map-time-meta">
                <span>{previewDays > 0 ? "+" : ""}{previewDays} days</span>
                <span>{new Date(previewTime * 1000).toISOString().slice(0, 10)} UTC</span>
              </div>
              <p>{elapsedPreview ? "PREVIEW ONLY — live ship movement and server time are unchanged." :
                "LIVE: orbital positions are derived from authoritative simulation time."}</p>
            </div>
          </div>

          <aside className="system-map-inspector">
            <div className="map-inspector-status">
              <strong>{bodies.length} orbiting bodies & objects</strong>
              <span>{stationCount} stations · {listStarSystems().length} registered system(s)</span>
            </div>
            <h3>Celestial catalog</h3>
            <div className="map-catalog" role="list" aria-label="Selectable bodies in current system">
              {bodies.map(body => (
                <button key={body.id} className={"map-catalog-body " + classFor(body) +
                  (selected.id === body.id ? " selected" : "")}
                  onClick={() => setSelectionId(body.id)} style={{ paddingLeft: body.parentId === "aster" ? 17 : body.parentId ? 32 : 11 }}>
                  <span className="body-color-dot" style={{ background: body.mapColor }}/>
                  <span>{body.name}<small>{body.kind}</small></span>
                </button>
              ))}
            </div>
            <div className="map-inspector-details">
              <h3>{selected.name}</h3>
              <p>{selected.description}</p>
              <dl>
                <dt>Type</dt><dd>{selected.kind}</dd>
                <dt>Orbits</dt><dd>{parent?.name ?? "System barycentric origin"}</dd>
                <dt>Radius</dt><dd>{formatAstronomicalDistance(selected.radiusMeters)}</dd>
                {orbitalRadius && <><dt>Semi-major axis</dt><dd>{formatAstronomicalDistance(orbitalRadius)}</dd></>}
                {periodDays !== null && <><dt>Orbital period</dt><dd>{periodDays > 365 ? (periodDays / 365.256).toFixed(2) + " years" : periodDays.toFixed(2) + " days"}</dd></>}
                {distance !== null && <><dt>From ship (live)</dt><dd>{formatAstronomicalDistance(distance)}</dd></>}
                <dt>Orbit inclination</dt><dd>{selected.orbit ? (selected.orbit.inclinationRadians * 180 / Math.PI).toFixed(1) + "°" : "—"}</dd>
              </dl>
              <p className="map-note">No cruise or jump orders yet. This map is a navigational and orbital test instrument.</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
