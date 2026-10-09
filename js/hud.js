/* hud.js: the HUD, as vectors on a 2D canvas, authored ON the ball and projected through the same
   ball -> eye geometry as the world's ball warp (sky.js), so it curves for real and stays sharp.

   The layout is measured, not composed: every front position below was read off the owner's front frame
   (ref, 1:26:32) and converted to ball angles assuming the frame's camera, a 100-degree view tilted 10 deg
   down (the tilt that makes its rulers true meridians and its pink rail a true parallel). The side rings
   come from the side frame (29:50). Ball angles: az right +, el up +, the nose at (0, 0).
     - the pink rail: a parallel at el -18 round the whole ball, open in front between az +-30, where
       diamond caps close it (chevrons at +-26 pointing in);
     - at az +-90 and 180, centred on the rail, a small crosshair (3.4), a dotted ring (26) round it, dot grids;
     - the tall rulers: full circles round a point off each side, through the measured ruler path, their
       dashes sliding round with the pitch; a coffin column just outside; a plate on each;
     - the centre: heading ticks at el 22 scrolling with the heading, the nose designator at el -10; the plate
       cluster under it (centred on el -26);
     - world-fixed: the W contact marks.
   Every element is drawn at SZ (0.75) of its measured size, in place: the owner found it too cluttered.
   The triangle sight (or the Y, ?look=penelope) is always up on the nose, at eye level; the rail and the
   cluster sit lower than the frame has them so it stands clear (owner, 2026-10-05). Coffin cells glow in turn. */
