// Main-thread wrapper around the simulation worker: stimulation API, frame
// callbacks and smoothed population firing rates for the readout groups.
export class Sim {
  constructor(data, groups) {
    this.data = data; this.groups = groups;                   // name -> Int array
    this.groupNames = Object.keys(groups);
    this.rates = {}; for (const g of this.groupNames) this.rates[g] = 0;
    this.worker = new Worker('./js/sim.worker.js');
    this.ready = new Promise(res => { this._resolveReady = res; });
    this.onFrame = null; this.simTime = 0; this.spikes = 0; this.nActive = 0; this.speed = 1; this.running = false;
    this.history = new Float32Array(600); this.hIdx = 0;     // brain-wide spikes per sim-ms
    this.worker.onmessage = (ev) => this._onMessage(ev.data);
    this.worker.postMessage({ type: 'init', N: data.N, rowptr: data.rowptr, col: data.col, w: data.w, groups });
    this._trace = null; this._pending = [];
  }

  _onMessage(m) {
    if (m.type === 'ready') { this._resolveReady(m); return; }
    if (m.type === 'frame') {
      this.simTime = m.t; this.spikes = m.spikes; this.nActive = m.nActive;
      const dtSec = Math.max(1e-3, m.dtSim / 1000);
      const a = 1 - Math.exp(-m.dtSim / 80);                    // EMA, 80 ms sim time
      m.groupNames.forEach((g, i) => {
        const n = this.groups[g].length || 1;
        const inst = m.counts[i] / n / dtSec;                  // Hz per neuron
        this.rates[g] += (inst - this.rates[g]) * a;
      });
      this.history[this.hIdx++ % this.history.length] = m.spikes / Math.max(0.5, m.dtSim);
      const trace = new Float32Array(m.trace);
      if (this.onFrame) this.onFrame(trace, m);
      this.worker.postMessage({ type: 'buffer', buffer: m.trace }, [m.trace]);
      return;
    }
    if (m.type === 'top' && this._topCb) { this._topCb(m); this._topCb = null; }
    if (m.type === 'modulated' && this._modCb) { this._modCb(m.changed); }
  }

  run(speed) { this.running = true; if (speed !== undefined) this.speed = speed; this.worker.postMessage({ type: 'run', speed: this.speed }); }
  pause() { this.running = false; this.worker.postMessage({ type: 'pause' }); }
  setStd(on) { this.worker.postMessage({ type: 'std', on }); }
  setAdapt(on) { this.worker.postMessage({ type: 'adapt', on }); }
  setSpeed(s) { this.speed = s; this.worker.postMessage({ type: 'speed', speed: s }); }
  quiet() { this.worker.postMessage({ type: 'quiet' }); for (const g in this.rates) this.rates[g] = 0; }
  reset() { this.worker.postMessage({ type: 'reset' }); for (const g in this.rates) this.rates[g] = 0; this.history.fill(0); }
  stim(id, idx, rate) { this.worker.postMessage({ type: 'stim', id, idx: Array.from(idx), rate }); }
  rate(id, rate) { this.worker.postMessage({ type: 'rate', id, rate }); }
  clearStim(id) { this.worker.postMessage({ type: 'clearStim', id }); }
  kick(idx, gain = 1) { this.worker.postMessage({ type: 'kick', idx: Array.from(idx), gain }); }
  modulate(pre, post, factor, thr = 0.3) { this.worker.postMessage({ type: 'modulate', pre: Array.from(pre), post: Array.from(post), factor, thr }); }
  top(k = 20) { return new Promise(res => { this._topCb = res; this.worker.postMessage({ type: 'query', k }); }); }
}
