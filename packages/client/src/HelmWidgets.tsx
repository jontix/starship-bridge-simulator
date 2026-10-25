import { useId, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { ShipState } from "@bridge-sim/shared";
import {
  bearingDistance, currentHeadingFromShip, offAxisDriftDegrees, velocityHeading,
  wrapHeading, type HelmDraftHeading
} from "./helmInstruments";

const radialPoint = (bearing: number, radius: number) => {
  const theta = bearing * Math.PI / 180;
  return { x: 120 + Math.sin(theta) * radius, y: 120 - Math.cos(theta) * radius };
};

function BearingPointer({ bearing, radius, color, label, size = 5 }: {
  bearing: number; radius: number; color: string; label: string; size?: number;
}) {
  const point = radialPoint(bearing, radius);
  return <g aria-label={label}>
    <circle cx={point.x} cy={point.y} r={size + 5} fill={color} fillOpacity=".12"/>
    <circle cx={point.x} cy={point.y} r={size} fill={color} stroke="#07121e" strokeWidth="2"/>
  </g>;
}

export function HeadingDial({ ship, heading, onPick, disabled }: {
  ship: ShipState | null | undefined;
  heading: HelmDraftHeading;
  onPick: (bearing: number) => void;
  disabled: boolean;
}) {
  const gradientId = useId().replace(/:/g, "");
  const actual = ship ? currentHeadingFromShip(ship) : null;
  const velocity = ship ? velocityHeading(ship.velocity) : null;
  const ordered = ship ? ship.desiredYaw * 180 / Math.PI : null;
  const pointer = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * 240 - 120;
    const y = (event.clientY - bounds.top) / bounds.height * 240 - 120;
    if (Math.hypot(x, y) < 27 || Math.hypot(x, y) > 112) return;
    onPick(Math.round(wrapHeading(Math.atan2(x, -y) * 180 / Math.PI)));
  };
  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onPick(wrapHeading(heading.yaw + (event.key === "ArrowRight" ? 5 : -5)));
    }
  };
  const ticks = Array.from({ length: 72 }, (_, index) => {
    const bearing = index * 5;
    const from = radialPoint(bearing, index % 6 === 0 ? 100 : index % 3 === 0 ? 104 : 107);
    const to = radialPoint(bearing, 112);
    return <line key={index} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
      stroke={index % 6 === 0 ? "#78d2e1" : "#355168"}
      strokeWidth={index % 6 === 0 ? 1.5 : 0.8}/>;
  });
  return <div className="helm-compass">
    <svg viewBox="0 0 240 240" className="helm-compass-dial"
      role="slider" tabIndex={disabled ? -1 : 0}
      aria-label="Select world bearing" aria-valuemin={-180} aria-valuemax={180}
      aria-valuenow={heading.yaw} aria-valuetext={heading.yaw + " degrees"}
      aria-disabled={disabled}
      onPointerDown={pointer} onKeyDown={keyboard}>
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0%" stopColor="#12354a" stopOpacity=".9"/>
          <stop offset="74%" stopColor="#0b2335" stopOpacity=".8"/>
          <stop offset="100%" stopColor="#020b17" stopOpacity=".95"/>
        </radialGradient>
      </defs>
      <circle cx="120" cy="120" r="113" fill={`url(#${gradientId})`}
        stroke="#34718c" strokeWidth="1.5"/>
      <circle cx="120" cy="120" r="94" fill="none" stroke="#2a5266" strokeDasharray="2 6"/>
      <circle cx="120" cy="120" r="68" fill="none" stroke="#234459" strokeWidth="1"/>
      <circle cx="120" cy="120" r="35" fill="none" stroke="#355c6a" strokeWidth="1"/>
      <line x1="120" y1="9" x2="120" y2="231" stroke="#265067" strokeWidth=".8"/>
      <line x1="9" y1="120" x2="231" y2="120" stroke="#265067" strokeWidth=".8"/>
      {ticks}
      <text x="120" y="22" textAnchor="middle" className="helm-compass-direction">000</text>
      <text x="219" y="124" textAnchor="middle" className="helm-compass-direction">090</text>
      <text x="120" y="226" textAnchor="middle" className="helm-compass-direction">180</text>
      <text x="21" y="124" textAnchor="middle" className="helm-compass-direction">270</text>
      {actual && <line x1="120" y1="120" x2={radialPoint(actual.yaw, 64).x}
        y2={radialPoint(actual.yaw, 64).y} stroke="#e2f7ff" strokeWidth="3" strokeLinecap="round"/>}
      {velocity && <line x1="120" y1="120" x2={radialPoint(velocity.yaw, 83).x}
        y2={radialPoint(velocity.yaw, 83).y} stroke="#65eba4" strokeWidth="1.5" strokeDasharray="5 4"/>}
      {ordered !== null && <BearingPointer bearing={ordered} radius={95} color="#ffbe69" label="Ordered heading" size={5}/>}
      {velocity && <BearingPointer bearing={velocity.yaw} radius={83} color="#65eba4" label="Velocity vector" size={4}/>}
      {actual && <BearingPointer bearing={actual.yaw} radius={64} color="#e2f7ff" label="Actual bow heading" size={5}/>}
      <BearingPointer bearing={heading.yaw} radius={107} color="#58eaff" label="Preview heading" size={6}/>
      <circle cx="120" cy="120" r="21" fill="#051524" stroke="#47748a" strokeWidth="1.2"/>
      <path d="M120 106 L129 132 L120 126 L111 132 Z" fill="#d9f7ff"/>
      <text x="120" y="157" textAnchor="middle" fill="#9ce5ed" fontSize="9" fontWeight="700">WORLD</text>
    </svg>
    <div className="helm-compass-key">
      <span><i className="helm-key-dot preview"/> Selected</span>
      <span><i className="helm-key-dot ordered"/> Ordered</span>
      <span><i className="helm-key-dot actual"/> Bow</span>
      <span><i className="helm-key-dot velocity"/> Velocity</span>
    </div>
    <p className="helm-hint">Tap the compass to preview a bearing; arrow keys adjust by 5°. Engage to transmit.</p>
  </div>;
}

