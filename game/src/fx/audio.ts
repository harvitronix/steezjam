import { clamp } from "../core/util";

/** All sound is synthesised at runtime; nothing is loaded from disk or a CDN. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private carveGain!: GainNode;
  private scrapeGain!: GainNode;
  private scrapeFilter!: BiquadFilterNode;
  private tensionGain!: GainNode;
  private tensionOsc!: OscillatorNode;
  private ready = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  start() {
    if (this.ready) {
      if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(ctx.destination);

      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;

      this.carveGain = this.loopNoise(320, 1.1, 0);
      this.scrapeFilter = ctx.createBiquadFilter();
      this.scrapeGain = this.loopNoise(2100, 5.5, 0, this.scrapeFilter);

      this.tensionOsc = ctx.createOscillator();
      this.tensionOsc.type = "sawtooth";
      this.tensionOsc.frequency.value = 128;
      this.tensionGain = ctx.createGain();
      this.tensionGain.gain.value = 0;
      const tf = ctx.createBiquadFilter();
      tf.type = "lowpass";
      tf.frequency.value = 700;
      this.tensionOsc.connect(tf).connect(this.tensionGain).connect(this.master);
      this.tensionOsc.start();

      this.ready = true;
      void ctx.resume();
    } catch {
      this.ready = false;
    }
  }

  private loopNoise(freq: number, q: number, gain: number, extra?: BiquadFilterNode): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (extra) {
      extra.type = "highpass";
      extra.frequency.value = 1400;
      src.connect(f).connect(extra).connect(g).connect(this.master);
    } else {
      src.connect(f).connect(g).connect(this.master);
    }
    src.start();
    return g;
  }

  setCarve(amount: number, speed: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.carveGain.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.22, t, 0.08);
    void speed;
  }

  setScrape(amount: number, pitch: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.scrapeGain.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.3, t, 0.04);
    this.scrapeFilter.frequency.setTargetAtTime(1200 + pitch * 900, t, 0.1);
  }

  setTension(amount: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const a = clamp(amount, 0, 1);
    this.tensionGain.gain.setTargetAtTime(a * a * 0.1, t, 0.06);
    this.tensionOsc.frequency.setTargetAtTime(110 + a * 130, t, 0.06);
  }

  private tone(
    freq: number,
    endFreq: number,
    dur: number,
    gain: number,
    type: OscillatorType = "sine",
  ) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hit(dur: number, gain: number, freq: number, q: number, type: BiquadFilterType) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  pop() {
    this.hit(0.13, 0.34, 2600, 1.2, "bandpass");
    this.tone(420, 900, 0.1, 0.1, "triangle");
  }

  railLock() {
    this.hit(0.3, 0.4, 3400, 2.5, "bandpass");
    this.tone(1400, 700, 0.14, 0.09, "square");
  }

  switchUp() {
    this.tone(660, 1180, 0.16, 0.13, "triangle");
    this.hit(0.14, 0.22, 2400, 1.5, "bandpass");
  }

  land(power: number) {
    this.hit(0.24, 0.32 + power * 0.15, 420, 0.9, "lowpass");
    this.tone(150, 62, 0.22, 0.22 + power * 0.1, "sine");
  }

  bank() {
    this.tone(520, 780, 0.1, 0.11, "triangle");
    window.setTimeout(() => this.tone(780, 1050, 0.16, 0.11, "triangle"), 90);
  }

  bail() {
    this.hit(0.55, 0.42, 900, 0.6, "lowpass");
    this.tone(220, 55, 0.5, 0.18, "sawtooth");
  }

  tick() {
    this.tone(1200, 1500, 0.06, 0.07, "square");
  }
}
