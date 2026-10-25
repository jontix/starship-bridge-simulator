import { Room, Client } from "colyseus";
import { performance } from "node:perf_hooks";
import {
  applyHelmCommand, createInitialShipState, HelmCommandSchema,
  RoleSchema, stepShip, DEFAULT_SYSTEM_ID, getStarSystem, validateStarCatalog,
  beginCruise, createCruiseState, CruiseCommandSchema, requestCruiseDrop,
  selectCruiseTarget, setCruiseThrottle, stepCruise, systemPositionOfShip,
  type CruiseState, type GameSnapshot, type LocalFrame,
  type PlayerRole, type ShipState,
  InterstellarCommandSchema, createInterstellarState, plotInterstellarTarget,
  engageInterstellarJump, cancelInterstellarSpool, stepInterstellar,
  completeInterstellarArrival, failInterstellarArrival, INTERSTELLAR_LIMITS,
  getBody, bodyPositionAt, arrivalStandOffMetres,
  vec3, type InterstellarState, type InterstellarTimings
} from "@bridge-sim/shared";

type JoinOptions = { role?: PlayerRole };
const TICK_SECONDS = 1 / 30;

/** Accelerated server smoke tests only; production timings cannot be changed
 * unless the explicit fixed-epoch test switch is also present.
 */
function roomJumpTimings(): InterstellarTimings {
  const raw = process.env.BRIDGE_TEST_JUMP_TIME_SCALE;
  if (!process.env.BRIDGE_TEST_START_EPOCH_SECONDS || raw === undefined) return INTERSTELLAR_LIMITS;
  const scale = Number(raw);
  if (!(scale >= 0.01 && scale <= 1) || !Number.isFinite(scale)) {
    throw new Error("Invalid BRIDGE_TEST_JUMP_TIME_SCALE (must be 0.01..1)");
  }
  return {
    spoolSeconds: INTERSTELLAR_LIMITS.spoolSeconds * scale,
    transitSeconds: INTERSTELLAR_LIMITS.transitSeconds * scale
  };
}

/** Optional test-only fixed epoch for deterministic visual regression scenes.
 * In ordinary gameplay the room continues to start at the current UTC time.
 */
function initialUniverseEpochSeconds(): number {
  const testEpoch = process.env.BRIDGE_TEST_START_EPOCH_SECONDS;
  if (testEpoch === undefined) return Date.now() / 1000;
  const seconds = Number(testEpoch);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("BRIDGE_TEST_START_EPOCH_SECONDS must be a positive finite Unix timestamp");
  }
  return seconds;
}

export class BridgeRoom extends Room {
  maxClients = 8;
  private ship: ShipState = createInitialShipState();
  private roles = new Map<string, PlayerRole>();
  private tick = 0;
  private starSystem = getStarSystem(process.env.BRIDGE_SYSTEM_ID ?? DEFAULT_SYSTEM_ID);
  private readonly startUnixSeconds = initialUniverseEpochSeconds();
  private universeElapsedSeconds = 0;
  private frame: LocalFrame = {
    referenceBodyId: this.starSystem.start.referenceBodyId,
    offsetFromReferenceMeters: { ...this.starSystem.start.offsetFromReferenceMeters }
  };
  private cruise: CruiseState = createCruiseState();
  private interstellar: InterstellarState = createInterstellarState();
  private readonly jumpTimings = roomJumpTimings();
  // Propulsion physics uses a fixed 30 Hz step. Jump timers must instead use
  // monotonic elapsed real time: a loaded Windows event loop may tick <30 Hz,
  // which otherwise stretches a 6s/45s jump into 8s/56s for the crew.
  private previousWallTickMs = performance.now();

