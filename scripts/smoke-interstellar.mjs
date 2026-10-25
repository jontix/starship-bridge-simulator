import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "colyseus.js";
import {
  bodyPositionAt, getStarSystem, length, sub, systemPositionOfShip
} from "@bridge-sim/shared";

const port = 2572;
const server = spawn(process.execPath, ["packages/server/dist/index.js"], {
  env: {
    ...process.env, PORT: String(port), BRIDGE_SYSTEM_ID: "aster-reach",
    BRIDGE_TEST_START_EPOCH_SECONDS: "1792886400",
    BRIDGE_TEST_JUMP_TIME_SCALE: "0.15"
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32"
});
let log = "";
let exited = false;
server.stdout.setEncoding("utf8");
server.stderr.setEncoding("utf8");
server.stdout.on("data", chunk => { log += chunk; });
server.stderr.on("data", chunk => { log += chunk; });
server.on("exit", () => { exited = true; });
server.on("error", error => { log += error.message; exited = true; });

async function until(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error("Server stopped during " + label + ": " + log);
    if (predicate()) return;
    await delay(40);
  }
  throw new Error("Timeout waiting for " + label + ": " + log);
}

let helm, screen, reconnectingCrew;
try {
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error("Server failed before binding: " + log);
    try {
      if ((await fetch("http://127.0.0.1:" + port + "/health")).ok) {
        healthy = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(healthy, "Bridge server health check failed: " + log);
  const client = new Client("ws://127.0.0.1:" + port);
  helm = await client.joinOrCreate("bridge", { role: "helm" });
  screen = await client.joinOrCreate("bridge", { role: "main-screen" });
  assert.equal(helm.roomId, screen.roomId, "Same ship, same authoritative crew room");

  let hs = null, ms = null, reconnectState = null;
  const phases = new Set();
  const notices = [];
  helm.onMessage("snapshot", snap => {
    hs = snap;
    phases.add(snap.interstellar.phase);
  });
  screen.onMessage("snapshot", snap => { ms = snap; });
  helm.onMessage("interstellar_notice", notice => { notices.push(notice); });
  await until(() => hs && ms, 5_000, "initial crew snapshots");
  assert.equal(hs.universe.systemId, "aster-reach");
  assert.equal(hs.interstellar.phase, "idle");

  // The second station has no propulsion authority.
  screen.send("interstellar_command", { type: "set_interstellar_target", systemId: "vesper" });
  await delay(180);
  assert.equal(hs.interstellar.destinationSystemId, null);
  helm.send("interstellar_command", { type: "set_interstellar_target", systemId: "fictional" });
  await until(() => notices.some(s => s.includes("Unknown")), 3_000, "invalid plot rejection");
  assert.equal(hs.interstellar.destinationSystemId, null);

  // Deliberately leave an old-system cruise target to verify it is cleared on arrival.
  helm.send("cruise_command", { type: "set_cruise_target", targetId: "selene-observatory" });
  await until(() => hs?.cruise.targetId === "selene-observatory", 3_000, "old-system cruise plot");
  helm.send("interstellar_command", { type: "set_interstellar_target", systemId: "vesper" });
  await until(() => hs?.interstellar.destinationSystemId === "vesper", 3_000, "interstellar plot");
  assert.equal(hs.interstellar.phase, "idle", "Plotting must not teleport");
  assert.ok(hs.interstellar.distanceLightYears > 4 && hs.interstellar.distanceLightYears < 6);

  // First spool: freeze local reference, reject conflicting commands, then cancel.
  const startingFrame = structuredClone(hs.universe.frameOffsetMeters);
  const startingReference = hs.universe.referenceBodyId;
  helm.send("interstellar_command", { type: "engage_jump" });
  await until(() => hs?.interstellar.phase === "charging", 3_000, "first spool");
  helm.send("cruise_command", { type: "engage_cruise" });
  helm.send("helm_command", { type: "set_speed", speed: 220 });
  await delay(150);
  assert.equal(hs.cruise.mode, "local");
  assert.equal(hs.ship.desiredSpeed, 0, "Impulse must be locked during charge");
  assert.equal(hs.universe.systemId, "aster-reach");
  helm.send("interstellar_command", { type: "cancel_jump_spool" });
  await until(() => hs?.interstellar.phase === "idle", 3_000, "spool cancellation");
  assert.equal(hs.universe.systemId, "aster-reach");
  assert.equal(hs.universe.referenceBodyId, startingReference);
  assert.deepEqual(hs.universe.frameOffsetMeters, startingFrame);
  assert.equal(hs.interstellar.destinationSystemId, "vesper", "Keep plotted course");
  assert.equal(hs.interstellar.progress, 0);

  // Real jump: both crew stations see transit, and late crew join the SAME room.
  helm.send("interstellar_command", { type: "engage_jump" });
  await until(() => hs?.interstellar.phase === "transit", 5_000, "interstellar transit");
  assert.equal(hs.cruise.mode, "local");
  screen.send("interstellar_command", { type: "cancel_jump_spool" });
  helm.send("interstellar_command", { type: "cancel_jump_spool" });
  await delay(100);
  assert.equal(hs.interstellar.phase, "transit", "Transit cannot be cancelled in v1");
  reconnectingCrew = await client.joinOrCreate("bridge", { role: "main-screen" });
  assert.equal(reconnectingCrew.roomId, helm.roomId, "No room reassignment mid-jump");
  reconnectingCrew.onMessage("snapshot", snap => { reconnectState = snap; });
  await until(() => reconnectState?.interstellar.phase === "transit", 4_000, "late-joining crew transit");
  const initialEpoch = hs.universe.epochSeconds;
  await until(() => hs?.universe.systemId === "vesper" &&
    hs?.interstellar.phase === "idle" && hs?.cruise.mode === "local", 16_000, "safe Vesper arrival");
  await until(() => ms?.universe.systemId === "vesper" &&
    reconnectState?.universe.systemId === "vesper", 3_000, "crew arrival synchronization");

  const vesper = getStarSystem("vesper");
  assert.equal(hs.universe.referenceBodyId, vesper.interstellarArrival.referenceBodyId);
  assert.deepEqual(hs.universe.frameOffsetMeters, vesper.interstellarArrival.offsetFromReferenceMeters);
  assert.ok(hs.universe.epochSeconds >= initialEpoch, "Universe time never resets");
  assert.equal(hs.cruise.targetId, null, "Old system's planetary target must be cleared");
  assert.equal(hs.interstellar.lastArrivalSystemId, "vesper");
  assert.ok(phases.has("charging") && phases.has("transit"));
  assert.equal(hs.ship.velocity.x, 0);
  assert.equal(hs.ship.velocity.y, 0);
  assert.equal(hs.ship.velocity.z, 0);
  const pos = systemPositionOfShip(vesper, {
    referenceBodyId: hs.universe.referenceBodyId,
    offsetFromReferenceMeters: hs.universe.frameOffsetMeters
  }, hs.ship.position, hs.universe.epochSeconds);
  const anchor = bodyPositionAt(vesper, hs.universe.referenceBodyId, hs.universe.epochSeconds);
  assert.ok(Math.abs(length(sub(pos, anchor)) - 250_000) < 1_000, "Safe gateway arrival range");

  // Following arrival, normal Helm commands and the new system's cruise planner work.
  helm.send("helm_command", { type: "set_speed", speed: 20 });
  await until(() => hs?.ship.desiredSpeed === 20, 4_000, "post-jump impulse orders");
  helm.send("cruise_command", { type: "set_cruise_target", targetId: "umbra" });
  await until(() => hs?.cruise.targetId === "umbra", 4_000, "new-system cruise plotting");

  // Jump home with the same authoritative ship/room, clearing the Vesper target.
  helm.send("interstellar_command", { type: "set_interstellar_target", systemId: "aster-reach" });
  await until(() => hs?.interstellar.destinationSystemId === "aster-reach", 3_000, "reverse route plot");
  helm.send("interstellar_command", { type: "engage_jump" });
  await until(() => hs?.interstellar.phase === "transit", 5_000, "return transit");
  await until(() => hs?.universe.systemId === "aster-reach" &&
    hs?.interstellar.phase === "idle", 16_000, "return arrival");
  await until(() => ms?.universe.systemId === "aster-reach", 3_000, "second station return");
  assert.equal(hs.cruise.targetId, null);
  assert.equal(hs.interstellar.eventSequence, 2);
  assert.equal(hs.interstellar.lastArrivalSystemId, "aster-reach");
  assert.equal(hs.universe.referenceBodyId, "haven-highport");
  console.log("Interstellar multiplayer smoke passed: role security, spool/cancel, drive exclusion, late join, two-way safe arrival and local controls");
} finally {
  for (const room of [reconnectingCrew, helm, screen]) {
    try { await room?.leave(); } catch {}
  }
  if (!exited && server.pid) {
    if (process.platform !== "win32") {
      try { process.kill(-server.pid, "SIGTERM"); }
      catch { server.kill("SIGTERM"); }
    } else server.kill("SIGTERM");
  }
}
