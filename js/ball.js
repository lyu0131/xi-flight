/* ball.js: the cockpit's model and motion. Everything renders from one pose, built here each frame:
     world -> suit (attitude) -> ball (the panoramic monitor, a unit sphere rigid with the suit)
           -> seat (hung inside the ball on a spring) -> the pilot's eye (seat + head look).
   Frames are x right, y up, z forward; angles in degrees unless named *Rad.
   The suit flies in km over the Earth, among air traffic (traffic.js): on its own (AUTO) it cruises from one
   aircraft to the next, closing on each until it has held a lock a while. Arrows/WASD take it (MANUAL) and it
   hands back 4s after the last key.
   Controls, arcade style (owner, 2026-10-07): the mouse steers (its offset from the centre of the screen sets the
   turn and climb, past a small dead zone; the cursor is hidden over the view), W/S set the throttle (it stays; 0 is a
   standstill, and the flight starts there), Shift boosts while held, A/D bank into a turn, Q/E yaw gently, the arrows
   are a stick too. No looking round by dragging and no pause (owner, 2026-10-09).
   Three modes (M, or the MODE button): FREE watches (AUTO only, the keys don't fly), HYBRID shares (as above),
   INPUT is yours (the keys only; let go and it holds heading and altitude).
   The HUD is painted on the ball, so it only moves on screen when the eye moves against the ball. The
   pilot's head therefore leads every move -- looks up into a climb, into a turn -- on a spring that lags
   a beat and overshoots (as in the FPV clip, where the whole HUD drops as the pilot looks up), and the
   mouse steers the gaze a few degrees.
   sky.js, hud.js and seat.js register in SITE5.renderers and draw from the pose. The only global is SITE5. */
