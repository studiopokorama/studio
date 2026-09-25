/** Tiny synthesized tile sounds. On by default; browsers only let audio start from a visitor gesture. */
export class Sound {
  private ctx: AudioContext | null = null;
  enabled = true;

  /** Call from a user gesture (pointerdown, keydown) to start audio. */
  unlock() {
    if (!this.enabled) return;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "running") return;
    this.ctx
      .resume()
      .catch((err: unknown) =>
        console.error("sound: could not start audio", err),
      );
  }

  /** Turn sounds on or off; turning on confirms with a click. */
  toggle(on = !this.enabled): boolean {
    this.enabled = on;
    if (!on) return false;
    this.unlock();
    this.ctx!.resume().then(
      () => this.snap(1),
      (err: unknown) => console.error("sound: could not start audio", err),
    );
    return true;
  }

  /** Short wooden click as a tile lands; `weight` 0..1 scales loudness. */
  snap(weight = 0.6) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const detune = 1 + (Math.random() - 0.5) * 0.12;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(420 * detune, t);
    osc.frequency.exponentialRampToValueAtTime(180 * detune, t + 0.07);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22 * weight, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);

    // A breath of filtered noise for the contact.
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const noise = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    noise.buffer = buf;
    bp.type = "bandpass";
    bp.frequency.value = 2400 * detune;
    ng.gain.value = 0.12 * weight;
    noise.connect(bp).connect(ng).connect(ctx.destination);
    noise.start(t);
  }

  /** A found word: a quick rising arpeggio with a bright bell on top. */
  reward() {
    const ctx = this.live();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.05; // after the landing click
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const t = t0 + i * 0.07;
      const last = i === notes.length - 1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = last ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(last ? 0.16 : 0.1, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (last ? 0.6 : 0.18));
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + (last ? 0.65 : 0.2));
    });
  }

  /** One bell note from a rising two-octave pentatonic scale; `position` 0..1 runs low to high. */
  note(position: number) {
    const ctx = this.live();
    if (!ctx) return;
    const scale = [523.25, 587.33, 659.25, 783.99, 880];
    const steps = scale.length * 2;
    const i = Math.round(Math.min(1, Math.max(0, position)) * (steps - 1));
    const freq = scale[i % scale.length]! * 2 ** Math.floor(i / scale.length);
    const t = ctx.currentTime;
    for (const [mult, type, level] of [
      [1, "sine", 0.12],
      [2, "triangle", 0.03],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * mult, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.75);
    }
  }

  /** Wooden click that climbs with `step`, for a wave running along the tiles. */
  tick(step: number) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    const f = 380 * 2 ** (step / 12) * 1.5;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.06);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** The closing chord: warm, slightly detuned, with a soft shimmer on top. */
  chord() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);
    // C major add9, spread over two octaves.
    const notes = [130.81, 261.63, 329.63, 392.0, 587.33, 783.99];
    notes.forEach((freq, i) => {
      for (const detune of [-5, 5]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = i === 0 ? "sine" : "triangle";
        osc.frequency.setValueAtTime(freq, t);
        osc.detune.setValueAtTime(detune, t);
        const start = t + i * 0.025; // a gentle strum
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.035, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 2.4);
        osc.connect(gain).connect(out);
        osc.start(start);
        osc.stop(start + 2.5);
      }
    });
    const bell = ctx.createOscillator();
    const bg = ctx.createGain();
    bell.type = "sine";
    bell.frequency.setValueAtTime(2093, t + 0.12);
    bg.gain.setValueAtTime(0.0001, t + 0.12);
    bg.gain.exponentialRampToValueAtTime(0.05, t + 0.13);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    bell.connect(bg).connect(out);
    bell.start(t + 0.12);
    bell.stop(t + 1.7);
  }

  /** Softer, higher tick as a tile lifts. */
  lift() {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660 * (1 + (Math.random() - 0.5) * 0.1), t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.05);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  private live(): AudioContext | null {
    return this.enabled && this.ctx?.state === "running" ? this.ctx : null;
  }
}
