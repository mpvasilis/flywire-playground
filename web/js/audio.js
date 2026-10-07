// Web Audio: synthesized tracks (a real Drosophila courtship song, a techno beat),
// user audio files and the microphone, plus band analysis that maps onto the
// Johnston's organ frequency channels.
export class AudioEngine {
  constructor() {
    this.ctx = null; this.analyser = null; this.master = null; this.source = null; this.kind = null;
    this.fft = null; this.time = null;
    this.level = { sub: 0, low: 0, mid: 0, high: 0, total: 0, onset: 0 };
    this._prev = 0; this._env = 0;
  }

  ensure() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.7;
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.5;
    this.master.connect(this.analyser); this.analyser.connect(this.ctx.destination);
    this.fft = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Uint8Array(this.analyser.fftSize);
  }

  async stop() {
    if (this.source) { try { this.source.stop?.(); } catch (e) { /* ignore */ } try { this.source.disconnect?.(); } catch (e) { /* ignore */ } }
    if (this._nodes) for (const n of this._nodes) { try { n.stop?.(); n.disconnect?.(); } catch (e) { /* ignore */ } }
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    this.source = null; this._nodes = null; this.kind = null;
  }

  // ---------- Drosophila melanogaster courtship song (synthesized) ----------
  // Pulse song: trains of ~15 ms pulses, inter-pulse interval ~35 ms, carrier ~200-250 Hz.
  // Sine song: continuous ~150-160 Hz hum for a few hundred ms.  Loosely after
  // Clemens et al. 2018 and Murthy lab recordings.
  async playCourtshipSong() {
    await this.stop(); this.ensure(); await this.ctx.resume();
    this.kind = 'song';
    const ctx = this.ctx, out = this.master;
    let t = ctx.currentTime + 0.1;
    const schedule = () => {
      const now = ctx.currentTime;
      while (t < now + 1.5) {
        if (Math.random() < 0.65) {                      // pulse train
          const n = 8 + Math.floor(Math.random() * 14);
          for (let i = 0; i < n; i++) {
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 220 + Math.random() * 40;
            const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.9, t + 0.003); g.gain.exponentialRampToValueAtTime(0.001, t + 0.016);
            o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.02);
            t += 0.035 + (Math.random() - 0.5) * 0.004;        // 35 ms IPI
          }
          t += 0.25 + Math.random() * 0.5;
        } else {                                          // sine song
          const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 155;
          const g = ctx.createGain(); const d = 0.3 + Math.random() * 0.5;
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.05);
          g.gain.setValueAtTime(0.35, t + d - 0.05); g.gain.linearRampToValueAtTime(0, t + d);
          o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.01);
          t += d + 0.2 + Math.random() * 0.4;
        }
      }
    };
    schedule(); this._timer = setInterval(schedule, 500);
  }

  // ---------- Techno beat (synthesized) ----------
  async playBeat(bpm = 126) {
    await this.stop(); this.ensure(); await this.ctx.resume();
    this.kind = 'beat';
    const ctx = this.ctx, out = this.master, step = 60 / bpm / 4;
    let t = ctx.currentTime + 0.1, i = 0;
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0); for (let k = 0; k < nd.length; k++) nd[k] = Math.random() * 2 - 1;
    const schedule = () => {
      const now = ctx.currentTime;
      while (t < now + 0.6) {
        if (i % 4 === 0) {                               // kick
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
          g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
          o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.4);
        }
        if (i % 4 === 2) {                               // off-beat hat
          const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
          s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + 0.08);
        }
        if (i % 16 === 4 || i % 16 === 12) {             // clap
          const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
          s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + 0.2);
        }
        if (i % 2 === 1) {                               // rolling bass line (in the fly's hearing band)
          const o = ctx.createOscillator(); o.type = 'sawtooth';
          const notes = [55, 55, 65.4, 55, 73.4, 55, 49, 55]; o.frequency.value = notes[(i >> 1) % 8] * 2;
          const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(200, t + 0.2);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
          o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.25);
        }
        if (i % 32 >= 24 && i % 2 === 0) {               // lead stab
          const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = [440, 523, 659, 784][(i >> 1) % 4];
          const g = ctx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
          o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.12);
        }
        t += step; i++;
      }
    };
    schedule(); this._timer = setInterval(schedule, 200);
  }

  async playFile(file) {
    await this.stop(); this.ensure(); await this.ctx.resume();
    const buf = await this.ctx.decodeAudioData(await file.arrayBuffer());
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(this.master); s.start();
    this.source = s; this.kind = 'file';
  }

  async useMicrophone() {
    await this.stop(); this.ensure(); await this.ctx.resume();
    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const s = this.ctx.createMediaStreamSource(this._stream);
    // analyse but do not play back (avoid feedback)
    s.connect(this.analyser); this.source = s; this.kind = 'mic';
  }

  // Band energies normalised to 0..1.  Bands chosen around fly hearing:
  // Johnston's organ JO-B is tuned to low frequencies (~100-350 Hz, courtship song),
  // JO-A to higher frequencies (~350-1000+ Hz).  Sub-bass acts like wind on the arista (JO-C/E).
  analyse(dt) {
    if (!this.analyser) return this.level;
    this.analyser.getByteFrequencyData(this.fft);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (lo, hi) => {
      let s = 0, n = 0; for (let k = Math.floor(lo / binHz); k <= Math.min(this.fft.length - 1, Math.ceil(hi / binHz)); k++) { s += this.fft[k]; n++; }
      return n ? s / n / 255 : 0;
    };
    const L = this.level;
    L.sub = band(20, 100); L.low = band(100, 350); L.mid = band(350, 1200); L.high = band(1200, 8000);
    L.total = (L.sub + L.low + L.mid + L.high) / 4;
    // onset detection: positive spectral flux, then a fast-decaying envelope
    const flux = Math.max(0, L.total - this._prev); this._prev = L.total;
    this._env = Math.max(this._env * Math.exp(-dt / 0.12), Math.min(1, flux * 8));
    L.onset = this._env;
    return L;
  }
}
