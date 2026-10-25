import { vec3 } from "../math.js";
import type { CelestialBody, OrbitalElements, StarSystem } from "./types.js";
import { METRES_PER_AU as AU, days, kilometres as km, radians as rad, years } from "./units.js";

/** Vesper is deliberately visually and geographically distinct from Aster Reach. */
function orbit(
  semiMajorAxisMeters: number, periodSeconds: number, eccentricity = 0,
  inclinationDegrees = 0, ascendingNodeDegrees = 0,
  periapsisDegrees = 0, meanAnomalyDegrees = 0
): OrbitalElements {
  return {
    semiMajorAxisMeters, periodSeconds, eccentricity,
    inclinationRadians: rad(inclinationDegrees),
    ascendingNodeRadians: rad(ascendingNodeDegrees),
    periapsisArgumentRadians: rad(periapsisDegrees),
    meanAnomalyAtEpochRadians: rad(meanAnomalyDegrees)
  };
}

const bodies: CelestialBody[] = [
  {
    id: "vesper-primary", name: "Vesper", kind: "star", parentId: null,
    radiusMeters: km(478_000), mapColor: "#ffad74", orbit: null,
    description: "A warm orange K-type star beyond the Aster Reach corridor.",
    appearance: { archetype: "stellar", seed: 71502, axialTiltRadians: rad(12), rotationPeriodSeconds: days(31) }
  },
  {
    id: "ember", name: "Ember", kind: "planet", parentId: "vesper-primary",
    radiusMeters: km(2_950), mapColor: "#ae6651",
    orbit: orbit(0.35 * AU, days(81), 0.12, 4, 19, 72, 148),
    description: "A baked, iron-rich inner planet marked by deep shadows.",
    appearance: { archetype: "airless", seed: 70103, axialTiltRadians: rad(3), rotationPeriodSeconds: days(64) }
  },
  {
    id: "caldera", name: "Caldera", kind: "planet", parentId: "vesper-primary",
    radiusMeters: km(5_170), mapColor: "#c17d51",
    orbit: orbit(0.84 * AU, days(302), 0.045, 3, 58, 44, 228),
    description: "Dry desert highlands and rust-coloured basins beneath a thin atmosphere.",
    appearance: { archetype: "rocky", seed: 70411, axialTiltRadians: rad(19), rotationPeriodSeconds: days(1.2),
      atmosphere: { colorHex: "#d49b79", thicknessMeters: km(65) } }
  },
  {
    id: "umbra", name: "Umbra", kind: "planet", parentId: "vesper-primary",
    radiusMeters: km(26_200), mapColor: "#6e9cba",
    orbit: orbit(6.4 * AU, years(20.4), 0.06, 8, 102, 179, 35),
    description: "An indigo ice giant surrounded by cold distant debris.",
    appearance: { archetype: "ice-giant", seed: 73522, axialTiltRadians: rad(34), rotationPeriodSeconds: days(0.71),
      atmosphere: { colorHex: "#7696cc", thicknessMeters: km(380) },
      rings: { innerRadiusRatio: 1.24, outerRadiusRatio: 1.58, colorHex: "#a1a9c7" } }
  },
  {
    id: "shard", name: "Shard", kind: "moon", parentId: "umbra",
    radiusMeters: km(1_080), mapColor: "#c5bacc",
    orbit: orbit(km(260_000), days(9.4), 0.015, 13, 65, 21, 295),
    description: "A fractured icy satellite used as a long-range navigation landmark.",
    appearance: { archetype: "airless", seed: 74901, axialTiltRadians: rad(6), rotationPeriodSeconds: days(9.4) }
  },
  {
    id: "vesper-gateway", name: "Vesper Gateway", kind: "station", parentId: "caldera",
    radiusMeters: 380, mapColor: "#8de1d3",
    orbit: orbit(km(6_050), days(0.085), 0.002, 7, 18, 0, 80),
    description: "Navigation and survey station above Caldera; a safe anchor for incoming jumps."
  }
];

export const VESPER: StarSystem = {
  id: "vesper",
  name: "Vesper",
  description: "A warm K-type star, dry inner planets, a remote ice giant, and a frontier jump gateway.",
  galacticPositionLightYears: vec3(4.8, 0.6, 1.4),
  epochUnixSeconds: Date.UTC(2026, 9, 24, 0, 0, 0) / 1000,
  start: { referenceBodyId: "vesper-gateway", offsetFromReferenceMeters: vec3(0, 0, 300) },
  // Separate from the initial ship spawn. Arrival remains outside station safety limits.
  interstellarArrival: {
    referenceBodyId: "vesper-gateway",
    offsetFromReferenceMeters: vec3(0, 0, 250_000)
  },
  bodies
};
