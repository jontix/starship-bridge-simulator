/**
 * Stage E: production-speed, two-way Colyseus acceptance with genuine disconnect/rejoin.
 * No BRIDGE_TEST_JUMP_TIME_SCALE: drive must run its real 6s spool + 45s transit.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "colyseus.js";
import { getStarSystem } from "@bridge-sim/shared";

const port = 2591;
const server = spawn(process.execPath, ["packages/server/dist/index.js"], {
  env: { ...process.env, PORT: String(port), BRIDGE_SYSTEM_ID: "aster-reach",
    BRIDGE_TEST_START_EPOCH_SECONDS: String(Date.UTC(2026, 9, 24, 20) / 1000),
    BRIDGE_TEST_JUMP_TIME_SCALE: "" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32"
});
let output = "", exited = false;
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", part => { output = (output + part).slice(-14000); });
}
server.on("exit", () => { exited = true; });
server.on("error", error => { exited = true; output += String(error); });

async function until(predicate, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (exited) throw Error("Bridge exited during " + label + ": " + output);
    if (predicate()) return;
    await delay(40);
  }
  throw Error("Timeout: " + label + "; " + output);
}
const client = new Client("ws://127.0.0.1:" + port);
let helm, main, auxiliary;
let helmState = null, mainState = null, auxState = null;
const primaryHistory = [];
const mainHistory = [];
let lastEpoch = -Infinity;
function track(history, s) {
  if (s.universe.epochSeconds < lastEpoch - 0.0001) {
    throw Error("Non-monotonic universe epoch");
  }
  if (history === primaryHistory) lastEpoch = s.universe.epochSeconds;
  history.push({
    phase: s.interstellar.phase,
    tick: s.tick,
    system: s.universe.systemId,
    eta: s.interstellar.etaSeconds,
    spool: s.interstellar.spoolRemainingSeconds,
    transit: s.interstellar.transitRemainingSeconds,
    progress: s.interstellar.progress,
    time: Date.now()
  });
}
async function join(role, assign, history) {
  const room = await client.joinOrCreate("bridge", { role });
  room.onMessage("snapshot", snap => { assign(snap); track(history, snap); });
  return room;
}
async function plotAndEngage(dest) {
  helm.send("interstellar_command", { type: "set_interstellar_target", systemId: dest });
  await until(() => helmState?.interstellar.destinationSystemId === dest,
    "plot " + dest, 5000);
  assert.equal(helmState.interstellar.phase, "idle", "Preview/plot must not launch");
  helm.send("interstellar_command", { type: "engage_jump" });
  await until(() => helmState?.interstellar.phase === "charging", "charge " + dest, 5000);
  const begun = Date.now();
  assert.ok(helmState.interstellar.etaSeconds > 49.0 &&
    helmState.interstellar.etaSeconds <= 51.2, "Must use unscaled production drive");
  assert.ok(helmState.interstellar.spoolRemainingSeconds > 5);
  return begun;
}
async function verifyLeg(origin, dest, onCharge, onTransit) {
  const start = await plotAndEngage(dest);
  const initialChargeTick = helmState.tick;
  await onCharge?.();
  await until(() => helmState?.interstellar.phase === "transit", "transit to " + dest, 14_000);
  const chargeElapsed = Date.now() - start;
  assert.ok(chargeElapsed >= 5_100 && chargeElapsed < 13_000,
    "Production spool must take approx six wall-clock seconds: " + chargeElapsed);
  assert.equal(helmState.universe.systemId, origin);
  assert.ok(helmState.tick > initialChargeTick);
  const transitStart = Date.now();
  await onTransit?.();
  await until(() => helmState?.universe.systemId === dest &&
    helmState?.interstellar.phase === "idle", "arrival " + dest, 67_000);
  const transitElapsed = Date.now() - transitStart;
  assert.ok(transitElapsed >= 39_000 && transitElapsed < 67_000,
    "Production transit must take approx 45 wall-clock seconds: " + transitElapsed);
  assert.ok(Date.now() - start >= 45_000, "A real-speed jump cannot arrive instantly");
  const arrival = helmState;
  assert.equal(arrival.cruise.mode, "local");
  assert.equal(arrival.cruise.targetId, null);
  assert.equal(arrival.interstellar.lastArrivalSystemId, dest);
  assert.equal(arrival.interstellar.phase, "idle");
  const anchor = getStarSystem(dest).interstellarArrival;
  assert.equal(arrival.universe.referenceBodyId, anchor.referenceBodyId);
  assert.deepEqual(arrival.universe.frameOffsetMeters, anchor.offsetFromReferenceMeters);
  await until(() => mainState?.universe.systemId === dest &&
    mainState.interstellar.phase === "idle", "Main Screen arrival " + dest, 4000);
  const portion = primaryHistory.filter(h => h.time >= start && h.time <= Date.now());
  const spool = portion.filter(h => h.phase === "charging");
  const transit = portion.filter(h => h.phase === "transit");
  assert.ok(spool.length > 20 && transit.length > 150, "Need numerous server snapshots in both phases");
  for (const series of [spool.map(h=>h.spool), transit.map(h=>h.transit)]) {
    assert.ok(series.every((v, i)=>i === 0 || v <= series[i-1]+0.000001),
      "Server drive countdown must never increase");
  }
  assert.ok(transit.every((h,i)=>i===0 || h.progress+0.000001 >= transit[i-1].progress),
    "Transit progress must never go backwards");
  assert.ok(transit.at(-1).progress > .95, "Transit reaches nearly 100%");
  console.log(JSON.stringify({leg: origin+"→"+dest, spoolSeconds: +(chargeElapsed/1000).toFixed(2),
    transitSeconds: +(transitElapsed/1000).toFixed(2), snapshots: portion.length,
    peakProgress: transit.at(-1).progress, epoch: arrival.universe.epochSeconds }));
}
try {
  let healthy = false;
  for (let i=0;i<110;i++) {
    if (exited) throw Error("Server failed to start: "+output);
    try { if ((await fetch("http://127.0.0.1:"+port+"/health")).ok) { healthy=true;break; } }
    catch {}
    await delay(120);
  }
  assert.ok(healthy, "Server health failed: "+output);
  helm = await join("helm", s=>{helmState=s}, primaryHistory);
  main = await join("main-screen", s=>{mainState=s}, mainHistory);
  await until(()=>!!helmState && !!mainState,"initial crew",5000);
  const roomId = helm.roomId;
  assert.equal(main.roomId,roomId);
  const initialEpoch = helmState.universe.epochSeconds;
  // A real disconnected observer returning while the spool is running.
  await verifyLeg("aster-reach","vesper",async()=>{
    await delay(1100);
    await main.leave();
    main = undefined; mainState = null;
    await delay(450);
    main = await join("main-screen",s=>{mainState=s},mainHistory);
    assert.equal(main.roomId,roomId,"Screen must return to same crew room");
    await until(()=>mainState?.interstellar.phase==="charging","reconnected screen charge",3000);
    assert.equal(mainState.interstellar.destinationSystemId,"vesper");
    // Spoofed privilege after rejoining must still be rejected.
    main.send("interstellar_command",{type:"cancel_jump_spool"});
    main.send("helm_command",{type:"set_speed",speed:123});
    await delay(140);
    assert.equal(helmState.interstellar.phase,"charging");
    assert.equal(helmState.ship.desiredSpeed,0);
  },async()=>{
    await delay(3500);
    const progressBefore = helmState.interstellar.progress;
    // Simulate actual Helm disconnect, not merely an additional station.
    await helm.leave(); helm = undefined; helmState = null;
    await delay(450);
    helm = await join("helm",s=>{helmState=s},primaryHistory);
    assert.equal(helm.roomId,roomId,"Helm must reclaim same active crew room");
    await until(()=>helmState?.interstellar.phase==="transit","reconnected Helm transit",5000);
    assert.equal(helmState.universe.systemId,"aster-reach");
    assert.ok(helmState.interstellar.progress>=progressBefore,"Voyage progress continues through reconnect");
    helm.send("interstellar_command",{type:"cancel_jump_spool"});
    await delay(150);
    assert.equal(helmState.interstellar.phase,"transit","Transit can't be aborted");
  });
  assert.ok(helmState.universe.epochSeconds > initialEpoch + 45);
  // A disconnect/reconnect after arrival restores up-to-date destination state.
  await main.leave(); main = undefined; mainState = null;
  main = await join("main-screen",s=>{mainState=s},mainHistory);
  assert.equal(main.roomId,roomId);
  await until(()=>mainState?.universe.systemId==="vesper","Vesper rejoin",4000);
  assert.equal(mainState.interstellar.lastArrivalSystemId,"vesper");
  await verifyLeg("vesper","aster-reach",null,async()=>{
    await delay(4800);
    const progressBefore = mainState.interstellar.progress;
    await main.leave(); main = undefined; mainState = null;
    await delay(180);
    main = await join("main-screen",s=>{mainState=s},mainHistory);
    assert.equal(main.roomId,roomId);
    await until(()=>mainState?.interstellar.phase==="transit","return-transit rejoin",4000);
    assert.ok(mainState.interstellar.progress >= progressBefore,
      "Return transit continues after screen disconnect");
  });
  assert.equal(helmState.interstellar.eventSequence,2);
  assert.equal(mainState.interstellar.eventSequence,2);
  assert.equal(helmState.universe.systemId,"aster-reach");
  assert.ok(helmState.universe.epochSeconds > initialEpoch+90);
  helm.send("helm_command",{type:"set_speed",speed:18});
  await until(()=>helmState?.ship.desiredSpeed===18,"post-arrival normal Helm control",5000);
  console.log("Stage E production-speed acceptance PASS: two 6s+45s legs, reconnect Helm/Main Screen, role rejection, monotonic telemetry, local flight restored");
} finally {
  for(const room of [auxiliary,helm,main]) { try {await room?.leave()}catch{} }
  if (!exited && server.pid) {
    if(process.platform!=="win32"){try{process.kill(-server.pid,"SIGTERM")}catch{server.kill("SIGTERM")}}
    else server.kill("SIGTERM");
  }
}
