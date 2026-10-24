import { formatAstronomicalDistance, type GameSnapshot } from "@bridge-sim/shared";
import { assessPlanetView } from "./planetView";

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
  const {
    system, body, geometry, blocker,
    angularDiameterDegrees, fieldOfViewDegrees,
    isSurfaceCloseup, surfaceIllumination
  } = assessPlanetView(snapshot, focusId, opticalZoom);

  return <div className="planet-view-controls">
    <label className="planet-view-label">
      <span>Optical target — currently {body.name}</span>
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
    {isSurfaceCloseup && <div className="planet-zoom-explanation" role="status">
      <strong>{opticalZoom}× close-up: {body.name} {surfaceIllumination ?? "surface"}</strong>
      <p>
        This world spans {angularDiameterDegrees.toFixed(1)}° but your optical
        field is only {fieldOfViewDegrees.toFixed(1)}°. You are looking at a small
        patch of its surface, not at the whole planet or its horizon.
        {surfaceIllumination === "night side" ? " Little detail may be visible without sunlight." : ""}
      </p>
      <button className="planet-reset-zoom" onClick={() => setOpticalZoom(1)}>
        Return to 1× orbital panorama
      </button>
    </div>}
    <div className="planet-view-stats">
      <div><span>Focused world</span><strong>{body.name}</strong></div>
      <div><span>Physical radius</span><strong>{formatAstronomicalDistance(body.radiusMeters)}</strong></div>
      <div><span>Range to centre</span><strong>{formatAstronomicalDistance(geometry.distanceMeters)}</strong></div>
      <div><span>Surface altitude</span><strong>{geometry.altitudeMeters < 0
        ? "Below surface (no collision yet)"
        : formatAstronomicalDistance(geometry.altitudeMeters)}</strong></div>
      <div><span>Apparent diameter</span><strong>{angularDiameterDegrees.toFixed(2)}°</strong></div>
      <div><span>Optical field (at chosen zoom)</span><strong>{fieldOfViewDegrees.toFixed(1)}°</strong></div>
      {surfaceIllumination && <div><span>Visible hemisphere</span><strong>{surfaceIllumination}</strong></div>}
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
      Changing the target or magnification automatically opens the
      <strong> Planet / orbital</strong> camera. At 4× or greater this becomes
      a telescope feed, hiding the local ship and station
      while preserving every object's true angular scale. To inspect Aster, choose
      <strong> Aster · star</strong> above: Automatic targets the nearby world, Haven.
    </p>
  </div>;
}
