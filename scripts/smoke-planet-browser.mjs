/**
 * Runtime WebGL acceptance smoke for the two-scene Babylon compositor.
 * Builds and starts the real server/client, compiles shaders in Chromium
 * SwiftShader, and saves user-reviewable screenshots as CI artifacts.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshots = join(root, "test-artifacts");
await mkdir(screenshots, { recursive: true });
const processes = [];

function start(command, args, name, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", chunk => {
      output += String(chunk);
      if (output.length > 24_000) output = output.slice(-20_000);
    });
  }
  processes.push({ name, child, output: () => output });
  return child;
}
async function health(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error("Timed out waiting for " + url + "\n" +
    processes.map(p => p.name + ":\n" + p.output()).join("\n"));
}
async function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGTERM"); return; } catch {}
  }
  try { child.kill("SIGTERM"); } catch {}
}

let browser;
try {
  start(process.execPath, ["packages/server/dist/index.js"], "Colyseus", { PORT: "2567" });
  start("npm", ["--prefix", "packages/client", "run", "dev", "--",
    "--host", "127.0.0.1", "--port", "5173", "--strictPort"], "Vite");
  await health("http://127.0.0.1:2567/health");
  await health("http://127.0.0.1:5173");

  browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"
    ]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const shaderFailures = [];
  const runtimeErrors = [];
  page.on("pageerror", error => runtimeErrors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error") {
      const text = message.text();
      runtimeErrors.push(text);
    }
    if (/unable to compile|shader compilation|webgl error|failed to compile effect/i.test(message.text())) {
      shaderFailures.push(message.text());
    }
  });

  await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByText("Connected · Main Screen").waitFor({ timeout: 30_000 });
  await page.getByText("Focused world").waitFor({ timeout: 30_000 });
  await sleep(5000); // generate texture + compile when the surface becomes visible

  const gpuReady = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.scene");
    if (!canvas) return false;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    return Boolean(gl) && !gl.isContextLost();
  });
  assert.ok(gpuReady, "Babylon must retain a valid WebGL context");
  assert.equal(shaderFailures.length, 0, "Babylon shader compilation errors:\n" + shaderFailures.join("\n"));
  assert.equal(runtimeErrors.length, 0, "Browser console/page errors:\n" + runtimeErrors.join("\n"));
  const haven = join(screenshots, "haven-highport-v2.png");
  await page.screenshot({ path: haven, fullPage: true, animations: "disabled" });
  console.log("Captured Haven high-orbit view:", haven);

  await page.getByLabel("Focused planet").selectOption("aster");
  await sleep(1500);
  assert.equal(shaderFailures.length, 0, "Aster shader compilation errors:\n" + shaderFailures.join("\n"));
  assert.equal(runtimeErrors.length, 0, "Aster console errors:\n" + runtimeErrors.join("\n"));
  const star = join(screenshots, "aster-v2.png");
  await page.screenshot({ path: star, fullPage: true, animations: "disabled" });
  console.log("Captured Aster stellar view:", star);
  await context.close();
  console.log("Planetary browser smoke passed: both shaders, connected multiplayer session, valid WebGL and screenshots");
} catch (error) {
  console.error(error);
  for (const p of processes) console.error(p.name, p.output());
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await Promise.all(processes.map(p => stop(p.child)));
}
