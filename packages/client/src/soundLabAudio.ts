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

  get state() {
    return {
      enabled: this.context?.state === "running",
      contextState: this.context?.state ?? "not-created",
      scene: this.scene,
      ...this.controls,
      cuesPlayed: this.cues,
      activeVoices: this.voices ? Object.entries(this.voices)
        .filter(([, voice]) => voice.bus.gain.value > 0.001)
        .map(([name]) => name) : []
    };
  }

  async enable(): Promise<void> {
    if (this.context?.state === "running") return;
    if (!this.context) this.createGraph();
    await this.context!.resume(); // Called only after a real user gesture.
    if (this.scene === "standby") this.scene = "local";
    this.refresh();
  }

  async disable(): Promise<void> {
    if (this.context) {
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
    this.refresh();
  }

  /**
   * A short transient played only on explicit preview transitions.
   * Reconnecting to a live server is never allowed to replay these by itself.
   */
  cue(kind: "ftl-charge" | "ftl-engage" | "ftl-drop" |
    "jump-charge" | "jump-engage" | "jump-arrive" | "thruster"): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master || ctx.state !== "running") return;
    this.cues++;
    const now = ctx.currentTime;
    const settings: Record<typeof kind, [number, number, number, number]> = {
      "thruster": [290, 90, 0.24, 0.10],
      "ftl-charge": [105, 370, 4.0, 0.065],
      "ftl-engage": [620, 130, 0.72, 0.10],
      "ftl-drop": [340, 75, 1.0, 0.095],
      "jump-charge": [48, 240, 6.0, 0.10],
      "jump-engage": [170, 38, 1.45, 0.16],
      "jump-arrive": [125, 590, 1.8, 0.095]
    };
    const [from, to, duration, maxGain] = settings[kind];
    const osc = ctx.createOscillator();
    osc.type = kind.startsWith("jump") ? "sawtooth" : "triangle";
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), now + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(kind.startsWith("jump") ? 440 : 1200, now);
    filter.frequency.exponentialRampToValueAtTime(kind === "jump-arrive" ? 2100 : 630, now + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(maxGain, now + Math.min(0.25, duration * 0.3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter).connect(envelope).connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => { osc.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }

  async dispose(): Promise<void> {
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
      local: makeVoice([[55, "sine", 0.13], [110, "triangle", 0.035], [83, "sine", 0.02]], 490, 280),
      ftl: makeVoice([[110, "sine", 0.06], [165, "triangle", 0.05], [220, "sine", 0.03], [330, "sine", 0.018]], 1350, 1750),
      jump: makeVoice([[55, "sine", 0.07], [82.5, "sine", 0.055], [110, "triangle", 0.026], [165, "sine", 0.014]], 740, 900)
    };
    this.refresh();
  }

  private refresh(): void {
    const ctx = this.context;
    if (!ctx || !this.master || !this.voices) return;
    const now = ctx.currentTime;
    const c = this.controls;
    glide(this.master.gain, c.master, now);
    const local = this.scene === "local";
    const ftl = this.scene === "ftl-spool" || this.scene === "ftl-cruise";
    const jump = this.scene === "jump-charge" || this.scene === "jump-transit";
    const gains: Record<"local" | "ftl" | "jump", number> = {
      local: local ? 0.4 + c.intensity * 0.6 : 0,
      ftl: ftl ? 0.5 + c.intensity * 0.45 : 0,
      jump: jump ? (this.scene === "jump-transit" ? 0.45 + c.intensity * 0.38 : 0.62) : 0
    };
    for (const key of ["local", "ftl", "jump"] as const) {
      glide(this.voices[key].bus.gain, gains[key], now, 0.13);
    }
    glide(this.voices.local.filter.frequency, 160 + c.intensity * 1050, now);
    glide(this.voices.ftl.filter.frequency, 650 + c.intensity * 1800, now);
    glide(this.voices.jump.filter.frequency, 390 + c.evolution * 1100, now, 0.18);
    glide(this.voices.local.noise.gain, c.texture * (0.016 + c.intensity * 0.065), now);
    glide(this.voices.ftl.noise.gain, c.texture * 0.042, now);
    glide(this.voices.jump.noise.gain, c.texture * (0.024 + c.evolution * 0.075), now);
    const t = this.voices.jump.tones;
    // Harmonic evolution, not a continuously rising loudness.
    glide(t[1].frequency, 82.5 * (1 + c.evolution * 0.16), now, 0.35);
    glide(t[3].frequency, 165 * (1 - c.evolution * 0.09), now, 0.35);
  }
}