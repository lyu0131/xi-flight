// site5 checks, on the headless-Chrome harness (tests/cdp.js, a copy of site4's): the ball renders, the HUD draws, the scripted flight
// moves the suit and the seat, keys take it over and it hands back, drag turns the head, reduced motion
// holds still, every look loads, it fits a phone. Run: node site5/tests/cockpit.test.js
const { launch: launchFile, check } = require('./cdp');
const serve = require('./serve');
// site5 runs over http (Cesium's workers and the streamed tiles don't work from file://): every page here is
// opened from a local server rooted at the repo
let srv = null;
// ONLY=main,3d,... runs just those blocks (main, altitude, modes, traffic, controls, horizon, world, light, 3d,
// capture, seatlight, reduce, phone); unset, everything runs
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null, want = n => !ONLY || ONLY.includes(n);
async function launch(o) {
  const p = await launchFile(o);
  // (the old page is marked first and the wait is for it to be gone: a fixed sleep let ready() pass on the old page
  // when the new one was slow to commit)
  p.goto = async (path, wait = 1500) => {
    await p.eval('window.__oldPage = true');
    await p.send('Page.navigate', { url: srv.url(path.replace(/^\.\.\//, '')) });
    for (let i = 0; i < 100 && (await p.eval('window.__oldPage === true')) !== false; i++) await p.sleep(50);
    await p.sleep(wait);
  };
  return p;
}
const PAGE = '../site5/index.html?seed=7&mode=hybrid&alt=11&throttle=0&hdg=0';   // the airways' height, at the lowest throttle, for the targeting checks
// a read inside a frame that can't hang the run: if no frame comes within 3 s, or the read throws, it gives `none`
const inFrame = (p, body, none) => Promise.race([p.eval(`new Promise(r => requestAnimationFrame(() => { ${body} }))`),
  new Promise(r => setTimeout(() => r(none), 3000))]).then(v => v == null ? none : v);
const pose = (p, expr) => p.eval(`(() => { const s = SITE5.pose; return ${expr}; })()`);
// ready: drawing, the world (sky.js, from the CDN) up and the seat (the 11 MB glb) in and drawn: their first seconds
// are slow, which timing checks mustn't catch. (A missing seat is ready too, with only the rings.)
async function ready(p) {
  for (let i = 0; i < 60 && !(await p.eval('!!(window.SITE5 && SITE5.pose && SITE5.frames > 5)')); i++) await p.sleep(100);
  for (let i = 0; i < 160 && !(await p.eval('!!(SITE5.world && SITE5.world.ready)')); i++) await p.sleep(250);
  for (let i = 0; i < 160 && !(await p.eval('!!(SITE5.seat && SITE5.seat.ready && SITE5.parts && SITE5.parts.ringGroups)')); i++) await p.sleep(250);
}

(async () => {
  srv = await serve.start();
  if (want('main')) {
  {
    const st = async u => (await fetch(srv.url(u))).status;
    check('the page loads over http', (await st('site5/index.html')) === 200 && (await st('site5/js/ball.js')) === 200);
  }
  const p = await launch({ width: 1440, height: 900 });
  await p.goto(PAGE, 300);
  // strapping in: the hand rings start open and swing shut. Their clock starts when they first draw, so the open
  // angle is read the moment it appears, not at ready
  let open0; for (let i = 0; i < 1200 && (open0 = await p.eval('window.SITE5 && SITE5.parts ? SITE5.parts.ringOpen : undefined')) === undefined; i++) await p.sleep(50);
  await ready(p);
  check('WebGL2 is up', await p.eval('!!SITE5.gl && !document.documentElement.classList.contains("nogl")'));
  // read the ball's picture inside a frame, straight after it's drawn
  check('the HUD draws', await p.eval(`(() => { const c = document.getElementById('hud'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i]) n++; return n > 200; })()`));

  // the scripted flight turns the suit, and the seat swings inside the ball
  // (each read falls back to a blank, so a seat that never came in fails these checks instead of ending the run)
  const ctl = () => p.eval('JSON.stringify(SITE5.parts.controls || { arm: 0, cover: 0, toggle: 0, keys: [0, 0, 0, 0] })').then(JSON.parse);
  const ctlL = () => p.eval('JSON.stringify(SITE5.parts.controlsL || { gauge: 0, wheel: 0, twist: 0 })').then(JSON.parse);
  const hands = JSON.parse(await p.eval('JSON.stringify(SITE5.parts.ringGroups || [[], []])'));
  check('each hand has its own controls: targeting right, thrust left', ['trigger', 'dial', 'armbtn', 'thumb'].every(g => hands[1].includes(g) && !hands[0].includes(g))
    && ['boost', 'wheel', 'twist', 'rocker', 'gauge4'].every(g => hands[0].includes(g) && !hands[1].includes(g)), JSON.stringify(hands));
  const a0 = await pose(p, 's.heading'), q0a = JSON.parse(await pose(p, 'JSON.stringify(s.pos)')); let maxSeat = 0, armIn = 0; const keysIn = [0, 0, 0, 0]; let gaugeMax = 0;
  for (let i = 0; i < 60; i++) { await p.sleep(50); maxSeat = Math.max(maxSeat, await pose(p, 'Math.hypot(s.eye[0], s.eye[1], s.eye[2] + .4)'));
    const c = await ctl(); armIn = Math.max(armIn, c.arm); c.keys.forEach((k, j) => { keysIn[j] = Math.max(keysIn[j], k); }); gaugeMax = Math.max(gaugeMax, (await ctlL()).gauge); }
  check('the throttle gauge sweeps up once on strap-in', gaugeMax > 0.95, gaugeMax.toFixed(2));
  // (the autopilot may hold its heading on an aircraft dead ahead, so 'flies' is: it moves, under AUTO)
  { const q1a = JSON.parse(await pose(p, 'JSON.stringify(s.pos)')); check('AUTO flies: the suit moves on its own', Math.hypot(q1a[0] - q0a[0], q1a[2] - q0a[2]) > 1 && (await pose(p, 's.pilot')) === 'AUTO', JSON.stringify([q0a, q1a])); }
  check('AUTO says so', (await pose(p, 's.pilot')) === 'AUTO');
  check('the seat sways inside the ball', maxSeat > 0.003 && maxSeat < 0.3, maxSeat.toFixed(4));
  const c3 = await ctl();
  check('strapped in, the ARM cover flips up and the button goes in', c3.cover > 0.9 && armIn > 0.5 && c3.arm < 0.1, JSON.stringify({ cover: c3.cover, armIn, arm: c3.arm }));
  check('the four finger keys ripple through a check', keysIn.every(k => k > 0.4) && c3.keys.every(k => k < 0.1), JSON.stringify(keysIn));
  check('the hand rings start open and close as you strap in', open0 > 60 && (await p.eval('SITE5.parts.ringOpen')) === 0, open0 + ' -> ' + (await p.eval('SITE5.parts.ringOpen')));

  {
    const q0 = JSON.parse(await pose(p, 'JSON.stringify(s.pos)')); await p.sleep(2000); const q1 = JSON.parse(await pose(p, 'JSON.stringify(s.pos)'));
    const moved = Math.hypot(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]);
    check("the suit flies at the throttle's speed", moved > 0.8 && moved < 1.2, moved.toFixed(3) + ' km in 2s at 0.5 km/s');
  }
  // keys take it over (MANUAL) and turn it; it hands back after 4s
  const cl = () => p.eval('JSON.stringify(SITE5.parts.cluster)').then(JSON.parse);
  const dash0 = (await cl()).dash;
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  const h0 = await pose(p, 's.heading'), L0 = await ctlL(); await p.sleep(900);
  const L1 = await ctlL();
  check('turning runs the thumb wheel', Math.abs(L1.wheel - L0.wheel) > 20, JSON.stringify({ twist: L1.twist, wheel: [L0.wheel, L1.wheel] }));
  const turning = await cl(), tiltTurn = JSON.parse(await p.eval('JSON.stringify(SITE5.parts.ringTurn || null)')); await p.sleep(300);
  // twin sticks ([left ring, right ring]): turning left pulls the left arm back and pushes the right forward, both roll left
  check('turning left: left arm back, right arm forward, both roll left', !!tiltTurn && tiltTurn[0].pitch < -5 && tiltTurn[1].pitch > 5 && tiltTurn.every(t => t.roll < -3), JSON.stringify(tiltTurn));
  check('turning left lights the left turn tabs only', turning.tabs[0] > 0.3 && turning.tabs[1] < 0.05, JSON.stringify(turning.tabs));
  check('the dash rows scroll with the turn', Math.abs(turning.dash - dash0) > 0.001, dash0 + ' -> ' + turning.dash);
  check('the thrust vector swings into the turn', turning.thrust[0] < -0.1, JSON.stringify(turning.thrust));
  check('the thrust bars fire the verniers for the turn', turning.bars[2] > turning.bars[1] + 0.2, JSON.stringify(turning.bars));
  check('a key takes over: MANUAL', (await pose(p, 's.pilot')) === 'MANUAL' && (await pose(p, 's.modeWord')) === 'MANUAL');
  check('taking over flicks the toggle to MANUAL', (await ctl()).toggle > 0.8, String((await ctl()).toggle));
  check('left turns it left', ((await pose(p, 's.heading')) - h0 + 540) % 360 - 180 < -15);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await p.sleep(4600);
  check('it hands back to AUTO', (await pose(p, 's.pilot')) === 'AUTO' && (await pose(p, 's.modeWord')) === 'HYBRID');

  // going up, the pilot looks up into the climb: the HUD (on the ball) drops down the screen, as in the FPV clip
  const noseY = () => p.eval('(SITE5.project([0, 0, 1]) || [0, NaN])[1]');
  await p.sleep(400);
  const y0 = await noseY();
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
  await p.sleep(500); let upLit = 0, upY = 0;
  for (let i = 0; i < 10; i++) { const c = (await cl()).chev; upLit = Math.max(upLit, c.up); upY = Math.max(upY, c.upY); await p.sleep(30); }
  check('climbing lights the up arrow', upLit > 0.3, upLit.toFixed(2));
  check('climbing pushes the up arrow up', upY > 0.3, upY.toFixed(2));
  const tiltClimb = JSON.parse(await p.eval('JSON.stringify(SITE5.parts.ringTurn || null)'));
  check('climbing pulls both arms back', !!tiltClimb && tiltClimb.every(t => t.pitch < -5), JSON.stringify(tiltClimb));
  const y1 = await noseY();
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
  check('climbing shifts the HUD down the screen', y1 - y0 > 40, `${y0.toFixed(0)} -> ${y1.toFixed(0)}`);
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await p.sleep(400); let downY = 0;
  for (let i = 0; i < 10; i++) { downY = Math.max(downY, (await cl()).chev.downY); await p.sleep(30); }
  const tiltDive = JSON.parse(await p.eval('JSON.stringify(SITE5.parts.ringTurn || null)'));
  check('diving pushes both arms forward', !!tiltDive && tiltDive.every(t => t.pitch > 5), JSON.stringify(tiltDive));
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  check('diving pushes the down arrow down', downY > 0.3, downY.toFixed(2));
  await p.sleep(4600);
  // the mouse steers the gaze a little: the HUD slides away from where you look
  await p.mouse('mouseMoved', 720, 450); await p.sleep(900);
  const g0 = await p.eval('SITE5.project([0, 0, 1])[0]');
  await p.mouse('mouseMoved', 1400, 450); await p.sleep(1200);
  const g1 = await p.eval('SITE5.project([0, 0, 1])[0]');
  check('looking right with the mouse slides the HUD left', g0 - g1 > 25, `${g0.toFixed(0)} -> ${g1.toFixed(0)}`);
  // the mouse steers now (HYBRID): back to the centre, and the autopilot takes over again
  await p.mouse('mouseMoved', 720, 450); await p.sleep(4600);
  // the layout is measured off the owner's front frame: the anchors sit where that frame has them (checked
  // still, in the reduced-motion run below); here, live: the rail, its caps, the rulers stream, three contacts
  const parts = () => p.eval('JSON.stringify(SITE5.parts)').then(JSON.parse);
  let pt = await parts();
  check('the pink rail is drawn with its two diamond caps', pt.rail === true && pt.caps === 2, JSON.stringify({ rail: pt.rail, caps: pt.caps }));
  const nAir = await pose(p, 's.contacts.length');
  check('6 to 9 aircraft in the world', nAir >= 6 && nAir <= 9, String(nAir));
  const c0 = await cl(); await p.sleep(700); const c1 = await cl();
  check('the radar sweeps, with a blip for every contact', c0.radarArm !== c1.radarArm && c1.blips === (await pose(p, 's.contacts.length')), JSON.stringify([c0.radarArm, c1.radarArm, c1.blips]));
  check('the trace runs', c1.trace >= 50 && c1.traceSpread > 0.05, JSON.stringify([c1.trace, c1.traceSpread]));
  check('the bars read between 0 and 1', c1.bars.length === 6 && c1.bars.every(v => v >= 0 && v <= 1), JSON.stringify(c1.bars));
  let cellsMoved = false;
  for (let i = 0; i < 20 && !cellsMoved; i++) { await p.sleep(100); cellsMoved = (await cl()).cells !== c0.cells; }
  check('the system cells blink', cellsMoved);
  const st0 = await p.eval('SITE5.tapes.stream'); await p.sleep(500);
  check('the ruler dashes move with the pitch', (await p.eval('SITE5.tapes.stream')) !== st0);
  const hdg0 = await p.eval('SITE5.tapes.heading');
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await p.sleep(900); pt = await parts(); pt.hdgBefore = hdg0;
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  check('the heading ticks scroll with the heading', pt.hdgBefore !== (await p.eval('SITE5.tapes.heading')), String(await p.eval('SITE5.tapes.heading')));
  await p.sleep(4600);
  // the triangle sight is always up, and the coffin cells glow in turn (a lit run that moves on)
  // the sight: faint at idle, closing in (and jittering) while a lock builds, full and blinking on lock
  // (E: springs open and closes in, clunks into the lock; brackets and V follow the target; pings while held)
  // the dial eases round after a click: read it once it has settled
  let dial0 = (await ctl()).dial; for (let i = 0; i < 20; i++) { await p.sleep(60); const d = (await ctl()).dial; if (Math.abs(d - dial0) < 0.5) break; dial0 = d; }
  let thumbIn = 0, triggerIn = 0, combat = 0;
  const seen = {}; let maxK = 1, minK = 9, follow = null, pinged = false, onFor = 0, railPulsed = false, cascaded = false, triPink = false, caretOff = false;
  const sightNow = () => p.eval('JSON.stringify({ s: SITE5.parts.sightStage, k: SITE5.parts.sightScale, cue: SITE5.parts.sightCue, err: SITE5.parts.sightCueErr, pings: SITE5.parts.sightPings, fly: SITE5.parts.sightFly, sway: SITE5.parts.sightSway })').then(JSON.parse);
  for (let i = 0; i < 500 && !(seen.idle && seen.acquire && seen.blink && seen.on && onFor > 40); i++) {
    const st = await sightNow();
    seen[st.s] = true; if (st.s === 'acquire') maxK = Math.max(maxK, st.k);
    if (st.s === 'acquire') thumbIn = Math.max(thumbIn, (await ctl()).thumb); if (st.s === 'on') { triggerIn = Math.max(triggerIn, (await ctl()).trigger); combat = Math.max(combat, (await ctlL()).rocker); }
    if (st.s === 'on' || st.s === 'blink') minK = Math.min(minK, st.k);
    if (st.s === 'on' || st.s === 'blink') { const k = await cl(); if (k.railPulse) railPulsed = true; if (k.cascade) cascaded = true; if (k.triPink) triPink = true; if (!k.caret || k.caret !== k.triColor) caretOff = true; }
    if (st.s === 'on') { onFor++; if (st.pings) pinged = true; if (onFor > 25 && st.cue && Math.hypot(st.cue[0], st.cue[1]) > 0.002 && (!follow || st.err < follow.err)) follow = st; }
    await p.sleep(12);
  }
  check('the sight sits faint on the nose at idle', !!seen.idle);
  check('it closes in while the lock builds', !!seen.acquire && maxK > 1.15, 'max scale ' + maxK.toFixed(2));
  check('on lock it blinks and holds', !!seen.blink && !!seen.on, Object.keys(seen).join(','));
  check('it springs into the lock, overshooting', minK < 0.985, 'min scale ' + minK.toFixed(3));
  check('locked, the brackets and V follow the target off the nose', !!follow && follow.err < 0.004, JSON.stringify(follow && { cue: follow.cue, err: follow.err }));
  check('a ping goes out while the lock is held', pinged);
  check('on lock a pulse runs in along the rail', railPulsed);
  check('on lock a flash runs up the cluster, and its triangle turns pink', cascaded && triPink, JSON.stringify({ cascaded, triPink }));
  check('the caret always wears the triangle\'s colour', !caretOff);
  check('the thumb holds the dome in while the lock builds', thumbIn > 0.5, thumbIn.toFixed(2));
  check('the trigger snaps in on the lock', triggerIn > 0.8, triggerIn.toFixed(2));
  check('the left rocker tips to COMBAT while a target is held', combat > 0.8, combat.toFixed(2));
  // the autopilot may hold one aircraft a while: give it up to 10s to move on to the next
  for (let i = 0; i < 100 && (await ctl()).dial - dial0 < 20; i++) await p.sleep(100);
  check('the SEL dial clicks round for a new target', (await ctl()).dial - dial0 >= 20, dial0 + ' -> ' + (await ctl()).dial);
  // turning hard off the target breaks the lock: the brackets fly apart, and the big triangle sways with the turn
  // (and right next to the bunched contacts a held key still turns at full rate: the aim help never fights it)
  for (let i = 0; i < 150 && !(await pose(p, 's.locked')); i++) await p.sleep(100);   // break a lock that's held
  const hdgA = await pose(p, 's.heading'), tA = Date.now();
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  let flew = false, sx = [], squeeze = 0;
  for (let i = 0; i < 120 && !(flew && sx.length > 60); i++) { const st = await sightNow(); if (st.fly > 0 && st.fly < 1) flew = true; sx.push(st.sway[0]); squeeze = Math.max(squeeze, (await ctl()).paddle); await p.sleep(12); }
  check('a broken lock squeezes the pinky paddle', squeeze > 0.3, squeeze.toFixed(2));
  while (Date.now() - tA < 1000) await p.sleep(20);
  const turned = -(((await pose(p, 's.heading')) - hdgA + 540) % 360 - 180);
  check('next to the contacts a held key turns at full rate', turned > 35, turned.toFixed(1) + ' deg in 1s');
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  check('a broken lock: the brackets fly apart', flew);
  check('the big triangle sways with the turn', Math.max(...sx) - Math.min(...sx) > 0.003, (Math.max(...sx) - Math.min(...sx)).toFixed(4));
  // MANUAL can lock too: a pilot who takes over, turns away, then steers at the enemy the way a person does (a
  // quarter-second reaction, tapping the keys) gets a lock within 3s of first bringing a contact within 12 deg
  {
    const KY = { l: ['ArrowLeft', 37], r: ['ArrowRight', 39], u: ['ArrowUp', 38], d: ['ArrowDown', 40] }, held = {};
    const key = async (k, on) => { if (!!held[k] === on) return; held[k] = on; await p.send('Input.dispatchKeyEvent', { type: on ? 'keyDown' : 'keyUp', key: KY[k][0], code: KY[k][0], windowsVirtualKeyCode: KY[k][1] }); };
    await key('l', true); await p.sleep(1500); await key('l', false);
    let manualLock = null, tClose = null; const t0 = Date.now();
    while (Date.now() - t0 < 9000 && manualLock === null) {
      const s = JSON.parse(await p.eval(`(() => { const s = SITE5.pose, m = SITE5.m, b = m.qrot(m.qconj(s.suitQ), s.contacts.reduce((a, c) => c.off < a.off ? c : a).d);
        return JSON.stringify({ x: Math.atan2(b[0], b[2]) / m.D, y: Math.asin(b[1]) / m.D, near: Math.min(...s.contacts.map(c => c.off)), locked: s.locked, pilot: s.pilot }); })()`));
      if (tClose === null && s.near < 12) tClose = Date.now();
      if (s.locked && s.pilot === 'MANUAL') manualLock = (Date.now() - (tClose || t0)) / 1000;
      await key('r', s.x > 3); await key('l', s.x < -3); await key('u', s.y > 3); await key('d', s.y < -3);
      await p.sleep(250);
    }
    for (const k of Object.keys(KY)) await key(k, false);
    check('MANUAL: steering at the enemy like a person locks within 3s of getting close', manualLock !== null && manualLock < 3, manualLock === null ? 'no lock' : manualLock.toFixed(1) + 's');
    await p.sleep(4600);
  }
  // targeting: a lock goes to the contact nearest the boresight, and the HUD marks that one
  let tg = null;
  for (let i = 0; i < 80 && !tg; i++) { await p.sleep(100); tg = await p.eval(`(() => { const s = SITE5.pose; if (!s.locked) return null;
    const near = s.contacts.reduce((a, b) => b.off < a.off ? b : a), cur = s.contacts.find(c => c.id === s.lockId);
    return JSON.stringify({ lockId: s.lockId, near: near.id, nearOff: near.off, off: cur.off, marked: SITE5.parts.target }); })()`); }
  tg = tg && JSON.parse(tg);
  // (a held lock stays put until another contact is clearly nearer, by 2.5 deg: ball.js keeps it from flickering)
  check('a lock goes to the contact nearest the sight', !!tg && (tg.lockId === tg.near || tg.off < tg.nearOff + 2.5) && tg.off < 7, JSON.stringify(tg));
  check('and the HUD marks that contact as the target', !!tg && tg.marked === tg.lockId);
  // the hierarchy: only the sight / active target (tier 1) and the rail's core (tier 2) carry a halo
  const halo = await p.eval('JSON.stringify(SITE5.parts.halo)').then(JSON.parse);
  check('only the sight, the target and the rail core glow', halo[1] > 0 && halo[2] > 0 && !halo[3] && !halo[4], JSON.stringify(halo));
  // one sphere: line weight follows depth (nearer parts of the monitor a touch heavier), and changes smoothly --
  // round the rail, no step between neighbouring points is more than a few percent
  const dep = JSON.parse(await p.eval(`(() => { const d = (az, el) => [Math.cos(el * Math.PI / 180) * Math.sin(az * Math.PI / 180), Math.sin(el * Math.PI / 180), Math.cos(el * Math.PI / 180) * Math.cos(az * Math.PI / 180)];
    const r = []; for (let a = 0; a <= 360; a += 3) r.push(SITE5.depthScale(d(a, -22)));
    let jump = 0; for (let i = 1; i < r.length; i++) jump = Math.max(jump, Math.abs(r[i] - r[i - 1]));
    return JSON.stringify({ front: r[0], rear: r[60], jump }); })()`));
  check('lines weigh more on the near side of the sphere', dep.rear > dep.front + 0.1, JSON.stringify(dep));
  check('and the weight changes smoothly round the rail', dep.jump < 0.03, dep.jump.toFixed(3));
  const lit = () => p.eval('SITE5.parts.litCells');
  const l0 = await lit(); await p.sleep(400);
  check('the coffin glow moves from cell to cell', (await lit()) !== l0 && (await lit()) !== undefined, l0 + ' -> ' + (await lit()));

  // a drag turns the pilot's head, not the suit
  await p.mouse('mousePressed', 700, 450, 1); for (let k = 1; k <= 8; k++) await p.mouse('mouseMoved', 700 - 25 * k, 450, 1); await p.mouse('mouseReleased', 500, 450);
  check('a drag turns the head', Math.abs(await pose(p, 's.head.yaw')) > 20, String(await pose(p, 's.head.yaw')));
  // looking round to the tail: the rail runs on behind the seat too
  await p.mouse('mousePressed', 700, 450, 1); for (let k = 1; k <= 8; k++) await p.mouse('mouseMoved', 700 - 75 * k, 450, 1); await p.mouse('mouseReleased', 100, 450);
  await p.sleep(200);
  check('the rear of the monitor has its own HUD', await p.eval('SITE5.parts.rear === true'));
  // looking down (dragging the view up): the arm rails and grips are there, drawn in perspective
  await p.goto(PAGE, 300); await ready(p);
  await p.mouse('mousePressed', 700, 650, 1); for (let k = 1; k <= 8; k++) await p.mouse('mouseMoved', 700, 650 - 40 * k, 1); await p.mouse('mouseReleased', 700, 330);
  await p.sleep(200);
  check('looking down shows the controls', await p.eval('SITE5.parts.seat.grip > 4 && SITE5.parts.seat.rail > 4'), JSON.stringify(await p.eval('SITE5.parts.seat')));
  // the seat is a real 3D model on its own canvas: looking down, it fills a good part of the view, and its contact
  // shading (worked out after load) is in
  const seatCover = await inFrame(p, ` const g = SITE5.seatGL, w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(4 * w * h);
    g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px); let n = 0; for (let i = 3; i < px.length; i += 4 * 16) if (px[i] > 0) n++; r(n / (px.length / 64)); `, NaN);
  check('looking down, the 3D seat fills a good part of the view', seatCover > 0.15, (seatCover * 100).toFixed(0) + '%');
  check('the seat contact shading is in', await p.eval('SITE5.parts.seatAO === true'));
  check('no JS errors', p.errors.length === 0, p.errors.join(' | '));
  check('frames hold up (avg under 25ms)', (await p.eval('SITE5.frameMs')) < 25, (await p.eval('SITE5.frameMs')).toFixed(1) + 'ms');

  await p.goto(`${PAGE}&look=penelope`, 300); await ready(p);
  check('?look=penelope loads and draws', (await p.eval('SITE5.look')) === 'penelope' && await p.eval('!!SITE5.gl'));
  check('looks: no JS errors', p.errors.length === 0, p.errors.join(' | '));
  p.close();
  }

  // altitude: a held climb raises it; the floor and ceiling hold; with no traffic at all nothing breaks
  if (want('altitude')) {
    const a = await launch({ width: 1200, height: 700 });
    const hold = async (key, code, vk, ms) => { await a.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }); await a.sleep(ms); await a.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); };
    await a.goto(PAGE, 300); await ready(a);
    const al0 = await pose(a, 's.alt'); await hold('ArrowUp', 'ArrowUp', 38, 2000);
    check('climbing raises the altitude', (await pose(a, 's.alt')) - al0 > 0.2, al0.toFixed(2) + ' -> ' + (await pose(a, 's.alt')).toFixed(2));
    await a.goto('../site5/index.html?seed=7&mode=hybrid&alt=99.8', 300); await ready(a); await hold('ArrowUp', 'ArrowUp', 38, 3000);
    const hi = await pose(a, 's.alt');
    await a.goto('../site5/index.html?seed=7&mode=hybrid&alt=1.2', 300); await ready(a); await hold('ArrowDown', 'ArrowDown', 40, 3000);
    const lo = await pose(a, 's.alt');
    check('the floor and ceiling hold', Number.isFinite(hi) && hi <= 100 && Number.isFinite(lo) && lo >= 1, JSON.stringify([hi, lo]));
    // on the real globe: cruise is 2 km/s; north raises the latitude by the distance over 111.2 km a degree; the date line wraps
    await a.goto('../site5/index.html?seed=7&mode=input&traffic=0&hdg=0', 300); await ready(a);
    const q0 = JSON.parse(await pose(a, 'JSON.stringify(s.pos)')), g0 = JSON.parse(await pose(a, 'JSON.stringify(s.geo)')); await a.sleep(2000);
    const q1 = JSON.parse(await pose(a, 'JSON.stringify(s.pos)')); const mv = Math.hypot(q1[0] - q0[0], q1[2] - q0[2]);
    check('the suit cruises at 2 km/s', mv > 3.4 && mv < 4.6, mv.toFixed(2) + ' km in 2s');
    await a.sleep(8000); const g1 = JSON.parse(await pose(a, 'JSON.stringify(s.geo)')), north = (g1[0] - g0[0]) * 111.2;
    const flown = Math.hypot(...[0, 2].map(i => JSON.parse(JSON.stringify(q1))[i]));
    check('north raises the latitude', north > 17 && north < 23 && Math.abs(g1[1] - g0[1]) < 0.01, JSON.stringify({ g0, g1, north }));
    await a.goto('../site5/index.html?seed=7&mode=input&traffic=0&lon=179.99&hdg=90', 300); await ready(a); await a.sleep(3000);
    const gd = JSON.parse(await pose(a, 'JSON.stringify(s.geo)'));
    check('the date line wraps', Number.isFinite(gd[1]) && gd[1] > -180 && gd[1] < -179.9, JSON.stringify(gd));
    await a.goto(PAGE + '&traffic=0', 300); await ready(a); await a.sleep(2000);
    check('targeting with no contacts', a.errors.length === 0 && (await pose(a, 's.lockId')) === null && (await pose(a, 's.contacts.length')) === 0, a.errors.join(' | '));
    a.close();
  }

  // three modes: FREE watches (keys don't fly), HYBRID shares, INPUT is yours (let go and it holds course)
  if (want('modes')) {
    const q = await launch({ width: 1200, height: 700 });
    const BASE = '../site5/index.html?seed=7&hdg=0';
    const key = (type, k, code, vk) => q.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
    const left = on => key(on ? 'keyDown' : 'keyUp', 'ArrowLeft', 'ArrowLeft', 37);
    const press = async (k, code, vk) => { await key('keyDown', k, code, vk); await key('keyUp', k, code, vk); await q.sleep(60); };
    await q.goto(BASE, 300); await ready(q);
    check('HYBRID is the default', (await pose(q, 's.mode')) === 'HYBRID' && (await pose(q, 's.modeWord')) === 'HYBRID');
    await q.goto(BASE + '&mode=free', 300); await ready(q);
    check('the mode button says what the mode does', /AUTOPILOT/.test(await q.eval('document.getElementById("mode").textContent')), await q.eval('document.getElementById("mode").textContent'));
    let auto = true; const h0 = await pose(q, 's.heading'); await left(true);
    for (let i = 0; i < 10; i++) { await q.sleep(100); if ((await pose(q, 's.pilot')) !== 'AUTO') auto = false; }
    const nudge = await q.eval('document.getElementById("mode").textContent');
    await left(false);
    check('an arrow in FREE says to press M', /PRESS M/.test(nudge), nudge);
    const turnedF = Math.abs(((await pose(q, 's.heading')) - h0 + 540) % 360 - 180);
    check('FREE ignores the keys', auto && turnedF < 35, JSON.stringify({ auto, turnedF }));
    const seq = [await pose(q, 's.mode')];
    for (let i = 0; i < 3; i++) { await press('m', 'KeyM', 77); seq.push(await pose(q, 's.mode')); }
    check('M cycles FREE -> HYBRID -> INPUT -> FREE', seq.join() === 'FREE,HYBRID,INPUT,FREE', seq.join());
    await q.eval('document.getElementById("mode").click()'); await q.sleep(100);
    check('the mode button cycles and says so', (await pose(q, 's.mode')) === 'HYBRID' && /HYBRID/.test(await q.eval('document.getElementById("mode").getAttribute("aria-label")')),
      await q.eval('document.getElementById("mode").getAttribute("aria-label")'));
    // switching while a key is held: HYBRID + key = MANUAL; M to INPUT keeps flying; M to FREE hands to AUTO at once
    await left(true); await q.sleep(300);
    const wasManual = (await pose(q, 's.pilot')) === 'MANUAL';
    await press('m', 'KeyM', 77);
    const inInput = (await pose(q, 's.mode')) === 'INPUT' && (await pose(q, 's.pilot')) === 'MANUAL';
    await press('m', 'KeyM', 77);
    const inFree = (await pose(q, 's.mode')) === 'FREE' && (await pose(q, 's.pilot')) === 'AUTO';
    await left(false);
    check('switching mode while a key is held', wasManual && inInput && inFree, JSON.stringify({ wasManual, inInput, inFree }));
    await q.goto(BASE.replace('?', '?mode=input&'), 300); await ready(q); await q.sleep(1500);
    const a0 = await pose(q, 's.heading'), al0 = await pose(q, 's.alt'); await q.sleep(3000);
    const drift = Math.abs(((await pose(q, 's.heading')) - a0 + 540) % 360 - 180), dAlt = Math.abs((await pose(q, 's.alt')) - al0);
    const b0 = await pose(q, 's.heading'); await left(true); await q.sleep(1000); await left(false);
    const turnedI = Math.abs(((await pose(q, 's.heading')) - b0 + 540) % 360 - 180);
    check('INPUT holds course', drift < 0.5 && dAlt < 0.05 && turnedI > 35, JSON.stringify({ drift, dAlt, turnedI }));
    check('modes: no JS errors', q.errors.length === 0, q.errors.join(' | '));
    q.close();
  }

  // the traffic: a close aircraft carries its W mark (the 3D models return with Phase 4 of the realism rebuild)
  if (want('traffic')) {
    const v = await launch({ width: 1440, height: 810, reduce: true });
    await v.goto(PAGE + '&near=1', 300); await ready(v); await v.sleep(300);
    const near = JSON.parse(await v.eval(`(() => { const s = SITE5.pose, c = s.contacts.find(c => c.near); return JSON.stringify({ id: c && c.id, w: SITE5.parts.wIds, lock: s.lockId }); })()`));
    check('a close aircraft carries its W mark', !!near.id && near.w.includes(near.id), JSON.stringify(near));
    check('traffic: no JS errors', v.errors.length === 0, v.errors.join(' | '));
    v.close();
  }

  // arcade controls (owner, 2026-10-07): the mouse steers, W/S throttle (it stays), Shift boosts, A/D bank into a
  // turn, Q/E yaw, a right-drag or C looks without steering; FREE ignores all of it
  if (want('controls')) {
    const k = await launch({ width: 1200, height: 700 });
    const key = (type, kk, code, vk, mods) => k.send('Input.dispatchKeyEvent', { type, key: kk, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 });
    const hold = async (kk, code, vk, ms, mods) => { await key('keyDown', kk, code, vk, mods); await k.sleep(ms); await key('keyUp', kk, code, vk, mods); };
    const turned = h0 => pose(k, 's.heading').then(h => ((h - h0 + 540) % 360) - 180);
    await k.goto('../site5/index.html?seed=7&mode=input', 300); await ready(k); await k.sleep(500);
    const sp0 = await pose(k, 's.speed');
    await hold('w', 'KeyW', 87, 1200);
    const spUp = await pose(k, 's.speed'); await k.sleep(1000); const spKept = await pose(k, 's.speed');
    check('W raises the throttle and it stays', spUp > sp0 + 0.08 && spKept > sp0 + 0.08, JSON.stringify([sp0, spUp, spKept]));
    await hold('s', 'KeyS', 83, 2500); await k.sleep(800);
    const spDown = await pose(k, 's.speed');
    check('S lowers it', spDown < sp0 - 0.05, JSON.stringify([sp0, spDown]));
    const spPre = await pose(k, 's.speed'); await key('keyDown', 'Shift', 'ShiftLeft', 16, 8); await k.sleep(1500); const spB = await pose(k, 's.speed'); const boosting = await pose(k, 's.boost'); const lever = await k.eval('SITE5.parts.controlsL.boost');
    await key('keyUp', 'Shift', 'ShiftLeft', 16); await k.sleep(2500); const spAfter = await pose(k, 's.speed');
    check("Shift boosts while held, the left ring's boost lever in", spB > spPre + 0.2 && boosting && lever > 0.5 && spAfter < spB - 0.15, JSON.stringify([spPre, spB, boosting, lever, spAfter]));
    check('the HUD shows the speed', /KM\/H/.test(await k.eval('SITE5.parts.speedText || ""')), await k.eval('SITE5.parts.speedText || ""'));
    check('the left ring\'s throttle follows it', Math.abs((await k.eval('SITE5.parts.controlsL.twist')) - (await pose(k, 's.throttle'))) < 0.15,
      JSON.stringify([await k.eval('SITE5.parts.controlsL.twist'), await pose(k, 's.throttle')]));
    // the mouse at the centre doesn't steer; at the right it turns right
    await k.mouse('mouseMoved', 600, 350); await k.sleep(600);
    let h0 = await pose(k, 's.heading'); await k.sleep(1000);
    const still = Math.abs(await turned(h0));
    await k.mouse('mouseMoved', 1120, 350); await k.sleep(200); h0 = await pose(k, 's.heading'); await k.sleep(1500);
    const right = await turned(h0);
    await k.mouse('mouseMoved', 600, 350); await k.sleep(800);
    check('the mouse steers: centre holds, right turns right', still < 2 && right > 20, JSON.stringify({ still, right }));
    // a right-drag looks round without steering
    h0 = await pose(k, 's.heading');
    await k.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 350, button: 'right', buttons: 2, clickCount: 1 });
    for (let i = 1; i <= 10; i++) await k.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600 + i * 45, y: 350, button: 'right', buttons: 2 });
    const look = await pose(k, 's.head.yaw'), during = Math.abs(await turned(h0));
    await k.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1050, y: 350, button: 'right', buttons: 0, clickCount: 1 });
    await k.mouse('mouseMoved', 600, 350);
    check('a right-drag looks without steering', Math.abs(look) > 20 && during < 3, JSON.stringify({ look, during }));
    h0 = await pose(k, 's.heading'); await hold('d', 'KeyD', 68, 1000); const dTurn = await turned(h0);
    await k.sleep(600); h0 = await pose(k, 's.heading'); await hold('e', 'KeyE', 69, 1000); const eTurn = await turned(h0);
    check('D banks into a right turn, E yaws right more gently', dTurn > 30 && eTurn > 8 && eTurn < dTurn, JSON.stringify({ dTurn, eTurn }));
    await k.goto('../site5/index.html?seed=7&mode=free', 300); await ready(k); await k.sleep(500);
    await k.mouse('mouseMoved', 1150, 350); let auto = true;
    for (let i = 0; i < 8; i++) { await k.sleep(100); if ((await pose(k, 's.pilot')) !== 'AUTO') auto = false; }
    const thr0 = await pose(k, 's.throttle'); await hold('w', 'KeyW', 87, 600);
    check('FREE: the mouse and throttle do nothing', auto && (await pose(k, 's.throttle')) === thr0, JSON.stringify({ auto, thr0 }));
    check('controls: no JS errors', k.errors.length === 0, k.errors.join(' | '));
    k.close();
  }

  // the horizon dips with altitude as the real Earth's does; W marks only on aircraft within range
  if (want('horizon')) {
    const e = await launch({ width: 1440, height: 810, reduce: true });
    await e.goto(PAGE, 300); await ready(e);
    const dip11 = Math.acos(6371 / 6382) * 180 / Math.PI;
    check('the horizon dip matches the Earth', Math.abs((await e.eval('SITE5.horizonDip(11)')) - dip11) < 0.05, String(await e.eval('SITE5.horizonDip(11)')) + ' vs ' + dip11.toFixed(2));
    const wm = JSON.parse(await e.eval(`(() => { const s = SITE5.pose, m = SITE5.m, R = SITE5.W_RANGE, w = SITE5.parts.wIds;
      const inView = s.contacts.filter(c => c.range <= R && SITE5.project(m.qrot(m.qconj(s.suitQ), c.d))).map(c => c.id);
      return JSON.stringify({ R, w, inView, far: s.contacts.filter(c => w.includes(c.id) && c.range > R).length }); })()`));
    check('W marks only within range', wm.R === 30 && wm.far === 0 && wm.inView.every(id => wm.w.includes(id)), JSON.stringify(wm));
    check('horizon: no JS errors', e.errors.length === 0, e.errors.join(' | '));
    e.close();
  }

  // the world in Three.js + Takram, through the ball (the realism rebuild)
  if (want('world')) {
    const v = await launch({ width: 1440, height: 810, reduce: true });
    const worldUp = async () => { for (let i = 0; i < 120 && !(await v.eval('!!(SITE5.world && SITE5.world.ready)')); i++) await v.sleep(500); };
    await v.goto('../site5/index.html?seed=7&traffic=0', 300); await ready(v); await worldUp(); await v.sleep(1500);
    check('the world is up', await v.eval('!!(SITE5.world && SITE5.world.ready)') && v.errors.length === 0, v.errors.join(' | '));
    // WGS84 geodetic -> ECEF (m), and the eye's forward in ECEF, worked out here independently of sky.js
    const cam = JSON.parse(await v.eval(`(() => { const s = SITE5.pose, m = SITE5.m, D = Math.PI / 180, a = 6378137, e2 = 6.69437999014e-3;
      const la = s.geo[0] * D, lo = s.geo[1] * D, h = s.alt * 1000, N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
      const P = [(N + h) * Math.cos(la) * Math.cos(lo), (N + h) * Math.cos(la) * Math.sin(lo), (N * (1 - e2) + h) * Math.sin(la)];
      const E = [-Math.sin(lo), Math.cos(lo), 0], U = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], Nn = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
      const f = m.qrot(s.suitQ, m.qrot(s.eyeQ, [0, 0, 1])), F = [0, 1, 2].map(i => E[i] * f[0] + U[i] * f[1] + Nn[i] * f[2]);
      const c = SITE5.world.camera, d = c.getWorldDirection(new c.position.constructor());
      return JSON.stringify({ off: Math.hypot(c.position.x - P[0], c.position.y - P[1], c.position.z - P[2]), ang: Math.acos(Math.min(1, d.x * F[0] + d.y * F[1] + d.z * F[2])) / D }); })()`));
    check('the camera is at the suit', cam.off < 50, cam.off.toFixed(1) + ' m');
    check('the camera looks where the eye looks', cam.ang < 0.5, cam.ang.toFixed(3) + ' deg');
    const cw = JSON.parse(await v.eval('JSON.stringify(SITE5.warp(innerWidth / 2, innerHeight / 2))'));
    check('the centre maps to the centre', !!cw && Math.abs(cw[0] - 0.5) < 0.02 && Math.abs(cw[1] - 0.5) < 0.02, JSON.stringify(cw));
    // a pixel of the world canvas, read straight after it's drawn
    const px = (x, y) => inFrame(v, ` const g = SITE5.gl, k = g.drawingBufferWidth / innerWidth, o = new Uint8Array(4);
      g.readPixels(Math.round(${x} * k), Math.round(g.drawingBufferHeight - ${y} * k), 1, 1, g.RGBA, g.UNSIGNED_BYTE, o); r(Array.from(o.slice(0, 3))); `, [NaN, NaN, NaN]);
    // the seams: a point midway between two neighbouring panel centres lies on a seam; it's lighter than a panel's middle
    const sp = JSON.parse(await v.eval(`(() => { const c = SITE5.panels.cells, m = SITE5.m, P = SITE5.project, near = [0, 0, 1];
      let best = null; for (const a of c) for (const b of c) { if (a === b) continue; const d = m.dot(a, b); if (d < 0.99 && d > 0.7) { const mid = m.norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
        const sa = P(a), sm = P(mid); if (sa && sm && Math.abs(sm[0] - innerWidth / 2) < 400 && Math.abs(sm[1] - innerHeight / 2) < 250 && (!best || d > best.d)) best = { d, sa, sm }; } }
      return JSON.stringify(best); })()`));
    const hudA = (x, y) => v.eval(`(() => { const c = document.getElementById('hud'), k = c.width / innerWidth; return c.getContext('2d').getImageData(Math.round(${x} * k), Math.round(${y} * k), 1, 1).data[3]; })()`);
    const onSeam = sp && await hudA(sp.sm[0], sp.sm[1]), inPanel = sp && await hudA(sp.sa[0], sp.sa[1]);
    check('the seams draw', !!sp && onSeam > inPanel + 25, JSON.stringify({ onSeam, inPanel }));
    await v.mouse('mousePressed', 700, 400, 1); for (let k = 1; k <= 20; k++) await v.mouse('mouseMoved', 700 - 50 * k, 400, 1);
    await v.sleep(300);
    // (at dusk much of the view is truly black, so these check the warp reaches inside the picture, not brightness)
    const inPic = uv => !!uv && uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1;
    const back = JSON.parse(await v.eval('JSON.stringify([SITE5.warp(innerWidth / 2, innerHeight / 2), SITE5.warp(5, 5), SITE5.warp(innerWidth - 5, innerHeight - 5)])'));
    await v.mouse('mouseReleased', 0, 400);
    check('looking back still shows the world', back.every(inPic) && Math.abs(await pose(v, 's.head.yaw')) > 120, JSON.stringify(back));
    await v.size(375, 812); await v.sleep(1500);
    const corners = JSON.parse(await v.eval('JSON.stringify([[5, 5], [370, 5], [5, 807], [370, 807]].map(([x, y]) => SITE5.warp(x, y)))'));
    check('a resize keeps the picture filling the screen', corners.every(inPic) && (await v.eval('SITE5.world.camera.aspect')) < 1, JSON.stringify(corners));
    await v.size(1440, 810); await v.sleep(3000);
    check('the world holds its frame time (avg under 33ms)', (await v.eval('SITE5.frameMs')) < 33, (await v.eval('SITE5.frameMs')).toFixed(1) + 'ms');
    check('world: no JS errors', v.errors.length === 0, v.errors.join(' | '));
    v.close();
  }

  // the world's light and clouds: dusk glows in the west; the volumetric clouds load; on a moonless night the cities
  // still show; a world whose libraries can't load says so, and the cockpit still works
  if (want('light')) {
    const v = await launch({ width: 1440, height: 810, reduce: true });
    const wait = async (expr, n = 120) => { for (let i = 0; i < n && !(await v.eval(expr)); i++) await v.sleep(500); return v.eval(expr); };
    await v.goto('../site5/index.html?seed=7&traffic=0&clouds=1', 300); await ready(v);   // (the clouds are off unless asked for)
    const clouds = await wait('!!(SITE5.world && SITE5.world.cloudsReady)'); await v.sleep(2500);
    check('clouds draw', clouds, JSON.stringify(await v.eval('SITE5.world && SITE5.world.loads')));
    const best = JSON.parse(await inFrame(v, ` const g = SITE5.gl, w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(4 * h);
      g.readPixels(w >> 1, 0, 1, h, g.RGBA, g.UNSIGNED_BYTE, px); let b = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > b[0] + b[1] + b[2]) b = [px[i], px[i + 1], px[i + 2]]; r(JSON.stringify(b)); `, '["no frame"]'));
    check('the sky is lit at dusk, warm in the west', best[0] > 60 && best[0] > best[2], JSON.stringify(best));
    check('the loading readout goes once the world is in', await v.eval('document.getElementById("loading").hidden'));
    await v.goto('../site5/index.html?seed=7&traffic=0', 300); await ready(v);
    check('the clouds are off by default', !(await v.eval('SITE5.world.cloudsReady || SITE5.envClouds')));
    // the monitor meters its picture like a camera: deep in the twilight (the default start, sun -6.7 deg) it opens
    // up instead of showing black
    await wait('SITE5.world.exposure > 30', 30); await v.sleep(6000);   // it adapts over a few seconds, as an eye does
    const dim = await inFrame(v, ` const g = SITE5.gl, w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(4 * w * h);
      g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px); let s = 0, n = 0; for (let i = 0; i < px.length; i += 4 * 97) { s += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; n++; } r(s / n); `, NaN);
    check('deep twilight is visible, not black: the monitor opens up', dim > 0.05, (dim * 100).toFixed(1) + '% mean, exposure ' + (await v.eval('SITE5.world.exposure')).toFixed(0));
    await v.goto('../site5/index.html?seed=7&traffic=0&lat=40.85&lon=14.27&time=2026-10-08T22:00:00Z', 300); await ready(v);
    await v.sleep(2500);
    await v.mouse('mousePressed', 720, 760, 1); for (let y = 760; y >= 300; y -= 20) await v.mouse('mouseMoved', 720, y, 1);
    await v.sleep(1500);
    const warm = await inFrame(v, ` const g = SITE5.gl, w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(4 * w * h);
      g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px); let n = 0; for (let i = 0; i < px.length; i += 4 * 9) if (px[i] > 40 && px[i] - px[i + 2] > 20) n++; r(n / (px.length / 36)); `, NaN);
    await v.mouse('mouseReleased', 720, 300);
    check('a moonless night still shows the cities', warm > 0.002, (warm * 100).toFixed(2) + '% warm');
    check('light and clouds: no JS errors', v.errors.length === 0, v.errors.join(' | '));
    v.close();
    const z = await launch({ width: 1200, height: 700 });
    await z.send('Network.enable'); await z.send('Network.setBlockedURLs', { urls: ['*esm.sh*'] });
    await z.goto('../site5/index.html?seed=7', 300); await z.sleep(4000);
    const txt = await z.eval('document.getElementById("loading").textContent');
    const hud = await z.eval(`(() => { const c = document.getElementById('hud'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i]) n++; return n; })()`);
    check('a world that fails to load says so', /COULDN/.test(txt) && hud > 200, JSON.stringify({ txt, hud }));
    z.close();
  }

  // ---- the 3D Earth ----
  if (want('3d')) {
    const KEY = require('fs').existsSync(require('path').join(__dirname, '../js/keys.js'));
    const skip = n => console.log('SKIP ' + n + ' (no key)');
    const t = await launch({ width: 1280, height: 720 });
    if (KEY) {
      await t.goto('../site5/index.html?seed=7', 300); await ready(t);
      for (let i = 0; i < 80 && !(await t.eval('SITE5.world.tiles.loaded > 20')); i++) await t.sleep(250);
      check('the 3D Earth streams in', await t.eval('SITE5.world.tiles.on && SITE5.world.tiles.loaded > 20 && !SITE5.world.tiles.failed'), JSON.stringify(await t.eval('SITE5.world.tiles')));
      await t.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true }); await t.sleep(3000);
      check('after a resize the tiles keep loading, no errors', (await t.eval('SITE5.world.tiles.loaded')) > 20 && t.errors.length === 0, t.errors.join(' | '));
      await t.send('Emulation.clearDeviceMetricsOverride', {});
      // the terrain: Mont Blanc stands, the suit can't fly into it, and the cities glow on the tiles at night
      await t.goto('../site5/index.html?seed=7&lat=45.8326&lon=6.8652&alt=8&hdg=0&time=2026-10-08T11:00:00Z', 300); await ready(t);
      for (let i = 0; i < 120 && !((await t.eval('SITE5.world.heightAt(45.8326, 6.8652)')) > 3500); i++) await t.sleep(250);
      const mb = await t.eval('SITE5.world.heightAt(45.8326, 6.8652)');
      check('it\'s 3D: Mont Blanc stands over 3500 m', mb > 3500, String(mb));
      await t.goto('../site5/index.html?seed=7&lat=45.8326&lon=6.8652&alt=1&hdg=0&throttle=0&time=2026-10-08T11:00:00Z', 300); await ready(t); await t.sleep(6000);
      const alt = await t.eval('SITE5.pose.alt'), ground = await t.eval('SITE5.world.heightAt(SITE5.pose.geo[0], SITE5.pose.geo[1])');
      check('the suit stays above the mountains (floor = terrain + 0.3 km)', ground === null || alt >= ground / 1000 + 0.29, alt.toFixed(2) + ' km over ' + ground);
      await t.goto('../site5/index.html?seed=7&traffic=0&lat=40.85&lon=14.27&alt=10&time=2026-10-08T22:00:00Z', 300); await ready(t);
      for (let i = 0; i < 80 && !(await t.eval('SITE5.world.tiles.loaded > 20')); i++) await t.sleep(250);
      await t.mouse('mousePressed', 640, 700, 1); for (let y = 700; y >= 250; y -= 20) await t.mouse('mouseMoved', 640, y, 1); await t.sleep(2500);
      const warm = await inFrame(t, ` const g = SITE5.gl, w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(4 * w * h);
        g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px); let n = 0; for (let i = 0; i < px.length; i += 4 * 9) if (px[i] > 40 && px[i] - px[i + 2] > 20) n++; r(n / (px.length / 36)); `, NaN);
      await t.mouse('mouseReleased', 640, 250);
      check('the cities glow on the 3D Earth at night', warm > 0.2, (warm * 100).toFixed(2) + '% warm');
      await t.goto('../site5/index.html?seed=7', 300); await ready(t); await t.sleep(4000);
      check("Google's attribution shows with the tiles", /google/i.test(await t.eval('document.getElementById("attrib").textContent')), await t.eval('document.getElementById("attrib").textContent'));
      // (ion's required credits: both logos, the Google one once, the ion one inside its link, and only the links take the mouse)
      check("the Google and Cesium ion logos show, linked and sized", await t.eval('(() => { const q = s => document.querySelectorAll("#attrib " + s); const g = q("img[alt=Google]"), c = q("a[href=\\"https://cesium.com\\"] img[alt=\\"Cesium ion\\"]"); return g.length === 1 && c.length === 1 && q("a[href=\\"https://cesium.com/pricing/\\"]").length === 1 && g[0].height === 14 && getComputedStyle(document.getElementById("attrib")).pointerEvents === "none" && getComputedStyle(c[0].parentNode).pointerEvents === "auto"; })()'), await t.eval('document.getElementById("attrib").innerHTML.length'));
      await t.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true }); await t.sleep(800);
      check('the full credit fits a 375 px phone', await t.eval('(() => { const a = document.getElementById("attrib").getBoundingClientRect(); return a.width > 0 && a.left >= 0 && a.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()'));
      await t.send('Emulation.clearDeviceMetricsOverride', {});
      await t.goto('../site5/index.html?seed=7&mode=input&throttle=1', 300); await ready(t);
      await t.sleep(3000); const mem0 = await t.eval('SITE5.world.renderer.info.memory.textures');
      await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 }); await t.sleep(30000);
      await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
      check('a long fast flight: frames hold, no errors', (await t.eval('SITE5.frameMs')) < 12 && t.errors.length === 0, (await t.eval('SITE5.frameMs')).toFixed(1) + 'ms ' + t.errors.join(' | '));
      // (the tiles' GPU memory is freed as they leave: the texture count at the end of the flight stays under 3x the start's, or an absolute 1500)
      const mem1 = await t.eval('SITE5.world.renderer.info.memory.textures');
      check('a long fast flight: GPU textures stay bounded', mem1 < Math.max(3 * mem0, 1500), mem0 + ' -> ' + mem1);
      await t.goto('../site5/index.html?seed=7&tilestoken=bad', 300); await ready(t); await t.sleep(4000);
      check('a bad key says so and the flat Earth flies on', (await t.eval('document.getElementById("loading").textContent')).includes("THE 3D EARTH COULDN'T LOAD") && await t.eval('SITE5.world.tiles.failed && SITE5.frames > 30'));
    } else ['the 3D Earth streams in', 'after a resize the tiles keep loading, no errors', 'it\'s 3D: Mont Blanc stands over 3500 m',
      'the suit stays above the mountains (floor = terrain + 0.3 km)', 'the cities glow on the 3D Earth at night',
      "Google's attribution shows with the tiles", 'the Google and Cesium ion logos show, linked and sized', 'the full credit fits a 375 px phone', 'a long fast flight: frames hold, no errors', 'a long fast flight: GPU textures stay bounded', 'a bad key says so and the flat Earth flies on'].forEach(skip);
    await t.goto('../site5/index.html?seed=7&tiles=0', 300); await ready(t); await t.sleep(1500);
    check('?tiles=0: the flat Earth, no tiles, no errors', await t.eval('SITE5.world.tiles.on === false && SITE5.world.heightAt(46, 8) === null') && t.errors.length === 0, t.errors.join(' | '));
    t.close();
  }

  // ---- the monitor capture ----
  if (want('capture')) {
    const p = await launch({ width: 1440, height: 900 });
    await p.goto(PAGE, 300); await ready(p);
    const n0 = await p.eval('SITE5.env ? SITE5.env.n : -1'); await p.sleep(2000);
    const env = JSON.parse(await p.eval('JSON.stringify(SITE5.env ? { n: SITE5.env.n, size: SITE5.env.size, faces: SITE5.env.faces.length, len: SITE5.env.faces[0].length } : null)'));
    check('the monitor is captured: 6 faces of 64x64, refreshing', env && env.size === 64 && env.faces === 6 && env.len === 64 * 64 * 4 && env.n - n0 >= 3, JSON.stringify(env) + ' from ' + n0);
    const faceMean = k => k.eval('(() => { if (!SITE5.env) return 0; let s = 0; for (const f of SITE5.env.faces) for (let i = 0; i < f.length; i += 4) s += f[i] + f[i + 1] + f[i + 2]; return s / (6 * 64 * 64 * 3 * 255); })()');
    // day vs night: the capture is the displayed picture, so day is far brighter
    await p.goto('../site5/index.html?seed=7&alt=18&hdg=90&time=2026-10-08T11:00:00Z', 300); await ready(p); await p.sleep(1500); const day = await faceMean(p);
    await p.goto('../site5/index.html?seed=7&alt=18&hdg=90&time=2026-10-08T22:00:00Z', 300); await ready(p); await p.sleep(1500); const night = await faceMean(p);
    check('the capture follows the world: day brighter than night', day > night * 3 && day > 0.15, day.toFixed(3) + ' vs ' + night.toFixed(3));
    // resize keeps the main picture's size (the capture composer mustn't resize the renderer)
    await p.goto('../site5/index.html?seed=7&alt=18&hdg=90&time=2026-10-08T11:00:00Z', 300); await ready(p);
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false }); await p.sleep(800);
    check('after a resize the world picture is full size, not the capture\'s', await p.eval('SITE5.gl.drawingBufferWidth > 400 && SITE5.gl.drawingBufferHeight > 280'), await p.eval('SITE5.gl.drawingBufferWidth + "x" + SITE5.gl.drawingBufferHeight'));
    await p.send('Emulation.clearDeviceMetricsOverride', {});
    check('the monitor capture: no JS errors', p.errors.length === 0, p.errors.join(' | '));
    p.close();
  }

  // ---- the seat's light ----
  if (want('seatlight')) {
    const p = await launch({ width: 1440, height: 900 });
    await p.goto(PAGE, 300); await ready(p); for (let i = 0; i < 80 && !(await p.eval('SITE5.seat.ready')); i++) await p.sleep(250);
    check('the seat comes from seat.glb', await p.eval('SITE5.seat.source === "glb" && SITE5.parts.seatAO === true'));
    // the seat's own pixels (alpha > 0), read in a frame: mean luminance overall, in the left and right thirds, mean r and b
    const seatStats = k => inFrame(k, ` const g = SITE5.seatGL, w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(4 * w * h);
      g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px); const s = { n: 0, lum: 0, r: 0, b: 0, nl: 0, l: 0, nr: 0, rr: 0 };
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const i = 4 * (y * w + x), a = px[i + 3]; if (a < 250) continue;
        const L = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; s.n++; s.lum += L; s.r += px[i] / 255; s.b += px[i + 2] / 255;
        if (x < w / 3) { s.nl++; s.l += L } else if (x > 2 * w / 3) { s.nr++; s.rr += L } }
      r({ n: s.n, lum: s.lum / s.n, r: s.r / s.n, b: s.b / s.n, left: s.l / s.nl, right: s.rr / s.nr }); `, { n: 0 })
      .then(st => { for (const f of ['lum', 'r', 'b', 'left', 'right']) if (typeof st[f] !== 'number') st[f] = NaN; return st; });   // (no seat pixels: NaN, so the checks FAIL)
    const lookDown = async k => { await k.mouse('mousePressed', 700, 650, 1); for (let j = 1; j <= 8; j++) await k.mouse('mouseMoved', 700, 650 - 40 * j, 1); await k.mouse('mouseReleased', 700, 330); await k.sleep(1500); };
    const at = async (q) => { await p.goto('../site5/index.html?seed=7&alt=18&' + q, 300); await ready(p); await lookDown(p); return seatStats(p); };
    check('the seat is on Three.js', await p.eval('SITE5.seat && SITE5.seat.ready === true && SITE5.seat.source === "glb"'));
    await p.goto(PAGE + '&seat=nope', 300); await ready(p); await p.sleep(2000);
    check('a missing seat says so and the flight runs on, rings drawn', (await p.eval('document.getElementById("loading").textContent')).includes("THE SEAT COULDN'T LOAD") && (await p.eval('SITE5.frames')) > 30
      && (await p.eval('SITE5.seat.source === "none" && SITE5.parts.ringGroups.length === 2')),
      await p.eval('document.getElementById("loading").textContent'));
    const noon = await at('hdg=90&time=2026-10-08T11:00:00Z'), late = await at('hdg=90&time=2026-10-08T22:00:00Z');
    check('the seat is lit by the monitor: noon at least 3x night', noon.lum > 3 * late.lum, noon.lum.toFixed(3) + ' vs ' + late.lum.toFixed(3));
    // looking down, the left third is mostly the left armrest's inner walls (they face +x) and the right third the right
    // one's (facing -x): a sun to the right lights the left third, a sun to the left the right third
    const sunR = await at('hdg=224&time=2026-10-08T16:50:00Z'), sunL = await at('hdg=304&time=2026-10-08T16:50:00Z'), ratio = s => s.left / s.right;
    check('the seat\'s lit side follows the sun on the monitor', ratio(sunR) > ratio(sunL), 'left/right ' + ratio(sunR).toFixed(3) + ' (sun right) vs ' + ratio(sunL).toFixed(3) + ' (sun left)');
    const dusk = await at('hdg=262&time=2026-10-08T16:50:00Z');
    check('facing a sunset the seat is warm', dusk.r > dusk.b, dusk.r.toFixed(3) + ' r vs ' + dusk.b.toFixed(3) + ' b');
    // orientation, with a synthetic monitor: only the seat's right (+x) face white
    await p.goto(PAGE, 300); await ready(p); await lookDown(p);
    await p.eval(`(() => { SITE5.envFreeze = true; const f = i => new Uint8Array(64 * 64 * 4).map((_, j) => j % 4 === 3 ? 255 : (i === 0 ? 255 : 0)); SITE5.env = { n: 1e6, size: 64, faces: [0, 1, 2, 3, 4, 5].map(f) }; })()`);
    await p.sleep(500); const side = await seatStats(p);
    // (looking down, the left third is the left armrest's inner walls, which face +x)
    check('a white right-hand monitor lights the surfaces facing right (the left armrest\'s inner walls)', side.left > 1.5 * side.right, side.left.toFixed(3) + ' vs ' + side.right.toFixed(3));
    // before any capture the seat is a dim grey, never black
    await p.goto(PAGE + '&capture=0', 300); await ready(p); await lookDown(p); const none = await seatStats(p);
    check('with no capture the seat still shows (dim, not black)', none.n > 1000 && none.lum > 0.01, JSON.stringify(none));
    check('the seat\'s light: no JS errors', p.errors.length === 0, p.errors.join(' | '));
    p.close();
    // the budget, at 1280x720
    const q = await launch({ width: 1280, height: 720 }); await q.goto(PAGE, 300); await ready(q); await q.sleep(3000);
    check('frames hold up with the seat lit (under 12 ms)', (await q.eval('SITE5.frameMs')) < 12, (await q.eval('SITE5.frameMs')).toFixed(1) + 'ms'); await q.close();
  }

  // reduced motion: no auto flight, no sway
  if (want('reduce')) {
    const r = await launch({ width: 1440, height: 810, reduce: true });   // 16:9, as the reference frame
    await r.goto(PAGE, 300); await ready(r);
    const h0 = await pose(r, 's.heading'), e0 = await pose(r, 'JSON.stringify(s.eye)');
    await r.sleep(2000);
    check('reduced motion: the suit holds still', Math.abs((await pose(r, 's.heading')) - h0) < 0.01 && (await pose(r, 'JSON.stringify(s.eye)')) === e0);
    const r0 = JSON.parse(await r.eval('JSON.stringify(SITE5.parts.cluster)'));
    check('reduced motion: the radar arm is parked and the dashes and cells hold', r0.radarArm === 0 && r0.dash === 0 && r0.cells === JSON.parse(await r.eval('JSON.stringify(SITE5.parts.cluster)')).cells, JSON.stringify([r0.radarArm, r0.dash]));
    check('reduced motion: the sight does not sway', (await r.eval('JSON.stringify(SITE5.parts.sightSway)')) === '[0,0,0]', await r.eval('JSON.stringify(SITE5.parts.sightSway)'));
    const rn0 = await r.eval('SITE5.env ? SITE5.env.n : -1'); await r.sleep(1500); const rn1 = await r.eval('SITE5.env ? SITE5.env.n : -1');
    check('reduced motion: the monitor capture still refreshes', rn1 - rn0 >= 2, rn0 + ' -> ' + rn1);
    // the triangle sits in front of the eyes (near the screen's centre), the rail and the cluster below it, and
    // the rulers still where the owner's front frame has them (scaled to the current view width)
    const sc = JSON.parse(await r.eval("JSON.stringify(Object.fromEntries(Object.entries(SITE5.anchors).map(([k, v]) => { const s = SITE5.project(v); return [k, s ? [s[0] / innerWidth * 100, s[1] / innerHeight * 100] : null]; })))"));
    check('the triangle is in front of the eyes', Math.abs(sc.nose[0] - 50) < 1 && Math.abs(sc.nose[1] - 50) < 3, JSON.stringify(sc.nose));
    check('the rail and the cluster sit below the triangle', sc.capL[1] > sc.apex[1] + 4 && sc.cluster[1] > sc.apex[1] + 8, JSON.stringify({ apex: sc.apex, cap: sc.capL, cluster: sc.cluster }));
    const k = await r.eval('SITE5.camRef / SITE5.cam.tx');
    // (since the eye moved to 0.2 behind the ball's centre, 2026-10-08, the HUD sits ~17% further out than the measured frame)
    check('the rulers sit in their band, left of the sight', sc.rulerL[0] > 20 && sc.rulerL[0] < 40, sc.rulerL[0].toFixed(1) + '%');
    // each of the rail's lines ends on its cap's edge at its own height, the same on both sides (px off the outline)
    const railFit = JSON.parse(await r.eval(`(() => { const P = SITE5.project, pr = SITE5.parts;
      const seg = (q, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy); };
      const off = (pt, dia) => { const q = P(pt), d = dia.map(P); return Math.min(...d.map((a, i) => seg(q, a, d[(i + 1) % 4]))); };
      return JSON.stringify(pr.railEnds.map(([rt, lf]) => [off(lf, pr.capDia[0]), off(rt, pr.capDia[1])].map(v => +v.toFixed(2)))); })()`));
    check('the rail meets both caps: every line ends on the cap\'s edge', railFit.length === 4 && railFit.every(s => s.every(v => v < 1)), JSON.stringify(railFit));
    const tk = JSON.parse(await r.eval('JSON.stringify(SITE5.parts.railTicks || null)'));
    check('the rail\'s ticks sit evenly between the caps', !!tk && Math.abs(tk[0] + tk[1] - 360) < 0.01, JSON.stringify(tk));
    r.close();
  }

  // phones
  if (want('phone')) {
    const m = await launch({ width: 375, height: 812 });
    await m.goto(PAGE, 300); await ready(m);
    check('phone: no h-overflow', await m.eval('document.documentElement.scrollWidth <= innerWidth'));
    check('phone: draws', await m.eval('!!SITE5.gl') && m.errors.length === 0, m.errors.join(' | '));
    const ed = await m.eval('JSON.stringify(SITE5.parts.cluster.edges)');
    check('phone: the whole cluster fits across the screen', JSON.parse(ed)[0] >= 4 && JSON.parse(ed)[1] <= 371, ed);
    await m.mouse('mousePressed', 187, 650, 1); for (let k = 1; k <= 8; k++) await m.mouse('mouseMoved', 187, 650 - 40 * k, 1); await m.mouse('mouseReleased', 187, 330);
    await m.sleep(200);
    check('phone: looking down shows the rails and grips', await m.eval('SITE5.parts.seat.grip > 4 && SITE5.parts.seat.rail > 4'), JSON.stringify(await m.eval('SITE5.parts.seat')));
    // (a long credit is put in first, so an empty element can't pass: the tiles' own credit needs a key)
    check('phone: the attribution fits', await m.eval('(() => { const e = document.getElementById("attrib"); e.textContent = "Google; Data SIO, NOAA, U.S. Navy, NGA, GEBCO; IBCAO; Landsat / Copernicus · Airbus"; const a = e.getBoundingClientRect(); return a.width > 0 && a.right <= innerWidth && a.width < innerWidth; })()'));
    m.close();
  }
  srv.close();
})().catch(e => { check('the run finishes', false, e && e.stack); process.exit(1); });
