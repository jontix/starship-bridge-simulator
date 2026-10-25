import { CinematicDriveEffects, type DesignCue } from "./cinematicDriveEffects";
import { RecordedDriveAudio } from "./recordedDriveAudio";
/**
 * Starship Audio v1 — standalone, browser-only sound-design instrument.
 *
 * Not wired into bridge snapshots, not a gameplay system and no samples or
 * network dependencies. Oscillators, filtered noise, gain envelopes and a
 * safety compressor produce small, deterministic and tweakable sound layers.
 */
export type SoundScene =
  | "standby" | "local" | "ftl-spool" | "ftl-cruise"
  | "jump-charge" | "jump-transit";
export type AudioControl = "master" | "intensity" | "texture" | "evolution";

type Voice = {
  bus: GainNode;
  filter: BiquadFilterNode;
  noise: GainNode;
  tones: OscillatorNode[];
};

export const SOUND_PALETTE = {
  local: { label: "THE MACHINE", rootHz: 55, character: "Mass and reaction" },
  ftl: { label: "THE FIELD", rootHz: 110, character: "Stable harmonic propulsion" },
  jump: { label: "THE CORRIDOR", rootHz: 55, character: "Spacious altered reality" }
} as const;

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
function glide(param: AudioParam, value: number, time: number, seconds = 0.07) {
  param.setTargetAtTime(value, time, seconds);
}

