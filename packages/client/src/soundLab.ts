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
    describe("local", "Audio enabled. Local propulsion is ready for audition.");
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
});
byId<HTMLButtonElement>("local-coast").addEventListener("click", () => {
  cancelSequence();
  describe("standby", "COAST / The main drive has settled to bridge quiet.");
});
byId<HTMLButtonElement>("ftl-engage").addEventListener("click", () => {
  cancelSequence();
  describe("ftl-spool", "FTL / Charging drive coils for four seconds.");
  engine.cue("ftl-charge");
  schedule(4000, () => {
    describe("ftl-cruise", "FTL / Harmonic cruise field engaged.");
    engine.cue("ftl-engage");
  });
});
byId<HTMLButtonElement>("ftl-drop").addEventListener("click", () => {
  cancelSequence();
  engine.cue("ftl-drop");
  describe("standby", "FTL / Field decaying; preparing to return to local flight.");
  schedule(1050, () => describe("local", "LOCAL / Drive field released."));
});
byId<HTMLButtonElement>("jump-engage").addEventListener("click", () => {
  cancelSequence();
  describe("jump-charge", "JUMP / Corridor charge, six seconds.");
  engine.cue("jump-charge");
  schedule(6000, () => {
    describe("jump-transit", "JUMP / Interstellar corridor. Evolve the texture, then choose Preview Arrival.");
    engine.cue("jump-engage");
  });
});
byId<HTMLButtonElement>("jump-arrive").addEventListener("click", () => {
  cancelSequence();
  engine.cue("jump-arrive");
  describe("standby", "ARRIVAL / Harmonic release and local-space settling.");
  schedule(1900, () => describe("local", "LOCAL / Destination reached, local propulsion ready."));
});

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