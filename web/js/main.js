import { loadConnectome } from './data.js';
import { Sim } from './sim.js';
import { BrainView } from './brain.js';
import { FlyStage } from './fly.js';
import { AudioEngine } from './audio.js';
import { buildScenarios, READOUT_LABELS } from './scenarios.js';

const $ = (s) => document.querySelector(s);
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(t._h); t._h = setTimeout(() => (t.style.opacity = 0), 3500); };

async function main() {
  const data = await loadConnectome('./data/', (p, f) => { $('#load-bar').style.width = (p * 100) + '%'; $('#load-msg').textContent = f; });
  $('#load-msg').textContent = 'building groups & GPU buffers';

  // ---- neuron groups: precomputed ones + a few extra readouts found by the downstream analysis ----
  const G = { ...data.groups };
  for (const t of ['DNg35', 'DNg84', 'DNg29', 'DNb05', 'DNb06', 'DNp12', 'DNg24', 'DNp02']) G[t] = data.byType(t);
  for (const t of ['DNa01', 'DNa02']) {
    const idx = data.byType(t);
    G[t + '_L'] = idx.filter(i => data.sideName(i) === 'left'); G[t + '_R'] = idx.filter(i => data.sideName(i) === 'right');
  }
  // retina grid: right-eye R8 photoreceptors, rank-binned onto a W x H "retinotopic" grid
  const retina = (() => {
    const W = 40, H = 24;
    const r8 = data.byType('R8').filter(i => data.sideName(i) === 'right');
    r8.sort((a, b) => data.pos[3 * a + 2] - data.pos[3 * b + 2]);           // anterior->posterior columns
    const grid = new Array(W * H).fill(null).map(() => []);
    const perCol = Math.ceil(r8.length / W);
    for (let x = 0; x < W; x++) {
      const colN = r8.slice(x * perCol, (x + 1) * perCol).sort((a, b) => data.pos[3 * a + 1] - data.pos[3 * b + 1]); // dorsal->ventral rows
      const perRow = Math.ceil(colN.length / H);
      for (let y = 0; y < H; y++) grid[y * W + x] = colN.slice(y * perRow, (y + 1) * perRow);
    }
    return { w: W, h: H, grid, all: r8 };
  })();
  G.R8_chart = retina.all;

  const sim = new Sim(data, G);
  const brain = new BrainView($('#brain-canvas'), data);
  const stage = new FlyStage($('#fly-canvas'));
  const audio = new AudioEngine();
  await sim.ready;

  // cell type datalist for the poke scenario
  const dl = $('#celltypes'); const frag = document.createDocumentFragment();
  for (const t of data.meta.cell_types) { if (t === 'unknown') continue; const o = document.createElement('option'); o.value = t; frag.appendChild(o); }
  dl.appendChild(frag);

  const ui = { controls: $('#sc-controls'), toast };
  const ctx = { sim, stage, brain, data, audio, ui, G, retina, onPick: null };
  const scenarios = buildScenarios(ctx);
  let current = null;

  // ---- meters ----
  const meterHtml = (name, cls) => `<div class="meter ${cls}" data-g="${name}"><span title="${READOUT_LABELS[name] || name}">${READOUT_LABELS[name] || name} <em class="n">(${(G[name] || []).length})</em></span><div class="bar"><i></i></div><b>0</b></div>`;
  function setScenario(sc) {
    if (current) { current.stop(); sim.reset(); }   // fresh membrane state for every experiment
    current = sc; ctx.current = sc;
    document.querySelectorAll('#scenarios button').forEach(b => b.classList.toggle('active', b.dataset.id === sc.id));
    $('#sc-title').textContent = sc.title; $('#sc-blurb').innerHTML = sc.blurb; ui.controls.innerHTML = sc.controls || '';
    $('#inputs').innerHTML = sc.inputs.map(n => meterHtml(n, 'in')).join('') || '<div class="small">none: click neurons or type a cell type</div>';
    $('#readouts').innerHTML = sc.readouts.map(n => meterHtml(n, 'out')).join('');
    stage.show(sc.stageProps); stage.badge('');
    stage.fly.setMotor({ proboscis: 0, flap: 0, extendL: 0, extendR: 0, songVib: 0, antenna: 0, groom: 0, walk: 0, back: 0, turn: 0, jump: 0, headBob: 0, curl: 0, freeze: 0, lean: 0 });
    // highlight stimulated + readout populations in the brain view
    const hi = []; for (const n of [...sc.inputs, ...sc.readouts]) if (G[n] && G[n].length < 3000) hi.push(...G[n]);
    brain.setHighlight(hi);
    sc.start();
    location.hash = sc.id;
  }
  const nav = $('#scenarios');
  for (const sc of scenarios) { const b = document.createElement('button'); b.textContent = sc.title; b.dataset.id = sc.id; b.onclick = () => setScenario(sc); nav.appendChild(b); }

  // ---- worker frames -> GPU + scenario logic ----
  // Scenario logic runs on the worker's ~60 Hz frame clock (not requestAnimationFrame),
  // so the fly keeps behaving even when the tab is in the background.
  let lastLogic = performance.now(), level = 0, runawayT = 0;
  sim.onFrame = (trace) => {
    brain.updateTrace(trace);
    const now = performance.now(); const dt = Math.min(0.1, (now - lastLogic) / 1000); lastLogic = now;
    if (current) { try { level = current.tick(dt) || 0; } catch (e) { console.error(e); } }
    stage.update(dt, level);
    // Runaway guard: the pure LIF can lock the antennal-lobe / mushroom-body network into a
    // self-sustaining state (>150k spikes/s with no input). Silence it and say so.
    const rate = sim.history[(sim.hIdx - 1 + sim.history.length) % sim.history.length];
    runawayT = rate > 150 ? runawayT + dt : 0;
    if (runawayT > 2.5) { runawayT = 0; sim.quiet(); toast('⚡ seizure-like runaway (>150k spikes/s): membrane potentials reset; a known property of the LIF model'); }
  };
  sim.run(1.0);

  // ---- header controls ----
  $('#speed').oninput = (e) => { sim.setSpeed(+e.target.value); $('#st-speed').textContent = (+e.target.value).toFixed(1) + '×'; };
  $('#adapt').onchange = (e) => sim.setAdapt(e.target.checked);
  $('#std').onchange = (e) => sim.setStd(e.target.checked);
  $('#btn-pause').onclick = () => { if (sim.running) { sim.pause(); $('#btn-pause').textContent = '▶'; } else { sim.run(); $('#btn-pause').textContent = '⏸'; } };
  $('#btn-reset').onclick = () => { sim.reset(); if (current) { current.stop(); current.start(); } };
  $('#btn-quiet').onclick = () => sim.quiet();

  // ---- brain interaction: hover tooltip + click to poke ----
  const tip = $('#tooltip'); let hoverIdx = -1, lastMove = 0;
  const bc = $('#brain-canvas');
  bc.addEventListener('mousemove', (e) => {
    const now = performance.now(); if (now - lastMove < 60) return; lastMove = now;
    const i = brain.pick(e.clientX, e.clientY); hoverIdx = i;
    if (i < 0) { tip.style.display = 'none'; return; }
    const r = bc.getBoundingClientRect();
    tip.style.display = 'block'; tip.style.left = (e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top + 14) + 'px';
    const rate = sim.rates; // (population rates only): show neuron identity
    tip.innerHTML = `<b>${data.typeName(i)}</b> · ${data.superName(i)} / ${data.className(i)}${data.subName(i) !== 'unknown' ? ' / ' + data.subName(i) : ''}<br>
      ${data.sideName(i)} · ${data.ntName(i)} · ${data.rowptr ? '' : ''}root ${data.rootid[i]}<br><span class="small">click to stimulate · ${current && current.id === 'poke' ? '' : 'switch to “Poke any neuron” for full control'}</span>`;
  });
  bc.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  bc.addEventListener('click', (e) => {
    const i = brain.pick(e.clientX, e.clientY); if (i < 0) return;
    if (ctx.onPick) ctx.onPick(i); else { sim.kick([i], 1); toast(`kicked ${data.typeName(i)} (${data.rootid[i]})`); }
  });
  bc.addEventListener('dblclick', (e) => { const i = brain.pick(e.clientX, e.clientY); if (i >= 0) window.open(data.codexUrl(i), '_blank'); });

  // ---- main loop ----
  const strip = $('#strip').getContext('2d');
  let last = performance.now(), fpsAcc = 0, fpsN = 0, uiAcc = 0;
  function frame(now) {
    const dt = (now - last) / 1000; last = now;
    stage.render(); brain.render();
    fpsAcc += dt; fpsN++; uiAcc += dt;
    if (uiAcc > 0.1) {
      uiAcc = 0;
      $('#st-time').textContent = (sim.simTime / 1000).toFixed(2);
      $('#st-spk').textContent = Math.round(sim.history[(sim.hIdx - 1 + sim.history.length) % sim.history.length] * 1000).toLocaleString();
      $('#st-act').textContent = sim.nActive.toLocaleString();
      $('#st-fps').textContent = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
      for (const m of document.querySelectorAll('.meter')) {
        const g = m.dataset.g; const r = sim.rates[g] || 0;
        m.querySelector('i').style.width = Math.min(100, r / 1.5) + '%'; m.querySelector('b').textContent = r.toFixed(r < 10 ? 1 : 0);
      }
      // strip chart
      const c = strip.canvas, W = c.width, H = c.height; strip.fillStyle = '#0a0e16'; strip.fillRect(0, 0, W, H);
      const L = sim.history.length; let mx = 1; for (let k = 0; k < L; k++) mx = Math.max(mx, sim.history[k]);
      strip.strokeStyle = '#ffd86b'; strip.lineWidth = 1.5; strip.beginPath();
      for (let k = 0; k < W; k++) { const v = sim.history[(sim.hIdx - W + k + L * 4) % L]; const y = H - 3 - (v / mx) * (H - 8); k ? strip.lineTo(k, y) : strip.moveTo(k, y); }
      strip.stroke(); strip.fillStyle = '#8b98b0'; strip.font = '10px system-ui'; strip.fillText(`peak ${mx.toFixed(1)} spikes/ms`, 6, 12);
    }
    requestAnimationFrame(frame);
  }
  const ro = new ResizeObserver(() => { brain.resize(); stage.resize(); });
  ro.observe($('#pane-fly')); ro.observe($('#pane-brain'));
  requestAnimationFrame(frame);

  $('#loader').style.display = 'none';
  const initial = scenarios.find(s => s.id === location.hash.slice(1)) || scenarios[0];
  setScenario(initial);
  window.fly = ctx; // for console poking
}

main().catch(e => { console.error(e); $('#load-msg').textContent = 'Error: ' + e.message; });