  private get epochSeconds(): number {
    // Stable, monotonic astronomical epoch even when a busy event loop runs
    // fewer than the nominal 30 simulation ticks per wall-clock second.
    return this.startUnixSeconds + this.universeElapsedSeconds;
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
      interstellar: { ...this.interstellar },
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

  /** This is one transaction from the crew's perspective: all destination
   * resources/ephemerides are checked BEFORE changing any room-owned state.
   * The same Colyseus room and monotonically advancing epoch are retained.
   */
  private commitJumpArrival(destinationSystemId: string): boolean {
    try {
      const destination = getStarSystem(destinationSystemId);
      const anchor = destination.interstellarArrival;
      if (!anchor) throw new Error("No safe arrival anchor");
      const body = getBody(destination, anchor.referenceBodyId);
      const distance = Math.hypot(anchor.offsetFromReferenceMeters.x,
        anchor.offsetFromReferenceMeters.y, anchor.offsetFromReferenceMeters.z);
      if (body.kind !== "station" || distance < arrivalStandOffMetres(body)) {
        throw new Error("Unsafe destination arrival distance");
      }
      const ephemeris = bodyPositionAt(destination, body.id, this.epochSeconds);
      if (![ephemeris.x, ephemeris.y, ephemeris.z].every(Number.isFinite)) {
        throw new Error("Non-finite destination ephemeris");
      }
      const nextFrame: LocalFrame = {
        referenceBodyId: body.id,
        offsetFromReferenceMeters: { ...anchor.offsetFromReferenceMeters }
      };
      const nextShip: ShipState = {
        ...this.ship,
        position: vec3(), velocity: vec3(), acceleration: vec3(),
        angularVelocity: vec3(), desiredSpeed: 0, desiredStrafe: 0, desiredLift: 0,
        emergencyStopping: false
      };
      const nextCruise = createCruiseState();
      nextCruise.positionSystemMeters = systemPositionOfShip(
        destination, nextFrame, nextShip.position, this.epochSeconds
      );
      const nextInterstellar = completeInterstellarArrival(this.interstellar, destinationSystemId);
      // The full new snapshot is published only after all assignments succeed.
      this.starSystem = destination;
      this.frame = nextFrame;
      this.ship = nextShip;
      this.cruise = nextCruise;
      this.interstellar = nextInterstellar;
      return true;
    } catch (error) {
      console.error("Interstellar arrival rejected; retaining original star system", error);
      this.interstellar = failInterstellarArrival(this.interstellar);
      return false;
    }
  }

  onCreate(): void {
    validateStarCatalog();
    console.log("Bridge room in star system " + this.starSystem.name + " (" + this.starSystem.id + ")");

    this.cruise.positionSystemMeters = systemPositionOfShip(
      this.starSystem, this.frame, this.ship.position, this.epochSeconds
    );

    this.setSimulationInterval(() => {
      const wallNowMs = performance.now();
      const interstellarElapsedSeconds = Math.max(0,
        (wallNowMs - this.previousWallTickMs) / 1000);
      this.previousWallTickMs = wallNowMs;
      this.universeElapsedSeconds += interstellarElapsedSeconds;
      this.tick += 1;
      let arrived = false;
      if (this.interstellar.phase === "idle") {
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
      } else {
        // Jump drive exclusively owns translation; local pose/orders are held
        // during charging so a cancelled spool cannot displace the ship.
        if (this.interstellar.phase === "charging") {
          this.cruise.positionSystemMeters = systemPositionOfShip(
            this.starSystem, this.frame, this.ship.position, this.epochSeconds
          );
        }
        const step = stepInterstellar(this.interstellar, interstellarElapsedSeconds);
        this.interstellar = step.state;
        if (step.arrivalSystemId) {
          this.commitJumpArrival(step.arrivalSystemId);
          arrived = true;
        }
      }
      if (arrived || this.tick % 2 === 0) this.broadcast("snapshot", this.snapshot());
    }, TICK_SECONDS * 1000);

    this.onMessage("helm_command", (client, payload: unknown) => {
      if (this.roles.get(client.sessionId) !== "helm") return;
      if (this.cruise.mode !== "local" || this.interstellar.phase !== "idle") {
        client.send("cruise_notice", "Impulse commands unavailable while a travel drive is engaged");
        return;
      }
      const parsed = HelmCommandSchema.safeParse(payload);
      if (!parsed.success) return;
      applyHelmCommand(this.ship, parsed.data);
    });

    this.onMessage("cruise_command", (client, payload: unknown) => {
      if (this.roles.get(client.sessionId) !== "helm") return;
      if (this.interstellar.phase !== "idle") {
        client.send("cruise_notice", "Interplanetary cruise is locked during a jump");
        return;
      }
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

    this.onMessage("interstellar_command", (client, payload: unknown) => {
      if (this.roles.get(client.sessionId) !== "helm") return;
      const parsed = InterstellarCommandSchema.safeParse(payload);
      if (!parsed.success) {
        client.send("interstellar_notice", "Invalid interstellar command");
        return;
      }
      const command = parsed.data;
      const decision = command.type === "set_interstellar_target"
        ? plotInterstellarTarget(this.interstellar, this.starSystem.id, command.systemId, this.cruise.mode)
        : command.type === "engage_jump"
          ? engageInterstellarJump(this.interstellar, this.starSystem.id, this.cruise.mode, this.jumpTimings)
          : cancelInterstellarSpool(this.interstellar);
      if (decision.accepted) {
        this.interstellar = decision.state;
        // A valid order is visible to every connected crew station immediately.
        this.broadcast("snapshot", this.snapshot());
      }
      client.send("interstellar_notice", decision.notice);
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
