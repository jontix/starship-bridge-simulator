/**
 * Sound Lab 02: sample-shaped effects synthesised in a Web Audio graph.
 * All noise recordings here are deterministic buffers generated in-browser.
 * The impulse/rumble, capacitor, glass, thunder and Doppler pass-bys are
 * audition-quality prototypes. Swap specific one-shot sources for vetted
 * field recordings after listening approval; no third-party assets are used.
 */
export type DesignCue =
  | "thruster" | "ftl-charge" | "ftl-engage" | "ftl-drop"
  | "jump-charge" | "jump-engage" | "jump-arrive" | "passby";

type TrackedSource = OscillatorNode | AudioBufferSourceNode;
const EPS = 0.0001;

export class CinematicDriveEffects {
  private sources = new Set<TrackedSource>();
  private seed = 0x1988;
  private brown: AudioBuffer;
  private bright: AudioBuffer;
  private passes = 0;

  constructor(private readonly ctx: AudioContext, private readonly out: AudioNode) {
    this.brown = this.makeNoise(true);
    this.bright = this.makeNoise(false);
  }

  get activeCount() { return this.sources.size; }
  get passCount() { return this.passes; }

  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private makeNoise(low: boolean): AudioBuffer {
    const n = Math.round(this.ctx.sampleRate * 3);
    const buffer = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const white = this.random() * 2 - 1;
      y = (y + white * 0.03) / 1.03;
      data[i] = low ? y * 5.5 : white * 0.65;
    }
    return buffer;
  }
  private track(source: TrackedSource, duration: number, start = this.ctx.currentTime) {
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
    source.start(start);
    source.stop(start + duration);
  }
  private gain(start: number, peak: number, attack: number, decay: number, end: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(EPS, start);
    g.gain.exponentialRampToValueAtTime(Math.max(EPS, peak), start + Math.max(0.012, attack));
    g.gain.setValueAtTime(Math.max(EPS, peak), start + Math.max(0.012, attack) + 0.01);
    g.gain.exponentialRampToValueAtTime(EPS, start + decay);
    g.connect(this.out);
    return g;
  }
  private tone(freq: number, finish: number, duration: number, level: number,
      shape: OscillatorType, delay = 0, attack = 0.025, pan = 0) {
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = shape;
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(5, finish), start + duration);
    const env = this.gain(start, level, attack, duration, start + duration);
    const spatial = this.ctx.createStereoPanner();
    spatial.pan.value = pan;
    osc.connect(spatial).connect(env);
    this.track(osc, duration + 0.015, start);
  }
  private hiss(opts: {
    duration: number; level: number; filter: number;
    highpass?: boolean; delay?: number; attack?: number;
    pan?: number; bandwidth?: number; rolloff?: number;
  }) {
    const start = this.ctx.currentTime + (opts.delay ?? 0);
    const source = this.ctx.createBufferSource();
    source.buffer = opts.filter < 350 ? this.brown : this.bright;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.highpass ? "highpass" : "bandpass";
    filter.frequency.setValueAtTime(Math.max(80, opts.filter), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(100, opts.rolloff ?? opts.filter * 0.65),
      start + opts.duration);
    filter.Q.value = opts.bandwidth ?? 0.8;
    const env = this.gain(start, opts.level, opts.attack ?? 0.016, opts.duration, start + opts.duration);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    source.connect(filter).connect(pan).connect(env);
    this.track(source, opts.duration + 0.01, start);
  }

  cue(kind: DesignCue): void {
    switch (kind) {
      case "thruster":
        this.tone(63, 41, 0.55, 0.22, "sawtooth");
        this.hiss({ duration: 0.8, level: 0.14, filter: 135, attack: 0.025, bandwidth: 0.5 });
        break;
      case "ftl-charge":
        // Capacitor flash: starts high and narrow, then climbs sharply, with a
        // slight low-voltage warble and intermittent electrical crackles.
        this.tone(690, 4100, 3.97, 0.095, "sine", 0, 0.06);
        this.tone(705, 4020, 3.96, 0.013, "sawtooth", 0, 0.08);
        for (let i = 0; i < 8; i++) {
          this.hiss({ duration: 0.035 + this.random() * 0.04,
            level: 0.021, filter: 2700 + this.random() * 1000,
            highpass: true, delay: 0.4 + i * 0.39 });
        }
        break;
      case "ftl-engage":
        // Shattered glass imitation: broadband fracture at the onset, then
        // pitches fall independently in an inharmonic spray of shards.
        this.hiss({ duration: 0.55, level: 0.34, filter: 2500, highpass: true, bandwidth: 1.5 });
        this.hiss({ duration: 1.05, level: 0.15, filter: 840, attack: 0.018, bandwidth: 0.5 });
        for (let i = 0; i < 13; i++) {
          const f = 630 + this.random() * 4200;
          const dur = 0.22 + this.random() * 1.35;
          this.tone(f, f * (0.58 + this.random() * 0.31), dur,
            0.013 + this.random() * 0.016, "sine", this.random() * 0.27,
            0.008, this.random() * 1.8 - 0.9);
        }
        break;
      case "ftl-drop":
        this.tone(710, 110, 1.15, 0.08, "triangle");
        this.hiss({ duration: 1.1, level: 0.055, filter: 2900, rolloff: 280 });
        break;
      case "jump-charge":
        this.tone(45, 160, 5.95, 0.115, "sawtooth", 0, 0.45);
        this.hiss({ duration: 5.95, level: 0.05, filter: 1200, rolloff: 360, attack: 0.9 });
        break;
      case "jump-engage":
      case "jump-arrive": {
        // Thunder has a sharp crack and three rolling bands, deliberately
        // asymmetrical so entry and exit are related but recognisably different.
        const outgoing = kind === "jump-engage";
        this.hiss({ duration: 0.22, level: outgoing ? 0.35 : 0.24,
          filter: 1600, highpass: true, attack: 0.012 });
        this.tone(74, 32, outgoing ? 2.8 : 3.1, outgoing ? 0.28 : 0.24,
          "sawtooth", 0, 0.016);
        for (let i = 0; i < 3; i++) {
          this.hiss({ duration: 1.15 + i * 0.52, level: 0.12 - i * 0.021,
            filter: 140 + i * 95, delay: 0.12 + i * 0.35,
            attack: 0.025, bandwidth: 0.4 });
        }
        break;
      }
      case "passby":
        this.passes++;
        // Doppler-like multi-layered vehicle flyby. The pitch and spectrum
        // rise into the listener, then plunge as it races past. Stereo reverses
        // on alternating passes to give moving traffic spatial variation.
        this.passBy();
        break;
    }
  }

  private passBy() {
    const t = this.ctx.currentTime;
    const duration = 1.42 + this.random() * 0.38;
    const side = this.passes % 2 === 0 ? 1 : -1;
    const pitch = 125 + this.random() * 115;
    const engine = this.ctx.createOscillator();
    engine.type = "sawtooth";
    engine.frequency.setValueAtTime(pitch * 0.85, t);
    engine.frequency.exponentialRampToValueAtTime(pitch * 1.78, t + duration * 0.45);
    engine.frequency.exponentialRampToValueAtTime(pitch * 0.57, t + duration);
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(300, t);
    lowpass.frequency.exponentialRampToValueAtTime(3100, t + duration * 0.44);
    lowpass.frequency.exponentialRampToValueAtTime(320, t + duration);
    const spatial = this.ctx.createStereoPanner();
    spatial.pan.setValueAtTime(-0.9 * side, t);
    spatial.pan.linearRampToValueAtTime(0.9 * side, t + duration);
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(EPS, t);
    envelope.gain.exponentialRampToValueAtTime(0.018, t + duration * 0.18);
    envelope.gain.exponentialRampToValueAtTime(0.13, t + duration * 0.46);
    envelope.gain.exponentialRampToValueAtTime(EPS, t + duration);
    engine.connect(lowpass).connect(spatial).connect(envelope).connect(this.out);
    this.track(engine, duration + 0.01, t);
    this.hiss({ duration, filter: 4400, rolloff: 490,
      level: 0.082, pan: -0.3 * side, attack: duration * 0.38, bandwidth: 0.65 });
  }

  stopAll(): void {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* ended or stopping */ }
    }
    this.sources.clear();
  }
}