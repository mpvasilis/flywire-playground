// Capture README screenshots of the running app with headless Chrome over the DevTools protocol.
// usage: node tools/screenshot.mjs [chromePath] [baseUrl]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const chrome = process.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.argv[3] || 'http://127.0.0.1:8765/';
const port = 9333, W = 1600, H = 900;
const only = process.argv[4] ? process.argv[4].split(',') : null;   // optional: subset of scenario names
mkdirSync('docs/screenshots', { recursive: true });

const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, '--remote-allow-origins=*',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', `--window-size=${W},${H}`,
  `--user-data-dir=${process.env.TEMP}/chrome-cdp-shots`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(200); }
}
if (!wsUrl) { proc.kill(); throw new Error('chrome did not start'); }
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);
const evaluate = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId).then(r => r.result?.result?.value);

const shots = [
  { name: 'music', hash: 'music', wait: 9000, prep: `document.querySelector('[data-track=song]').click()` },
  { name: 'trading', hash: 'trading', wait: 35000 },
  { name: 'feeding', hash: 'feeding', wait: 2600 },
  { name: 'groom', hash: 'groom', wait: 400, prep: `document.querySelector('#scenarios button[data-id="groom"]').click()` },
  { name: 'escape', hash: 'escape', wait: 2300 },
  { name: 'courtship', hash: 'courtship', wait: 9000 },
  { name: 'poke', hash: 'poke', wait: 5000, prep: `(() => { const i = document.querySelector('[data-type]'); i.value = 'MDN'; document.querySelector('[data-act=go]').click(); })()` },
];
let first = true;
for (const s of shots) {
  if (only && !only.includes(s.name)) continue;
  if (first) {
    await send('Page.navigate', { url: base + '#' + s.hash }, sessionId);
    for (let i = 0; i < 100; i++) { if (await evaluate(`!!window.fly`)) break; await sleep(300); }
    await sleep(500); first = false;
  } else {
    await evaluate(`document.querySelector('#scenarios button[data-id="${s.hash}"]').click(); true`);
    await sleep(300);
  }
  if (s.prep) await evaluate(s.prep + '; true');
  await sleep(s.wait);
  const info = await evaluate(`JSON.stringify({t: window.fly.sim.simTime, spikes: window.fly.sim.spikes, active: window.fly.sim.nActive, trades: window.fly.current.trades?.length})`);
  const { result: { data } } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(`docs/screenshots/${s.name}.png`, Buffer.from(data, 'base64'));
  console.log(s.name, info);
}
ws.close(); proc.kill();
