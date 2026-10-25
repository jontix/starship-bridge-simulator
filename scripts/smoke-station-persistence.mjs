/**
 * Regression for a lone bridge user switching Helm -> Main Screen at Vesper.
 * Unlike earlier crew tests, there is deliberately no second client to keep
 * the Colyseus room alive. Rejoining after all crew leave must not create
 * another ship at Aster Reach.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "colyseus.js";

const port = 2596;
const server = spawn(process.execPath, ["packages/server/dist/index.js"], {
  env: { ...process.env, PORT: String(port), BRIDGE_SYSTEM_ID: "aster-reach",
    BRIDGE_TEST_START_EPOCH_SECONDS: String(Date.UTC(2026, 9, 24, 20) / 1000),
    BRIDGE_TEST_JUMP_TIME_SCALE: "0.10" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32"
});
let log = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", chunk => { log = (log + chunk).slice(-12000); });
}
let room;
async function until(check, label, timeout = 14_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await delay(40);
  }
  throw Error("Timed out " + label + "\n" + log);
}
const client = new Client("ws://127.0.0.1:" + port);
let snap = null, confirmed = null;
async function join(role) {
  const connected = await client.joinOrCreate("bridge", { role });
  connected.onMessage("snapshot", message => { snap = message; });
  connected.onMessage("station_role_confirmed", message => { confirmed = message; });
  return connected;
}
async function switchRole(role) {
  confirmed = null;
  room.send("station_role", { role });
  await until(() => confirmed?.role === role, "station role ACK " + role);
  assert.equal(confirmed.roomId, room.roomId, "Station change must not create a room");
}
async function jump(destination, previous) {
  room.send("interstellar_command", { type: "set_interstellar_target", systemId: destination });
  await until(() => snap?.interstellar.destinationSystemId === destination, "plotted route");
  room.send("interstellar_command", { type: "engage_jump" });
  await until(() => snap?.interstellar.phase === "transit", "transit");
  assert.equal(snap.universe.systemId, previous, "No early arrival");
  await until(() => snap?.universe.systemId === destination && snap.interstellar.phase === "idle",
    "destination " + destination, 13_000);
  assert.equal(snap.interstellar.lastArrivalSystemId, destination);
}
try {
  let started = false;
  for (let i = 0; i < 130; i++) {
    try { if ((await fetch("http://127.0.0.1:" + port + "/health")).ok) {
      started = true; break;
    } } catch {}
    await delay(100);
  }
  assert.ok(started, "Server did not start\n" + log);
  room = await join("helm");
  const initialRoomId = room.roomId;
  await until(() => snap?.universe.systemId === "aster-reach", "initial Aster");
  await jump("vesper", "aster-reach");
  const vesperEpoch = snap.universe.epochSeconds;
  const vesperTick = snap.tick;

  // Same websocket becomes Main Screen, with server permissions revoked.
  await switchRole("main-screen");
  room.send("interstellar_command", { type: "set_interstellar_target", systemId: "aster-reach" });
  room.send("helm_command", { type: "set_speed", speed: 90 });
  await delay(250);
  assert.equal(snap.universe.systemId, "vesper");
  assert.equal(snap.interstellar.destinationSystemId, null);
  assert.equal(snap.ship.desiredSpeed, 0, "Main Screen must not control Helm");

  // Leave the room EMPTY, precisely reproducing the original bug.
  await room.leave();
  room = undefined;
  snap = null;
  await delay(300);
  room = await join("main-screen");
  assert.equal(room.roomId, initialRoomId,
    "The last crew member rejoining must recover the same persistent voyage");
  await until(() => snap?.universe.systemId === "vesper", "Vesper after last-client rejoin");
  assert.ok(snap.universe.epochSeconds >= vesperEpoch);
  assert.ok(snap.tick > vesperTick);
  assert.equal(snap.interstellar.lastArrivalSystemId, "vesper");

  // Regain Helm on the SAME room, prove a return jump remains possible.
  await switchRole("helm");
  await jump("aster-reach", "vesper");
  assert.equal(room.roomId, initialRoomId);
  assert.equal(snap.interstellar.eventSequence, 2);
  console.log("Single-client station persistence PASS: Helm → Vesper → Main Screen, empty-room rejoin still Vesper, Helm → Aster Reach in same room " + initialRoomId);
} finally {
  try { await room?.leave(); } catch {}
  if (server.pid) {
    if (process.platform !== "win32") {
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    } else server.kill("SIGTERM");
  }
}
