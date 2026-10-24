import { z } from "zod";
import type { Quat, Vec3 } from "./math.js";

export const RoleSchema = z.enum(["helm", "main-screen"]);
export type PlayerRole = z.infer<typeof RoleSchema>;

export type ShipState = {
  position: Vec3;                    // Metres, world axes
  velocity: Vec3;                    // Metres / second, world axes
  acceleration: Vec3;                // Metres / second^2, world axes
  orientation: Quat;                 // World orientation, +Z ship forward
  angularVelocity: Vec3;            // Radians / second, world axes
  desiredYaw: number;               // Radians
  desiredPitch: number;
  desiredRoll: number;
  desiredSpeed: number;             // Forward m/s relative to ship
  desiredStrafe: number;            // Starboard m/s relative to ship
  desiredLift: number;              // Dorsal m/s relative to ship
  emergencyStopping: boolean;
};

const finite = z.number().finite();
export const HelmCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_heading"),
    yaw: finite.min(-Math.PI).max(Math.PI),
    pitch: finite.min(-Math.PI / 2).max(Math.PI / 2),
    roll: finite.min(-Math.PI).max(Math.PI)
  }),
  z.object({ type: z.literal("set_speed"), speed: finite.min(0).max(300) }),
  z.object({
    type: z.literal("set_translation"),
    strafe: finite.min(-60).max(60),
    lift: finite.min(-60).max(60)
  }),
  z.object({ type: z.literal("emergency_stop") })
]);
export type HelmCommand = z.infer<typeof HelmCommandSchema>;

export type GameSnapshot = {
  universe: {
    systemId: string;
    epochSeconds: number;
    referenceBodyId: string;
  };
  tick: number;
  serverTime: number;
  ship: ShipState;
};
