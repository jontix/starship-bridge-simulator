/**
 * Fetches strictly reviewed, redistributable reference recordings for the
 * Sound Lab. Downloaded audio is NOT checked into git. See docs/recorded-audio-sources.md.
 *
 * This script never fetches music, noncommercial or unclear licences.
 * Run: node scripts/fetch-sound-lab-recordings.mjs
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve("packages/client/public/sound-lab/recorded");
const sources = [
  {
    file: "rumble.ogg",
    url: "https://opengameart.org/sites/default/files/deep_rumble.ogg",
    licence: "CC0 1.0",
    author: "gmason",
    source: "https://opengameart.org/content/underwater-or-space-engine-rumble",
    maxBytes: 2_000_000
  },
  {
    file: "glass.wav",
    url: "https://opengameart.org/sites/default/files/glass_breaking.wav",
    licence: "CC0 1.0",
    author: "Till Behrend (uploaded by TinyWorlds)",
    source: "https://opengameart.org/content/glass-break",
    maxBytes: 2_000_000
  },
  {
    file: "car.wav",
    url: "https://opengameart.org/sites/default/files/car1.wav",
    licence: "CC0 1.0",
    author: "Yaroslav_Novikov",
    source: "https://opengameart.org/content/car-1-1",
    maxBytes: 6_000_000
  },
  {
    file: "thunder.ogg",
    url: "https://upload.wikimedia.org/wikipedia/commons/4/42/Rain_and_thunder.ogg",
    licence: "Public domain (author dedication)",
    author: "Caesar",
    source: "https://commons.wikimedia.org/wiki/File:Rain_and_thunder.ogg",
    maxBytes: 2_000_000
  }
];

async function download(sample) {
  const target = resolve(root, sample.file);
  try {
    const existing = await readFile(target);
    if (existing.length > 2000 && validSignature(existing, sample.file)) {
      return { ...sample, bytes: existing.length, sha256: digest(existing), cached: true };
    }
  } catch {}
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await fetch(sample.url, {
        headers: { "User-Agent": "StarshipBridgeSoundLab/0.2 (CC0 attribution-linked research prototype)" },
        signal: AbortSignal.timeout(25_000)
      });
      if (!result.ok) throw Error("HTTP " + result.status + " " + result.statusText);
      if (Number(result.headers.get("content-length") ?? "0") > sample.maxBytes) {
        throw Error("Downloaded file exceeds declared size limit");
      }
      const chunks = [];
      let total = 0;
      for await (const chunk of result.body) {
        total += chunk.length;
        if (total > sample.maxBytes) throw Error("Download exceeds size limit");
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      if (!validSignature(data, sample.file)) {
        throw Error("Unexpected binary signature (may be an HTML error page)");
      }
      const temp = target + ".partial";
      await writeFile(temp, data);
      await rename(temp, target);
      return { ...sample, bytes: data.length, sha256: digest(data), cached: false };
    } catch (err) {
      lastError = err;
      await rm(target + ".partial", { force: true });
      await new Promise(done => setTimeout(done, (attempt + 1) * 600));
    }
  }
  throw Error("Could not acquire " + sample.file + " from " + sample.url +
    ": " + String(lastError));
}
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function validSignature(data, name) {
  if (data.length < 2000) return false;
  if (name.endsWith(".ogg")) return data.subarray(0, 4).toString("ascii") === "OggS";
  if (name.endsWith(".wav")) return data.subarray(0, 4).toString("ascii") === "RIFF"
    && data.subarray(8, 12).toString("ascii") === "WAVE";
  return false;
}
await mkdir(root, { recursive: true });
const outcomes = [];
for (const sample of sources) {
  const record = await download(sample);
  outcomes.push(record);
  console.log((record.cached ? "Cached" : "Downloaded") + " " + record.file +
    " (" + record.bytes + " bytes, sha256 " + record.sha256.slice(0, 12) + ")");
}
await writeFile(resolve(root, "source-manifest.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), files: outcomes }, null, 2) + "\n");
console.log("Four verified reference recordings ready in packages/client/public/sound-lab/recorded.");
console.log("Optional: add a CC0 camera-flash-charge sample as capacitor.wav; see docs/recorded-audio-sources.md.");