(function () {
  'use strict';
  var D = Math.PI / 180;
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---- quaternions, [x, y, z, w] ----
  function qmul(a, b) {
    return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  }
  function qaxis(x, y, z, a) { var s = Math.sin(a / 2); return [x * s, y * s, z * s, Math.cos(a / 2)]; }
  function qconj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
  function qrot(q, v) {
    var ux = q[0], uy = q[1], uz = q[2], w = q[3];
    var cx = uy * v[2] - uz * v[1], cy = uz * v[0] - ux * v[2], cz = ux * v[1] - uy * v[0];
    return [v[0] + 2 * (w * cx + uy * cz - uz * cy), v[1] + 2 * (w * cy + uz * cx - ux * cz), v[2] + 2 * (w * cz + ux * cy - uy * cx)];
  }
  // yaw right +, pitch up +, bank right + (right side down)
  function euler(yaw, pitch, bank) {
    return qmul(qmul(qaxis(0, 1, 0, yaw * D), qaxis(1, 0, 0, -pitch * D)), qaxis(0, 0, 1, -bank * D));
  }
  function dir(az, el) { return [Math.cos(el * D) * Math.sin(az * D), Math.sin(el * D), Math.cos(el * D) * Math.cos(az * D)]; }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function wrap(a) { return ((a % 360) + 540) % 360 - 180; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  // a damped spring {x, v} toward a target
  function spring(s, target, w, z, dt) { s.v += (w * w * (target - s.x) - 2 * z * w * s.v) * dt; s.x += s.v * dt; }

  var look = (/[?&]look=(mix|xi|penelope)\b/.exec(location.search) || [])[1] || 'mix';
  var S = window.SITE5 = {
    m: { qmul: qmul, qconj: qconj, qrot: qrot, euler: euler, dir: dir, norm: norm, dot: dot, wrap: wrap, clamp: clamp, D: D },
    look: look, reduce: reduce, renderers: [], pose: null, frames: 0
  };


  // ---- state ----
  // the clock (reduced motion holds it at 2s and never flies); ?seed= picks the sky, ?alt= the height (km),
  // ?traffic=0 empties it
  var T = reduce ? 2 : 0;
  var qs = function (k, d) { var m = new RegExp('[?&]' + k + '=(-?[\\d.]+)').exec(location.search); return m ? +m[1] : d; };
  // where on the real Earth the flight starts (?lat= ?lon=): over the hills east of Naples at dusk, heading west
  // (?hdg=, below) with the city's lights and the sunset ahead (owner, 2026-10-08: "let me see the city")
  var LAT0 = qs('lat', 40.92), LON0 = qs('lon', 14.95);
  // the real Earth, at real scale (the realism rebuild, 2026-10-08: CesiumJS draws it). Everything that needs its
  // size reads SITE5.RE. The suit's place on it (lat, lon) is integrated from its velocity; pos stays a flat km
  // frame round the start, for the traffic.
  var RE = S.RE = 6371, KM_DEG = RE * D;   // km of ground per degree of latitude
  var lat = LAT0, lon = LON0;
  var SEED = qs('seed', 1), TRAFFIC = qs('traffic', 1), ALT_LO = 1, ALT_HI = 1000, ALT0 = 400, tr = null, floor = ALT_LO, floorT = -1e9;   // low orbit's height by default, 1000 km the ceiling (owner, 2026-10-08)
  // speed: the throttle (0..1) sets it between SPD_LO and SPD_HI km/s; a boost adds BOOST while held; the actual
  // speed follows on a lag. 0-40 km/s, boost +20; the flight starts standing still, W to go (owner, 2026-10-09).
  // ?throttle= sets the start. (A touch screen has no W: there it starts at 0.2, 8 km/s.)
  // (chasing an aircraft the autopilot keeps the throttle's speed until it's close, then slows as it closes in:
  // (range - 8 km) x 0.4 a second (20 km: 4.8 km/s, 12 km: 1.6, 9 km: 0.5), never under CHASE_SPD nor over the
  // throttle's speed: the throttle's range, 5x the old one, raced past them
  // faster than a lock could hold, owner 2026-10-09 chose to slow it down for the chase)
  var CHASE_SPD = 0.5, SPD_LO = 0, SPD_HI = 40, BOOST = 20, throttle = clamp(qs('throttle', matchMedia('(hover: none)').matches ? 0.2 : 0), 0, 1), speed = SPD_LO + throttle * (SPD_HI - SPD_LO);
  var mouse = null, DEAD = 0.08;   // the cursor (-1..1 from the centre, or null if not over the page)
  var yaw = { x: qs('hdg', 258), v: 0 }, pitch = { x: 3, v: 0 }, bank = { x: 0, v: 0 };   // ?hdg= the start heading
  var seat = [{ x: 0, v: 0 }, { x: 0, v: 0 }, { x: 0, v: 0 }];   // offset in the ball, in ball radii
  var seatRoll = { x: 0, v: 0 }, seatPitch = { x: 0, v: 0 };
  var lead = { yaw: { x: 0, v: 0 }, pitch: { x: 0, v: 0 } };   // the head looking into the move
  var gaze = { yaw: { x: 0, v: 0 }, pitch: { x: 0, v: 0 } }, gazeAt = [0, 0];   // the mouse, -1..1
  var keys = {}, lastKey = -1e9;
  var MODES = ['FREE', 'HYBRID', 'INPUT'];
  // HYBRID by default (owner: "mouse is not integrated" -- in FREE the mouse did nothing)
  var mode = ((/[?&]mode=(free|hybrid|input)\b/.exec(location.search) || [])[1] || 'hybrid').toUpperCase();
  var modeBtn = document.getElementById('mode');
  S.setMode = function (name) {
    mode = MODES.indexOf(name) < 0 ? 'FREE' : name; lastKey = -1e9;   // a switch takes effect at once, nothing carried over
    showMode();
  };
  function showMode() {
    if (modeBtn) { modeBtn.textContent = 'MODE: ' + mode + ' · ' + WHAT[mode]; modeBtn.setAttribute('aria-label', 'Flight mode: ' + mode + ', ' + WHAT[mode].toLowerCase() + '. Press M to change.'); }
  }
  // what each mode does, said on the button (owner: "I don't know how any of the modes work")
  var WHAT = { FREE: 'AUTOPILOT FLIES, YOU WATCH', HYBRID: 'AUTOPILOT FLIES, MOUSE OR KEYS TAKE OVER', INPUT: 'YOU FLY: MOUSE, W/S THROTTLE' }, nudgeT = 0;
  S.setMode(mode);
  function nextMode() { S.setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]); }
  if (modeBtn) modeBtn.addEventListener('click', nextMode);
  var shake = 0, flash = 0, pos = [0, clamp(qs('alt', ALT0), ALT_LO, ALT_HI), 0], lockT = 0, locked = false, lockId = null;
  var ap = { id: null, held: 0, done: {}, alt: null };   // ...and the height it holds: where the pilot last left it   // the autopilot's current aircraft, how long it's held a lock on it, when each was done
  var LOCK_IN = 4.5, LOCK_OUT = 7, LOCK_TIME = 0.5;   // acquire inside the (small) triangle, release past it
  var NEAR = 0.0045;   // rad: an aircraft spanning more than this (about 0.26 deg) is near enough to see
  var ASSIST = 12;   // MANUAL: fire control's reach, deg off the nose
  // the eye sits well behind the ball's centre, as the reference camera does: from there everything on the ball
  // curves the way the inside of a dome does (from the exact centre a great circle would look straight)
  // (0.2 since the realism rebuild, 2026-10-08: at 0.4 the ball spread the picture so far that the world camera needed
  // a 160 deg field and 2.4x the pixels to stay sharp; at 0.2 it's 1.6x the field and 1.3x the pixels)
  var EYE0 = [0, 0, -0.2];
  // how much the camera floats: the seat's sway and jolts, its roll and pitch, and the head leading the move all
  // scale by this (owner: 75% of what it was, 2026-10-05)
  var FLOAT = 0.75;
  var suitQ = euler(0, 3, 0);

  // ---- input ----
  var cockpit = document.getElementById('cockpit');
  function keyRole(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    return { ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r', ArrowUp: 'u', ArrowDown: 'd', q: 'ql', e: 'qr', w: 'tu', s: 'td', Shift: 'b' }[k] || null;
  }
  var FLY = { l: 1, r: 1, u: 1, d: 1, ql: 1, qr: 1 };   // the keys that steer (and so take over in HYBRID)
  addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'm' || e.key === 'M') { if (!e.repeat) nextMode(); e.preventDefault(); return; }
    var r = keyRole(e); if (!r) return;
    if (mode === 'FREE' && FLY[r] && modeBtn) {   // the steering keys don't fly in FREE: say how to take the controls
      modeBtn.textContent = 'MODE: FREE · THE AUTOPILOT FLIES · PRESS M TO FLY'; modeBtn.classList.add('nudge');
      clearTimeout(nudgeT); nudgeT = setTimeout(function () { modeBtn.classList.remove('nudge'); showMode(); }, 3000);
    }
    keys[r] = true; if (FLY[r]) lastKey = performance.now(); e.preventDefault();
  });
  addEventListener('keyup', function (e) { var r = keyRole(e); if (r) keys[r] = false; });
  addEventListener('blur', function () { keys = {}; });
  cockpit.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') mouse = null; });
  cockpit.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') { gazeAt = [e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1]; mouse = gazeAt; }
  });

  // ---- one step of the simulation ----
  function step(dt, now) {
    // the mouse as a stick: its offset from the centre, past the dead zone
    var dz = function (v) { return Math.sign(v) * Math.max(0, Math.abs(v) - DEAD) / (1 - DEAD); };
    var ms = mouse && mode !== 'FREE' ? [dz(mouse[0]), -dz(mouse[1])] : [0, 0];
    if (ms[0] || ms[1]) lastKey = now;
    var held_ = keys.l || keys.r || keys.u || keys.d || keys.ql || keys.qr || ms[0] || ms[1];
    var manual = mode === 'INPUT' || (mode === 'HYBRID' && (now - lastKey < 4000 || held_));
    if (manual) ap.alt = null;   // the autopilot picks up the height it's handed
    // the throttle: W/S move it (0.8 a second) and it stays, in every mode (from a standstill even the autopilot needs
    // it); Shift boosts
    var boosting = !!keys.b;
    throttle = clamp(throttle + ((keys.tu ? 1 : 0) - (keys.td ? 1 : 0)) * 0.8 * dt, 0, 1);
    var chasing = !manual && ap.id !== null, cruise = SPD_LO + throttle * (SPD_HI - SPD_LO) + (boosting ? BOOST : 0);   // (the autopilot has an aircraft: it slows for the chase, then runs back up)
    if (!reduce) speed += ((chasing ? Math.min(cruise, Math.max(CHASE_SPD, (ap.range - 8) * 0.4)) : cruise) - speed) * Math.min(1, dt * 1.2);
    if (!reduce) T += dt;
    // the traffic round the suit, as seen from it (still under reduced motion)
    tr = tr || (S.makeTraffic && S.makeTraffic(SEED, { near: qs('near', 0) > 0 }));
    var contacts = tr && TRAFFIC ? tr.step(reduce ? 0 : dt, { pos: pos, heading: yaw.x }) : [];
    var fwd0 = qrot(suitQ, [0, 0, 1]);
    contacts.forEach(function (c) {
      c.az = Math.atan2(c.d[0], c.d[2]) / D; c.el = Math.asin(clamp(c.d[1], -1, 1)) / D;
      c.off = Math.acos(clamp(dot(c.d, fwd0), -1, 1)) / D;
      c.near = c.span / c.range > NEAR;   // big enough to see: drawn as its model, no longer only a W mark
    });
    var turn = clamp((keys.r ? 1 : 0) - (keys.l ? 1 : 0) + ((keys.qr ? 1 : 0) - (keys.ql ? 1 : 0)) * 0.35 + ms[0], -1, 1);
    var climb = clamp((keys.u ? 1 : 0) - (keys.d ? 1 : 0) + ms[1], -1, 1);
    if (manual) {
      // Fire control helps the pilot onto a target, as AUTO's chase does: once every key is let go with a contact
      // within ASSIST of the nose, the nose eases onto it and tracks it (the one being locked, if it's in reach, so
      // it doesn't hop round a bunched group). While any key is held the keys alone fly, at full rate. (Without
      // this the keys' 55 deg/s and their coast overshot the 4.5 deg lock window every time; slowing the keys
      // near contacts instead made every turn a crawl when the contacts were bunched, owner 2026-10-05.)
      var held = turn || climb, cur = contacts.filter(function (c) { return c.id === lockId && c.off < ASSIST; })[0];
      var aim = cur || contacts.reduce(function (a, b) { return !a || b.off < a.off ? b : a; }, null), assist = mode === 'HYBRID' && !held && !!aim && aim.off < ASSIST;
      var wy = assist ? clamp(wrap(aim.az - yaw.x) * 4, -30, 30) : turn * 80, wp = assist ? clamp((aim.el - pitch.x) * 4, -30, 30) : climb * 60;
      // a key ramps the turn up smoothly; letting go brakes it hard, so a tap stops about where it's let go
      var rate = function (k) { return Math.min(1, dt * (assist ? 8 : k ? 4 : 12)); };
      // INPUT holds course when let go: the pitch eases back to level, so the altitude holds too
      if (mode === 'INPUT' && !climb && !reduce) wp = clamp(-pitch.x * 2, -20, 20);
      yaw.v += (wy - yaw.v) * rate(turn); pitch.v += (wp - pitch.v) * rate(climb);
      yaw.x += yaw.v * dt; pitch.x += pitch.v * dt;
    } else if (!reduce) {
      // AUTO cruises to the traffic: it picks the nearest aircraft within 60 deg of the nose it hasn't done in the
      // last 20s and closes on it with a lag, so it drifts into the sight, until it has held a lock on it for 4s;
      // with none in reach it wanders in slow banks, levelling off
      var now_ = T, tgt = contacts.filter(function (c) { return c.id === ap.id; })[0];
      ap.range = tgt ? tgt.range : 0;
      if (tgt && locked && lockId === tgt.id) ap.held += dt;
      if (!tgt || ap.held > 4) {
        if (tgt) ap.done[tgt.id] = now_;
        for (var k in ap.done) if (now_ - ap.done[k] >= 20) delete ap.done[k];   // only the last 20s matter
        tgt = contacts.filter(function (c) { return c.off < 60 && !(now_ - (ap.done[c.id] || -1e9) < 20); })
          .reduce(function (a, b) { return !a || b.off < a.off ? b : a; }, null);
        ap.id = tgt ? tgt.id : null; ap.held = 0; ap.range = tgt ? tgt.range : 0;
      }
      // it holds its height (where the pilot left it), tilting only a little toward an aircraft above or below
      if (ap.alt === null) ap.alt = pos[1];
      var hold = clamp((ap.alt - pos[1]) * 1.5, -12, 12);
      if (tgt) { spring(yaw, yaw.x + wrap(tgt.az - yaw.x), 1.7, 0.75, dt); spring(pitch, clamp(clamp(tgt.el, -8, 8) + hold, -20, 20), 1.9, 0.8, dt); }
      else { yaw.v += (6 * Math.sin(T * 0.05) - yaw.v) * Math.min(1, dt); spring(pitch, hold, 1.2, 0.9, dt); yaw.x += yaw.v * dt; }
    }
    yaw.v = clamp(yaw.v, -110, 110); pitch.v = clamp(pitch.v, -80, 80); pitch.x = clamp(pitch.x, -75, 75);
    spring(bank, reduce ? 0 : clamp(yaw.v * 0.5, -60, 60), 3.2, 0.7, dt);
    suitQ = euler(yaw.x, pitch.x, bank.x);
    // the floor: 0.3 km over the 3D Earth's terrain where it's loaded (sampled every 0.5 s, here and 0.5 s ahead), never under ALT_LO
    // (only below 15 km: no ground stands above ~9 km, so higher up there's nothing to clear and no need to ask)
    if (now - floorT > 500 && S.world && S.world.heightAt && pos[1] < 15) { floorT = now; var h = S.world.heightAt(lat, lon), fw = dir(yaw.x, pitch.x), la = clamp(lat + fw[2] * speed * 0.5 / KM_DEG, -89.9, 89.9), g2 = S.world.heightAt(la, lon + fw[0] * speed * 0.5 / (KM_DEG * Math.cos(la * D)));   // (and the point 0.5 s ahead along the flight path: the higher of the two, so a ridge at boost speed is cleared before it's reached)
      var g = h === null ? g2 : g2 === null ? h : Math.max(h, g2); floor = g === null ? ALT_LO : Math.max(ALT_LO, g / 1000 + 0.3); }
    // flying forward, in km: the flight path is the nose; at the floor or the ceiling the climb is taken out
    if (!reduce) {
      var f = dir(yaw.x, pitch.x);
      pos[0] += f[0] * speed * dt; pos[1] += f[1] * speed * dt; pos[2] += f[2] * speed * dt;
      lat = clamp(lat + f[2] * speed * dt / KM_DEG, -89.9, 89.9);
      lon += f[0] * speed * dt / (KM_DEG * Math.cos(lat * D)); lon = ((lon + 540) % 360) - 180;
      if ((pos[1] >= ALT_HI && pitch.x > 0) || (pos[1] <= floor && pitch.x < 0)) { pitch.x *= Math.max(0, 1 - dt * 6); pitch.v = Math.min(0, pitch.v * Math.sign(pitch.x || 1)) * Math.sign(pitch.x || 1); }
    }
    pos[1] = clamp(pos[1], floor, ALT_HI);   // (still under reduced motion: a start inside a mountain is lifted out)

    // the seat, hung in the ball: thrown outward in a turn, pressed down in a pull, lagging the roll
    if (!reduce) {
      var ax = -yaw.v * D * 0.075 * FLOAT, ay = -pitch.v * D * 0.06 * FLOAT;
      spring(seat[0], ax, 5.5, 0.38, dt); spring(seat[1], ay, 5.5, 0.38, dt); spring(seat[2], 0, 5.5, 0.45, dt);
      spring(seatRoll, -bank.v * 0.05 * FLOAT, 6, 0.4, dt); spring(seatPitch, -pitch.v * 0.03 * FLOAT, 6, 0.4, dt);
    }
    // it leads the move (a third of the turn rate, a little under half the climb rate), and follows the mouse
    if (!reduce) {
      spring(lead.yaw, clamp(yaw.v * 0.3, -24, 24) * FLOAT, 4.2, 0.5, dt); spring(lead.pitch, clamp(pitch.v * 0.42, -20, 20) * FLOAT, 4.2, 0.5, dt);
      spring(gaze.yaw, gazeAt[0] * 9, 3, 0.8, dt); spring(gaze.pitch, -gazeAt[1] * 6, 3, 0.8, dt);
    }
    // the pilot's resting gaze is the nose itself: the triangle sight is right in front of the eyes
    var view = { yaw: lead.yaw.x + gaze.yaw.x, pitch: lead.pitch.x + gaze.pitch.x };

    // Targeting: the contact nearest the boresight, once inside LOCK_IN, is held for LOCK_TIME to lock. The
    // current target is kept until it drifts past LOCK_OUT (or another sits clearly nearer), so the lock never
    // flickers between two close contacts.
    var fwd = qrot(suitQ, [0, 0, 1]);
    contacts.forEach(function (c) { c.off = Math.acos(clamp(dot(c.d, fwd), -1, 1)) / D; });
    var near = contacts.reduce(function (a, b) { return !a || b.off < a.off ? b : a; }, null);
    var cur = contacts.filter(function (c) { return c.id === lockId; })[0];
    if (cur && cur.off < LOCK_OUT && !(near && near !== cur && near.off < cur.off - 2.5)) lockT += dt;
    else if (near && near.off < LOCK_IN) { if (near.id !== lockId) lockT = 0; lockId = near.id; lockT += dt; }
    else { lockId = null; lockT = 0; }
    locked = lockT > LOCK_TIME;

    shake *= Math.exp(-dt * 3.2); flash *= Math.exp(-dt * 7);
    var j = shake * 0.03, jr = shake * 1.6;
    var eye = [EYE0[0] + seat[0].x + (Math.random() - 0.5) * j, EYE0[1] + seat[1].x + (Math.random() - 0.5) * j, EYE0[2] + seat[2].x];
    var seatQ = euler(0, seatPitch.x + (Math.random() - 0.5) * jr, seatRoll.x + (Math.random() - 0.5) * jr);
    S.pose = {
      suitQ: suitQ, contacts: contacts, eye: eye, eyeQ: qmul(seatQ, euler(view.yaw, view.pitch, 0)),
      heading: ((yaw.x % 360) + 360) % 360, pitch: pitch.x, flash: flash, pos: pos.slice(), alt: pos[1], speed: speed, geo: [lat, lon], throttle: throttle, boost: boosting,
      locked: locked, lockT: lockT, lockId: lockId, pilot: manual ? 'MANUAL' : 'AUTO', chasing: chasing, mode: mode,
      modeWord: mode === 'HYBRID' ? (manual ? 'MANUAL' : 'HYBRID') : mode, head: view, t: T,
      stick: [clamp(yaw.v / 55, -1, 1), clamp(pitch.v / 40, -1, 1)]   // the grips' deflection: turn (+ right), climb (+ up)
    };
  }

  // the camera: 120 degrees across on a landscape screen, 90 tall on a portrait one. (78 matches the reference frame
  // exactly with EYE0; the owner asked for it wider, to 87 on 2026-10-05, 95 and then 120 on 2026-10-07.) S.camRef
  // is that fitted width.
  function camera(W, H) {
    if (W >= H) { var tx = Math.tan(60 * D); return { tx: tx, ty: tx * H / W }; }
    var ty = Math.tan(45 * D); return { tx: ty * W / H, ty: ty };
  }

  S.camRef = 0.81;
  var last = null, avg = 16;
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { last = null; return; }
    var dt = last == null ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
    if (last != null) avg += ((now - last) - avg) * 0.05;
    last = now;
    step(dt, now);
    var W = innerWidth, H = innerHeight;
    S.cam = camera(W, H); S.frameMs = avg;
    S.renderers.forEach(function (r) { r(S.pose, W, H); });
    S.frames++;
  }
  requestAnimationFrame(frame);
})();
