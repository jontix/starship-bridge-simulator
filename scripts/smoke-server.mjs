import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Exercise both the production ESM bundle and the tsx loader used by the development script.
// This catches ESM/Windows/Node-version bugs that tsc --noEmit and a Linux-only build miss.
async function checkServer(name, args, port) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });
  let output = "";
  let exited = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  child.once("exit", () => { exited = true; });
  child.once("error", error => { output += `\nspawn: ${error.message}`; exited = true; });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (exited) throw new Error(`${name} exited before listening:\n${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok && (await response.json()).ok === true) {
          ready = true;
          break;
        }
      } catch { /* server may not have bound yet */ }
      await delay(200);
    }
    if (!ready) throw new Error(`${name} did not listen after 10 seconds:\n${output}`);
    console.log(`${name} started: /health returned ok`);
  } finally {
    if (!exited) {
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); }
      } else {
        child.kill();
      }
    }
  }
}

await checkServer("Compiled server", ["packages/server/dist/index.js"], 2568);
await checkServer("Development loader", ["--import", "tsx", "packages/server/src/index.ts"], 2569);
