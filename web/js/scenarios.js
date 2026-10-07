// Scenario definitions: what is stimulated, what is read out, how the avatar moves.
// Every stimulus is a Poisson drive onto a real FlyWire cell population; every
// readout is the population firing rate of real descending / motor neurons.
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ---- shared motor mapping: population rates (Hz / neuron) -> avatar motor targets ----
export function driveFly(fly, R, extra = {}) {
  const m = {
    proboscis: clamp01(R.proboscis_MN / 35),
    back: clamp01(R.MDN / 15),
    walk: clamp01(R.DNp09 / 15),
    turn: clamp01(R.DNa02_R / 20) - clamp01(R.DNa02_L / 20) + 0.5 * (clamp01(R.DNa01_R / 20) - clamp01(R.DNa01_L / 20)),
    groom: clamp01((R.DNg35 + R.DNg84) / 50),
    antenna: Math.max(clamp01(R.antennal_MN / 15), extra.antenna || 0),
    headBob: Math.max(clamp01(R.neck_MN / 15), extra.headBob || 0),
    curl: clamp01(R.oviDN / 15),
    ...extra.motor,
  };
  // giant fiber -> take-off (one-shot; a real fly needs a moment before it can jump again)
  if (R.DNp01 > 10 && !fly.airborne && fly.t - (fly.lastJump || -10) > 2.5) m.jump = 1;
  fly.setMotor(m);
}

export const READOUT_LABELS = {
  DNp01: 'DNp01 giant fiber → escape jump', MDN: 'MDN moonwalker → walk backward', DNp09: 'DNp09 → walk forward',
  DNa02_L: 'DNa02 (L) steering', DNa02_R: 'DNa02 (R) steering', DNa01_L: 'DNa01 (L)', DNa01_R: 'DNa01 (R)',
  proboscis_MN: 'Proboscis motor neurons → extend', MN_prob_types: 'MN10 / MNx01 / MNx03', ingestion_MN: 'Pharyngeal pump motor neurons',
  antennal_MN: 'Antennal motor neurons', neck_MN: 'Neck motor neurons', DNg35: 'DNg35 (JO-F → grooming pathway)', DNg84: 'DNg84 (JO-F → grooming pathway)',
  DNg29: 'DNg29 (sound-recruited DN)', DNb05: 'DNb05', DNb06: 'DNb06', DNp12: 'DNp12', DNg24: 'DNg24', DNp02: 'DNp02',
  pC1: 'pC1 a-e (female receptivity / aggression hub)', WED: 'WED auditory interneurons', AMMC: 'AMMC neurons',
  PAM: 'PAM dopamine (reward)', PPL1: 'PPL1 dopamine (punishment)', MBON: 'Mushroom body output neurons', KC: 'Kenyon cells',
  oviDN: 'oviDN → egg laying', DNp07_10: 'DNp07 / DNp10 landing',
  'JO-A': 'JO-A auditory afferents', 'JO-B': 'JO-B auditory afferents (song band)', 'JO-CE': 'JO-C/D/E wind & gravity', 'JO-F': 'JO-F grooming afferents',
  sugar: 'Sugar / water GRNs', bitter: 'Bitter GRNs', LPLC2: 'LPLC2 looming detectors', LC4: 'LC4 looming detectors',
  ORN_DA1: 'ORN DA1 (cVA pheromone)', ORN_DM1: 'ORN DM1 (vinegar)', R8_chart: 'R8 photoreceptors (chart pixels)', R7: 'R7 photoreceptors',
};

