import { Room, Client } from "colyseus";
import {
  applyHelmCommand, createInitialShipState, HelmCommandSchema,
  RoleSchema, stepShip, DEFAULT_SYSTEM_ID, getStarSystem, validateStarSystem,
  beginCruise, createCruiseState, CruiseCommandSchema, requestCruiseDrop,
  selectCruiseTarget, setCruiseThrottle, stepCruise, systemPositionOfShip,
  type CruiseState, type GameSnapshot, type LocalFrame,
  type PlayerRole, type ShipState
} from "@bridge-sim/shared";

type JoinOptions = { role?: PlayerRole };
const TICK_SECONDS = 1 / 30;

export class BridgeRoom extends Room {
  maxClients = 8;
  private ship: ShipState = createInitialShipState();
  private roles = new Map<string, PlayerRole>();
  private tick = 0;
  private readonly starSystem = getStarSystem(process.env.BRIDGE_SYSTEM_ID ?? DEFAULT_SYSTEM_ID);
  private readonly startUnixSeconds = Date.now() / 1000;
  private frame: LocalFrame = {
    referenceBodyId: this.starSystem.start.referenceBodyId,
    offsetFromReferenceMeters: { ...this.starSystem.start.offsetFromReferenceMeters }
  };
  private cruise: CruiseState = createCruiseState();

  private get epochSeconds(): number {
    return this.startUnixSeconds + this.tick * TICK_SECONDS;
  }

  private snapshot(): GameSnapshot {
    return {
      tick: this.tick,
      universe: {
        systemId: this.starSystem.id,
        epochSeconds: this.epochSeconds,
        referenceBodyId: this.frame.referenceBodyId,
        frameOffsetMeters: { ...this.frame.offsetFromReferenceMeters }
      },
      cruise: {
        ...this.cruise,
        positionSystemMeters: { ...this.cruise.positionSystemMeters },
        approachDirection: { ...this.cruise.approachDirection }
      },
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
    validateStarSystem(this.starSystem);
    console.log("Bridge room in star system " + this.starSystem.name + " (" + this.starSystem.id + ")");

    this.cruise.positionSystemMeters = systemPositionOfShip(
      this.starSystem, this.frame, this.ship.position, this.epochSeconds
    );

    this.setSimulationInterval(() => {
      this.tick += 1;
      if (this.cruise.mode === "local") {
        stepShip(this.ship, TICK_SECONDS);
        this.cruise.positionSystemMeters = systemPositionOfShip(
          this.starSystem, this.frame, this.ship.position, this.epochSeconds
        );
      } else {
        const outcome = stepCruise(
          this.cruise, this.ship, this.starSystem, this.epochSeconds, TICK_SECONDS, this.frame
        );
        if (outcome.dropped) this.frame = outcome.frame;
      }
      if (this.tick % 2 === 0) this.broadcast("snapshot", this.snapshot());
    }, TICK_SECONDS * 1000);

    this.onMessage("helm_command", (client, payload: unknown) => {
      if (this.roles.get(client.sessionId) !== "helm") return;
      if (this.cruise.mode !== "local") {
        client.send("cruise_notice", "Impulse commands unavailable while the cruise drive is engaged");
        return;
      }
      const parsed = HelmCommandSchema.safeParse(payload);
      if (!parsed.success) return;
      applyHelmCommand(this.ship, parsed.data);
    });

    this.onMessage("cruise_command", (client, payload: unknown) => {
      if (this.roles.get(client.sessionId) !== "helm") return;
      const parsed = CruiseCommandSchema.safeParse(payload);
      if (!parsed.success) {
        client.send("cruise_notice", "Invalid cruise command");
        return;
      }
      const command = parsed.data;
      let result: string;
      switch (command.type) {
        case "set_cruise_target":
          result = selectCruiseTarget(this.cruise, this.starSystem, command.targetId);
          break;
        case "set_cruise_throttle":
          setCruiseThrottle(this.cruise, command.throttle);
          result = this.cruise.lastEvent;
          break;
        case "engage_cruise":
          result = beginCruise(this.cruise, this.starSystem, this.frame, this.ship, this.epochSeconds);
          break;
        case "request_drop":
          result = requestCruiseDrop(this.cruise, this.ship, this.starSystem, this.epochSeconds, this.frame);
          break;
      }
      client.send("cruise_notice", result);
      client.send("snapshot", this.snapshot());
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
