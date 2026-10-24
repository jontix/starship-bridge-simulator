import {
  apparentBodyGeometry, choosePlanetFocus,
  formatAstronomicalDistance, getStarSystem, lineOfSightBlocker,
  shipPositionFromSnapshot, systemPositionsAt,
  type GameSnapshot
} from "@bridge-sim/shared";

export function PlanetViewControls({
  snapshot, focusId, setFocusId, opticalZoom, setOpticalZoom
}: {
  snapshot: GameSnapshot | null;
  focusId: string;
  setFocusId: (id: string) => void;
  opticalZoom: number;
  setOpticalZoom: (zoom: number) => void;
}) {
  if (!snapshot) return null;
  const system = getStarSystem(snapshot.universe.systemId);
  const body = choosePlanetFocus(system, snapshot.universe.referenceBodyId,
    snapshot.cruise.targetId, focusId);
  const positions = systemPositionsAt(system, snapshot.universe.epochSeconds);
  const worldPosition = positions[body.id];
  const ship = shipPositionFromSnapshot(system, snapshot);
  const geometry = apparentBodyGeometry(body.radiusMeters, worldPosition, ship);
  const blocker = lineOfSightBlocker(system, positions, ship, body.id);
  const angularDiameter = geometry.apparentAngularRadiusRadians * 360 / Math.PI;

  return <div className="planet-view-controls">
    <label className="planet-view-label">
      <span>Planet / orbital camera focus</span>
      <select aria-label="Focused planet" value={focusId} onChange={e => setFocusId(e.target.value)}>
        <option value="auto">Automatic (local planet / cruise destination)</option>
        {system.bodies.filter(b => b.kind !== "station").map(b => (
          <option value={b.id} key={b.id}>{b.name} · {b.kind}</option>
        ))}
      </select>
    </label>
    <label className="planet-view-label orbital-optical-zoom">
      <span>Optical magnification (planet camera only)</span>
      <select aria-label="Optical magnification" value={opticalZoom}
        onChange={event => setOpticalZoom(Number(event.target.value))}>
        {[1, 2, 4, 8, 16, 32].map(zoom => (
          <option value={zoom} key={zoom}>{zoom}× {zoom >= 4 ? "· telescope" : "· exterior view"}</option>
        ))}
      </select>
    </label>
    <div className="planet-view-stats">
      <div><span>Focused world</span><strong>{body.name}</strong></div>
      <div><span>Physical radius</span><strong>{formatAstronomicalDistance(body.radiusMeters)}</strong></div>
      <div><span>Range to centre</span><strong>{formatAstronomicalDistance(geometry.distanceMeters)}</strong></div>
      <div><span>Surface altitude</span><strong>{geometry.altitudeMeters < 0
        ? "Below surface (no collision yet)"
        : formatAstronomicalDistance(geometry.altitudeMeters)}</strong></div>
      <div><span>Apparent diameter</span><strong>{angularDiameter.toFixed(2)}°</strong></div>
      <div><span>Centre sightline</span><strong>{blocker
        ? "Blocked by " + blocker.name
        : "Clear"}</strong></div>
    </div>
    {blocker && <p className="subtle" role="status">
      {body.name} centre sightline blocked by {blocker.name}.
      The selected world may be fully or partially hidden behind this closer body;
      change course or continue observing as orbital positions evolve.
    </p>}
    <p className="subtle planet-view-hint">
      Globes have actual angular scale in 3D. System Map icons remain schematic.
      Select <strong>Planet / orbital</strong> camera for a dedicated world-facing view.
      At 4× or greater this becomes a telescope feed, hiding the local ship and station
      while preserving every object's true angular scale.
    </p>
  </div>;
}
