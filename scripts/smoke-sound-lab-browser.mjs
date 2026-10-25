/**
 * Browser smoke for the entirely separate Starship Sound Lab.
 * This tests the real Web Audio graph and controls without opening a bridge
 * websocket or starting the server. A human must evaluate the sonic quality.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, "test-artifacts");
await mkdir(outputDir, { recursive: true });
const port = 5197;
const child = spawn("npm", ["--prefix", "packages/client", "run", "dev", "--",
  "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32"
});
let log = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", chunk => { log = (log + chunk).slice(-18000); });
}
let browser;
try {
  let running = false;
  for (let n = 0; n < 150; n++) {
    try {
      if ((await fetch("http://127.0.0.1:" + port + "/sound-lab.html")).ok) {
        running = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(running, "Vite Sound Lab did not start\n" + log);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const exceptions = [];
  page.on("pageerror", error => exceptions.push(String(error)));
  await page.goto("http://127.0.0.1:" + port + "/sound-lab.html", {
    waitUntil: "domcontentloaded"
  });
  await page.getByRole("heading", { name: /Three drives/ }).waitFor();
  await page.waitForFunction(() => !!window.__soundLabDebug);
  const state = () => page.evaluate(() => window.__soundLabDebug.state());
  const changeSlider = (id, value) => page.locator("#" + id).evaluate(
    (element, amount) => {
      element.value = String(amount);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value
  );

  const before = await state();
  assert.equal(before.contextState, "not-created",
    "Autoplay must not create an AudioContext before user interaction");
  assert.equal(before.enabled, false);
  assert.equal(await page.getByRole("button", { name: "Preview Thrust" }).isDisabled(), true);
  await page.screenshot({ path: join(outputDir, "sound-lab-standby.png"), fullPage: true });

  await page.getByRole("button", { name: "Enable Audio" }).click();
  await page.waitForFunction(() => window.__soundLabDebug.state().enabled);
  assert.equal((await state()).scene, "local");
  await page.getByRole("button", { name: "Preview Thrust" }).click();
  assert.ok((await state()).cuesPlayed >= 1);
  await changeSlider("intensity", 75);
  await changeSlider("texture", 60);
  await changeSlider("master", 25);
  assert.equal((await state()).intensity, 0.75);
  assert.equal((await state()).texture, 0.6);
  assert.equal((await state()).master, 0.25);
  await page.getByRole("button", { name: "Coast / Quiet" }).click();
  assert.equal((await state()).scene, "standby");

  await page.getByRole("button", { name: "Spool + Engage" }).click();
  assert.equal((await state()).scene, "ftl-spool");
  await page.waitForFunction(() => window.__soundLabDebug.state().scene === "ftl-cruise",
    null, { timeout: 6500 });
  await page.getByRole("button", { name: "Drop to Local" }).click();
  await page.waitForFunction(() => window.__soundLabDebug.state().scene === "local",
    null, { timeout: 4000 });

  await page.getByRole("button", { name: "Charge + Enter" }).click();
  assert.equal((await state()).scene, "jump-charge");
  await page.waitForFunction(() => window.__soundLabDebug.state().scene === "jump-transit",
    null, { timeout: 9000 });
  await page.waitForFunction(() => window.__soundLabDebug.state().passBys >= 1,
    null, { timeout: 5000 });
  assert.equal((await state()).scene, "jump-transit",
    "Thunder engagement must lead into corridor traffic, not restart the jump");
  await changeSlider("evolution", 82);
  assert.equal((await state()).evolution, 0.82);
  await page.screenshot({ path: join(outputDir, "sound-lab-jump-transit.png"), fullPage: true });
  await page.getByRole("button", { name: "Preview Arrival" }).click();
  assert.equal((await state()).scene, "standby");
  await page.waitForFunction(() => window.__soundLabDebug.state().scene === "local",
    null, { timeout: 3500 });
  assert.ok((await state()).cuesPlayed >= 6);

  // Complete audition in real wall-clock time: 6s charge, 15s corridor,
  // uneven fast pass-bys, then automatic thunderous arrival into local space.
  const passesBefore = (await state()).passBys;
  await page.getByRole("button", { name: "Charge + Enter" }).click();
  await page.waitForFunction(() => window.__soundLabDebug.state().scene === "jump-transit",
    null, { timeout: 9000 });
  await page.waitForFunction(() => window.__soundLabDebug.state().scene === "local",
    null, { timeout: 22000 });
  assert.ok((await state()).passBys >= passesBefore + 7,
    "Seven irregular stereo pass-bys should play before automatic arrival");

  // Pending sequences must not re-trigger when switching/muting.
  await page.getByRole("button", { name: "Charge + Enter" }).click();
  assert.ok((await state()).activeCues > 0, "Jump charge sweep should be in progress");
  await page.getByRole("button", { name: "Mute / Stop" }).click();
  await page.waitForFunction(() => !window.__soundLabDebug.state().enabled,
    null, { timeout: 4000 });
  assert.equal((await state()).activeCues, 0,
    "Mute must discard old charge cues rather than replay them after unmute");
  assert.equal((await state()).enabled, false);
  assert.equal((await state()).scene, "standby");
  await delay(700);
  assert.equal((await state()).scene, "standby");

  await page.getByRole("button", { name: "Enable Audio" }).click();
  await page.waitForFunction(() => window.__soundLabDebug.state().enabled,
    null, { timeout: 5000 });
  assert.equal((await state()).scene, "local");
  assert.deepEqual(exceptions, [], "Browser exceptions: " + exceptions.join("\n"));
  console.log("Starship Sound Lab Chromium PASS: no autoplay; Web Audio; rumble, capacitor/glass FTL, thunder with 7 irregular Doppler pass-bys and auto-arrival; 4s/6s spool; mix, mute/reset");
  await context.close();
} finally {
  if (browser) await browser.close();
  if (child.pid && child.exitCode === null) {
    if (process.platform !== "win32") {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    } else child.kill("SIGTERM");
  }
}