export function AxisStepper({ label, value, actual, step, min, max, onChange }: {
  label: string; value: number; actual: number | null;
  step: number; min: number; max: number; onChange: (value: number) => void;
}) {
  const adjust = (value: number) => onChange(Math.max(min, Math.min(max, value)));
  return <div className="helm-axis-control">
    <div className="helm-axis-caption"><span>{label}</span>
      <small>Actual {actual === null ? "—" : Math.round(actual) + "°"}</small>
    </div>
    <div className="helm-axis-inputrow">
      <button type="button" aria-label={"Decrease " + label} onClick={() => adjust(value - step)}>−</button>
      <label><input type="number" aria-label={label} min={min} max={max} step={1}
        value={value} onChange={event => adjust(Number(event.target.value))}/><span>°</span></label>
      <button type="button" aria-label={"Increase " + label} onClick={() => adjust(value + step)}>+</button>
    </div>
  </div>;
}

export function StatusMetric({ label, value, foot, intent }: {
  label: string; value: string; foot?: string; intent?: "good" | "warning" | "normal";
}) {
  return <div className={`helm-status-metric ${intent ?? "normal"}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    {foot && <small>{foot}</small>}
  </div>;
}

export function ModuleHeader({ index, title, extra }: {
  index: string; title: string; extra?: ReactNode;
}) {
  return <div className="helm-module-title"><div><span>{index}</span><strong>{title}</strong></div>{extra}</div>;
}

export function FlightMotionGlyph({ ship }: { ship: ShipState | null | undefined }) {
  const drift = ship ? offAxisDriftDegrees(ship) : null;
  const ratio = drift === null ? 0 : Math.min(1, drift / 180);
  const offsetX = 67 + Math.sin(ratio * Math.PI) * 37;
  const offsetY = 67 - Math.cos(ratio * Math.PI) * 37;
  return <div className="helm-motion-glyph">
    <svg viewBox="0 0 134 134" aria-label="Bow and world motion alignment instrument" role="img">
      <circle cx="67" cy="67" r="57" fill="none" stroke="#255269" strokeWidth="1.5"/>
      <circle cx="67" cy="67" r="38" fill="none" stroke="#1b3f58" strokeDasharray="4 5"/>
      <line x1="67" y1="6" x2="67" y2="128" stroke="#28546a"/>
      <line x1="6" y1="67" x2="128" y2="67" stroke="#28546a"/>
      <path d="M67 24 L78 72 L67 64 L56 72 Z" fill="#d5f6ff" stroke="#6ac8e7" strokeWidth="1.4"/>
      {drift !== null && <circle cx={offsetX} cy={offsetY} r="7" fill="#65eba4" stroke="#0e2530" strokeWidth="2"/>}
      <circle cx="67" cy="67" r="3" fill="#dff8ff"/>
    </svg>
    <div><strong>{drift === null ? "STATIONARY" : drift.toFixed(0) + "°"}</strong>
      <span>Bow / velocity separation</span>
    </div>
  </div>;
}

export function ConvergenceBar({ ship }: { ship: ShipState | null | undefined }) {
  if (!ship) return null;
  const desired = ship.desiredYaw * 180 / Math.PI;
  const actual = currentHeadingFromShip(ship);
  const error = bearingDistance(desired, actual.yaw);
  const pct = Math.max(0, Math.min(100, 100 - error / 180 * 100));
  return <div className="helm-convergence">
    <div><span>Bearing convergence</span><strong>{error.toFixed(1)}° remaining</strong></div>
    <div className="helm-convergence-track" role="progressbar"
      aria-label="Bearing convergence" aria-valuenow={Math.round(pct)}
      aria-valuemin={0} aria-valuemax={100}><span style={{ width: pct + "%" }}/></div>
  </div>;
}
