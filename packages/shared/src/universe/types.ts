import type { Vec3 } from "../math.js";

export type BodyKind = "star" | "planet" | "moon" | "station";

/** Analytic two-body orbit. All distances in metres, angles in radians, and times in seconds. */
export type OrbitalElements = {
  semiMajorAxisMeters: number;
  eccentricity: number;
  inclinationRadians: number;
  ascendingNodeRadians: number;
  periapsisArgumentRadians: number;
  meanAnomalyAtEpochRadians: number;
  periodSeconds: number;
};

export type CelestialBody = {
  id: string;
  name: string;
  kind: BodyKind;
  parentId: string | null;
  radiusMeters: number;
  mapColor: string;
  orbit: OrbitalElements | null;
  description: string;
};

export type StarSystem = {
  id: string;
  name: string;
  description: string;
  galacticPositionLightYears: Vec3;
  epochUnixSeconds: number;
  bodies: readonly CelestialBody[];
  /** The ship's existing 6DOF state remains LOCAL to this non-rotating, co-moving frame. */
  start: {
    referenceBodyId: string;
    offsetFromReferenceMeters: Vec3;
  };
};
