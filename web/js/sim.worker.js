/*
 * Whole-brain leaky integrate-and-fire simulation of the FlyWire v783 connectome.
 *
 * Model and constants follow Shiu et al. 2024 (Nature), "A Drosophila computational
 * brain model reveals sensorimotor processing", philshiu/Drosophila_brain_model/model.py:
 *
 *   dv/dt = (v_0 - v + g) / t_mbr        (unless refractory)
 *   dg/dt = -g / tau                      (unless refractory)
 *   spike when v > v_th ; then v = v_rst, g = 0, refractory t_rfc
 *   on presynaptic spike (after t_dly):   g_post += w_syn * (signed synapse count)
 *   optogenetic-like drive: Poisson events at r_poi Hz, each adding w_syn * f_poi
 *
 * Runs in a Web Worker. An "active set" scheduler only integrates neurons that are
 * away from rest, so 139k neurons run in real time on a laptop.
 */

const P = {
  dt: 0.5,          // ms
  v0: -52, vth: -45, tauM: 20, tauS: 5, tRef: 2.2, tDelay: 1.8,
  wSyn: 0.275,      // mV per synapse
  poissonGain: 250, // kick = wSyn * gain mV (guarantees a spike, as in Shiu et al.)
  traceTau: 60,     // ms, display trace decay
  // Optional spike-frequency adaptation (not in Shiu et al.): each spike raises the
  // threshold by adaptB mV, decaying with adaptTau.  Keeps strong multi-modal drive
  // from tipping the recurrent network into a self-sustaining state.
  adapt: true, adaptB: 0.2, adaptTau: 300,
  // Optional short-term synaptic depression (per presynaptic neuron, Tsodyks-Markram style):
  // each spike uses a fraction stdU of the neuron's synaptic resource, recovering with stdTau.
  std: false, stdU: 0.15, stdTau: 400,
};

let N = 0, rowptr, col, wmv;                  // CSR connectivity, weights in mV
let v, g, ref, trace, spikeCount, thAdd, xres, xTime; // state (xres = synaptic resource)
let activeFlag, active, nActive = 0;          // active-set scheduler
let ring = [], ringN, D;                      // spike delay ring buffer
let stims = new Map();                        // id -> {idx: Uint32Array, rate: Hz}
let groupPtr, groupIds, groupNames = [], groupCounts; // readout membership (CSR)
let simTime = 0, running = false, speed = 1.0, lastReal = 0;
let bufferPool = [];
let stepCount = 0, spikesFrame = 0, lastPost = 0;
const EPS = 0.02;

function init(msg) {
  N = msg.N;
  rowptr = new Uint32Array(msg.rowptr);
  col = new Uint32Array(msg.col);
  const w16 = new Int16Array(msg.w);
  wmv = new Float32Array(w16.length);
  for (let i = 0; i < w16.length; i++) wmv[i] = w16[i] * P.wSyn;
  v = new Float32Array(N).fill(P.v0);
  g = new Float32Array(N);
  ref = new Float32Array(N);
  thAdd = new Float32Array(N);
  xres = new Float32Array(N).fill(1); xTime = new Float32Array(N);
  trace = new Float32Array(N);
  spikeCount = new Uint32Array(N);
  activeFlag = new Uint8Array(N);
  active = new Uint32Array(N);
  D = Math.max(1, Math.round(P.tDelay / P.dt));
  ring = []; ringN = new Uint32Array(D);
  for (let i = 0; i < D; i++) ring.push(new Uint32Array(1 << 16));
  setGroups(msg.groups || {});
  postMessage({ type: 'ready', N, E: col.length, delaySteps: D });
}

function setGroups(groups) {
  groupNames = Object.keys(groups);
  const memb = new Array(N);
  groupNames.forEach((name, gi) => {
    for (const i of groups[name]) (memb[i] || (memb[i] = [])).push(gi);
  });
  groupPtr = new Uint32Array(N + 1);
  let tot = 0;
  for (let i = 0; i < N; i++) { groupPtr[i] = tot; if (memb[i]) tot += memb[i].length; }
  groupPtr[N] = tot;
  groupIds = new Uint16Array(tot);
  for (let i = 0, k = 0; i < N; i++) if (memb[i]) for (const gi of memb[i]) groupIds[k++] = gi;
  groupCounts = new Uint32Array(groupNames.length);
}

