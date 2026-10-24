import {
  apparentBodyGeometry, bodyPositionAt, choosePlanetFocus,
  formatAstronomicalDistance, getStarSystem, shipPositionFromSnapshot,
  type GameSnapshot
} from "@bridge-sim/shared";

export function PlanetViewControls({
  snapshot, focusId, setFocusId
}: { snapshot: GameSnapshot | null; focusId: string; setFocusId: (id: string) => void }) {
  if (!snapshot) return null;
  const system = getStarSystem(snapshot.universe.systemId);
  const body = choosePlanetFocus(system, snapshot.universe.referenceBodyId,
    snapshot.cruise.targetId, focusId);
  const positions = bodyPositionAt(system, body.id, snapshot.universe.epochSeconds);
  const ship = shipPositionFromSnapshot(system, snapshot);
  const geometry = apparentBodyGeometry(body.radiusMeters, positions, ship);
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
    <div className="planet-view-stats">
      <div><span>Focused world</span><strong>{body.name}</strong></div>
      <div><span>Physical radius</span><strong>{formatAstronomicalDistance(body.radiusMeters)}</strong></div>
      <div><span>Range to centre</span><strong>{formatAstronomicalDistance(geometry.distanceMeters)}</strong></div>
      <div><span>Surface altitude</span><strong>{geometry.altitudeMeters < 0
        ? "Below surface (no collision yet)"
        : formatAstronomicalDistance(geometry.altitudeMeters)}</strong></div>
      <div><span>Apparent diameter</span><strong>{angularDiameter.toFixed(2)}°</strong></div>
    </div>
    <p className="subtle planet-view-hint">
      Globes have actual angular scale in 3D. System Map icons remain schematic.
      Select <strong>Planet / orbital</strong> camera for a dedicated world-facing view.
    </p>
  </div>;
}
