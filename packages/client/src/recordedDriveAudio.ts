/**
 * Recorded foley layer for the Sound Lab. Assets are acquired separately from
 * CC0/public-domain sources; see docs/recorded-audio-sources.md.
 *
 * Uses decoded sound samples rather than pretending oscillators sound like
 * glass, thunder or a moving car. Does not talk to the ship server.
 */
type RecordedName = "rumble" | "glass" | "car" | "thunder" | "capacitor";
const CLIPS: Record<RecordedName, string> = {
  rumble: "/sound-lab/recorded/rumble.ogg",
  glass: "/sound-lab/recorded/glass.wav",
  car: "/sound-lab/recorded/car.wav",
  thunder: "/sound-lab/recorded/thunder.ogg",
  capacitor: "/sound-lab/recorded/capacitor.wav"
};

const nonnegative = (n: number) => Math.max(0, Number.isFinite(n) ? n : 0);
export class RecordedDriveAudio {
  private buffers = new Map<RecordedName, AudioBuffer>();
  private sources = new Set<AudioBufferSourceNode>();
  private rumbleSource: AudioBufferSourceNode | null = null;
  private rumbleGain: GainNode | null = null;
  private lastErrors: string[] = [];
  private passCount = 0;

  constructor(private readonly context: AudioContext, private readonly master: AudioNode) {}

  get status() {
    return {
      ready: [...this.buffers.keys()],
      missing: (Object.keys(CLIPS) as RecordedName[]).filter(k => !this.buffers.has(k)),
      errors: [...this.lastErrors],
      active: this.sources.size,
      playedCars: this.passCount
    };
  }

  async load(): Promise<void> {
    this.lastErrors = [];
    await Promise.all((Object.keys(CLIPS) as RecordedName[]).map(async name => {
      if (this.buffers.has(name)) return;
      try {
        const response = await fetch(CLIPS[name], { cache: "no-cache" });
        if (!response.ok) throw Error("HTTP " + response.status);
        const data = await response.arrayBuffer();
        if (data.byteLength < 2000) throw Error("audio file too small");
        const buffer = await this.context.decodeAudioData(data);
        if (!buffer.duration || !Number.isFinite(buffer.duration))
          throw Error("empty or invalid audio");
        this.buffers.set(name, buffer);
      } catch (error) {
        this.lastErrors.push(name + ": " + String(error));
      }
    }));
  }

  /**
   * Only an active thrust audition should rumble. In gameplay this would be
   * driven by authoritative acceleration, never by the ship's speed.
   */
  setThrust(active: boolean, strength = 0.6): void {
    const now = this.context.currentTime;
    if (active && !this.rumbleSource) {
      const buffer = this.buffers.get("rumble");
      if (!buffer) return;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = 0.86;
      const lowpass = this.context.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 470;
      const volume = this.context.createGain();
      volume.gain.value = 0.0001;
      volume.gain.setTargetAtTime(Math.min(0.42, 0.12 + 0.24 * strength), now, 0.18);
      source.connect(lowpass).connect(volume).connect(this.master);
      this.sources.add(source);
      this.rumbleSource = source;
      this.rumbleGain = volume;
      source.onended = () => {
        this.sources.delete(source);
        if (this.rumbleSource === source) {
          this.rumbleSource = null;
          this.rumbleGain = null;
        }
        source.disconnect();
        lowpass.disconnect();
        volume.disconnect();
      };
      source.start(now);
    } else if (!active && this.rumbleSource && this.rumbleGain) {
      const source = this.rumbleSource;
      const volume = this.rumbleGain;
      this.rumbleSource = null;
      this.rumbleGain = null;
      volume.gain.cancelScheduledValues(now);
      volume.gain.setTargetAtTime(0.0001, now, 0.12);
      try { source.stop(now + 0.55); } catch {}
    } else if (active && this.rumbleGain) {
      this.rumbleGain.gain.setTargetAtTime(
        Math.min(0.42, 0.12 + 0.24 * strength), now, 0.1
      );
    }
  }

  /**
   * Layers recorded materials onto the existing synthesised drive bed.
   * The recorded sample provides the physical identity; oscillators become
   * secondary colour, not the main effect.
   */
  play(name: "glass" | "thunder" | "car" | "capacitor", strength = 0.75) {
    const buffer = this.buffers.get(name);
    if (!buffer || this.context.state !== "running") return false;
    const ctx = this.context;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = name === "glass" ? "highpass" : "lowpass";
    filter.frequency.value = name === "glass" ? 290 : name === "car" ? 2100 : 1500;
    const panner = ctx.createStereoPanner();
    const volume = ctx.createGain();
    const safe = Math.max(0, Math.min(1, strength));
    const duration = Math.min(buffer.duration, name === "car" ? 2.4 :
      name === "thunder" ? 5 : name === "capacitor" ? 4 : 3);
    let offset = 0;

    if (name === "thunder" || name === "car") {
      // Pick the strongest moment of a long field recording, so a thunder
      // effect plays thunder rather than four seconds of rain beforehand.
      const peak = strongestMoment(buffer);
      offset = Math.max(0, Math.min(buffer.duration - duration,
        peak - (name === "thunder" ? 0.7 : duration * 0.44)));
    }
    if (name === "capacitor") {
      source.playbackRate.value = Math.max(0.65, Math.min(2,
        Math.min(buffer.duration, 6) / 3.95));
    }
    if (name === "car") {
      this.passCount++;
      source.playbackRate.setValueAtTime(1.3, now);
      source.playbackRate.exponentialRampToValueAtTime(0.74, now + duration);
      const side = this.passCount % 2 ? -1 : 1;
      panner.pan.setValueAtTime(-0.9 * side, now);
      panner.pan.linearRampToValueAtTime(0.9 * side, now + duration);
      filter.frequency.setValueAtTime(600, now);
      filter.frequency.exponentialRampToValueAtTime(3200, now + duration * 0.45);
      filter.frequency.exponentialRampToValueAtTime(550, now + duration);
    }

    const level = name === "thunder" ? 0.58 : name === "glass" ? 0.52 :
      name === "car" ? 0.45 : 0.40;
    volume.gain.setValueAtTime(0.0001, now);
    volume.gain.linearRampToValueAtTime(level * safe,
      now + (name === "car" ? duration * 0.45 : 0.055));
    volume.gain.setTargetAtTime(0.0001, now + duration * (name === "car" ? 0.55 : 0.7), 0.22);
    source.connect(filter).connect(panner).connect(volume).connect(this.master);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      filter.disconnect();
      panner.disconnect();
      volume.disconnect();
    };
    source.start(now, nonnegative(offset), duration);
    return true;
  }

  stopAll(): void {
    for (const source of this.sources) {
      try { source.stop(); } catch {}
    }
    this.sources.clear();
    this.rumbleSource = null;
    this.rumbleGain = null;
  }
}

function strongestMoment(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const windowSize = Math.max(1, Math.round(rate * 0.24));
  const hop = Math.max(1, Math.round(rate * 0.12));
  let max = -1;
  let best = 0;
  for (let base = 0; base + windowSize < data.length; base += hop) {
    let energy = 0;
    for (let i = base; i < base + windowSize; i += 10) {
      energy += data[i] * data[i];
    }
    if (energy > max) {
      max = energy;
      best = base;
    }
  }
  return best / rate;
}