export function buildScenarios(ctx) {
  const { sim, stage, brain, data, audio, ui, G } = ctx;
  const fly = stage.fly;

  // ================================================================== MUSIC
  const music = {
    id: 'music', title: '🎧 Fly listening to music', stageProps: ['speaker'],
    inputs: ['JO-B', 'JO-A', 'JO-CE'], readouts: ['DNp01', 'DNg29', 'DNg24', 'DNb05', 'DNb06', 'DNp12', 'pC1', 'WED', 'antennal_MN', 'neck_MN'],
    blurb: `Sound moves the arista, which twists the antenna and stretches the ~480 Johnston's organ neurons in the second antennal segment.
      JO-B cells are tuned to the 100-350 Hz band where the male courtship song lives; JO-A to higher tones; JO-C/E sense slow deflection (wind).
      The live spectrum of the track is mapped onto these three afferent classes as Poisson firing rates, and the connectome does the rest.
      Watch the descending neurons: a loud transient through JO-A reaches DNp01, the giant fiber: the fly's real acoustic startle jump.`,
    controls: `
      <div class="row"><button data-track="song">♫ Courtship song</button><button data-track="beat">♫ Techno beat</button></div>
      <div class="row"><label class="file">Audio file <input type="file" accept="audio/*"></label><button data-track="mic">🎤 Microphone</button><button data-track="stop">■ Stop</button></div>
      <div class="row"><label>Gain <input type="range" min="0" max="3" step="0.05" value="1.0" data-gain></label></div>
      <div class="meters" data-bands></div>`,
    start() {
      this.gain = 1.0; this.t = 0; this.male = false;
      const el = ui.controls;
      el.querySelectorAll('[data-track]').forEach(b => b.onclick = async () => {
        const k = b.dataset.track;
        if (k === 'song') { await audio.playCourtshipSong(); this.setMale(true); }
        if (k === 'beat') { await audio.playBeat(); this.setMale(false); }
        if (k === 'mic') { try { await audio.useMicrophone(); } catch (e) { ui.toast('Microphone unavailable: ' + e.message); } this.setMale(false); }
        if (k === 'stop') { await audio.stop(); this.setMale(false); }
      });
      el.querySelector('input[type=file]').onchange = async (e) => { if (e.target.files[0]) { await audio.playFile(e.target.files[0]); this.setMale(false); } };
      el.querySelector('[data-gain]').oninput = (e) => { this.gain = +e.target.value; };
      sim.stim('JO-B', G['JO-B'], 0); sim.stim('JO-A', G['JO-A'], 0); sim.stim('JO-CE', G['JO-CE'], 0);
      this.bands = el.querySelector('[data-bands]');
      this.bands.innerHTML = ['sub → JO-C/E (wind)', 'low 100-350 Hz → JO-B', 'mid 350-1200 Hz → JO-A', 'onset'].map(n => `<div class="meter"><span>${n}</span><div class="bar"><i></i></div><b></b></div>`).join('');
      audio.playBeat().catch(() => {});
    },
    setMale(on) { this.male = on; stage.show(on ? ['speaker', 'male'] : ['speaker']); },
    tick(dt) {
      this.t += dt;
      const L = audio.analyse(dt), g = this.gain;
      const jb = clamp01(L.low * g) * 220, ja = clamp01(L.mid * g * 0.9) * 200, jce = clamp01(L.sub * g * 0.7) * 100;
      sim.rate('JO-B', jb); sim.rate('JO-A', ja); sim.rate('JO-CE', jce);
      if (L.onset * g > 0.85 && this.t - (this.lastKick || 0) > 0.35) {     // sharp transient -> synchronous JO-A volley
        this.lastKick = this.t; const idx = G['JO-A'].filter(() => Math.random() < 0.5); sim.kick(idx);
      }
      const bars = this.bands.querySelectorAll('.meter'); const vals = [L.sub * g, L.low * g, L.mid * g, L.onset * g];
      bars.forEach((m, i) => { m.querySelector('i').style.width = (clamp01(vals[i]) * 100) + '%'; m.querySelector('b').textContent = [jce, jb, ja, 0][i] ? Math.round([jce, jb, ja, 0][i]) + ' Hz' : ''; });
      driveFly(fly, sim.rates, { antenna: clamp01(L.total * g * 2.5), headBob: clamp01(L.onset * g * 1.5), motor: { lean: clamp01(L.low * g) * 0.6 } });
      if (this.male) {
        const M = stage.props.male; const singing = L.low * g > 0.15;
        M.setMotor({ extendL: singing ? 1 : 0, songVib: singing ? 1 : 0, walk: 0 });
        M.root.position.set(-1.7 + 0.15 * Math.sin(this.t * 0.7), 0, 1.5); M.heading = Math.PI / 2 + 0.7;
      }
      return L.total * g;
    },
    stop() { audio.stop(); sim.clearStim('JO-B'); sim.clearStim('JO-A'); sim.clearStim('JO-CE'); fly.setMotor({ antenna: 0, headBob: 0, lean: 0 }); },
  };

  // ================================================================== TRADING
  const trading = {
    id: 'trading', title: '📈 Fly trading', stageProps: ['screen'],
    inputs: ['R8_chart', 'sugar', 'bitter', 'LPLC2'], readouts: ['proboscis_MN', 'MDN', 'DNp01', 'PAM', 'PPL1', 'MBON', 'KC', 'DNa02_L', 'DNa02_R'],
    blurb: `The fly watches a price chart with its own eyes: the last 40 candles are rasterised onto the retinotopic map of the R8 photoreceptors
      of one eye. Upward momentum is delivered as sweetness (sugar GRNs), falling prices as bitterness (bitter GRNs), and a crash as a looming
      object (LPLC2). The readout is behavioural: proboscis extension = BUY, backward walking (MDN) or an escape jump (DNp01) = SELL.
      Each closed trade fires the dopamine system: PAM (reward) on profit, PPL1 (punishment) on loss: which depresses the Kenyon-cell →
      MBON synapses that were just active, the same plasticity rule the mushroom body uses for odour learning.`,
    controls: `<div class="row"><button data-act="reset">↺ Reset portfolio</button><label>Volatility <input type="range" min="0.2" max="3" step="0.1" value="1" data-vol></label></div>
      <div class="kv" data-pf></div>`,
    start() {
      this.price = 100; this.hist = [100]; this.cash = 10000; this.pos = 0; this.entry = 0; this.pnl = 0; this.trades = []; this.tAcc = 0; this.decisionAcc = 0; this.vol = 1;
      this.dan = { PAM: 0, PPL1: 0 }; this.log = [];
      ui.controls.querySelector('[data-act=reset]').onclick = () => { this.cash = 10000; this.pos = 0; this.pnl = 0; this.trades = []; this.log = []; };
      ui.controls.querySelector('[data-vol]').oninput = (e) => { this.vol = +e.target.value; };
      sim.stim('sugar', G.sugar, 0); sim.stim('bitter', G.bitter, 0); sim.stim('LPLC2', G.LPLC2, 0);
      sim.stim('PAM', G.PAM, 0); sim.stim('PPL1', G.PPL1, 0);
      this.retina = ctx.retina;                          // R8 of one eye laid out on a 40x24 grid
      sim.stim('R8_chart', [], 0);
      this.badgeT = 0;
    },
    step() {
      // geometric Brownian motion with regime shifts and occasional crashes
      const dtY = 1 / 252 / 8;
      this.drift = (this.drift || 0) * 0.97 + (Math.random() - 0.5) * 0.004 - 0.02 * Math.log(this.price / 100) * 0.05; // slow regimes, mild mean reversion
      let r = this.drift + this.vol * 0.35 * Math.sqrt(dtY) * (Math.random() * 2 - 1) * 1.7;
      if (Math.random() < 0.012 * this.vol) r -= 0.05 + Math.random() * 0.08;   // crash
      if (Math.random() < 0.010 * this.vol) r += 0.04 + Math.random() * 0.05;   // squeeze
      this.price *= 1 + r; this.hist.push(this.price); if (this.hist.length > 400) this.hist.shift();
    },
    tick(dt) {
      this.tAcc += dt; this.decisionAcc += dt;
      while (this.tAcc >= 0.25) { this.tAcc -= 0.25; this.step(); }
      const h = this.hist, n = h.length, last = h[n - 1];
      const ret5 = n > 6 ? (last / h[n - 6] - 1) : 0, ret1 = n > 2 ? (last / h[n - 2] - 1) : 0;
      const peak = Math.max(...h.slice(-30)); const dd = 1 - last / peak;
      sim.rate('sugar', clamp01(ret5 * 25) * 150);
      sim.rate('bitter', clamp01(-ret5 * 25) * 150);
      sim.rate('LPLC2', clamp01((dd - 0.03) * 12) * 150);
      // visual input: rasterise the last 40 prices onto the R8 grid
      const W = this.retina.w, H = this.retina.h, seg = h.slice(-W), lo = Math.min(...seg), hi = Math.max(...seg) + 1e-9;
      const idx = [];
      seg.forEach((p, x) => { const y = Math.round((1 - (p - lo) / (hi - lo)) * (H - 1)); const cell = this.retina.grid[y * W + x]; if (cell) idx.push(...cell); });
      if (this.frame++ % 6 === 0) sim.stim('R8_chart', idx, 60);
      // decisions
      const R = sim.rates;
      if (this.decisionAcc > 1.0) {
        this.decisionAcc = 0;
        const buyDrive = R.proboscis_MN, sellDrive = R.MDN * 2 + R.DNp01 * 6;
        if (this.pos === 0 && buyDrive > 8 && buyDrive > sellDrive) {
          this.pos = Math.floor(this.cash / last); this.cash -= this.pos * last; this.entry = last;
          this.trades.push({ i: n - 1, side: 'BUY', p: last }); stage.badge('BUY', 'buy'); this.badgeT = 1.5; this.log.unshift(`BUY ${this.pos} @ ${last.toFixed(2)}  (proboscis ${buyDrive.toFixed(0)} Hz)`);
        } else if (this.pos > 0 && (sellDrive > 6 || (buyDrive < 2 && ret5 < -0.01))) {
          const pnl = (last - this.entry) * this.pos; this.cash += this.pos * last; this.pos = 0; this.pnl += pnl;
          this.trades.push({ i: n - 1, side: 'SELL', p: last, pnl }); stage.badge(`SELL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}`, pnl >= 0 ? 'buy' : 'sell'); this.badgeT = 1.5;
          this.log.unshift(`SELL @ ${last.toFixed(2)}  P&L ${pnl.toFixed(0)}  → ${pnl >= 0 ? 'PAM reward' : 'PPL1 punishment'} dopamine`);
          // dopamine: reward or punishment pulse + KC->MBON depression of the active Kenyon cells
          const dan = pnl >= 0 ? 'PAM' : 'PPL1'; this.dan[dan] = 0.6;
          sim.modulate(G.KC, G.MBON, 0.85, 0.2);
        }
      }
      for (const k of ['PAM', 'PPL1']) { this.dan[k] = Math.max(0, this.dan[k] - dt); sim.rate(k, this.dan[k] > 0 ? 80 : 0); }
      if (this.badgeT > 0) { this.badgeT -= dt; if (this.badgeT <= 0) stage.badge(''); }
      // avatar + screen
      driveFly(fly, R, { motor: { lean: clamp01(dd * 8) * 0.5 } });
      this.draw(); this.pf();
      return 0;
    },
    draw() {
      const self = this;
      stage.drawScreen((g, c) => {
        const W = c.width, H = c.height, h = self.hist.slice(-120), lo = Math.min(...h), hi = Math.max(...h) + 1e-9;
        g.fillStyle = '#05080f'; g.fillRect(0, 0, W, H);
        g.strokeStyle = '#17202e'; g.lineWidth = 1; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, i * H / 6); g.lineTo(W, i * H / 6); g.stroke(); }
        const X = (i) => 20 + i / (h.length - 1) * (W - 40), Y = (p) => 30 + (1 - (p - lo) / (hi - lo)) * (H - 70);
        g.strokeStyle = h[h.length - 1] >= h[0] ? '#3ddc84' : '#ff5c5c'; g.lineWidth = 3; g.beginPath();
        h.forEach((p, i) => i ? g.lineTo(X(i), Y(p)) : g.moveTo(X(i), Y(p))); g.stroke();
        const off = self.hist.length - h.length;
        for (const t of self.trades) { const i = t.i - off; if (i < 0) continue; g.fillStyle = t.side === 'BUY' ? '#3ddc84' : '#ff5c5c'; g.beginPath(); g.arc(X(i), Y(t.p), 6, 0, 7); g.fill(); }
        g.fillStyle = '#e8eefc'; g.font = 'bold 26px system-ui'; g.fillText('FLY/USD  ' + self.price.toFixed(2), 20, 26);
        g.font = '18px system-ui'; g.fillStyle = self.pnl >= 0 ? '#3ddc84' : '#ff5c5c';
        g.fillText(`P&L ${self.pnl >= 0 ? '+' : ''}${self.pnl.toFixed(0)}   ${self.pos ? 'LONG ' + self.pos : 'FLAT'}`, 20, H - 14);
        g.fillStyle = '#9fb0cc'; g.font = '14px system-ui'; g.fillText('retina view →', W - 130, H - 14);
        // retina thumbnail
        const R = self.retina, s = 2.5, ox = W - 20 - R.w * s, oy = 34;
        g.fillStyle = '#101826'; g.fillRect(ox - 2, oy - 2, R.w * s + 4, R.h * s + 4);
        const seg = self.hist.slice(-R.w), l2 = Math.min(...seg), h2 = Math.max(...seg) + 1e-9;
        g.fillStyle = '#ffd166'; seg.forEach((p, x) => { const y = Math.round((1 - (p - l2) / (h2 - l2)) * (R.h - 1)); g.fillRect(ox + x * s, oy + y * s, s, s); });
      });
    },
    pf() {
      const el = ui.controls.querySelector('[data-pf]'); const eq = this.cash + this.pos * this.price;
      el.innerHTML = `<div><span>Equity</span><b>${eq.toFixed(0)}</b></div><div><span>Realised P&L</span><b class="${this.pnl >= 0 ? 'pos' : 'neg'}">${this.pnl.toFixed(0)}</b></div>
        <div><span>Position</span><b>${this.pos ? 'LONG ' + this.pos : 'flat'}</b></div><div><span>Trades</span><b>${this.trades.length}</b></div>
        <div class="log">${this.log.slice(0, 6).map(l => `<div>${l}</div>`).join('')}</div>`;
    },
    stop() { for (const k of ['sugar', 'bitter', 'LPLC2', 'PAM', 'PPL1', 'R8_chart']) sim.clearStim(k); stage.badge(''); },
  };
  trading.frame = 0;

  // ================================================================== GROOMING
  const groom = {
    id: 'groom', title: '🧼 Antennal grooming', stageProps: [],
    inputs: ['JO-F'], readouts: ['DNg35', 'DNg84', 'antennal_MN', 'neck_MN', 'proboscis_MN', 'MDN'],
    blurb: `Shiu et al. (2024) predicted from this very model that activating the JO-F mechanosensory neurons of the antenna drives the
      descending neurons for antennal grooming, and then confirmed it in real flies. Here the JO-F population is switched on for one second
      at a time (150 Hz Poisson, like optogenetic activation). The two most strongly recruited descending neuron types in this build,
      DNg35 and DNg84, drive the front-leg grooming sweep of the avatar.`,
    controls: `<div class="row"><label>Stimulus rate <input type="range" min="0" max="200" step="10" value="150" data-rate></label><span data-state></span></div>`,
    start() { this.t = 0; this.rate = 150; sim.stim('JO-F', G['JO-F'], 0); ui.controls.querySelector('[data-rate]').oninput = (e) => { this.rate = +e.target.value; }; },
    tick(dt) {
      this.t += dt; const on = (this.t % 3.0) < 1.2;
      sim.rate('JO-F', on ? this.rate : 0);
      ui.controls.querySelector('[data-state]').textContent = on ? '● JO-F ON' : '○ off';
      driveFly(fly, sim.rates); return 0;
    },
    stop() { sim.clearStim('JO-F'); fly.setMotor({ groom: 0 }); },
  };

  // ================================================================== FEEDING
  const feeding = {
    id: 'feeding', title: '🍯 Sugar vs bitter', stageProps: ['food'],
    inputs: ['sugar', 'bitter'], readouts: ['proboscis_MN', 'MN_prob_types', 'ingestion_MN', 'MDN', 'DNp01'],
    blurb: `The classic proboscis extension reflex, and the paper's headline result. Sugar-sensing gustatory receptor neurons on the labellum
      excite a chain of GNG interneurons that ends on the proboscis motor neurons (MN10, MNx01…), so the fly extends its proboscis.
      Bitter GRNs are then presented instead: they activate a different interneuron set and the motor neurons stay silent.`,
    controls: `<div class="row"><span data-state></span></div>`,
    start() { this.t = 0; sim.stim('sugar', G.sugar, 0); sim.stim('bitter', G.bitter, 0); },
    tick(dt) {
      this.t += dt; const ph = this.t % 8;
      const sugar = ph < 3, bitter = ph >= 4 && ph < 7;
      sim.rate('sugar', sugar ? 150 : 0); sim.rate('bitter', bitter ? 150 : 0);
      stage.show(sugar ? ['food'] : bitter ? ['bitter'] : []);
      stage.placeInFront(sugar ? 'food' : 'bitter', 1.5);
      ui.controls.querySelector('[data-state]').textContent = sugar ? '🍯 sugar drop offered: sugar GRNs 150 Hz' : bitter ? '🥬 bitter drop offered: bitter GRNs 150 Hz' : '… nothing offered';
      driveFly(fly, sim.rates); return 0;
    },
    stop() { sim.clearStim('sugar'); sim.clearStim('bitter'); fly.setMotor({ proboscis: 0 }); },
  };

  // ================================================================== ESCAPE
  const escape = {
    id: 'escape', title: '🪰 Swatter! (looming escape)', stageProps: ['loom'],
    inputs: ['LPLC2', 'LC4'], readouts: ['DNp01', 'DNp07_10', 'DNa02_L', 'DNa02_R', 'MDN', 'DNp09'],
    blurb: `An object expanding on the retina is the signature of an approaching threat. Looming-sensitive visual projection neurons LPLC2 and LC4
      converge on DNp01, the giant fiber: a single spike in this neuron is enough to trigger the ~5 ms take-off jump.
      The swatter's angular size is fed as firing rate to the two looming detector populations; the connectome decides when the fly jumps.`,
    controls: `<div class="row"><label>Approach speed <input type="range" min="0.3" max="3" step="0.1" value="1" data-speed></label></div>`,
    start() { this.t = 0; this.speed = 1; sim.stim('LPLC2', G.LPLC2, 0); sim.stim('LC4', G.LC4, 0); ui.controls.querySelector('[data-speed]').oninput = (e) => { this.speed = +e.target.value; }; },
    tick(dt) {
      this.t += dt * this.speed; const cyc = this.t % 5, prog = cyc < 3 ? cyc / 3 : 0;
      stage.setLoom(prog);
      const size = Math.pow(prog, 2.5);
      sim.rate('LPLC2', size * 150); sim.rate('LC4', size * 120);
      driveFly(fly, sim.rates); return 0;
    },
    stop() { sim.clearStim('LPLC2'); sim.clearStim('LC4'); stage.setLoom(0); },
  };

  // ================================================================== COURTSHIP
  const courtship = {
    id: 'courtship', title: '💞 Courtship: song + pheromone', stageProps: ['male'],
    inputs: ['JO-B', 'ORN_DA1'], readouts: ['pC1', 'oviDN', 'DNa02_L', 'DNa02_R', 'MDN', 'DNp09', 'MBON', 'KC'],
    blurb: `FlyWire is a female brain. A courting male extends one wing and sings pulse song (35 ms inter-pulse interval) while emitting the
      pheromone cVA. Song reaches the JO-B auditory afferents; cVA is detected by the ORN DA1 olfactory receptor neurons: which in this
      model light up a huge swath of the antennal lobe, lateral horn and mushroom body. The pC1 cluster integrates both and gates receptivity.`,
    controls: `<div class="row"><span>male sings automatically; audio plays the synthesized song</span></div>`,
    start() { this.t = 0; sim.stim('JO-B', G['JO-B'], 0); sim.stim('ORN_DA1', G.ORN_DA1, 0); audio.playCourtshipSong().catch(() => {}); },
    tick(dt) {
      this.t += dt; const L = audio.analyse(dt);
      const singing = L.low > 0.12; sim.rate('JO-B', clamp01(L.low * 1.6) * 200);
      const smell = (this.t % 12) > 8; sim.rate('ORN_DA1', smell ? 40 : 0);
      const M = stage.props.male; M.setMotor({ extendR: singing ? 1 : 0, songVib: singing ? 1 : 0 });
      M.root.position.set(-1.6, 0, 1.7 + 0.2 * Math.sin(this.t * 0.5)); M.heading = Math.PI / 2 + 0.8;
      ui.controls.querySelector('span').textContent = (singing ? '♫ male singing → JO-B ' : '… male silent ') + (smell ? '| cVA plume → ORN DA1 40 Hz' : '| no pheromone');
      driveFly(fly, sim.rates, { antenna: clamp01(L.total * 3) }); return L.total;
    },
    stop() { audio.stop(); sim.clearStim('JO-B'); sim.clearStim('ORN_DA1'); },
  };

  // ================================================================== FREE POKE
  const poke = {
    id: 'poke', title: '🔬 Poke any neuron', stageProps: [],
    inputs: [], readouts: ['DNp01', 'MDN', 'DNp09', 'proboscis_MN', 'DNa02_L', 'DNa02_R', 'antennal_MN', 'neck_MN', 'oviDN', 'DNg35'],
    blurb: `Click a neuron in the brain view to drive it, or type a FlyWire cell type (e.g. <code>pC1d</code>, <code>MDN</code>, <code>ORN_DM1</code>,
      <code>DNp01</code>, <code>PAM01</code>). The population is driven with Poisson input at the chosen rate, and the top responding cell types are listed.
      Whatever reaches the descending and motor neurons moves the avatar.`,
    controls: `<div class="row"><input type="text" placeholder="cell type, e.g. pC1d" data-type list="celltypes"><button data-act="go">Stimulate</button><button data-act="clear">Clear</button></div>
      <div class="row"><label>Rate <input type="range" min="10" max="250" step="10" value="150" data-rate><b data-ratev>150 Hz</b></label></div>
      <div class="small" data-msg></div><div class="top" data-top></div>`,
    start() {
      this.rate = 150; this.t = 0; this.active = [];
      const el = ui.controls;
      el.querySelector('[data-rate]').oninput = (e) => { this.rate = +e.target.value; el.querySelector('[data-ratev]').textContent = this.rate + ' Hz'; for (const id of this.active) sim.rate(id, this.rate); };
      el.querySelector('[data-act=go]').onclick = () => this.stimType(el.querySelector('[data-type]').value.trim());
      const inp = el.querySelector('[data-type]');
      inp.onkeyup = (e) => { if (e.key === 'Enter' && inp.value.trim()) this.stimType(inp.value.trim()); };
      inp.onchange = () => { if (inp.value.trim() && data.byType(inp.value.trim()).length) this.stimType(inp.value.trim()); };
      el.querySelector('[data-act=clear]').onclick = () => { for (const id of this.active) sim.clearStim(id); this.active = []; brain.setHighlight([]); el.querySelector('[data-msg]').textContent = 'cleared'; };
      ctx.onPick = (i) => { if (i < 0) return; const name = data.typeName(i); this.stimType(name === 'unknown' ? null : name, i); };
    },
    stimType(name, single) {
      const idx = name ? data.byType(name) : [single];
      if (!idx.length) { ui.controls.querySelector('[data-msg]').textContent = `no neurons of type "${name}"`; return; }
      const id = 'poke:' + (name || single);
      sim.stim(id, idx, this.rate); this.active.push(id);
      brain.setHighlight(idx, 1, false);
      ui.controls.querySelector('[data-msg]').textContent = `driving ${idx.length} neuron${idx.length > 1 ? 's' : ''} (${name || 'root ' + data.rootid[single]}) at ${this.rate} Hz`;
    },
    tick(dt) {
      this.t += dt;
      if (this.t - (this.lastTop || 0) > 1.0) {
        this.lastTop = this.t;
        sim.top(12).then(({ top }) => {
          const byType = new Map();
          for (const [c, i] of top) { const t = data.typeName(i); byType.set(t, (byType.get(t) || 0) + c); }
          ui.controls.querySelector('[data-top]').innerHTML = [...byType.entries()].slice(0, 10).map(([t, c]) => `<div><span>${t}</span><b>${c} spikes/s</b></div>`).join('');
        });
      }
      driveFly(fly, sim.rates); return 0;
    },
    stop() { for (const id of this.active) sim.clearStim(id); ctx.onPick = null; brain.setHighlight([]); },
  };

  return [music, trading, feeding, groom, escape, courtship, poke];
}