export class StarshipSoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: Record<"local" | "ftl" | "jump", Voice> | null = null;
  private scene: SoundScene = "standby";
  private controls: Record<AudioControl, number> = {
    master: 0.38, intensity: 0.55, texture: 0.35, evolution: 0.3
  };
  private cues = 0;
  private effects: CinematicDriveEffects | null = null;
  private recorded: RecordedDriveAudio | null = null;

  get state() {
    return {
      enabled: this.context?.state === "running",
      contextState: this.context?.state ?? "not-created",
      scene: this.scene,
      ...this.controls,
      cuesPlayed: this.cues,
      activeCues: this.effects?.activeCount ?? 0,
      passBys: this.effects?.passCount ?? 0,
      recordings: this.recorded?.status ?? { ready: [], missing: [], errors: [], active: 0, playedCars: 0 },
      activeVoices: this.voices ? Object.entries(this.voices)
        .filter(([, voice]) => voice.bus.gain.value > 0.001)
        .map(([name]) => name) : []
    };
  }

  async enable(): Promise<void> {
    if (this.context?.state === "running") return;
    if (!this.context) this.createGraph();
    await this.context!.resume(); // Called only after a real user gesture.
    await this.recorded?.load();
    // An enabled sound device is not the same as an accelerating ship:
    // keep propulsion silent until the user previews thrust.
    this.refresh();
  }

  async disable(): Promise<void> {
    if (this.context) {
      this.cancelCues();
      this.recorded?.stopAll();
      this.scene = "standby";
      this.refresh();
      await this.context.suspend();
    }
  }

  setControl(which: AudioControl, value: number): void {
    this.controls[which] = clamp(value);
    this.refresh();
  }

  setScene(scene: SoundScene): void {
    this.scene = scene;
    this.recorded?.setThrust(scene === "local", this.controls.intensity);
    this.refresh();
  }

  /** Preview-only transient. No server state or duplicate network playback. */
  cue(kind: DesignCue): void {
    if (this.context?.state !== "running" || !this.effects) return;
    this.cues++;
    const real: Partial<Record<DesignCue, "glass" | "thunder" | "car" | "capacitor">> = {
      "ftl-charge": "capacitor", "ftl-engage": "glass",
      "jump-engage": "thunder", "jump-arrive": "thunder", "passby": "car"
    };
    const recording = real[kind];
    if (recording) this.recorded?.play(recording, this.controls.intensity);
    // The synthetic layers remain a restrained sub-bass/field bed; the
    // recognisable physical transient comes from the decoded recording.
    if (recording && this.recorded?.status.ready.includes(recording)) return;
    this.effects.cue(kind);
  }

  cancelCues(): void {
    this.effects?.stopAll();
    this.recorded?.stopAll();
  }

  async dispose(): Promise<void> {
    this.cancelCues();
    this.effects = null;
    this.recorded = null;
    const ctx = this.context;
    this.context = null;
    this.master = null;
    this.voices = null;
    this.scene = "standby";
    if (ctx && ctx.state !== "closed") await ctx.close();
  }

  private createGraph(): void {
    const ctx = new AudioContext();
    this.context = ctx;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.knee.value = 16;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.28;
    compressor.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(compressor);
    this.master = master;
    this.effects = new CinematicDriveEffects(ctx, master);
    this.recorded = new RecordedDriveAudio(ctx, master);

    // Deterministic soft noise texture reused by all three propulsion beds.
    const samples = Math.round(ctx.sampleRate * 2);
    const noiseBuffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let seed = 2601;
    for (let i = 0; i < samples; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }

    const makeVoice = (
      tones: ReadonlyArray<[number, OscillatorType, number]>,
      filterHz: number, noiseHz: number
    ): Voice => {
      const bus = ctx.createGain();
      bus.gain.value = 0;
      bus.connect(master);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = filterHz;
      filter.Q.value = 0.35;
      filter.connect(bus);
      const oscillators = tones.map(([hz, type, level]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz;
        const g = ctx.createGain();
        g.gain.value = level;
        o.connect(g).connect(filter);
        o.start();
        return o;
      });
      const textureFilter = ctx.createBiquadFilter();
      textureFilter.type = "bandpass";
      textureFilter.frequency.value = noiseHz;
      textureFilter.Q.value = 0.55;
      const noise = ctx.createGain();
      noise.gain.value = 0;
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;
      source.connect(textureFilter).connect(noise).connect(bus);
      source.start();
      return { bus, filter, noise, tones: oscillators };
    };

    this.voices = {
      local: makeVoice([[42, "sawtooth", 0.22], [63, "sine", 0.17], [85, "sawtooth", 0.07]], 400, 140),
      ftl: makeVoice([[110, "sawtooth", 0.06], [116.4, "triangle", 0.07], [157.3, "sawtooth", 0.035], [231, "sine", 0.04]], 960, 1600),
      jump: makeVoice([[48, "sine", 0.09], [70.5, "sawtooth", 0.032], [103.7, "triangle", 0.036], [156.5, "sine", 0.012]], 690, 760)
    };
    // Each advanced drive has a genuinely evolving sound even if nobody
    // touches the sliders. Sub-audio modulators add slow spectral motion.
    // They are deliberately very subtle to avoid an exhausting 45s tunnel.
    const fieldMotion = ctx.createOscillator();
    fieldMotion.type = "sine";
    fieldMotion.frequency.value = 0.31;
    const fieldDepth = ctx.createGain();
    fieldDepth.gain.value = 17; // ±17 cents
    fieldMotion.connect(fieldDepth).connect(this.voices.ftl.tones[2].detune);
    fieldMotion.start();
    const corridorMotion = ctx.createOscillator();
    corridorMotion.type = "sine";
    corridorMotion.frequency.value = 0.08;
    const corridorDepth = ctx.createGain();
    corridorDepth.gain.value = 85; // ±85 Hz of spectral filter breathing
    corridorMotion.connect(corridorDepth).connect(this.voices.jump.filter.frequency);
    corridorMotion.start();
    this.refresh();
  }

  private refresh(): void {
    const ctx = this.context;
    if (!ctx || !this.master || !this.voices) return;
    const now = ctx.currentTime;
    const c = this.controls;
    glide(this.master.gain, c.master, now);
    const local = this.scene === "local";
    const jump = this.scene === "jump-charge" || this.scene === "jump-transit";
    const gains: Record<"local" | "ftl" | "jump", number> = {
      local: local ? (this.recorded?.status.ready.includes("rumble") ? 0.18 : 0.4) + c.intensity * 0.16 : 0,
      ftl: this.scene === "ftl-cruise" ? 0.5 + c.intensity * 0.45 : 0,
      jump: jump ? (this.scene === "jump-transit" ? 0.45 + c.intensity * 0.38 : 0.62) : 0
    };
    for (const key of ["local", "ftl", "jump"] as const) {
      glide(this.voices[key].bus.gain, gains[key], now, 0.13);
    }
    this.recorded?.setThrust(this.scene === "local", c.intensity);
    glide(this.voices.local.filter.frequency, 140 + c.intensity * 480, now);
    glide(this.voices.ftl.filter.frequency, 370 + c.intensity * 1400, now);
    glide(this.voices.jump.filter.frequency, 290 + c.evolution * 780, now, 0.18);
    glide(this.voices.local.noise.gain, c.texture * (0.08 + c.intensity * 0.19), now);
    glide(this.voices.ftl.noise.gain, c.texture * 0.07, now);
    glide(this.voices.jump.noise.gain, c.texture * (0.03 + c.evolution * 0.08), now);
    const t = this.voices.jump.tones;
    // Harmonic evolution, not a continuously rising loudness.
    glide(t[1].frequency, 70.5 * (1 + c.evolution * 0.16), now, 0.35);
    glide(t[3].frequency, 156.5 * (1 - c.evolution * 0.09), now, 0.35);
  }
}