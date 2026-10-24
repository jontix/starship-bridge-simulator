import { Room, Client } from "colyseus";
import { applyHelmCommand, createInitialShipState, HelmCommandSchema, stepShip, type GameSnapshot, type PlayerRole, type ShipState } from "@bridge-sim/shared";
type JoinOptions = { role?: PlayerRole };
export class BridgeRoom extends Room {
  maxClients = 8;
  private ship: ShipState = createInitialShipState();
  private roles = new Map<string, PlayerRole>();
  onCreate(): void {
    this.setSimulationInterval((dtMs) => {
      stepShip(this.ship, dtMs / 1000);
      const snapshot: GameSnapshot = { serverTime: Date.now(), ship: this.ship };
      this.broadcast("snapshot", snapshot);
    }, 1000 / 30);
    this.onMessage("role", (client, role: PlayerRole) => {
      this.roles.set(client.sessionId, role);
    });
    this.onMessage("helm_command", (client, payload) => {
      const role = this.roles.get(client.sessionId);
      if (role !== "helm") return;
      const parsed = HelmCommandSchema.safeParse(payload);
      if (!parsed.success) return;
      applyHelmCommand(this.ship, parsed.data);
    });
  }
  onJoin(client: Client, options: JoinOptions): void {
    this.roles.set(client.sessionId, options.role ?? "main-screen");
    client.send("snapshot", { serverTime: Date.now(), ship: this.ship } satisfies GameSnapshot);
  }
  onLeave(client: Client): void {
    this.roles.delete(client.sessionId);
  }
}
