/**
 * Stage C acceptance: real Chromium/WebGL Helm and Main Screen UIs,
 * with a second real Colyseus crew client observing authoritative snapshots.
 * Stops during transit because full destination renderer handoff is Stage D.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Client } from "colyseus.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = join(root, "test-artifacts");
await mkdir(artifactDir, { recursive: true });
const children = [];
function start(command, args, name, env = {}) {
  const child = spawn(command, args, {
    cwd: root, env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });
  let log = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", part => { log = (log + part).slice(-20000); });
  }
  children.push({ name, child, log: () => log });
}
async function health(url) {
  for (let n = 0; n < 200; n++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await delay(150);
  }
  throw new Error("Health check failed " + url + "\n" +
    children.map(c => c.name + ": " + c.log()).join("\n"));
}
async function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGTERM"); return; } catch {}
  }
  child.kill("SIGTERM");
}

let browser;
let observerRoom;
try {
  start(process.execPath, ["packages/server/dist/index.js"], "Colyseus", {
    PORT: "2567",
    BRIDGE_SYSTEM_ID: "aster-reach",
    BRIDGE_TEST_START_EPOCH_SECONDS: String(Date.UTC(2026, 9, 24, 20) / 1000),
    BRIDGE_TEST_JUMP_TIME_SCALE: "0.75"
  });
  start("npm", ["--prefix", "packages/client", "run", "dev", "--",
    "--host", "127.0.0.1", "--port", "5173", "--strictPort"], "Vite");
  await health("http://127.0.0.1:2567/health");
  await health("http://127.0.0.1:5173");

  browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"]
  });
  const client = new Client("ws://127.0.0.1:2567");
  observerRoom = await client.joinOrCreate("bridge", { role: "main-screen" });
  let observerSnapshot = null;
  observerRoom.onMessage("snapshot", snapshot => { observerSnapshot = snapshot; });
  const untilObserver = async (condition, label, timeoutMs = 7000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (condition()) return;
      await delay(55);
    }
    throw new Error("Timed out waiting for observer " + label);
  };
  await untilObserver(() => observerSnapshot?.interstellar?.phase === "idle", "initial snapshot");

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => {
    if (m.type() === "error" || /shader compilation|unable to compile|failed to compile effect/i.test(m.text())) {
      errors.push(m.text());
    }
  });
  await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  await page.getByText("Connected · Main Screen").waitFor({ timeout: 30_000 });

  // Real browser Main Screen has a read-only chart, while a separate genuine
  // Colyseus main-screen client keeps the same room alive across role switches.
  await page.getByRole("button", { name: /GALACTIC MAP/ }).click();
  const observerChart = page.getByRole("dialog", { name: "Galactic Navigation map" });
  await observerChart.waitFor();
  await observerChart.getByRole("button", { name: /Vesper/ }).click();
  await observerChart.getByText("MAIN SCREEN · READ ONLY").waitFor();
  assert.equal(await observerChart.getByRole("button", { name: "PLOT SELECTED ROUTE" }).count(), 0);
  await page.screenshot({ path: join(artifactDir, "galactic-main-screen-readonly.png"), fullPage: true });
  await observerChart.getByRole("button", { name: "Close Galactic Navigation" }).click();

  // Browser takes the Helm role; the independent observer keeps watching.
  await page.locator("header .role-select select").selectOption("helm");
  await page.getByText("Connected · Helm").waitFor({ timeout: 20_000 });
  await page.getByRole("region", { name: "Helm workstation" }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /GALACTIC MAP/ }).click();
  const chart = page.getByRole("dialog", { name: "Galactic Navigation map" });
  await chart.getByRole("img", { name: /Galactic route chart/ }).waitFor();
  await chart.getByRole("button", { name: /Vesper/ }).click();
  await chart.getByText("5.04 ly", { exact: false }).first().waitFor({ timeout: 10_000 });
  assert.equal(await chart.getByText("Server-plotted").locator("..").locator("strong").textContent(),
    "NO ROUTE PLOTTED", "Selection is a local preview only");
  assert.equal(observerSnapshot.interstellar.destinationSystemId, null);
  await page.screenshot({ path: join(artifactDir, "galactic-chart-helm-preview.png"), fullPage: true });
  await chart.getByRole("button", { name: "PLOT SELECTED ROUTE" }).click();
  await chart.getByRole("button", { name: /ROUTE PLOTTED/ }).waitFor({ timeout: 10_000 });
  await untilObserver(() => observerSnapshot?.interstellar?.destinationSystemId === "vesper",
    "authoritative plotted route");
  assert.equal(observerSnapshot.interstellar.phase, "idle", "Plot alone cannot depart");
  await chart.getByRole("button", { name: "RETURN TO HELM JUMP CONTROLS" }).click();
  const panel = page.getByRole("region", { name: "Interstellar jump drive controls" });
  await panel.waitFor({ timeout: 8_000 });
  await panel.getByRole("button", { name: "ENGAGE JUMP" }).click();
  await panel.getByText("CHARGING", { exact: true }).first().waitFor({ timeout: 8_000 });
  await untilObserver(() => observerSnapshot?.interstellar?.phase === "charging",
    "shared charge");
  assert.equal(await page.getByRole("button", { name: /EMERGENCY BRAKE/ }).isDisabled(), true);
  await panel.getByRole("button", { name: "CANCEL CHARGE" }).click();
  await panel.getByText("ROUTE PLOTTED").first().waitFor({ timeout: 8_000 });
  await untilObserver(() => observerSnapshot?.interstellar?.phase === "idle",
    "cancellation");
  assert.equal(await panel.getByRole("button", { name: "ENGAGE JUMP" }).isEnabled(), true);

  await panel.getByRole("button", { name: "ENGAGE JUMP" }).click();
  await panel.getByText("INTERSTELLAR TRANSIT", { exact: true }).first().waitFor({ timeout: 9_000 });
  await untilObserver(() => observerSnapshot?.interstellar?.phase === "transit",
    "shared transit");
  assert.equal(await panel.getByRole("button", { name: "CANCEL CHARGE" }).isDisabled(), true);
  assert.equal(await panel.getByRole("button", { name: "PLOT ROUTE" }).isDisabled(), true);
  await page.screenshot({ path: join(artifactDir, "galactic-helm-in-transit.png"), fullPage: true });

  // Return Chromium to Main Screen while the *other* crew client continues to
  // hold and observe the live jump in the same authoritative room.
  await page.locator("header .role-select select").selectOption("main-screen");
  await page.getByText("Connected · Main Screen").waitFor({ timeout: 15_000 });
  await page.getByRole("region", { name: "Interstellar travel telemetry" })
    .getByRole("progressbar", { name: "Interstellar transit progress" }).waitFor({ timeout: 8_000 });
  await page.screenshot({ path: join(artifactDir, "galactic-main-screen-in-transit.png"), fullPage: true });
  assert.ok(observerSnapshot.interstellar.progress >= 0 &&
    observerSnapshot.interstellar.progress <= 1);
  assert.deepEqual(errors, [], "Real Chromium/WebGL errors during Stage C: " + errors.join("\\n"));
  console.log("Galactic Navigation browser smoke passed: Chromium Helm/Main Screen, real crew observer, preview/plot/engage/cancel and synced transit.");
  await context.close();
} catch (err) {
  console.error(err);
  for (const c of children) console.error(c.name, c.log());
  process.exitCode = 1;
} finally {
  try { await observerRoom?.leave(); } catch {}
  if (browser) await browser.close();
  await Promise.all(children.map(c => stop(c.child)));
}
