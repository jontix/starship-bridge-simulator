import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "colyseus.js";
import { getStarSystem, bodyPositionAt, arrivalStandOffMetres, length, sub } from "@bridge-sim/shared";

const port = 2571;
const processHandle = spawn(process.execPath, ["packages/server/dist/index.js"], {
  env: { ...process.env, PORT: String(port), BRIDGE_SYSTEM_ID: "aster-reach" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32"
});
let log = "";
let exited = false;
processHandle.stdout.setEncoding("utf8");
processHandle.stderr.setEncoding("utf8");
processHandle.stdout.on("data", chunk => { log += chunk; });
processHandle.stderr.on("data", chunk => { log += chunk; });
processHandle.on("exit", () => { exited = true; });
processHandle.on("error", error => { log += error.message; exited = true; });

async function until(predicate, timeoutMs, label) {
  const max = Date.now() + timeoutMs;
  while (Date.now() < max) {
    if (exited) throw new Error("Server crashed: " + log);
    if (predicate()) return;
    await delay(100);
  }
  throw new Error("Timeout waiting for " + label + ": " + log);
}

let helm, screen;
try {
  let healthy = false;
  for (let i = 0; i < 70; i++) {
    if (exited) throw new Error("Server exited: " + log);
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/health");
      if (response.ok) { healthy = true; break; }
    } catch { }
    await delay(100);
  }
  assert.ok(healthy, "Server startup failed: " + log);
  const client = new Client("ws://127.0.0.1:" + port);
  helm = await client.joinOrCreate("bridge", { role: "helm" });
  screen = await client.joinOrCreate("bridge", { role: "main-screen" });
  assert.equal(helm.roomId, screen.roomId);
  let helmState = null;
  let screenState = null;
  let cruiseStarted = false;
  let progressed = false;
  helm.onMessage("snapshot", data => {
    helmState = data;
    if (data.cruise.mode === "cruise") cruiseStarted = true;
    if (data.cruise.progress > 0.1) progressed = true;
  });
  screen.onMessage("snapshot", data => {
    screenState = data;
  });
  await until(() => Boolean(helmState && screenState), 6_000, "crew telemetry");

  screen.send("cruise_command", { type: "set_cruise_target", targetId: "selene-observatory" });
  await delay(200);
  assert.equal(helmState.cruise.targetId, null, "main-screen role must not command propulsion");

  helm.send("cruise_command", { type: "set_cruise_target", targetId: "selene-observatory" });
  await until(() => helmState?.cruise.targetId === "selene-observatory", 5000, "planned target");
  helm.send("cruise_command", { type: "engage_cruise" });
  await until(() => helmState?.cruise.mode === "spooling", 5000, "spool activation");
  assert.equal(screenState.universe.systemId, helmState.universe.systemId);

  await until(() => cruiseStarted, 10000, "high-speed flight engagement");
  await until(() => progressed, 15000, "route progress");
  await until(() => helmState?.cruise.mode === "local" &&
    helmState?.universe.referenceBodyId === "selene-observatory", 35000, "orbital arrival");
  await until(() => screenState?.universe.referenceBodyId === "selene-observatory", 3000,
    "second station arrival synchronization");
  assert.equal(helmState.cruise.targetId, "selene-observatory");
  assert.equal(screenState.cruise.mode, "local");

  const system = getStarSystem(helmState.universe.systemId);
  const target = system.bodies.find(body => body.id === helmState.cruise.targetId);
  const targetPos = bodyPositionAt(system, target.id, helmState.universe.epochSeconds);
  const shipPos = {
    x: targetPos.x + helmState.universe.frameOffsetMeters.x + helmState.ship.position.x,
    y: targetPos.y + helmState.universe.frameOffsetMeters.y + helmState.ship.position.y,
    z: targetPos.z + helmState.universe.frameOffsetMeters.z + helmState.ship.position.z
  };
  const error = Math.abs(length(sub(shipPos, targetPos)) - arrivalStandOffMetres(target));
  assert.ok(error < 200_000, "ship exits at an appropriate stand-off from the MOVING station");
  console.log("Multiplayer cruise smoke passed: Helm authority, moving target, progress, arrival and shared reference frame");
} finally {
  try { await helm?.leave(); } catch {}
  try { await screen?.leave(); } catch {}
  if (!exited && processHandle.pid) {
    if (process.platform !== "win32") {
      try { process.kill(-processHandle.pid, "SIGTERM"); }
      catch { processHandle.kill("SIGTERM"); }
    } else processHandle.kill("SIGTERM");
  }
}