function activate(i) {
  if (!activeFlag[i]) { activeFlag[i] = 1; active[nActive++] = i; }
}

function pushRing(slot, i) {
  let buf = ring[slot];
  if (ringN[slot] >= buf.length) {
    const nb = new Uint32Array(buf.length * 2); nb.set(buf); ring[slot] = buf = nb;
  }
  buf[ringN[slot]++] = i;
}

function step() {
  const dt = P.dt, v0 = P.v0, vth = P.vth, tauM = P.tauM, tRef = P.tRef;
  const gDecay = Math.exp(-dt / P.tauS);
  const adapt = P.adapt, aDecay = Math.exp(-dt / P.adaptTau), aB = P.adaptB;
  const slot = stepCount % D;

  // 1. deliver spikes that fired tDelay ago (scaled by the presynaptic resource if STD is on)
  const lst = ring[slot], n = ringN[slot], useStd = P.std, stdU = P.stdU, stdTau = P.stdTau;
  for (let k = 0; k < n; k++) {
    const i = lst[k];
    let scale = 1;
    if (useStd) {
      // lazy recovery: x -> 1 with time constant stdTau since last use
      const x = 1 - (1 - xres[i]) * Math.exp(-(simTime - xTime[i]) / stdTau);
      scale = x; xres[i] = x * (1 - stdU); xTime[i] = simTime;
    }
    for (let e = rowptr[i], end = rowptr[i + 1]; e < end; e++) {
      const j = col[e];
      g[j] += wmv[e] * scale;
      if (!activeFlag[j]) { activeFlag[j] = 1; active[nActive++] = j; }
    }
  }
  ringN[slot] = 0;

  // 2. Poisson drive (optogenetic-style activation)
  const kick = P.wSyn * P.poissonGain;
  for (const s of stims.values()) {
    if (s.rate <= 0) continue;
    const p = s.rate * dt / 1000, idx = s.idx;
    for (let k = 0; k < idx.length; k++) {
      if (Math.random() < p) { const i = idx[k]; g[i] += kick; if (!activeFlag[i]) { activeFlag[i] = 1; active[nActive++] = i; } }
    }
  }

  // 3. integrate the active set
  const outSlot = (stepCount + D) % D;
  let m = 0;
  for (let k = 0; k < nActive; k++) {
    const i = active[k];
    if (ref[i] > 0) { ref[i] -= dt; active[m++] = i; continue; }  // frozen while refractory
    let vi = v[i] + dt * (v0 - v[i] + g[i]) / tauM;
    let gi = g[i] * gDecay;
    let th = vth;
    if (adapt) { const a = thAdd[i] * aDecay; thAdd[i] = a; th += a; }
    if (vi > th) {
      v[i] = v0; g[i] = 0; ref[i] = tRef; if (adapt) thAdd[i] += aB;
      trace[i] += 1; spikeCount[i]++; spikesFrame++;
      pushRing(outSlot, i);
      for (let q = groupPtr[i], qe = groupPtr[i + 1]; q < qe; q++) groupCounts[groupIds[q]]++;
      active[m++] = i;
    } else {
      v[i] = vi; g[i] = gi;
      if (Math.abs(vi - v0) < EPS && Math.abs(gi) < EPS && thAdd[i] < EPS) { v[i] = v0; g[i] = 0; thAdd[i] = 0; activeFlag[i] = 0; }
      else active[m++] = i;
    }
  }
  nActive = m;
  stepCount++; simTime += dt;
}
function postFrame(now) {
  const dtReal = lastPost ? now - lastPost : 16;
  lastPost = now;
  // decay display trace once per frame (sim-time based)
  const decay = Math.exp(-(dtReal * speed) / P.traceTau);
  let buf = bufferPool.pop();
  if (buf && buf.byteLength !== N * 4) buf = null;
  const out = buf ? new Float32Array(buf) : new Float32Array(N);
  let maxT = 0;
  for (let i = 0; i < N; i++) { const t = trace[i] * decay; trace[i] = t; out[i] = t; if (t > maxT) maxT = t; }
  const counts = Array.from(groupCounts); groupCounts.fill(0);
  postMessage({
    type: 'frame', t: simTime, trace: out.buffer, spikes: spikesFrame, nActive,
    groupNames, counts, dtSim: dtReal * speed, maxTrace: maxT,
  }, [out.buffer]);
  spikesFrame = 0;
}