(function () {
  'use strict';
  var S = window.SITE5, m = S.m, D = m.D, qrot = m.qrot, norm = m.norm, dir = m.dir;
  var canvas = document.getElementById('hud'), ctx = canvas.getContext('2d');
  var Y_SIGHT = S.look === 'penelope';
  var C = {
    line: '#AFC0EC', tick: '#EEF3FA', pink: '#FFA3DC', bar: '#FF4F8B', barIn: '#FFC6E8', salmon: '#EBA89C',
    cellEdge: '#8DA0BC', glow: 'rgb(150, 182, 255)', glowEdge: '#CFE0FF', plate: 'rgba(120, 140, 200, .10)'
  };
  var FONT = "Michroma, 'B612 Mono', sans-serif";
  var parts = S.parts = {};
  var tapes = S.tapes = {};

  // the layout, in ball degrees (see the header)
  var RAIL = -22, GAP = 30, RING_AZ = [90, -90, 180], DOT_R = 26, RULER = 42;
  // the size of every element (cells, plates, ticks, marks), its position unchanged: 0.75 (owner, 2026-10-05)
  var SZ = 0.15;

  // ---- projection and drawing on the ball ----
  var W = 0, H = 0, E, EQi, SQi, tx, ty, f, GA = 1;   // GA: a fade applied to everything drawn
  function project(p) {
    var v = qrot(EQi, [p[0] - E[0], p[1] - E[1], p[2] - E[2]]);
    if (v[2] < 0.04) return null;
    return [W / 2 + v[0] / v[2] / tx * W / 2, H / 2 - v[1] / v[2] / ty * H / 2];
  }
  function toBall(w) { return qrot(SQi, w); }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  // the tangent basis at a ball point: R toward increasing azimuth, U toward increasing elevation
  function basis(c) {
    var az = Math.atan2(c[0], c[2]), el = Math.asin(m.clamp(c[1], -1, 1));
    return { c: c, R: [Math.cos(az), 0, -Math.sin(az)], U: [-Math.sin(el) * Math.sin(az), Math.cos(el), -Math.sin(el) * Math.cos(az)] };
  }
  // at q on a circle round c: R pointing away from c, U round the circle
  function radialBasis(c, q) {
    var d = m.dot(q, c), R = norm([q[0] * d - c[0], q[1] * d - c[1], q[2] * d - c[2]]);
    return { c: q, R: R, U: cross(q, R) };
  }
  function tp(B, u, v) { return norm([B.c[0] + B.R[0] * u + B.U[0] * v, B.c[1] + B.R[1] * u + B.U[1] * v, B.c[2] + B.R[2] * u + B.U[2] * v]); }
  // The hierarchy, by brightness, opacity and weight only (the colours stay): what reads first is brightest and
  // the only thing with a halo. A halo is a second, wider, faint stroke laid under the sharp core -- never a blur,
  // so it can't run neighbouring shapes together.
  //   1  the triangle sight and the active target         full, a restrained halo
  //   2  the pink rail's core                             near full, a fainter, tighter halo
  //   3  rulers, rings, coffin cells, heading, escorts    crisp, no halo, a little dimmer
  //   4  plates, badges, tabs, dash text, dot grids       crisp, finest, dimmer still
  // halo.w: how many core widths it spans, halo.max: but never more than this many px past the core (so a heavy
  // bar gets a tight rim, not a band)
  var TIERS = { 1: { a: 1, w: 1, halo: { w: 3, k: 0.16, max: 4 } }, 2: { a: 0.95, w: 1, halo: { w: 2.4, k: 0.1, max: 3 } },
                3: { a: 0.82, w: 0.9, halo: null }, 4: { a: 0.7, w: 0.85, halo: null } };
  var TA = 1, TW = 1, HALO = null, HALO_TIER = 0;
  function tier(n) { var t = TIERS[n]; TA = t.a; TW = t.w; HALO = t.halo; HALO_TIER = n; }
  var LW = 1;   // the current stroke's width, before depth
  function stroke(color, alpha, width) { ctx.strokeStyle = color; ctx.globalAlpha = alpha * GA * TA; LW = Math.max(0.8, width * TW); ctx.lineWidth = LW; }
  // stroke the current path: the halo under it first, if this tier has one
  function strokeNow() {
    if (HALO) {
      var lw = ctx.lineWidth, ga = ctx.globalAlpha;
      ctx.lineWidth = lw + Math.min(lw * (HALO.w - 1), HALO.max); ctx.globalAlpha = ga * HALO.k; ctx.stroke();
      ctx.lineWidth = lw; ctx.globalAlpha = ga;
      parts.halo[HALO_TIER] = (parts.halo[HALO_TIER] || 0) + 1;
    }
    ctx.stroke();
  }
  // How much heavier a line on the sphere at p draws than one straight ahead: with the eye behind the centre,
  // nearer parts of the monitor are closer, so they draw a little heavier (gently: the square root of the
  // distance ratio, held to 0.85..1.35). Continuous over the sphere, so a line never jumps in weight.
  var D0 = 1.4;
  function depthScale(p) {
    var dx = p[0] - E[0], dy = p[1] - E[1], dz = p[2] - E[2];
    return m.clamp(Math.sqrt(D0 / Math.sqrt(dx * dx + dy * dy + dz * dz)), 0.85, 1.35);
  }
  S.depthScale = function (p) { return E ? depthScale(p) : 1; };
  // a polyline through ball points, subdivided every ~2 degrees so it follows the sphere (1.2 was 40% more points
// for no visible difference; the HUD's curves were its biggest cost, profiled 2026-10-09)
  // Short paths (a tick, a cell) take one width from their middle; long ones (the rail, the rings, the ruler
  // circles) are stroked a few segments at a time, each at its own depth, so the weight changes smoothly
  // round the sphere. Round joins keep the pieces seamless.
  function path(pts, closed) {
    var n = pts.length, segs = closed ? n : n - 1, long = segs > 6;
    var mid = pts[Math.floor(n / 2)];
    ctx.beginPath();
    if (!long) ctx.lineWidth = LW * depthScale(mid);
    var pen = false, last = null;
    for (var i = 0; i < segs; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      if (long) {
        if (pen) strokeNow();
        ctx.beginPath(); ctx.lineWidth = LW * depthScale(norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]));
        if (last) { ctx.moveTo(last[0], last[1]); pen = true; } else pen = false;
      }
      var ang = Math.acos(m.clamp(m.dot(a, b), -1, 1)), k = Math.max(1, Math.ceil(ang / (2 * D)));
      for (var j = (i === 0 || long) ? 0 : 1; j <= k; j++) {
        var t = j / k, s = project(norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]));
        if (!s) { pen = false; last = null; continue; }
        if (pen) ctx.lineTo(s[0], s[1]); else { ctx.moveTo(s[0], s[1]); pen = true; }
        last = s;
      }
    }
    strokeNow();
  }
  function seg(a, b) { path([a, b]); }
  function fill(pts, color, alpha) {
    var q = pts.map(project);
    if (!q.every(Boolean)) return false;
    ctx.globalAlpha = alpha * GA * TA; ctx.fillStyle = color; ctx.beginPath();
    q.forEach(function (s, j) { if (j) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
    ctx.closePath(); ctx.fill();
    return true;
  }
  function text(p, s, color, alpha, size, align) {
    var q = project(p); if (!q) return;
    ctx.globalAlpha = alpha * GA * TA; ctx.fillStyle = color; ctx.font = size + 'px ' + FONT; ctx.textAlign = align || 'left';
    ctx.fillText(s, q[0], q[1]);
  }
  // points on a small circle of radius r degrees round c, from..to degrees round it
  function ring(c, r, from, to, step) {
    var B = basis(c), pts = [], cr = Math.cos(r * D), sr = Math.sin(r * D);
    for (var a = from; a <= to + 0.01; a += step || 4) {
      var ca = Math.cos(a * D), sa = Math.sin(a * D);
      pts.push(norm([c[0] * cr + (B.R[0] * ca + B.U[0] * sa) * sr, c[1] * cr + (B.R[1] * ca + B.U[1] * sa) * sr, c[2] * cr + (B.R[2] * ca + B.U[2] * sa) * sr]));
    }
    return pts;
  }
  function smooth(e0, e1, x) { var t = m.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function fade(el) { return 1 - smooth(48, 80, Math.abs(el)); }
  var F = basis([0, 0, 1]);   // the nose

  // ---- shapes, in tangent units round a ball point B (u along R, v along U) ----
  // a coffin cell: wide at one end, pointed at the other (s +1: the point toward +R)
  function coffin(B, s, a, b) {
    var P = function (u, v) { return tp(B, s * u, v); };
    return [P(a, -b * 0.35), P(a, b * 0.35), P(a * 0.2, b), P(-a, b * 0.72), P(-a, -b * 0.72), P(a * 0.2, -b)];
  }
  // a coffin cell; g (0..1) lights it: a brighter face, a lit edge and a soft halo stroke
  // A coffin cell: a flat translucent slate face with a very faint gradient, lighter at the wide end, darker
  // toward the point (pts[0..1] are the point, pts[3..4] the wide end), and a soft luminous border: a faint wide
  // halo under a fine edge. g (0..1) lights it as the glow runs past.
  function cell(pts, al, g) {
    var q = pts.map(project);
    if (!q.every(Boolean)) return false;
    var tipX = (q[0][0] + q[1][0]) / 2, tipY = (q[0][1] + q[1][1]) / 2, wideX = (q[3][0] + q[4][0]) / 2, wideY = (q[3][1] + q[4][1]) / 2;
    var gr = ctx.createLinearGradient(wideX, wideY, tipX, tipY);
    gr.addColorStop(0, 'rgba(66, 82, 102, .56)'); gr.addColorStop(1, 'rgba(42, 54, 70, .46)');
    ctx.globalAlpha = al * GA * TA; ctx.fillStyle = gr; ctx.beginPath();
    q.forEach(function (s, j) { if (j) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
    ctx.closePath(); ctx.fill();
    if (g > 0.02) fill(pts, C.glow, al * g * 0.5);
    var w = depthScale(pts[0]);
    ctx.strokeStyle = g > 0.02 ? C.glowEdge : C.cellEdge;
    ctx.globalAlpha = al * GA * TA * (0.035 + 0.1 * g); ctx.lineWidth = (2.8 + 1.4 * g) * w; ctx.stroke();
    ctx.globalAlpha = al * GA * TA * (0.3 + 0.6 * g); ctx.lineWidth = (0.85 + 0.45 * g) * w; ctx.stroke();
    return true;
  }
  // The chase: a few lit heads run along a row of n cells (speed cells a second), each leaving a fading trail,
  // so the glow moves on from one cell to the next. Off under reduced motion (the clock holds still there).
  var TRAIL = 5;
  // which cell of the left column is brightest (the test watches it move)
  function noteLit(i, g) { if (g > (parts._litG || 0)) { parts._litG = g; parts.litCells = i; } }
  function chase(i, n, t, speed, heads) {
    var g = 0;
    for (var h = 0; h < heads; h++) {
      var head = (t * speed + h * n / heads) % n, d = ((head - i) % n + n) % n;
      if (d < TRAIL) g = Math.max(g, Math.pow(1 - d / TRAIL, 2));
    }
    return g;
  }
  function longHex(B, u, v, a, b, k) {
    return [tp(B, u - a, v), tp(B, u - a + k, v + b), tp(B, u + a - k, v + b), tp(B, u + a, v), tp(B, u + a - k, v - b), tp(B, u - a + k, v - b)];
  }
  // tiny unreadable "text": rows of dashes
  function dashText(B, u, v, a, rows, gap) {
    for (var r = 0; r < rows; r++) for (var x = -a, i = 0; x < a; x += a * 0.16, i++) if ((i * 7 + r * 3) % 5 !== 3) seg(tp(B, u + x, v - r * gap), tp(B, u + x + a * 0.11, v - r * gap));
  }
  // a label plate: outline, an inset outline, two lines of dash text
  function plate(B, u, v, a, b, alpha) {
    var al = alpha == null ? 1 : alpha;
    fill(longHex(B, u, v, a, b, b * 0.9), C.plate, al);
    stroke(C.line, 0.7 * al, 1.2); path(longHex(B, u, v, a, b, b * 0.9), true);
    stroke(C.line, 0.45 * al, 1); path(longHex(B, u, v, a * 0.86, b * 0.68, b * 0.62), true);
    stroke(C.line, 0.55 * al, 1); dashText(B, u - a * 0.05, v + b * 0.22, a * 0.5, 2, b * 0.44);
  }
  // an arrow plate pointing toward sd, with a chevron inside (moved into the nose when the plate holds bars)
  function arrowPlate(B, u, v, s, sd, bars) {
    var P = function (x, y) { return tp(B, u + sd * x * s, v + y * s); };
    var out = [P(-1, 0.75), P(0.35, 0.75), P(1, 0), P(0.35, -0.75), P(-1, -0.75)];
    fill(out, C.plate, 1); stroke(C.line, 0.75, 1.3); path(out, true);
    stroke(C.line, 0.5, 1); path([P(-0.82, 0.55), P(0.25, 0.55), P(0.75, 0), P(0.25, -0.55), P(-0.82, -0.55)], true);
    if (bars) { stroke(C.line, 0.85, 1.3); path([P(0.58, 0.26), P(0.36, 0), P(0.58, -0.26)]); }
    else { stroke(C.line, 0.85, 1.5); path([P(0.1, 0.34), P(-0.35, 0), P(0.1, -0.34)]); }
  }
  function hexPts(B, u, v, r) { var q = []; for (var a = 0; a < 360; a += 60) q.push(tp(B, u + Math.cos(a * D) * r * 1.15, v + Math.sin(a * D) * r)); return q; }
  // a hexagonal badge with a smaller hexagon and three spokes (bare: the outer hexagon only, to hold an instrument)
  function badge(B, u, v, s, bare) {
    var hex = function (r) { return hexPts(B, u, v, r); };
    fill(hex(s), C.plate, 1); stroke(C.line, 0.75, 1.3); path(hex(s), true);
    if (bare) return;
    stroke(C.line, 0.5, 1); path(hex(s * 0.45), true);
    for (var a = 90; a < 450; a += 120) seg(tp(B, u + Math.cos(a * D) * s * 0.52, v + Math.sin(a * D) * s * 0.45), tp(B, u + Math.cos(a * D) * s * 0.85, v + Math.sin(a * D) * s * 0.8));
  }
  function dots(B, u, v, cols, rows, s) {
    for (var i = 0; i < cols; i++) for (var j = 0; j < rows; j++) {
      var x = u + (i - (cols - 1) / 2) * s * 2.3, y = v + (j - (rows - 1) / 2) * s * 2.3;
      fill([tp(B, x - s, y - s), tp(B, x + s, y - s), tp(B, x + s, y + s), tp(B, x - s, y + s)], C.line, 0.4);
    }
  }
  function T(deg) { return Math.tan(deg * D); }
  var CK = 1;   // the cluster's fit: under 1 only while the cluster draws on a narrow screen
  function Z(deg) { return Math.tan(deg * SZ * CK * D); }   // a size, scaled

  // ---- ball-fixed ----
  // The pink rail at the waist, right round the ball, with its tick rails; open in front, where diamond
  // caps close it and salmon chevrons point in at the cluster.
  function rail(p) {
    var u = 1.2 * SZ, dn = 1.6 * SZ, w = Z(2.6), h = Z(3.4);   // the caps' half width and height (tangent units)
    // each line runs cap to cap, ending on the diamond's edge at its own height: the same on both sides
    var inset = function (e) { return Math.atan(w * (1 - Math.tan(Math.abs(e - RAIL) * D) / h) / Math.cos(e * D)) / D; };
    var ends = [], capDia = [];
    var run = function (e) {
      var a0 = GAP + inset(e), n = Math.ceil((360 - 2 * a0) / 3), pts = [];
      for (var i = 0; i <= n; i++) pts.push(dir(a0 + i * (360 - 2 * a0) / n, e));
      ends.push([pts[0], pts[n]]); return pts;
    };
    tier(3);
    stroke(C.tick, 0.4, 1); path(run(RAIL + u)); path(run(RAIL - dn));
    stroke(C.barIn, 0.6, 1); path(run(RAIL - 0.7 * SZ));
    tier(2);
    stroke(C.bar, 0.92, 1.6); path(run(RAIL));
    tier(3);
    // ticks about every 4.5 deg, spaced to fit so both ends sit 4 deg off their caps, a big one every third
    var tA = GAP + 4, tn = 3 * Math.round((360 - 2 * tA) / 13.5);
    parts.railTicks = [tA, 360 - tA];
    for (var ti = 0; ti <= tn; ti++) {
      var az = tA + ti * (360 - 2 * tA) / tn, big = ti % 3 === 0;
      stroke(C.tick, big ? 0.6 : 0.35, 1); seg(dir(az, RAIL + u), dir(az, RAIL + u + (big ? 1.6 : 0.7) * SZ)); seg(dir(az, RAIL - dn), dir(az, RAIL - dn - (big ? 1.3 : 0.6) * SZ));
    }
    // On lock a bright run comes in along the rail to each cap (0.28s), the caps flash pink, then the salmon
    // chevrons that point at the cluster.
    var la = mo.lockAge, pulse = !S.reduce && la >= 0 && la < 0.8;
    var capLit = pulse ? bump(la, 0.26, 0.6, 0.1) : 0, chevLit = pulse ? bump(la, 0.36, 0.75, 0.1) : 0;
    var caps = 0;
    [-1, 1].forEach(function (sd) {
      if (pulse && la < 0.28) {
        var a0 = GAP + inset(RAIL) + 22 * (1 - la / 0.28);
        litStroke(C.barIn, 1, 2.6, 1); path([dir(sd * (a0 + 5), RAIL), dir(sd * a0, RAIL)]);
        parts.cluster.railPulse = true;
      }
      var B = basis(dir(sd * GAP, RAIL));
      var dia = [tp(B, -w, 0), tp(B, 0, h), tp(B, w, 0), tp(B, 0, -h)];
      capDia.push(dia);
      tier(3);
      if (fill(dia, C.plate, 1)) caps++;
      if (capLit > 0.05) fill(dia, C.bar, 0.18 * capLit);
      litStroke(capLit > 0.05 ? C.bar : C.line, 0.85, 1.3, capLit, 3); path(dia, true);
      litStroke(C.line, 0.5, 1, capLit * 0.6, 3); path([tp(B, -w * 0.62, 0), tp(B, 0, h * 0.62), tp(B, w * 0.62, 0), tp(B, 0, -h * 0.62)], true);
      litStroke(C.line, 0.9, 1.3, capLit, 3); path([tp(B, -sd * w * 0.2, h * 0.3), tp(B, sd * w * 0.25, 0), tp(B, -sd * w * 0.2, -h * 0.3)]);
      var Bc = basis(dir(sd * (GAP - 4 * SZ), RAIL - 0.5 * SZ));
      litStroke(C.salmon, 0.9, 2, chevLit, 3); path([tp(Bc, sd * Z(0.9), Z(1.5)), tp(Bc, -sd * Z(0.6), 0), tp(Bc, sd * Z(0.9), -Z(1.5))]);
    });
    tier(3);
    parts.rail = true; parts.caps = caps; parts.railEnds = ends; parts.capDia = capDia;
  }
  // At az +-90 and 180, on the rail: a crosshair and a dotted ring (the coffin ring that was here was removed, owner
  // 2026-10-07).
  function sideRing(az) {
    tier(3);
    var c = dir(az, RAIL);
    var dots_ = ring(c, DOT_R, 0, 360, 3);
    ctx.fillStyle = C.tick;
    dots_.forEach(function (d) { var s = project(d); if (s) { ctx.globalAlpha = 0.55 * GA * TA; ctx.beginPath(); ctx.arc(s[0], s[1], 1.4 * SZ, 0, 7); ctx.fill(); } });
    stroke(C.line, 0.55, 1.1); path(ring(c, 3.4 * SZ, 0, 360), true);
    [45, 135, 225, 315].forEach(function (a) { stroke(C.line, 0.6, 1.1); seg(ring(c, 3.4 * SZ, a, a)[0], ring(c, 5 * SZ, a, a)[0]); seg(ring(c, 8, a, a)[0], ring(c, 8 + 2 * SZ, a, a)[0]); });
    var B = basis(c);
    dots(B, -T(8), -T(5), 3, 2, Z(0.45)); dots(B, T(9), T(1.8), 3, 2, Z(0.45));
  }
  // The tall rulers are circles round a point off to each side (az +-90, el -10), radius 48: the ruler's
  // measured path in the front frame (it bows toward the middle), and unlike a meridian a circle like this
  // curves on screen however you look at it. They run the whole way round, as does the coffin column just
  // outside them, and their dashes slide round with the suit's pitch (1.6 deg of arc per degree), a long one
  // every fifth: climb and they run down past you, dive and they run up.
  var SIDE_C = [dir(-90, -10), dir(90, -10)], RULER_R = 48, STEP = 1.6;
  // (one point of ring(): the two centres never change, so their frames are worked out once -- rebuilding one for each
  // of ~900 ticks a frame was the HUD's biggest cost, profiled 2026-10-09)
  var SIDE_B = SIDE_C.map(basis);
  function arcPt2(sd, r, phi) {
    var i = sd < 0 ? 0 : 1, c = SIDE_C[i], B = SIDE_B[i], a = (sd < 0 ? phi : 180 - phi) * D, cr = Math.cos(r * D), sr = Math.sin(r * D), ca = Math.cos(a), sa = Math.sin(a);
    return norm([c[0] * cr + (B.R[0] * ca + B.U[0] * sa) * sr, c[1] * cr + (B.R[1] * ca + B.U[1] * sa) * sr, c[2] * cr + (B.R[2] * ca + B.U[2] * sa) * sr]);
  }
  function rulers(p) {
    var base = p.pitch * STEP;
    tier(3);
    tapes.stream = base.toFixed(3);
    [-1, 1].forEach(function (sd) {
      var c = SIDE_C[sd < 0 ? 0 : 1];
      for (var k = Math.ceil((base - 180) / STEP); k * STEP - base < 180; k++) {
        var ph = k * STEP - base, long = ((k % 5) + 5) % 5 === 0, q = arcPt2(sd, RULER_R, ph);
        stroke(C.tick, long ? 0.75 : 0.45, long ? 1.8 : 1.2);
        seg(q, arcPt2(sd, RULER_R - (long ? 3 : 1.8) * SZ, ph));
      }
      var cw = 2.5 * SZ, cr = RULER_R - 3.6 * SZ - cw;
      var nc = 2 * Math.round(360 / (4.6 * SZ) / 2), sp = 360 / nc;   // an even count: the stagger meets itself
      for (var i = 0; i < nc; i++) {
        var ph2 = -180 + i * sp, q2 = arcPt2(sd, cr - (i % 2) * 2.4 * SZ, ph2);
        var gl = chase(i, nc, p.t, 18, 4); if (sd < 0) noteLit(i, gl);
        cell(coffin(radialBasis(c, q2), 1, Z(2.5), Z(1.55)), 0.9, gl);
      }
      tier(4); plate(radialBasis(c, arcPt2(sd, RULER_R + 2 * SZ, 11)), 0, 0, Z(2.8), Z(1.25), 0.9); tier(3);
    });
  }
  // the centre: the heading ticks over the nose (+-12 deg) scroll with the heading under a fixed caret -- a tick
  // every degree, taller every 5, tallest every 10, fading out at the ends -- and the nose designator under it
  function centre(p) {
    tier(3);
    var h = p.heading, HT = 22.2, span = 12;
    for (var k = Math.ceil(h - span); k <= h + span; k++) {
      var rel = k - h, ten = ((k % 10) + 10) % 10 === 0, five = ((k % 5) + 5) % 5 === 0;
      var al = (ten ? 0.95 : five ? 0.8 : 0.55) * (1 - smooth(span - 3, span, Math.abs(rel)));
      stroke(C.line, al, ten ? 1.5 : five ? 1.25 : 1);
      seg(dir(rel, HT), dir(rel, HT + (ten ? 2.3 : five ? 1.6 : 0.9) * SZ));
    }
    tapes.heading = Math.round(h * 10) / 10;
    // the speed, under the heading caret, with a boost mark
    var kmh = Math.round(p.speed * 3600 / 10) * 10; parts.speedText = kmh + ' KM/H' + (p.boost ? ' · BOOST' : '');
    ctx.letterSpacing = '2px'; text(dir(0, HT - 1.6), parts.speedText, p.boost ? C.pink : C.line, 0.85, 9, 'center');
    // and under it where the suit is: latitude, longitude (2 decimals) and height (1 decimal under 100 km)
    var g = p.geo, ll = function (v, pos, neg) { return Math.abs(v).toFixed(2) + '°' + (v < 0 ? neg : pos); };
    parts.posText = ll(g[0], 'N', 'S') + ' ' + ll(g[1], 'E', 'W') + ' · ALT ' + p.alt.toFixed(p.alt < 100 ? 1 : 0) + ' KM';
    text(dir(0, HT - 3.1), parts.posText, C.line, 0.85, 9, 'center'); ctx.letterSpacing = '0px';
    stroke(C.line, 0.95, 1.5); path([dir(-0.9 * SZ, HT - 1.8 * SZ), dir(0, HT - 0.8 * SZ), dir(0.9 * SZ, HT - 1.8 * SZ)]);
    var Bn = basis(dir(0, -10));
    stroke(C.salmon, 0.85, 1.4); seg(tp(Bn, -Z(2.6), 0), tp(Bn, -Z(1.7), 0)); seg(tp(Bn, Z(1.7), 0), tp(Bn, Z(2.6), 0));
    stroke(C.salmon, 0.7, 1); dashText(Bn, 0, Z(0.2), Z(1.4), 2, Z(0.9));
    stroke(C.line, 0.7, 1.1); path([tp(Bn, -Z(0.9), -Z(1.6)), tp(Bn, 0, -Z(3)), tp(Bn, Z(0.9), -Z(1.6))]);
  }
  // the plate cluster under the nose, the whole group scaled by SZ about its centre (0, CLUSTER): Q(az, el) is where
  // a point the front frame has at (az, el -- centred on -26 there) goes
  var CLUSTER = -27;
  // The lower cluster: every shape reads the flight (the owner's picks of the cluster demos: 9, B1-B4, 1, 3, 6, 7).
  //   the chevron stack: in a climb the up chevrons ripple upward, in a dive the top V and the dashes ripple down,
  //     and the stack rides up a touch in a climb; the triangle pulses while a lock builds, a flash runs up the
  //     stack on lock (70ms a step) and the triangle holds pink while locked
  //   the dashes: the upper row scrolls with the turn; the lower row is a scrolling trace (1.7s of history) that
  //     spikes with every manoeuvre
  //   the left hex is the radar (heading-up, a sweep arm at site4's radar rate with a fading trail, the view wedge,
  //     a blip per contact that lights as the arm passes, the target's pink); the right hex is the thrust vector
  //   the turn tabs, above and below each hex, light on the side of the turn, their chevrons running outward
  //   the plates hold bars: thrust on the left (main, and the verniers that fire for each turn), reactor on the
  //     right (a row that drops pink in a dive); the cell grids blink on their own schedules
  // Reduced motion: the radar arm parks at the top; nothing scrolls, ripples, flashes or blinks.
  var SWEEP = 3.4;   // seconds a turn: site4's radar (and its emblems) turn at this rate
  function cluster(p) {
    // A narrow (portrait) view is only about +-16 deg across, so there the whole cluster scales down to fit,
    // as the seat's KX draws the grips closer: it spans about +-23 deg of the ball at full size.
    CK = m.clamp(tx / 0.34, 0.6, 1);
    var B = basis(dir(0, CLUSTER)), red = S.reduce, t = red ? 0 : p.t, la = mo.lockAge, cl = parts.cluster;
    var Q = function (x, y) { return tp(B, Z(x), Z(y)); };
    // 3: the pitch arrows, in the cluster's blue: the up arrow on top pointing up, the down arrow under the trace
    // pointing down. Climbing pushes the up arrow up (on a spring) and peels echoes off it upward, fading; diving
    // does the same downward. Only the triangle and its caret carry a state colour, always together: salmon, and
    // pink once locked (owner: the old mix of blue, salmon and pink looked muddy).
    var up = m.clamp(mo.pitch, 0, 1), dn = m.clamp(-mo.pitch, 0, 1), yUp = 3.9 + mo.au.x * 0.9, yDn = -2.9 - mo.ad.x * 0.9;
    var chev = function (y, sg) { return [Q(-1.8, y - sg * 1.3), Q(0, y), Q(1.8, y - sg * 1.3)]; };   // sg +1 points up
    var echo = function (y, sg, amt) {
      if (red || amt < 0.06) return;
      tier(3);
      for (var i = 0; i < 2; i++) { var f = (mo.echo + i / 2) % 1; stroke(C.line, 0.75 * amt * (1 - f) * (1 - f), 1.6); path(chev(y + sg * f * 1.2, sg)); }
    };
    var lTri = 0, lCar = 0, lDn = dn * 0.8, lDash = 0, lUp = up * 0.8, casc = 0;
    if (!red && mo.acqG > 0) lTri = 0.3 + 0.3 * mo.acqG + 0.35 * mo.acqG * Math.sin(t * 30);
    if (!red && la >= 0 && la < 0.6) {   // the lock's flash, bottom to top
      var lit = [0, 1, 2, 3, 4].map(function (k) { var x = (la - k * 0.07) / 0.06; return Math.exp(-x * x); });
      lTri = Math.max(lTri, lit[0]); lCar = lit[1]; lDn = Math.max(lDn, lit[2]); lDash = lit[3]; lUp = Math.max(lUp, lit[4]);
      casc = lit.filter(function (x) { return x > 0.3; }).length;
    }
    echo(yUp, 1, up); litStroke(C.line, 0.95, 2, lUp, 3); path(chev(yUp, 1));
    litStroke(C.line, 0.6, 1.1, lDash); dashScroll(B, 0, Z(1), Z(5.4), mo.dash); trace(B, 0, -Z(0.4), Z(5.4), Z(0.65));
    echo(yDn, -1, dn); litStroke(C.line, 0.95, 2, lDn, 3); path(chev(yDn, -1));
    cl.chev = { up: lUp, down: lDn, upY: yUp - 3.9, downY: -2.9 - yDn };
    var pink = !!p.locked, tc = pink ? C.bar : C.salmon, tri = [Q(-3.2, -10.4), Q(3.2, -10.4), Q(0, -7)];
    litStroke(tc, 0.85, 2, lCar); path([Q(-2, -5.8), Q(0, -4.3), Q(2, -5.8)]);   // the caret, the triangle's own
    tier(4); fill(tri, C.plate, 1); if (pink) fill(tri, C.bar, 0.16);
    litStroke(tc, 0.75, 1.5, pink ? Math.max(lTri, 0.7) : lTri); path(tri, true);
    litStroke(tc, 0.5, 1.1, pink ? 0.5 : lTri * 0.6); path([Q(-2, -9.8), Q(2, -9.8), Q(0, -7.9)], true);
    cl.cascade = casc; cl.triPink = pink; cl.dash = mo.dash; cl.caret = tc; cl.triColor = tc;
    var dr = red ? 0 : 1, bars = [], cells = '';
    [-1, 1].forEach(function (sd) {
      var bu = sd * Z(11.8), bs = Z(3.5);
      tier(4); badge(B, bu, 0, bs, true);
      if (sd < 0) radarHex(B, bu, 0, bs, p, cl); else cl.thrust = thrustHex(B, bu, 0, bs, t);
      var k = m.clamp(sd * mo.yaw, 0, 1);
      turnTab(B, bu, Z(5.1), Z(1.9), sd, k); turnTab(B, bu, -Z(5.1), Z(1.9), sd, k);
      cl.tabs = cl.tabs || []; cl.tabs[sd < 0 ? 0 : 1] = k;
      tier(4); arrowPlate(B, sd * Z(20.5), Z(0.4), Z(4), sd, true);
      var v = sd < 0
        ? [0.55 + 0.35 * Math.abs(mo.pitch) + dr * 0.04 * Math.sin(t * 2.1), 0.28 + 0.62 * Math.max(0, mo.yaw) + dr * 0.05 * Math.sin(t * 3.3), 0.28 + 0.62 * Math.max(0, -mo.yaw) + dr * 0.05 * Math.sin(t * 2.7)]
        : [0.92 + dr * 0.03 * Math.sin(t * 1.3), 0.64 + dr * 0.09 * Math.sin(t * 0.9), 0.42 + dr * 0.08 * Math.sin(t * 1.7) - 0.36 * Math.max(0, -mo.pitch)];
      v = v.map(function (x) { return m.clamp(x, 0, 1); });
      plateBars(B, sd * Z(20.5), Z(0.4), Z(4), sd, v); bars = bars.concat(v);
      cells += cellGrid(B, sd * Z(28), -Z(1.2), Z(0.75), t, sd);
    });
    cl.bars = bars; cl.cells = cells;
    var eL = project(tp(B, -Z(30.5), 0)), eR = project(tp(B, Z(30.5), 0));   // the outer edges of the cell grids
    cl.edges = [eL ? eL[0] : -1, eR ? eR[0] : 1e9]; cl.fit = CK;
    CK = 1;
  }
  // a cluster stroke lit by k (0..1): brighter, a touch heavier and with a halo scaled by k (drawn at tier 1);
  // unlit, at its own tier (4 unless given)
  function litStroke(color, alpha, width, k, base) {
    if (k > 0.05) { tier(1); HALO = { w: 3, k: 0.16 * Math.min(1, k), max: 4 }; stroke(color, alpha * 0.7 + (1 - alpha * 0.7) * Math.min(1, k), width * (1 + 0.2 * Math.min(1, k))); }
    else { tier(base || 4); stroke(color, alpha, width); }
  }
  function bump(x, a, b, r) { return smooth(a, a + r, x) * (1 - smooth(b - r, b, x)); }
  // one row of dash "text" that scrolls by phase (tangent units), wrapping inside its width
  function dashScroll(B, u, v, a, phase) {
    var span = a * 2.08;
    for (var i = 0; i < 13; i++) {
      if ((i * 7) % 5 === 3) continue;
      var x = -a + ((i * a * 0.16 + phase) % span + span) % span;
      if (x <= a) seg(tp(B, u + x, v), tp(B, u + Math.min(a * 1.11, x + a * 0.11), v));
    }
  }
  function trace(B, u, v, a, h) {
    var n = traceBuf.length, pts = [];
    for (var i = 0; i < n; i++) pts.push(tp(B, u - a + 2 * a * i / (n - 1), v + m.clamp(traceBuf[i], -1, 1) * h));
    if (n > 1) path(pts);
    parts.cluster.trace = n; parts.cluster.traceSpread = Math.max.apply(null, traceBuf) - Math.min.apply(null, traceBuf);
  }
  function radarHex(B, u, v, s, p, cl) {
    var R = s * 0.82, th = S.reduce ? 0 : (p.t / SWEEP * 360) % 360, half = Math.atan(tx) / D;
    var P = function (r, a) { return [u + Math.sin(a * D) * r * 1.15, v + Math.cos(a * D) * r]; };
    var at = function (q) { return tp(B, q[0], q[1]); };
    var wedge = function (a0, a1) { var q = [tp(B, u, v)]; for (var a = a0; a <= a1 + 0.01; a += 2.5) q.push(at(P(R, a))); return q; };
    tier(4);
    fill(wedge(-half, half), C.line, 0.07);                                                          // the view
    if (!S.reduce) for (var i = 0; i < 6; i++) fill(wedge(th - (i + 1) * 10, th - i * 10), C.line, 0.16 * (1 - i / 6));   // the trail
    stroke(C.line, 0.35, 1); path(hexPts(B, u, v, s * 0.45), true);                                // a range ring
    litStroke(C.line, 0.9, 1, 0.5); seg(tp(B, u, v), at(P(R, th)));                                // the arm
    tier(4);
    var n = 0, h = T(0.24);
    p.contacts.forEach(function (c) {
      var b = toBall(c.d), brg = Math.atan2(b[0], b[2]) / D, ago = (((th - brg) % 360) + 360) % 360 / 360 * SWEEP;
      var a = S.reduce ? 0.6 : 0.3 + 0.7 * Math.exp(-ago / 0.6), q = P(R * 0.64, brg);
      fill([tp(B, q[0] - h, q[1] - h), tp(B, q[0] + h, q[1] - h), tp(B, q[0] + h, q[1] + h), tp(B, q[0] - h, q[1] + h)], c.id === p.lockId ? C.bar : C.line, a);
      n++;
    });
    var o = T(0.42);
    fill([tp(B, u, v + o), tp(B, u + o * 0.66, v - o * 0.66), tp(B, u, v - o * 0.27), tp(B, u - o * 0.66, v - o * 0.66)], C.line, 0.8);   // own ship
    cl.radarArm = th; cl.blips = n;
  }
  // the thrust vector: a cross, and a dot on a stalk that swings with the turns (on a soft spring)
  function thrustHex(B, u, v, s, t) {
    tier(4);
    stroke(C.line, 0.35, 1); path(hexPts(B, u, v, s * 0.45), true);
    stroke(C.line, 0.3, 1); seg(tp(B, u - s * 0.85, v), tp(B, u + s * 0.85, v)); seg(tp(B, u, v - s * 0.75), tp(B, u, v + s * 0.75));
    var dr = S.reduce ? 0 : 1, ax = m.clamp(mo.vx.x * 0.9 + dr * 0.12 * Math.sin(t * 1.7), -1, 1), ay = m.clamp(mo.vy.x * 0.9 + dr * 0.1 * Math.cos(t * 1.3), -1, 1);
    var dx = ax * s * 0.62 * 1.15, dy = ay * s * 0.58, r = T(0.28);
    litStroke(C.line, 0.7, 1.3, 0.4); seg(tp(B, u, v), tp(B, u + dx, v + dy));
    tier(4); fill([tp(B, u + dx - r, v + dy), tp(B, u + dx, v + dy + r), tp(B, u + dx + r, v + dy), tp(B, u + dx, v + dy - r)], C.line, 0.95);
    return [ax, ay];
  }
  // a turn tab: a slim bracket pair round three small chevrons pointing out toward sd; turning that way lights it
  // and the chevrons run outward, faster the harder the turn
  function turnTab(B, u, v, s, sd, k) {
    var P = function (x, y) { return tp(B, u + sd * x * s, v + y * s); }, h = 0.32;
    litStroke(C.line, 0.6, 1.1, k * 0.6);
    path([P(-0.95, h), P(-1.15, h), P(-1.3, 0), P(-1.15, -h), P(-0.95, -h)]); path([P(0.95, h), P(1.15, h), P(1.3, 0), P(1.15, -h), P(0.95, -h)]);
    for (var i = 0; i < 3; i++) {
      var x = -0.45 + i * 0.45, run = S.reduce ? 1 : 0.5 + 0.5 * Math.sin(mo.tabPh - i * 2.1);
      litStroke(C.line, 0.5, 1.2, k * run); path([P(x - 0.12, h * 0.72), P(x + 0.12, 0), P(x - 0.12, -h * 0.72)]);
    }
    tier(4);
  }
  // three bar rows in an arrow plate: a track, and a fill that goes pink under 20%
  function plateBars(B, u, v, s, sd, vals) {
    var P = function (x, y) { return tp(B, u + sd * x * s, v + y * s); };
    vals.forEach(function (val, i) {
      var y = 0.3 - i * 0.3, x0 = -0.72, x1 = 0.18, xe = x0 + (x1 - x0) * Math.max(0.02, val);
      tier(4); stroke(C.line, 0.3, 1); seg(P(x0, y), P(x1, y));
      litStroke(val < 0.2 ? C.bar : C.line, 0.85, 2.6, val < 0.2 ? 0.6 : 0); seg(P(x0, y), P(xe, y));
    });
    tier(4);
  }
  // the 3 x 2 cell grid, each cell on its own blink (site4's combat-system cells); returns the pattern
  function cellGrid(B, u, v, s, t, sd) {
    var bits = '';
    tier(4);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 2; j++) {
      var q = i * 2 + j, on = Math.sin(t * 3000 / (2300 + q * 480) + q + (sd > 0 ? 3 : 0)) > -0.55;
      var x = u + (i - 1) * s * 2.3, y = v + (j - 0.5) * s * 2.3;
      fill([tp(B, x - s, y - s), tp(B, x + s, y - s), tp(B, x + s, y + s), tp(B, x - s, y + s)], C.line, on ? 0.9 : 0.15);
      bits += on ? 1 : 0;
    }
    return bits;
  }

  // ---- world-fixed ----
  // a contact: a doubled W, as in the front frame, with its label low on the right
  function wMark(po, r, color, label, labelColor) {
    var B = basis(po);
    var Wp = function (s, dy) { return [[-1, 1], [-0.5, -1], [0, 0.45], [0.5, -1], [1, 1]].map(function (q) { return tp(B, q[0] * r * s, (q[1] * r + dy) * s); }); };
    stroke(color, 0.9, 1.6); path(Wp(1, 0));
    stroke(color, 0.6, 1.2); path(Wp(0.8, -r * 0.12));
    stroke(color, 0.8, 1.3); path([tp(B, -r * 0.2, r * 0.2), tp(B, 0, -r * 0.2), tp(B, r * 0.2, r * 0.2)]);
    ctx.letterSpacing = '2px'; text(tp(B, r * 0.85, -r * 1.35), label, labelColor || color, 0.9, 9, 'left'); ctx.letterSpacing = '0px';
  }
  // the contacts: whichever is the target reads first (tier 1), pink with LOCK once locked; the rest are quieter.
  // Only an aircraft within W_RANGE km carries a mark, the target too (owner, 2026-10-07: the W only within a
  // certain range); further out there's nothing on the HUD for it
  var W_RANGE = S.W_RANGE = 30;
  function contacts(p) {
    var n = 0, tgt = null, wIds = [];
    p.contacts.forEach(function (c) {
      var po = toBall(c.d);
      if (!project(po) || c.range > W_RANGE) return;
      var opp = c.id === 'opp', isT = c.id === p.lockId, lock = isT && p.locked;
      if (isT) { tgt = c.id; return; }
      wIds.push(c.id);
      tier(opp ? 1 : 3);
      wMark(po, Z(opp ? 2 : 1.6), C.line, opp ? 'UNKNOWN' : 'MS', opp ? C.salmon : C.line);
      n++;
    });
    if (tgt) {
      var c = p.contacts.filter(function (k) { return k.id === tgt; })[0], po = toBall(c.d), lock = p.locked;
      tier(1);
      // sized to sit inside the sight's opening when it's on the nose
      wMark(po, Z(c.id === 'opp' ? 2 : 1.7), lock ? C.bar : C.line, lock ? 'LOCK' : (c.id === 'opp' ? 'UNKNOWN' : 'MS'), lock ? C.bar : C.salmon);
      n++;
    }
    if (tgt) wIds.push(tgt);
    parts.markers = n; parts.target = tgt; parts.wIds = wIds;
  }
  // The sight (the owner's pick, "E" of the lock demos, plus a sway). The big triangle rides the nose but sways: it
  // lags the suit's turns on a spring and drifts a little at rest. Idle it all sits faint. While a lock builds, the
  // brackets and V spring open, close in (jittering, the jitter settling) and slew onto the target; on lock they
  // clunk past full size, blink twice (60ms beats), then breathe and follow the target as it weaves, and a faint
  // outline pings out each second. When the lock breaks, a copy of the brackets flies apart. Reduced motion: no
  // springs, sway, jitter or pings.
  var LOCK_AT = 0.5;   // lockT at which the lock completes (ball.js LOCK_TIME)
  var IDLE_A = 0.15;
  var sp = { k: { x: 1, v: 0 }, cu: { x: 0, v: 0 }, cv: { x: 0, v: 0 }, wx: { x: 0, v: 0 }, wy: { x: 0, v: 0 }, wr: { x: 0, v: 0 } };
  var was = 'idle', lost = null;
  function spring(o, to, w, z, dt) { o.v += (-w * w * (o.x - to) - 2 * z * w * o.v) * dt; o.x += o.v * dt; }
  // The suit's motion, worked out once a frame for everything that reacts to it: the turn rates (body frame,
  // rad/s), and yaw (+ right) and pitch (+ up) normalised to -1..1 and smoothed; how long the lock has been held;
  // the dash scroll, the thrust vector's springs, the tab chevrons' run, and the trace's history.
  var mo = { dt: 0, om: [0, 0, 0], yaw: 0, pitch: 0, lockAge: -1, acqG: 0, dash: 0, tabPh: 0, vx: { x: 0, v: 0 }, vy: { x: 0, v: 0 },
    au: { x: 0, v: 0 }, ad: { x: 0, v: 0 }, echo: 0 };   // the pitch arrows' push (springs) and their echoes' run
  var moT = null, moQ = null, traceBuf = [], traceNext = 0;
  function wave(x) { return Math.sin(x * 7) * 0.3 + Math.sin(x * 13.3) * 0.3 + Math.sin(x * 29) * 0.22 + Math.sin(x * 61) * 0.13; }
  function motion(p) {
    var dt = moT === null ? 0 : m.clamp(p.t - moT, 0, 0.05), q = p.suitQ, om = [0, 0, 0];
    moT = p.t; mo.dt = dt;
    if (moQ && dt > 0) { var dq = m.qmul(m.qconj(moQ), q), sg = dq[3] < 0 ? -2 / dt : 2 / dt; om = [dq[0] * sg, dq[1] * sg, dq[2] * sg]; }
    moQ = q; mo.om = om;
    var k = dt > 0 ? 1 - Math.exp(-dt / 0.12) : 0;
    mo.yaw += (m.clamp(om[1] / 0.35, -1, 1) - mo.yaw) * k;
    mo.pitch += (m.clamp(-om[0] / 0.3, -1, 1) - mo.pitch) * k;
    mo.lockAge = p.locked ? p.lockT - LOCK_AT : -1;
    mo.acqG = !p.locked && p.lockId && p.lockT > 0 ? m.clamp(p.lockT / LOCK_AT, 0, 1) : 0;
    if (!traceBuf.length) { for (var i = 0; i < 57; i++) traceBuf.push(wave(p.t - 1.7 + i * 0.03) * 0.3); traceNext = p.t; }
    if (S.reduce) return;
    mo.dash += mo.yaw * dt * Z(6);
    mo.tabPh += dt * (4 + 10 * Math.abs(mo.yaw));
    spring(mo.vx, mo.yaw, 6, 0.45, dt); spring(mo.vy, mo.pitch, 6, 0.45, dt);
    spring(mo.au, Math.max(0, mo.pitch), 9, 0.5, dt); spring(mo.ad, Math.max(0, -mo.pitch), 9, 0.5, dt);
    mo.echo = (mo.echo + dt * (1 + 1.5 * Math.abs(mo.pitch))) % 1;
    // the trace: a sample every 30ms, 57 kept (1.7s), bigger while manoeuvring
    if (p.t - traceNext > 2) traceNext = p.t - 1.7;
    for (; traceNext <= p.t; traceNext += 0.03) {
      traceBuf.push(wave(traceNext) * (0.3 + 0.9 * m.clamp(Math.abs(mo.yaw) + Math.abs(mo.pitch), 0, 1)) + (Math.random() - 0.5) * 0.12);
      if (traceBuf.length > 57) traceBuf.shift();
    }
  }
  function lockSight(p) {
    var acq = !!p.lockId && !p.locked && p.lockT > 0, since = p.lockT - LOCK_AT, st = p.locked ? 'lock' : acq ? 'acq' : 'idle';
    var g = acq ? m.clamp(p.lockT / LOCK_AT, 0, 1) : (p.locked ? 1 : 0);   // how far the lock has built
    var blinkOff = p.locked && ((since >= 0.06 && since < 0.12) || (since >= 0.18 && since < 0.24));
    var dt = mo.dt, om = mo.om;
    // the target, in tangent units off the nose
    var tc = p.contacts.filter(function (c) { return c.id === p.lockId; })[0], tb = tc && toBall(tc.d);
    var aim = st !== 'idle' && tb && tb[2] > 0.5 ? [tb[0] / tb[2], tb[1] / tb[2]] : [0, 0];
    if (st === 'acq' && was === 'idle') sp.k.v += 9;     // flare open as the lock starts
    if (st === 'lock' && was !== 'lock') sp.k.v -= 3.5;  // the clunk into the lock
    if (was === 'lock' && st !== 'lock') lost = { t: p.t, cu: sp.cu.x, cv: sp.cv.x, k: sp.k.x };
    was = st;
    var kTo = st === 'acq' ? 1.5 - 0.45 * g : st === 'lock' ? 1 + 0.018 * Math.sin(since * 7.5) : 1;
    var lim = function (x, a) { return m.clamp(x, -a, a); };
    if (S.reduce) {
      sp.k.x = st === 'lock' ? 1 : kTo; sp.cu.x = aim[0]; sp.cv.x = aim[1]; sp.wx.x = sp.wy.x = sp.wr.x = 0; lost = null;
    } else {
      spring(sp.k, kTo, 15, 0.42, dt);
      var wc = st === 'acq' ? 8 : 28;   // slews in loosely, sticks tight once locked
      spring(sp.cu, aim[0], wc, 0.8, dt); spring(sp.cv, aim[1], wc, 0.8, dt);
      spring(sp.wx, lim(-om[1] * 0.025, 0.014) + 0.0025 * Math.sin(p.t * 0.9), 6, 0.5, dt);
      spring(sp.wy, lim(om[0] * 0.025, 0.014) + 0.0018 * Math.sin(p.t * 1.3 + 1), 6, 0.5, dt);
      spring(sp.wr, lim(-om[2] * 0.08, 0.06) + 0.012 * Math.sin(p.t * 0.7), 6, 0.5, dt);
    }
    var k = sp.k.x, kf = 1 + (k - 1) * 0.25, cu = sp.cu.x, cv = sp.cv.x;
    var fly = lost ? (p.t - lost.t) / 0.3 : 1; if (fly >= 1) lost = null;
    var shake = acq && !S.reduce ? 0.4 * (0.006 * (1 - g) + 0.0012) : 0;   // tangent units: big at first, settling
    var jit = function () { return (Math.random() - 0.5) * shake; };
    parts.sight = p.locked; parts.sightStage = p.locked ? (blinkOff ? 'blink' : 'on') : acq ? 'acquire' : 'idle';
    parts.sightScale = k; parts.sightCue = [cu, cv]; parts.sightCueErr = Math.hypot(cu - aim[0], cv - aim[1]);
    parts.sightSway = [sp.wx.x, sp.wy.x, sp.wr.x]; parts.sightFly = lost ? fly : 0; parts.sightPings = 0;
    if (blinkOff) return;
    tier(1);
    if (!p.locked) { GA = IDLE_A + (0.7 - IDLE_A) * g; HALO = null; }
    else if (since > 0.24 && !S.reduce) GA = 0.9 + 0.1 * Math.sin(since * 7.5);
    var cr = Math.cos(sp.wr.x), sr = Math.sin(sp.wr.x);
    // the frame (swaying) and the cue (the brackets and V, on the target), from tangent offsets (x right, y up)
    var Fr = function (x, y) { return tp(F, sp.wx.x + x * cr - y * sr, sp.wy.x + x * sr + y * cr); };
    var jx = jit(), jy = jit();
    var Cu = function (x, y) { return tp(F, cu + x + jx, cv + y + jy); };
    if (Y_SIGHT) {
      [150, 30, 270].forEach(function (an) {
        var c = Math.cos(an * D), sn = Math.sin(an * D), w = 0.0045 * SZ * 0.55;
        [-1, 1].forEach(function (o) { var pt = function (r) { return Cu((c * r - sn * o * w) * k, (sn * r + c * o * w) * k); }; stroke(C.line, 0.8, 1.8); seg(pt(0.03 * SZ * 0.55), pt(0.085 * SZ * 0.55)); });
      });
      ctx.letterSpacing = '2px'; text(Fr(0.055, 0.055), p.modeWord, C.pink, 0.95, 9, 'left'); ctx.letterSpacing = '0px';
    } else {
      // TRI: the sight at about half its old size (owner); kf: the frame breathes a quarter as much as the cue
      var TRI = 0.55, u = Math.min(0.22, tx * 0.4) * SZ * TRI / 237, lw = Math.max(0.6, f / 605 * 0.8 * SZ * TRI * 1.35);
      var L = function (x, y) { return Fr(x * u * kf, -y * u * kf); }, B = function (x, y) { return Cu(x * u * k, -y * u * k); };
      var Tt = -200, A = 210, hw = 237, len = Math.hypot(hw, A - Tt), face = [L(-hw, Tt), L(hw, Tt), L(0, A)];
      var keep = HALO;
      fill(face, 'rgb(170, 186, 245)', 0.07); HALO = null; stroke(C.line, 0.34, Math.max(1, lw)); path(face, true);
      // the ping: a faint outline echo going out, on lock and every second after
      if (p.locked && !S.reduce && since % 1 < 0.5) {
        var pq = (since % 1) / 0.5, Pg = function (x, y) { return Fr(x * u * kf * (1 + 0.4 * pq), -y * u * kf * (1 + 0.4 * pq)); };
        var ga = GA; GA = 1; stroke(C.line, 0.45 * (1 - pq) * (1 - pq), 1.2); path([Pg(-hw, Tt), Pg(hw, Tt), Pg(0, A)], true); GA = ga;
        parts.sightPings = 1;
      }
      HALO = keep;
      var brk = function (sd, P) { var ix = sd * hw * 0.62, iy = Tt + 62, ux = -sd * hw / len, uy = (A - Tt) / len; return [P(ix - sd * 78, iy), P(ix, iy), P(ix + ux * 84, iy + uy * 84)]; };
      [-1, 1].forEach(function (sd) {
        var ux = -sd * hw / len, uy = (A - Tt) / len, nx = sd * (A - Tt) / len, ny = hw / len;
        var at = function (t, off) { return L(sd * hw + ux * len * t + nx * off, Tt + uy * len * t + ny * off); };
        stroke(C.line, 0.7, 7 * lw); seg(at(-0.04, 30), at(0.3, 30)); seg(at(0.72, 30), at(1.03, 30));
        stroke(C.line, 0.64, 4.6 * lw); path(brk(sd, B));
      });
      stroke(p.locked ? C.bar : C.line, p.locked ? 0.9 : 0.64, 4.6 * lw); path([B(-48, A - 196), B(0, A - 116), B(48, A - 196)]);
      ctx.letterSpacing = '2px'; text(L(hw + 6, Tt - 14), p.modeWord, C.pink, 0.95, 9, 'right'); ctx.letterSpacing = '0px';
      // the broken lock: a copy of the brackets flies apart where the lock was
      if (lost) {
        var lk = lost.k * (1 + 0.8 * fly);
        [-1, 1].forEach(function (sd) {
          var Fl = function (x, y) { return tp(F, lost.cu + (x + sd * fly * 90) * u * lk, lost.cv - (y - fly * 40) * u * lk); };
          GA = 1; tier(1); stroke(C.line, 0.7 * (1 - fly), 4.6 * lw); path(brk(sd, Fl));
        });
      }
    }
    GA = 1;
  }




  S.project = function (p) { return E ? project(p) : null; };
  S.anchors = { capL: dir(-GAP, RAIL), rulerL: dir(-RULER, -7.5), cluster: dir(0, CLUSTER), heading: dir(0, 22.2), nose: [0, 0, 1], apex: dir(0, -4.5) };
  // The panel centres: an icosahedron, each face split 3 ways (92 points, the 12 corners are the pentagons).
  // Turned so one face's centre is the nose (a hexagon square in front), with one of that face's corners
  // straight above or below it, so the pattern mirrors left to right; of the two, the one keeping the
  // pentagons further from the nose, sides, tail, top and bottom.
  var cells = (function () {
    var P = (1 + Math.sqrt(5)) / 2;
    var V = [[-1, P, 0], [1, P, 0], [-1, -P, 0], [1, -P, 0], [0, -1, P], [0, 1, P], [0, -1, -P], [0, 1, -P], [P, 0, -1], [P, 0, 1], [-P, 0, -1], [-P, 0, 1]].map(m.norm);
    var FACES = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
                 [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    var pts = [], seen = {};
    FACES.forEach(function (fc) {
      for (var i = 0; i <= 3; i++) for (var j = 0; j <= 3 - i; j++) {
        var k = 3 - i - j, a = V[fc[0]], b = V[fc[1]], c = V[fc[2]];
        var q = m.norm([a[0] * i + b[0] * j + c[0] * k, a[1] * i + b[1] * j + c[1] * k, a[2] * i + b[2] * j + c[2] * k]);
        var key = q.map(function (x) { return x.toFixed(4); }).join();
        if (!seen[key]) { seen[key] = 1; pts.push(q); }
      }
    });
    var f0 = FACES[0], g = m.norm([0, 1, 2].reduce(function (s, n) { return [s[0] + V[f0[n]][0], s[1] + V[f0[n]][1], s[2] + V[f0[n]][2]]; }, [0, 0, 0]));
    function frame(up) {
      // z' = the face centre, y' = toward (or away from) one of its corners, x' = y' x z'
      var c = V[f0[0]], d = m.dot(c, g), y = m.norm([(c[0] - g[0] * d) * up, (c[1] - g[1] * d) * up, (c[2] - g[2] * d) * up]);
      var x = [y[1] * g[2] - y[2] * g[1], y[2] * g[0] - y[0] * g[2], y[0] * g[1] - y[1] * g[0]];
      return function (q) { return [m.dot(q, x), m.dot(q, y), m.dot(q, g)]; };
    }
    var best = null;
    [1, -1].forEach(function (up) {
      var T = frame(up), corners = V.map(T), worst = 180;
      [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]].forEach(function (t) {
        corners.forEach(function (c) { worst = Math.min(worst, Math.acos(m.clamp(m.dot(c, t), -1, 1)) / m.D); });
      });
      if (!best || worst > best.worst) best = { worst: worst, T: T };
    });
    var out = pts.map(best.T);
    S.panels = { n: pts.length, pentagonClearance: Math.round(best.worst), cells: out };
    return out;
  })();

  // The panels' seams: the Voronoi edges of the 92 cell centres. Neighbouring cells (within 30 deg) share an edge
  // between the circumcentres of the two triangles they make with their two common neighbours. Worked out once;
  // drawn as thin light joints on the ball, easing off to 45% within ~20 deg of the nose so the aim reads clean.
  var SEAMS = (function () {
    var nb = cells.map(function (a) { return cells.map(function (b, j) { return j; }).filter(function (j) { var d = m.dot(a, cells[j]); return d < 0.9999 && d > 0.866; }); });
    var cc = function (a, b, c) {
      var u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      var n = m.norm([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
      return m.dot(n, [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]) < 0 ? [-n[0], -n[1], -n[2]] : n;
    }, out = [];
    nb.forEach(function (ns, i) { ns.forEach(function (j) {
      if (j <= i) return;
      var k = ns.filter(function (q) { return nb[j].indexOf(q) >= 0; });
      if (k.length === 2) out.push([cc(cells[i], cells[j], cells[k[0]]), cc(cells[i], cells[j], cells[k[1]])]);
    }); });
    S.panels.seams = out.length;
    return out;
  })();
  var SEAM_K = { mix: 0.75, xi: 0.95, penelope: 0.45 }[S.look] || 0.75;
  function seams() {
    tier(4);
    SEAMS.forEach(function (e) {
      var z = (e[0][2] + e[1][2]) / 2, clear = 0.45 + 0.55 * (1 - Math.max(0, Math.min(1, (z - 0.94) / 0.045)));
      stroke('#9EAFC8', 0.5 * SEAM_K * clear, 1); path(e);
    });
  }

  S.renderers.push(function (p, w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    W = w; H = h; E = p.eye; EQi = m.qconj(p.eyeQ); SQi = m.qconj(p.suitQ); tx = S.cam.tx; ty = S.cam.ty; f = W / 2 / tx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    parts._litG = 0; parts.halo = {};
    motion(p); parts.cluster = { railPulse: false };
    seams();
    rulers(p);
    RING_AZ.forEach(sideRing);
    rail(p);
    centre(p);
    cluster(p);
    contacts(p);
    lockSight(p);
    parts.rear = !!(project(dir(180, RAIL)) || project(dir(150, RAIL)) || project(dir(-150, RAIL)));
    ctx.globalAlpha = 1;
  });
  if (document.fonts && document.fonts.load) document.fonts.load('12px Michroma');
})();
