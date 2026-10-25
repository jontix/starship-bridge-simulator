import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "colyseus.js";
import { getStarSystem, systemPositionsAt } from "@bridge-sim/shared";

const port = 2570;
const expectedSystemId = process.argv[2] ?? "aster-reach";
const expectedSystem = getStarSystem(expectedSystemId);
const child = spawn(process.execPath, ["packages/server/dist/index.js"], {
  env: { ...process.env, PORT: String(port), BRIDGE_SYSTEM_ID: expectedSystemId },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32"
});
let output = "";
let exited = false;
child.once("exit", () => { exited = true; });
child.once("error", error => { output += "\n" + error.message; exited = true; });
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { output += chunk; });

async function receiveSnapshot(room, timeoutMs = 5000) {
  return Promise.race([
    new Promise(resolve => room.onMessage("snapshot", resolve)),
    delay(timeoutMs).then(() => { throw new Error("Did not receive multiplayer star-system snapshot"); })
  ]);
}

let helm, mainScreen;
try {
  let listening = false;
  for (let i = 0; i < 40; i++) {
    if (exited) throw new Error("Server exited before binding:\n" + output);
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/health");
      if (response.ok) { listening = true; break; }
    } catch { /* starting */ }
    await delay(200);
  }
  assert.ok(listening, "Server did not start:\n" + output);

  const client = new Client("ws://127.0.0.1:" + port);
  helm = await client.joinOrCreate("bridge", { role: "helm" });
  mainScreen = await client.joinOrCreate("bridge", { role: "main-screen" });
  assert.equal(helm.roomId, mainScreen.roomId, "Crew stations must share one room");

  const [helmSnap, mainSnap] = await Promise.all([
    receiveSnapshot(helm), receiveSnapshot(mainScreen)
  ]);
  const system = getStarSystem(helmSnap.universe.systemId);
  assert.equal(system.id, expectedSystemId);
  assert.equal(mainSnap.universe.systemId, system.id);
  assert.equal(helmSnap.universe.referenceBodyId, expectedSystem.start.referenceBodyId);
  assert.ok(Number.isFinite(helmSnap.universe.epochSeconds));
  assert.ok(Number.isFinite(mainSnap.universe.epochSeconds));
  assert.ok(Math.abs(mainSnap.universe.epochSeconds - helmSnap.universe.epochSeconds) < 3);

  const positions = systemPositionsAt(system, helmSnap.universe.epochSeconds);
  assert.equal(Object.keys(positions).length, system.bodies.length);
  console.log("Universe multiplayer smoke passed: shared room, synced system/time and " + system.bodies.length + " orbital bodies.");
} finally {
  try { await helm?.leave(); } catch {}
  try { await mainScreen?.leave(); } catch {}
  if (!exited && child.pid) {
    if (process.platform !== "win32") {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    } else {
      child.kill("SIGTERM");
    }
  }
}
