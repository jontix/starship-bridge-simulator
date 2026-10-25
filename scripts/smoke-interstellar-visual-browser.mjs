/**
 * Stage D acceptance: real Colyseus room + live Chromium/WebGL scene.
 * Repeated Aster Reach ⇄ Vesper jumps prove the destination scene replaces
 * the old Babylon renderer, never interpolating galactic-sized metre values.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Client } from "colyseus.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshots = join(root, "test-artifacts");
await mkdir(screenshots, { recursive: true });
const port = 2588, sitePort = 5189;
const processes = [];
function start(command, args, name, env) {
  const child = spawn(command, args, {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env: { ...process.env, ...env }
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", text => { output = (output + text).slice(-18000); });
  }
  processes.push({ child, name, log: () => output });
}
async function waitForServer(url) {
  for (let i = 0; i < 260; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(150);
  }
  throw new Error("Timeout starting " + url + "\n" + processes.map(p => p.log()).join("\n"));
}
async function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGTERM"); return; } catch {}
  }
  try { child.kill("SIGTERM"); } catch {}
}
async function until(predicate, label, timeout = 35000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(45);
  }
  throw new Error("Timed out awaiting " + label);
}

let browser, helm;
try {
  start(process.execPath, ["packages/server/dist/index.js"], "Colyseus", {
    PORT: String(port), BRIDGE_SYSTEM_ID: "aster-reach",
    BRIDGE_TEST_START_EPOCH_SECONDS: String(Date.UTC(2026, 9, 24, 20) / 1000),
    BRIDGE_TEST_JUMP_TIME_SCALE: "0.25"
  });
  start("npm", ["--prefix", "packages/client", "run", "dev", "--",
    "--host", "127.0.0.1", "--port", String(sitePort), "--strictPort"], "Vite", {
    VITE_SERVER_URL: "ws://127.0.0.1:" + port
  });
  await waitForServer("http://127.0.0.1:" + port + "/health");
  await waitForServer("http://127.0.0.1:" + sitePort);

  const client = new Client("ws://127.0.0.1:" + port);
  helm = await client.joinOrCreate("bridge", { role: "helm" });
  let ship = null;
  helm.onMessage("snapshot", state => { ship = state; });
  await until(() => ship?.universe.systemId === "aster-reach", "starting crew snapshot", 8000);

  browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"]
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error" ||
        /shader compilation|unable to compile|failed to compile effect/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.goto("http://127.0.0.1:" + sitePort, { waitUntil: "domcontentloaded" });
  await page.getByText("Connected · Main Screen").waitFor({ timeout: 30000 });

  async function assertRenderer(systemId, primaryId, label) {
    await page.locator('canvas.scene[data-system-id="' + systemId + '"]').waitFor({ timeout: 35000 });
    await page.waitForFunction(
      ({ id, primary }) => {
        const c = window.__bridgeRendererDiagnostics;
        return c && c.active === 1 && c.created - c.disposed === 1 &&
          c.activeSystemId === id && c.activeSkyBodyIds.includes(primary) &&
          c.oldSystemSkyBodies === 0 && c.skyMeshes > 0;
      }, { id: systemId, primary: primaryId }, { timeout: 40000 }
    );
    const metrics = await page.evaluate(() => ({ ...window.__bridgeRendererDiagnostics }));
    assert.ok(metrics.skyTextures < 140, "Sky texture count potentially leaking: " + JSON.stringify(metrics));
    assert.equal(metrics.active, 1);
    assert.equal(metrics.created - metrics.disposed, 1);
    assert.equal(metrics.oldSystemSkyBodies, 0);
    const gpuReady = await page.evaluate(() => {
      const canvas = document.querySelector("canvas.scene");
      const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
      return !!gl && !gl.isContextLost();
    });
    assert.ok(gpuReady, "Lost WebGL context " + label);
    console.log(label, JSON.stringify(metrics));
    await page.screenshot({ path: join(screenshots, "jump-visual-" + label + ".png"),
      fullPage: true, animations: "disabled" });
    return metrics;
  }

  const initial = await assertRenderer("aster-reach", "aster", "aster-start");
  assert.equal(initial.disposed, 1, "Placeholder system renderer should be disposed on first snapshot");

  async function jumpTo(destinationId, destinationPrimary, label) {
    const from = ship.universe.systemId;
    const beforeEpoch = ship.universe.epochSeconds;
    helm.send("interstellar_command", { type: "set_interstellar_target", systemId: destinationId });
    await until(() => ship?.interstellar.destinationSystemId === destinationId &&
      ship?.interstellar.originSystemId === from, label + " route plot", 10000);
    assert.equal(ship.interstellar.phase, "idle", "Plot does not engage");
    helm.send("interstellar_command", { type: "engage_jump" });
    await until(() => ship?.interstellar.phase === "transit", label + " transit", 12000);
    await page.locator('[data-jump-phase="transit"]').waitFor({ timeout: 12000 });
    await page.getByRole("region", { name: "Interstellar voyage visual" })
      .getByText("No local position exists between systems").waitFor({ timeout: 12000 });
    const inTransitSystem = await page.locator("canvas.scene").getAttribute("data-system-id");
    assert.equal(inTransitSystem, from, "No speculative system handoff during transit");
    await until(() => ship?.universe.systemId === destinationId &&
      ship?.interstellar.phase === "idle", label + " committed arrival", 23000);
    assert.ok(ship.universe.epochSeconds >= beforeEpoch, "Universe time must never reset");
    const metrics = await assertRenderer(destinationId, destinationPrimary, label);
    await page.getByRole("region", { name: "Interstellar travel telemetry" })
      .getByText(destinationId === "vesper" ? "Vesper" : "Aster Reach", { exact: true }).first()
      .waitFor({ timeout: 8000 });
    assert.equal(ship.cruise.targetId, null, "Old-system cruise targets must be cleared");
    return metrics;
  }

  // One genuine Main Screen browser and a separate Helm crew room share each jump.
  const vesper1 = await jumpTo("vesper", "vesper-primary", "vesper-arrival-1");
  await page.getByLabel("Focused planet").selectOption("umbra");
  assert.equal(await page.getByLabel("Focused planet").inputValue(), "umbra");

  // Open local orbital map BEFORE jumping home; its selection/orbits must
  // be recreated for Aster Reach on arrival, not retain Vesper orbit data.
  await page.getByRole("button", { name: /System Map/ }).click();
  await page.getByRole("dialog", { name: "Star system navigation map" }).getByText("Umbra").first().waitFor();

  const aster1 = await jumpTo("aster-reach", "aster", "aster-return-1");
  await page.getByRole("dialog", { name: "Star system navigation map" })
    .getByRole("heading", { name: "Aster Reach" }).waitFor({ timeout: 10000 });
  assert.equal(await page.getByRole("dialog", { name: "Star system navigation map" })
    .getByText("Umbra", { exact: true }).count(), 0, "Vesper catalog leaked into Aster Map");
  await page.getByRole("button", { name: "Close star system map" }).click();
  assert.equal(await page.getByLabel("Focused planet").inputValue(), "auto",
    "Stale Umbra telescope focus must reset at arrival");
  assert.ok(aster1.created > vesper1.created && aster1.disposed > vesper1.disposed);

  // Switch the browser station role without changing the authoritative ship.
  await page.locator("header .role-select select").selectOption("helm");
  await page.getByText("Connected · Helm").waitFor({ timeout: 25000 });
  await page.getByRole("region", { name: "Helm workstation" }).waitFor();
  await assertRenderer("aster-reach", "aster", "aster-helm-joined");
  await jumpTo("vesper", "vesper-primary", "vesper-arrival-2");
  const last = await jumpTo("aster-reach", "aster", "aster-return-2");
  assert.equal(last.active, 1);
  assert.equal(last.created - last.disposed, 1);
  assert.equal(errors.length, 0, "WebGL/browser exceptions: " + errors.join("\n"));
  console.log("Interstellar Stage D WebGL passed: four jumps, two stations, cinematic, destination bodies, no cross-system interpolation, no stale resources");
  await context.close();
} catch (error) {
  console.error(error);
  for (const p of processes) console.error(p.name, p.log());
  process.exitCode = 1;
} finally {
  try { await helm?.leave(); } catch {}
  if (browser) await browser.close();
  await Promise.all(processes.map(p => stop(p.child)));
}
