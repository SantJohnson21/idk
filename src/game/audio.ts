type OscType = OscillatorType;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private musicGeneration = 0;
  soundOn = true;
  musicOn = true;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean) {
    this.soundOn = on;
    if (!on) this.stopCrowd();
    if (this.master && this.ctx) this.master.gain.value = on ? 0.32 : 0;
  }

  private now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscType = 'square',
    gain = 0.12,
    slideTo?: number,
    delay = 0,
  ) {
    if (!this.ctx || !this.master || !this.soundOn) return;
    const t = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, freq), t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private noise(dur: number, gain = 0.1, filter = 1200, delay = 0, type: BiquadFilterType = 'bandpass') {
    if (!this.ctx || !this.master || !this.soundOn) return;
    const t = this.now() + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filter;
    f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  play(name: string) {
    if (!this.ctx || !this.soundOn) return;
    switch (name) {
      case 'select':
        this.tone(880, 0.035, 'square', 0.05, 1320);
        this.noise(0.02, 0.03, 6000, 0, 'highpass');
        break;
      case 'ready':
        this.tone(380, 0.08, 'square', 0.05);
        break;
      case 'kickoff':
        [220, 330, 440].forEach((f, i) => this.tone(f, 0.16, 'square', 0.06, undefined, i * 0.09));
        break;
      case 'snap':
        this.tone(140, 0.06, 'triangle', 0.12, 90);
        this.noise(0.05, 0.06, 900);
        break;
      case 'throw':
        this.noise(0.16, 0.06, 1800, 0, 'highpass');
        this.tone(700, 0.1, 'sine', 0.03, 1100);
        break;
      case 'catch':
        this.tone(600, 0.05, 'square', 0.08);
        this.tone(900, 0.06, 'square', 0.06, undefined, 0.03);
        break;
      case 'incomplete':
      case 'drop':
      case 'deflect':
        this.tone(330, 0.12, 'sawtooth', 0.05, 200);
        break;
      case 'intercept':
      case 'turnover':
        this.tone(180, 0.25, 'sawtooth', 0.1, 70);
        this.noise(0.2, 0.08, 600);
        break;
      case 'tackle':
        this.noise(0.13, 0.16, 420, 0, 'lowpass');
        this.tone(90, 0.1, 'triangle', 0.12, 50);
        break;
      case 'break':
        this.tone(300, 0.18, 'square', 0.07, 700);
        this.noise(0.1, 0.05, 1400);
        break;
      case 'first':
        this.tone(660, 0.07, 'square', 0.07);
        this.tone(880, 0.09, 'square', 0.06, undefined, 0.07);
        break;
      case 'td':
        // A filtered riser into a stab chord and a bright arpeggio.
        this.tone(120, 0.6, 'sawtooth', 0.05, 1400);
        this.noise(0.6, 0.05, 2000, 0, 'highpass');
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'square', 0.08, undefined, 0.6 + i * 0.08));
        this.noise(0.45, 0.05, 900, 0.6);
        break;
      case 'whistle':
        this.tone(1500, 0.12, 'sine', 0.05, 1900);
        break;
      case 'burst':
        this.noise(0.25, 0.08, 2200, 0, 'highpass');
        this.tone(240, 0.2, 'sawtooth', 0.07, 620);
        break;
      case 'audible':
        this.tone(420, 0.06, 'square', 0.06);
        this.tone(560, 0.06, 'square', 0.05, undefined, 0.05);
        break;
      case 'rewind':
        this.noise(0.55, 0.09, 700, 0, 'bandpass');
        this.tone(700, 0.55, 'sawtooth', 0.05, 120);
        break;
      case 'defense':
        this.tone(220, 0.2, 'triangle', 0.06, 160);
        break;
      case 'punt':
        this.tone(300, 0.14, 'triangle', 0.07, 180);
        this.noise(0.1, 0.05, 500);
        break;
      case 'scramble':
        // Feet, then open field: a short upward sweep with turf under it.
        this.tone(240, 0.18, 'triangle', 0.06, 560);
        this.noise(0.12, 0.04, 1100);
        break;
      case 'block':
        // A punt off a blocker's back: the thud, then the crowd's gasp under it.
        this.tone(80, 0.22, 'triangle', 0.16, 45);
        this.noise(0.28, 0.16, 300, 0, 'lowpass');
        this.noise(0.5, 0.05, 900, 0.12);
        this.tone(210, 0.6, 'sawtooth', 0.05, 120, 0.14);
        break;
      case 'kickready':
        this.tone(440, 0.09, 'square', 0.06);
        break;
      case 'fg':
        [660, 880, 1320].forEach((f, i) => this.tone(f, 0.2, 'square', 0.07, undefined, i * 0.08));
        break;
      case 'miss':
        this.tone(360, 0.3, 'sawtooth', 0.07, 140);
        break;
      case 'opptd':
        this.tone(200, 0.3, 'sawtooth', 0.06, 120);
        break;
      case 'oppfg':
        this.tone(300, 0.2, 'triangle', 0.06, 220);
        break;
      case 'safety':
        this.tone(140, 0.4, 'sawtooth', 0.08, 60);
        break;
      case 'quarter':
        [400, 300].forEach((f, i) => this.tone(f, 0.1, 'square', 0.05, undefined, i * 0.1));
        break;
      case 'overtime':
        [330, 440, 330, 440].forEach((f, i) => this.tone(f, 0.12, 'square', 0.06, undefined, i * 0.12));
        break;
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.28, 'square', 0.08, undefined, i * 0.12));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.26, 'triangle', 0.07, undefined, i * 0.13));
        break;
      case 'tie':
        [392, 392].forEach((f, i) => this.tone(f, 0.2, 'square', 0.05, undefined, i * 0.2));
        break;
      default:
        this.tone(440, 0.04, 'square', 0.03);
    }
  }

  startCrowd() {
    if (!this.ctx || !this.master || this.crowd || !this.soundOn) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 2.2);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[i] = last * 3.4;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 780;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    gain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 1.5);
    this.crowd = { source: src, gain };
  }

  stopCrowd() {
    if (!this.crowd || !this.ctx) return;
    const { source, gain } = this.crowd;
    try {
      gain.gain.cancelScheduledValues(this.ctx.currentTime);
      gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
      source.stop(this.ctx.currentTime + 0.7);
    } catch {
      // ignore
    }
    this.crowd = null;
  }

  crowdRoar(amount = 1) {
    if (!this.crowd || !this.ctx) return;
    this.crowd.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.crowd.gain.gain.setTargetAtTime(0.09 + 0.14 * amount, this.ctx.currentTime, 0.15);
    this.crowd.gain.gain.setTargetAtTime(0.09, this.ctx.currentTime + 1.4, 1.2);
  }

  startMusic() {
    this.init();
    if (!this.ctx || !this.musicOn || this.musicTimer !== null) return;
    const gen = ++this.musicGeneration;
    this.nextNoteTime = this.now() + 0.1;
    this.musicStep = 0;
    // 128 BPM, four bars of Am - F - C - G. Four-on-the-floor kick, clap on 2 and 4,
    // off-beat hats, a rolling 16th bass, and a square arpeggio over stabs.
    const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    const roots = [57, 53, 48, 55];
    const chords = [
      [0, 3, 7],
      [0, 4, 7],
      [0, 4, 7],
      [0, 4, 7],
    ];
    const bassLine = [0, 0, 12, 0, 0, 0, 7, 0, 0, 0, 12, 0, 3, 0, 7, 0];
    const arp = [0, 7, 12, 7];
    const stepDur = 60 / 128 / 4;
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.master || this.musicTimer === null || gen !== this.musicGeneration) return;
      while (this.nextNoteTime < this.now() + 0.2) {
        const step = this.musicStep % 64;
        const bar = Math.floor(step / 16) % 4;
        const pos = step % 16;
        const root = roots[bar];
        const delay = Math.max(0, this.nextNoteTime - this.now());
        if (pos % 4 === 0) this.tone(150, 0.16, 'sine', 0.24, 45, delay);
        if (pos === 4 || pos === 12) this.noise(0.09, 0.08, 1500, delay);
        if (pos % 4 === 2) this.noise(0.03, 0.03, 7000, delay, 'highpass');
        this.tone(midi(root - 24 + bassLine[pos]), 0.11, 'sawtooth', 0.035, undefined, delay);
        this.tone(midi(root + 12 + arp[pos % 4]), 0.08, 'square', 0.02, undefined, delay);
        if (pos === 0) {
          chords[bar].forEach((i) => this.tone(midi(root + i), 0.35, 'square', 0.025, undefined, delay));
        }
        this.nextNoteTime += stepDur;
        this.musicStep++;
      }
    }, 60);
  }

  stopMusic() {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicGeneration++;
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (!on) this.stopMusic();
  }
}

export const audio = new AudioEngine();
