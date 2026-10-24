import { vec3 } from "./math.js";

/** Fixed, non-colliding training landmarks. Client-only navigation aids, not physics entities. */
export const NAV_MARKERS = [
  { id: "A", label: "NAV A · FORWARD", position: vec3(0, 20, 350) },
  { id: "B", label: "NAV B · PORT", position: vec3(-420, 85, 280) },
  { id: "C", label: "NAV C · DORSAL", position: vec3(360, 240, 650) },
  { id: "D", label: "NAV D · AFT", position: vec3(0, -60, -450) }
] as const;
