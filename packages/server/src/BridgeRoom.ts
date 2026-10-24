import { Room, Client } from "colyseus";
import {
  applyHelmCommand, createInitialShipState, HelmCommandSchema,
  RoleSchema, stepShip, type GameSnapshot, type PlayerRole, type ShipState
} from "@bridge-sim/shared";

type JoinOptions = { role?: PlayerRole };
const TICK_SECONDS = 1 / 30;

export class BridgeRoom extends Room {
  maxClients = 8;
  private ship: ShipState = createInitialShipState();
  private roles = new Map<string, PlayerRole>();
  private tick = 0;

  private snapshot(): GameSnapshot {
    return {
      tick: this.tick,
      serverTime: Date.now(),
      ship: {
        ...this.ship,
        position: { ...this.ship.position },
        velocity: { ...this.ship.velocity },
        acceleration: { ...this.ship.acceleration },
        angularVelocity: { ...this.ship.angularVelocity },
        orientation: { ...this.ship.orientation }
      }
    };
  }

  onCreate(): void {
    this.setSimulationInterval(() => {
      stepShip(this.ship, TICK_SECONDS);
      this.tick += 1;
      if (this.tick % 2 === 0) this.broadcast("snapshot", this.snapshot());
    }, TICK_SECONDS * 1000);

    this.onMessage("helm_command", (client, payload: unknown) => {
      if (this.roles.get(client.sessionId) !== "helm") return;
      const parsed = HelmCommandSchema.safeParse(payload);
      if (!parsed.success) return;
      applyHelmCommand(this.ship, parsed.data);
    });
  }

  onJoin(client: Client, options: JoinOptions): void {
    const role = RoleSchema.safeParse(options.role);
    this.roles.set(client.sessionId, role.success ? role.data : "main-screen");
    client.send("snapshot", this.snapshot());
  }

  onLeave(client: Client): void {
    this.roles.delete(client.sessionId);
  }
}
