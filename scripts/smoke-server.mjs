import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = 2568;
const child = spawn(process.execPath, ["packages/server/dist/index.js"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32"
});
let output = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
let exitCode = null;
child.once("exit", (code) => { exitCode = code; });

try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (exitCode !== null) throw new Error(`Server exited early with code ${exitCode}\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok && (await response.json()).ok === true) { ready = true; break; }
    } catch { /* wait for process to bind */ }
    await delay(200);
  }
  if (!ready) throw new Error(`Server not listening after 6s. Output:\n${output}`);
  console.log("Server smoke test passed: /health returns ok.");
} finally {
  if (process.platform !== "win32" && child.pid) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
  } else {
    child.kill("SIGTERM");
  }
}
