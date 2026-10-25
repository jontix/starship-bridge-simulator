/**
 * Reproduce the reported issue in a single real Chromium browser:
 * after landing in Vesper, switching Helm -> Main Screen must not create a
 * fresh Aster Reach ship. No other client may keep the original room alive.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const captures = join(root, "test-artifacts");
await mkdir(captures, { recursive: true });
const serverPort = 2598, vitePort = 5198;
const processes = [];
function start(command, args, name, env = {}) {
  const child = spawn(command, args, {
    cwd: root, env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", x => { output = (output + x).slice(-16000); });
  }
  processes.push({ name, child, log: () => output });
}
async function healthy(url) {
  for (let n = 0; n < 150; n++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await delay(130);
  }
  throw Error("Server not healthy: " + url + "\n" + processes.map(p => p.log()).join("\n"));
}
function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGTERM"); return; } catch {}
  }
  try { child.kill("SIGTERM"); } catch {}
}
let browser;
try {
  start(process.execPath, ["packages/server/dist/index.js"], "server", {
    PORT: String(serverPort), BRIDGE_SYSTEM_ID: "aster-reach",
    BRIDGE_TEST_START_EPOCH_SECONDS: String(Date.UTC(2026, 9, 24, 20) / 1000),
    BRIDGE_TEST_JUMP_TIME_SCALE: "0.3"
  });
  start("npm", ["--prefix", "packages/client", "run", "dev", "--",
    "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], "vite", {
    VITE_SERVER_URL: "ws://127.0.0.1:" + serverPort
  });
  await healthy("http://127.0.0.1:" + serverPort + "/health");
  await healthy("http://127.0.0.1:" + vitePort);
  browser = await chromium.launch({ headless: true, args: [
    "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"
  ] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => {
    if (m.type() === "error" || /same key|shader compilation|postProcessManager/i.test(m.text())) {
      errors.push(m.text());
    }
  });
  await page.goto("http://127.0.0.1:" + vitePort, { waitUntil: "domcontentloaded" });
  await page.getByText("Connected · Main Screen").waitFor({ timeout: 30000 });
  await page.locator("header .role-select select").selectOption("helm");
  await page.getByText("Connected · Helm").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "JUMP DRIVE" }).click();
  const jump = page.getByRole("region", { name: "Interstellar jump drive controls" });
  await jump.getByRole("button", { name: "PLOT ROUTE" }).click();
  await jump.getByRole("button", { name: "ENGAGE JUMP" }).click();
  await page.locator('canvas.scene[data-system-id="vesper"]').waitFor({ timeout: 45_000 });
  await page.getByRole("region", { name: "Interstellar travel telemetry" })
    .getByText("Vesper", { exact: true }).first().waitFor({ timeout: 12000 });
  await page.waitForFunction(() => {
    const d = window.__bridgeRendererDiagnostics;
    return d?.active === 1 && d.activeSystemId === "vesper" &&
      d.activeSkyBodyIds.includes("vesper-primary") && d.oldSystemSkyBodies === 0;
  }, null, { timeout: 30000 });
  const rendererBefore = await page.evaluate(() => ({
    created: window.__bridgeRendererDiagnostics.created,
    disposed: window.__bridgeRendererDiagnostics.disposed
  }));
  // A connection replacement used to dispose the room and reset the ship.
  await page.evaluate(() => {
    window.__stationStatuses = [];
    const node = document.querySelector(".connection-status");
    if (!node) throw Error("Missing connection status");
    const observer = new MutationObserver(() => {
      window.__stationStatuses.push(node.textContent);
    });
    observer.observe(node, { childList: true, subtree: true, characterData: true });
  });
  await page.locator("header .role-select select").selectOption("main-screen");
  await page.getByText("Connected · Main Screen").waitFor({ timeout: 10000 });
  await page.locator('canvas.scene[data-system-id="vesper"]').waitFor({ timeout: 12000 });
  await page.getByRole("region", { name: "Interstellar travel telemetry" })
    .getByText("Vesper", { exact: true }).first().waitFor({ timeout: 6000 });
  const roleSwitchState = await page.evaluate(() => ({
    ...window.__bridgeRendererDiagnostics,
    statuses: window.__stationStatuses
  }));
  assert.equal(roleSwitchState.activeSystemId, "vesper");
  assert.equal(roleSwitchState.created, rendererBefore.created,
    "Changing a station must not rebuild a Babylon engine");
  assert.equal(roleSwitchState.disposed, rendererBefore.disposed,
    "Changing station must not tear down the live Vesper scene");
  assert.equal(roleSwitchState.statuses.some(x => /connecting|unavailable/i.test(x)), false,
    "Station switching should not disconnect the websocket");
  await page.screenshot({ path: join(captures, "solo-vesper-after-main-switch.png"), fullPage: true });

  // A real reload also leaves the Colyseus room empty. Returning to the app
  // must rejoin the existing Vesper voyage, not create Aster Reach again.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Connected · Main Screen").waitFor({ timeout: 20000 });
  await page.locator('canvas.scene[data-system-id="vesper"]').waitFor({ timeout: 20000 });
  await page.getByRole("region", { name: "Interstellar travel telemetry" })
    .getByText("Vesper", { exact: true }).first().waitFor({ timeout: 8000 });
  await page.screenshot({ path: join(captures, "solo-vesper-after-reload.png"), fullPage: true });

  await page.locator("header .role-select select").selectOption("helm");
  await page.getByText("Connected · Helm").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "JUMP DRIVE" }).click();
  const home = page.getByRole("region", { name: "Interstellar jump drive controls" });
  await home.getByRole("button", { name: "PLOT ROUTE" }).click();
  await home.getByRole("button", { name: "ENGAGE JUMP" }).click();
  await page.locator('canvas.scene[data-system-id="aster-reach"]').waitFor({ timeout: 45_000 });
  assert.deepEqual(errors, [], "Chromium errors: " + errors.join("\n"));
  console.log("Solo browser Vesper station switch PASS: arrival → Main Screen unchanged, zero disconnect/rebuilds, empty-room page reload keeps Vesper, reverse jump to Aster Reach.");
  await context.close();
} catch (error) {
  console.error(error);
  for (const p of processes) console.error(p.name, p.log());
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const p of processes) stop(p.child);
}
