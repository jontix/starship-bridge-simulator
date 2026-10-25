/**
 * Stage C acceptance: real Vite + Colyseus + two Chromium WebGL stations.
 * Stops during transit because full destination renderer handoff is Stage D.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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
try {
  start(process.execPath, ["packages/server/dist/index.js"], "Colyseus", {
    PORT: "2567",
    BRIDGE_SYSTEM_ID: "aster-reach",
    BRIDGE_TEST_START_EPOCH_SECONDS: String(Date.UTC(2026, 9, 24, 20) / 1000),
    BRIDGE_TEST_JUMP_TIME_SCALE: "0.45"
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const helm = await context.newPage();
  const screen = await context.newPage();
  const errors = [];
  for (const page of [helm, screen]) {
    page.on("pageerror", e => errors.push(String(e)));
    page.on("console", m => {
      if (m.type() === "error" || /shader compilation|unable to compile|failed to compile effect/i.test(m.text())) {
        errors.push(m.text());
      }
    });
    await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
    try {
      await page.getByText("Connected · Main Screen").waitFor({ timeout: 30_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        title: document.title,
        appText: document.querySelector(".app")?.textContent?.slice(0, 1700) ?? null,
        connection: document.querySelector(".connection-status")?.textContent ?? null,
        bodyText: document.body?.textContent?.slice(0, 1400) ?? null
      })).catch(e => ({ diagnosticError: String(e) }));
      console.error("GALACTIC CHROMIUM CONNECTION DIAGNOSTIC", JSON.stringify(diagnostic),
        "browser errors:", errors.join("\\n"));
      await page.screenshot({ path: join(artifactDir, "galactic-connection-failure.png"),
        fullPage: true, timeout: 5000 }).catch(() => undefined);
      throw error;
    }
  }
  await helm.locator("header .role-select select").selectOption("helm");
  await helm.getByText("Connected · Helm").waitFor({ timeout: 25_000 });
  await helm.getByRole("region", { name: "Helm workstation" }).waitFor({ timeout: 15_000 });

  // Main Screen can inspect the catalog but has NO plotting/engagement control.
  await screen.getByRole("button", { name: /GALACTIC MAP/ }).click();
  const observerChart = screen.getByRole("dialog", { name: "Galactic Navigation map" });
  await observerChart.waitFor();
  await observerChart.getByRole("button", { name: /Vesper/ }).click();
  await observerChart.getByText("MAIN SCREEN · READ ONLY").waitFor();
  assert.equal(await observerChart.getByRole("button", { name: "PLOT SELECTED ROUTE" }).count(), 0);
  await screen.screenshot({ path: join(artifactDir, "galactic-main-screen-readonly.png"), fullPage: true });
  await observerChart.getByRole("button", { name: "Close Galactic Navigation" }).click();

  // Helm opens the distinct GALACTIC chart, not the existing AU System Map.
  await helm.getByRole("button", { name: /GALACTIC MAP/ }).click();
  const chart = helm.getByRole("dialog", { name: "Galactic Navigation map" });
  await chart.getByRole("img", { name: /Galactic route chart/ }).waitFor();
  await chart.getByRole("button", { name: /Vesper/ }).click();
  await chart.getByText("5.04 ly", { exact: false }).first().waitFor({ timeout: 10_000 });
  assert.equal(await chart.getByText("Server-plotted").locator("..").locator("strong").textContent(),
    "NO ROUTE PLOTTED", "Selecting is only a preview, not server flight intent");
  await helm.screenshot({ path: join(artifactDir, "galactic-chart-helm-preview.png"), fullPage: true });
  await chart.getByRole("button", { name: "PLOT SELECTED ROUTE" }).click();
  await chart.getByRole("button", { name: /ROUTE PLOTTED/ }).waitFor({ timeout: 10_000 });
  await screen.getByRole("region", { name: "Interstellar travel telemetry" })
    .getByText("ROUTE PLOTTED").waitFor({ timeout: 10_000 });
  assert.equal(await chart.getByText("Drive state").locator("..").locator("strong").textContent(),
    "ROUTE PLOTTED");
  await chart.getByRole("button", { name: "RETURN TO HELM JUMP CONTROLS" }).click();

  // Plot alone cannot depart; only a separate Helm Engage command starts charging.
  const panel = helm.getByRole("region", { name: "Interstellar jump drive controls" });
  await panel.waitFor({ timeout: 8000 });
  await panel.getByRole("button", { name: "ENGAGE JUMP" }).click();
  await panel.getByText("CHARGING", { exact: true }).first().waitFor({ timeout: 10_000 });
  await screen.getByRole("region", { name: "Interstellar travel telemetry" })
    .getByText("CHARGING", { exact: true }).waitFor({ timeout: 10_000 });
  assert.equal(await helm.getByRole("button", { name: /EMERGENCY BRAKE/ }).isDisabled(), true);
  await panel.getByRole("button", { name: "CANCEL CHARGE" }).click();
  await panel.getByText("ROUTE PLOTTED").first().waitFor({ timeout: 8_000 });
  assert.equal(await panel.getByRole("button", { name: "ENGAGE JUMP" }).isEnabled(), true);

  // Re-engage and confirm synchronized transit, progress and disabled abort.
  await panel.getByRole("button", { name: "ENGAGE JUMP" }).click();
  await panel.getByText("INTERSTELLAR TRANSIT", { exact: true }).first().waitFor({ timeout: 8_000 });
  await screen.getByRole("region", { name: "Interstellar travel telemetry" })
    .getByRole("progressbar", { name: "Interstellar transit progress" }).waitFor({ timeout: 8_000 });
  assert.equal(await panel.getByRole("button", { name: "CANCEL CHARGE" }).isDisabled(), true);
  assert.equal(await panel.getByRole("button", { name: "PLOT ROUTE" }).isDisabled(), true);
  await helm.screenshot({ path: join(artifactDir, "galactic-helm-in-transit.png"), fullPage: true });
  await screen.screenshot({ path: join(artifactDir, "galactic-main-screen-in-transit.png"), fullPage: true });
  assert.deepEqual(errors, [], "Real Chromium/WebGL errors during Stage C: " + errors.join("\n"));
  console.log("Galactic Navigation browser smoke passed: read-only Main Screen, Helm chart preview/plot/engage/cancel, synced transit and WebGL.");
  await context.close();
} catch (err) {
  console.error(err);
  for (const c of children) console.error(c.name, c.log());
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await Promise.all(children.map(c => stop(c.child)));
}
