// Minimal headless-Chrome driver over CDP (Node 22 has fetch + WebSocket built in). No npm deps.
const { spawn, execSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const win = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
  for (const p of win) if (fs.existsSync(p)) return p;
  for (const b of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'])
    try { return execSync('command -v ' + b, { shell: '/bin/sh' }).toString().trim(); } catch {}
  throw new Error('No Chrome found; set CHROME=/path/to/chrome');
}
const SITE = path.resolve(__dirname, '..');
const url = p => 'file://' + (process.platform === 'win32' ? '/' : '') + path.join(SITE, p).replace(/\\/g, '/');
async function launch({ width = 1440, height = 900, reduce = false } = {}) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bunnys-'));
  const proc = spawn(chromePath(), ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files',
    '--remote-debugging-port=' + port,
    // (no back/forward cache: it kept every page a test had left alive, WebGL contexts, 3D tiles and all, until the GPU
    // lost its contexts and the page hung after a few navigations)
    '--disable-features=BackForwardCache', '--user-data-dir=' + dir, 'about:blank'], { stdio: 'ignore' });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let list; for (let i = 0; i < 60 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pending = {}; const errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise(r => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  // without this the page is never foregrounded, so focus/blur events never fire
  // even though document.activeElement updates -- focus-driven UI looks broken
  await send('Page.bringToFront');
  const page = {
    errors, sleep, send,
    size: (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }),
    goto: async (p, wait = 1500) => { await send('Page.navigate', { url: url(p) }); await sleep(wait); },
    eval: async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value,
    mouse: (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 }),
    key: async (key, code, vk) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk }); },
    shot: async (file, full = true) => { const m = JSON.parse(await page.eval('JSON.stringify([innerWidth, document.documentElement.scrollHeight])'));
      const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, clip: full ? { x: 0, y: 0, width: m[0], height: Math.min(m[1], 9000), scale: 1 } : undefined });
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(s.data, 'base64')); },
    close: () => { ws.close(); proc.kill(); }
  };
  await page.size(width, height);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
  return page;
}
function check(name, ok, info = '') { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) process.exitCode = 1; }
module.exports = { launch, check, SITE, url };
