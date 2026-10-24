import { z } from "zod";
import type { Vec3 } from "./math";
export const RoleSchema = z.enum(["helm", "main-screen"]);
export type PlayerRole = z.infer<typeof RoleSchema>;
export type ShipState = {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  angularVelocity: Vec3;
  desiredYaw: number;
  desiredPitch: number;
  desiredRoll: number;
  desiredSpeed: number;
};
export const HelmCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_heading"), yaw: z.number(), pitch: z.number().default(0), roll: z.number().default(0) }),
  z.object({ type: z.literal("set_speed"), speed: z.number().min(0).max(300) }),
  z.object({ type: z.literal("emergency_stop") })
]);
export type HelmCommand = z.infer<typeof HelmCommandSchema>;
export type GameSnapshot = {
  serverTime: number;
  ship: ShipState;
};
