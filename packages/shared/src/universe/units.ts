export const METRES_PER_KILOMETRE = 1_000;
export const METRES_PER_AU = 149_597_870_700;
export const SECONDS_PER_DAY = 86_400;
export const SECONDS_PER_YEAR = 365.256363004 * SECONDS_PER_DAY;
export const radians = (degrees: number): number => degrees * Math.PI / 180;
export const kilometres = (km: number): number => km * METRES_PER_KILOMETRE;
export const days = (value: number): number => value * SECONDS_PER_DAY;
export const years = (value: number): number => value * SECONDS_PER_YEAR;

/** Human-friendly scalar distances, keeping authoritative coordinates unrounded. */
export function formatAstronomicalDistance(distanceMetres: number): string {
  const metres = Math.abs(distanceMetres);
  if (metres >= METRES_PER_AU * 0.03) return (metres / METRES_PER_AU).toFixed(3) + " AU";
  if (metres >= 1_000_000) return (metres / 1_000).toLocaleString("en-GB", { maximumFractionDigits: 0 }) + " km";
  if (metres >= 1_000) return (metres / 1_000).toFixed(1) + " km";
  return metres.toFixed(0) + " m";
}
