import { StarshipSoundEngine, type SoundScene, type AudioControl } from "./soundLabAudio";

const engine = new StarshipSoundEngine();
const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error("Missing Sound Lab element: " + id);
  return node as T;
};
const status = byId<HTMLSpanElement>("audio-status");
const nowPlaying = byId<HTMLSpanElement>("now-playing");
const enable = byId<HTMLButtonElement>("audio-enable");
const disable = byId<HTMLButtonElement>("audio-disable");

let scheduled: number[] = [];
let currentSequence = 0;
let narration = "Audio inactive";

function cancelSequence(): void {
  currentSequence++;
  engine.cancelCues();
  for (const id of scheduled) window.clearTimeout(id);
  scheduled = [];
}
function schedule(ms: number, callback: () => void) {
  const run = currentSequence;
  const id = window.setTimeout(() => {
    if (run === currentSequence && engine.state.enabled) callback();
    scheduled = scheduled.filter(p => p !== id);
  }, ms);
  scheduled.push(id);
}
function describe(scene: SoundScene, message: string): void {
  engine.setScene(scene);
  narration = message;
  nowPlaying.textContent = scene.replaceAll("-", " / ").toUpperCase();
  status.textContent = message;
  document.body.dataset.scene = scene;
}
function disabledControls(disabled: boolean): void {
  for (const el of document.querySelectorAll<HTMLButtonElement>("[data-needs-audio]")) {
    el.disabled = disabled;
  }
  enable.disabled = !disabled;
  disable.disabled = disabled;
  document.body.dataset.audio = disabled ? "off" : "on";
}

enable.addEventListener("click", async () => {
  try {
    await engine.enable();
    disabledControls(false);
    describe("standby", "Audio enabled. Thrusters are quiet until you preview thrust.");
    const recordingInfo = engine.state.recordings;
    const tag = byId<HTMLParagraphElement>("recorded-status");
    const found = recordingInfo.ready;
    const missing = recordingInfo.missing;
    tag.textContent = found.length
      ? "Recorded foley loaded: " + found.join(", ") +
        ". " + (missing.length ? "Missing: " + missing.join(", ") +
        ". Run npm run audio:fetch; optional capacitor recording needs a manual CC0 download." : "All five recorded layers available.")
      : "No recorded foley installed. Run npm run audio:fetch from the project root and reload this page; otherwise you hear the older synthesised fallback.";
  } catch (error) {
    status.textContent = "Could not start audio: " + String(error);
    disabledControls(true);
  }
});
disable.addEventListener("click", async () => {
  cancelSequence();
  await engine.disable();
  disabledControls(true);
  describe("standby", "Audio muted. Select Enable Audio to audition again.");
});

byId<HTMLButtonElement>("local-thrust").addEventListener("click", () => {
  cancelSequence();
  describe("local", "LOCAL / Main propulsion responding to acceleration.");
  engine.cue("thruster");
  // Five-second demo, then a clear quiet coast to compare the two.
  schedule(2600, () => engine.cue("thruster"));
  schedule(5000, () => describe("standby", "COAST / Thrusters off. Ship remains in motion without a speed-based engine roar."));
});
byId<HTMLButtonElement>("local-coast").addEventListener("click", () => {
  cancelSequence();
  describe("standby", "COAST / The main drive has settled to bridge quiet.");
});
byId<HTMLButtonElement>("ftl-engage").addEventListener("click", () => {
  cancelSequence();
  describe("ftl-spool", "FTL / Vintage flash-capacitor charge, four seconds before glass fracture.");
  engine.cue("ftl-charge");
  schedule(4000, () => {
    describe("ftl-cruise", "FTL / Glass fractured. Discordant field active for ten seconds.");
    engine.cue("ftl-engage");
    schedule(10000, () => dropToLocal());
  });
});
function dropToLocal(): void {
  cancelSequence();
  engine.cue("ftl-drop");
  describe("standby", "FTL / Dissonant field collapsing; returning to local space.");
  schedule(1150, () => describe("standby", "LOCAL / Field released. Thrusters are quiet."));
}
byId<HTMLButtonElement>("ftl-drop").addEventListener("click", dropToLocal);
byId<HTMLButtonElement>("jump-engage").addEventListener("click", () => {
  cancelSequence();
  describe("jump-charge", "JUMP / Building six-second charge towards a thunderclap.");
  engine.cue("jump-charge");
  schedule(6000, () => {
    describe("jump-transit", "JUMP / Thunder at the corridor gate. Eerie bed with fast spatial pass-bys.");
    engine.cue("jump-engage");
    // Explicit semi-irregular traffic rhythm, allowing listening to the
    // pass-bys in clusters and gaps instead of a robotic metronome.
    for (const ms of [900, 3150, 4870, 7430, 9040, 11920, 13340]) {
      schedule(ms, () => {
        if (engine.state.scene === "jump-transit") engine.cue("passby");
      });
    }
    schedule(15000, () => arriveAtDestination());
  });
});
function arriveAtDestination(): void {
  cancelSequence();
  engine.cue("jump-arrive");
  describe("standby", "ARRIVAL / Thunder rolls along the collapsing corridor. Local space restored.");
  schedule(3100, () => describe("standby", "LOCAL / Destination reached; thrusters standing by."));
}
byId<HTMLButtonElement>("jump-arrive").addEventListener("click", arriveAtDestination);

for (const key of ["master", "intensity", "texture", "evolution"] as const) {
  const slider = byId<HTMLInputElement>(key);
  const output = byId<HTMLOutputElement>(key + "-value");
  const update = () => {
    const value = Math.max(0, Math.min(100, Number(slider.value)));
    output.value = String(value) + "%";
    engine.setControl(key as AudioControl, value / 100);
  };
  slider.addEventListener("input", update);
  update();
}

// A small test-only observation surface, not part of the simulator's ship API.
declare global {
  interface Window {
    __soundLabDebug?: {
      state: () => ReturnType<typeof readState>;
      narration: () => string;
    };
  }
}
const readState = () => engine.state;
window.__soundLabDebug = {
  state: readState,
  narration: () => narration
};
window.addEventListener("pagehide", () => {
  cancelSequence();
  void engine.dispose();
});
disabledControls(true);