// All sound is synthesized with Web Audio, so there are no asset files to load.
export class GameAudio {
  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const bd = brown.getChannelData(0), wd = white.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      wd[i] = w;
      last = (last + 0.02 * w) / 1.02;
      bd[i] = last * 3.5;
    }
    this.white = white;

    // distant city rumble
    const amb = ctx.createBufferSource();
    amb.buffer = brown;
    amb.loop = true;
    const af = ctx.createBiquadFilter();
    af.type = 'lowpass';
    af.frequency.value = 420;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.3;
    amb.connect(af).connect(this.ambGain).connect(this.master);
    amb.start();

    // engine: two detuned oscillators through a lowpass
    this.eng = ctx.createOscillator();
    this.eng.type = 'sawtooth';
    this.eng2 = ctx.createOscillator();
    this.eng2.type = 'square';
    this.engF = ctx.createBiquadFilter();
    this.engF.type = 'lowpass';
    this.engF.frequency.value = 300;
    this.engG = ctx.createGain();
    this.engG.gain.value = 0;
    const e2g = ctx.createGain();
    e2g.gain.value = 0.5;
    this.eng.connect(this.engF);
    this.eng2.connect(e2g).connect(this.engF);
    this.engF.connect(this.engG).connect(this.master);
    this.eng.start();
    this.eng2.start();
  }

  noise(dur, freq, type, vol, q = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  tone(freq, start, dur, vol, type = 'sine') {
    const ctx = this.ctx, t = ctx.currentTime + start;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  step(k = 1) {
    this.noise(0.07, 140 + Math.random() * 90, 'bandpass', 0.35 * k, 0.8);
  }

  door() {
    this.noise(0.12, 300, 'lowpass', 0.6);
  }

  crash(v) {
    this.noise(0.5, 700, 'lowpass', Math.min(1, v / 18));
    this.noise(0.18, 2600, 'bandpass', Math.min(0.5, v / 30), 2);
  }

  pickup() {
    if (!this.ctx) return;
    [880, 1320, 1760, 2640].forEach((f, i) => this.tone(f, i * 0.07, 0.35, 0.16));
  }

  win() {
    if (!this.ctx) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, i * 0.12, 0.8, 0.14, 'triangle'));
  }

  horn(vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09 * vol, t + 0.02);
    g.gain.setValueAtTime(0.09 * vol, t + 0.32);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    f.connect(g).connect(this.master);
    for (const fr of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = fr;
      o.connect(f);
      o.start(t);
      o.stop(t + 0.45);
    }
  }

  engine(on, speed, throttle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.abs(speed);
    const gear = s % 13 / 13; // fake gear shifts
    const f = 42 + s * 1.4 + gear * 30 + throttle * 10;
    this.eng.frequency.setTargetAtTime(f, t, 0.05);
    this.eng2.frequency.setTargetAtTime(f * 0.501, t, 0.05);
    this.engF.frequency.setTargetAtTime(260 + s * 18 + throttle * 450, t, 0.08);
    this.engG.gain.setTargetAtTime(on ? 0.06 + throttle * 0.07 : 0, t, 0.12);
  }

  setAmbient(night) {
    if (this.ambGain) this.ambGain.gain.setTargetAtTime(0.3 - night * 0.14, this.ctx.currentTime, 1);
  }
}