let target = 0;
function loop() {
  if (!running) return;
  const now = performance.now();
  if (!lastReal) lastReal = now;
  target += (now - lastReal) * speed;   // ms of sim time we owe
  lastReal = now;
  const maxSteps = 400;                  // cap so a slow frame can't spiral
  let n = 0;
  while (simTime < target && n < maxSteps) { step(); n++; }
  if (simTime < target) target = simTime; // drop backlog
  if (now - lastPost >= 15) postFrame(now);   // ~60 frames/s to the main thread, no more
  setTimeout(loop, 0);
}

onmessage = (ev) => {
  const m = ev.data;
  switch (m.type) {
    case 'init': init(m); break;
    case 'run': running = true; speed = m.speed ?? speed; lastReal = 0; target = simTime; loop(); break;
    case 'pause': running = false; break;
    case 'speed': speed = m.speed; break;
    case 'adapt': P.adapt = !!m.on; if (!P.adapt) thAdd.fill(0); break;
    case 'std': P.std = !!m.on; if (!P.std) { xres.fill(1); xTime.fill(0); } break;
    case 'buffer': bufferPool.push(m.buffer); break;
    case 'stim': stims.set(m.id, { idx: Uint32Array.from(m.idx), rate: m.rate }); break;
    case 'rate': { const s = stims.get(m.id); if (s) s.rate = m.rate; break; }
    case 'clearStim': if (m.id === undefined) stims.clear(); else stims.delete(m.id); break;
    case 'kick': {                          // one immediate super-threshold input
      const kick = P.wSyn * P.poissonGain;
      for (const i of m.idx) { g[i] += kick * (m.gain ?? 1); activate(i); }
      break;
    }
    case 'quiet': {                          // soft reset: silence the network but keep stimuli & weights
      v.fill(P.v0); g.fill(0); ref.fill(0); thAdd.fill(0); xres.fill(1); xTime.fill(0); trace.fill(0);
      activeFlag.fill(0); nActive = 0; ringN.fill(0);
      break;
    }
    case 'reset': {
      v.fill(P.v0); g.fill(0); ref.fill(0); thAdd.fill(0); xres.fill(1); xTime.fill(0); trace.fill(0); spikeCount.fill(0);
      activeFlag.fill(0); nActive = 0; ringN.fill(0); stims.clear(); simTime = 0; target = 0; lastReal = 0;
      break;
    }
    case 'modulate': {
      // Dopamine-gated plasticity (simplified): scale synapses from recently-active
      // presynaptic neurons (trace > thr) onto a target population by `factor`.
      const isTarget = new Uint8Array(N); for (const j of m.post) isTarget[j] = 1;
      let changed = 0;
      for (const i of m.pre) {
        if (trace[i] < (m.thr ?? 0.3)) continue;
        for (let e = rowptr[i], end = rowptr[i + 1]; e < end; e++) {
          if (isTarget[col[e]]) { wmv[e] = Math.max(-40, Math.min(40, wmv[e] * m.factor)); changed++; }
        }
      }
      postMessage({ type: 'modulated', changed });
      break;
    }
    case 'query': {                          // top firing neurons since last query window
      const k = m.k ?? 20, arr = [];
      for (let i = 0; i < N; i++) if (spikeCount[i]) arr.push([spikeCount[i], i]);
      arr.sort((a, b) => b[0] - a[0]);
      postMessage({ type: 'top', top: arr.slice(0, k), total: arr.length });
      spikeCount.fill(0);
      break;
    }
  }
};
