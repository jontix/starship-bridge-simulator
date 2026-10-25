import { vec3 } from "../math.js";
import type { CelestialBody, OrbitalElements, StarSystem } from "./types.js";
import { METRES_PER_AU as AU, days, kilometres as km, radians as rad, years } from "./units.js";

function orbit(
  a: number, periodSeconds: number, eccentricity = 0,
  inclinationDegrees = 0, ascendingNodeDegrees = 0,
  periapsisDegrees = 0, meanAnomalyDegrees = 0
): OrbitalElements {
  return {
    semiMajorAxisMeters: a,
    periodSeconds,
    eccentricity,
    inclinationRadians: rad(inclinationDegrees),
    ascendingNodeRadians: rad(ascendingNodeDegrees),
    periapsisArgumentRadians: rad(periapsisDegrees),
    meanAnomalyAtEpochRadians: rad(meanAnomalyDegrees)
  };
}

const bodies: CelestialBody[] = [
  {
    id: "aster", name: "Aster", kind: "star", parentId: null,
    radiusMeters: km(696_000), mapColor: "#ffc879", orbit: null,
    description: "A stable G-type star and primary gravitational reference.",
    appearance: { archetype: "stellar", seed: 3101, axialTiltRadians: rad(7), rotationPeriodSeconds: days(25.4) }
  },
  {
    id: "cinder", name: "Cinder", kind: "planet", parentId: "aster",
    radiusMeters: km(2_440), mapColor: "#b59e93",
    orbit: orbit(0.39 * AU, days(88), 0.19, 6, 30, 77, 15),
    description: "An airless, sun-scorched rocky world.",
    appearance: { archetype: "rocky", seed: 12044, axialTiltRadians: rad(1.8), rotationPeriodSeconds: days(58.6) }
  },
  {
    id: "haven", name: "Haven", kind: "planet", parentId: "aster",
    radiusMeters: km(6_370), mapColor: "#57b6d8",
    orbit: orbit(1.02 * AU, days(372), 0.018, 2.4, 21, 104, 210),
    description: "A temperate ocean world and centre of local traffic.",
    appearance: { archetype: "ocean", seed: 48271, axialTiltRadians: rad(24), rotationPeriodSeconds: days(1.04),
      atmosphere: { colorHex: "#52a8f8", thicknessMeters: km(110) },
      clouds: { altitudeMeters: km(17), coverage: 0.46 } }
  },
  {
    id: "selene", name: "Selene", kind: "moon", parentId: "haven",
    radiusMeters: km(1_740), mapColor: "#ccd4d7",
    orbit: orbit(km(384_400), days(27.32), 0.055, 5, 40, 29, 125),
    description: "Haven's largest natural satellite and observatory site.",
    appearance: { archetype: "airless", seed: 6383, axialTiltRadians: rad(6.7), rotationPeriodSeconds: days(27.32) }
  },
  {
    id: "bastion", name: "Bastion", kind: "planet", parentId: "aster",
    radiusMeters: km(69_900), mapColor: "#d9ad8b",
    orbit: orbit(5.25 * AU, years(12.05), 0.048, 1.3, 77, 270, 340),
    description: "A massive gas giant with a long orbital period.",
    appearance: { archetype: "gas-giant", seed: 89011, axialTiltRadians: rad(3.1), rotationPeriodSeconds: days(0.42),
      atmosphere: { colorHex: "#efc8a3", thicknessMeters: km(850) },
      rings: { innerRadiusRatio: 1.08, outerRadiusRatio: 1.38, colorHex: "#e3d4bb" } }
  },
  {
    id: "tundra", name: "Tundra", kind: "planet", parentId: "aster",
    radiusMeters: km(24_600), mapColor: "#8fbed0",
    orbit: orbit(18.7 * AU, years(80.7), 0.012, 3, 95, 45, 110),
    description: "A distant cold ice giant, useful for long-range navigation.",
    appearance: { archetype: "ice-giant", seed: 20038, axialTiltRadians: rad(28), rotationPeriodSeconds: days(0.69),
      atmosphere: { colorHex: "#8fd8f8", thicknessMeters: km(400) } }
  },
  {
    id: "haven-highport", name: "Haven Highport", kind: "station", parentId: "haven",
    radiusMeters: 320, mapColor: "#90ebc5",
    orbit: orbit(km(6_800), days(0.065), 0, 0.7, 12, 0, 23),
    description: "Orbital traffic hub. The initial training ship spawns 300 m away in a co-moving frame."
  },
  {
    id: "selene-observatory", name: "Selene Observatory", kind: "station", parentId: "selene",
    radiusMeters: 140, mapColor: "#b6e9e1",
    orbit: orbit(km(1_950), days(0.09), 0, 8, 14, 0, 49),
    description: "Scientific outpost orbiting Selene."
  },
  {
    id: "bastion-platform", name: "Bastion Platform", kind: "station", parentId: "bastion",
    radiusMeters: 480, mapColor: "#ffd9a6",
    orbit: orbit(km(105_000), days(0.55), 0.01, 4, 140, 22, 188),
    description: "A refuelling and survey platform in the giant planet's orbit."
  }
];

export const ASTER_REACH: StarSystem = {
  id: "aster-reach",
  name: "Aster Reach",
  description: "A fictional test system with realistically sized worlds, Keplerian orbits, moons, and orbital stations.",
  galacticPositionLightYears: vec3(0, 0, 0),
  epochUnixSeconds: Date.UTC(2026, 9, 24, 0, 0, 0) / 1000,
  start: { referenceBodyId: "haven-highport", offsetFromReferenceMeters: vec3(0, 0, 300) },
  interstellarArrival: {
    referenceBodyId: "haven-highport", offsetFromReferenceMeters: vec3(0, 0, 250_000)
  },
  bodies
};
