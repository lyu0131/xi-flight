/* traffic.js: the air traffic round the suit, in the world frame (x east, y up, z north, km; heading 0 north,
   clockwise). Seven at a time: airliners, freighters and business jets on airways at 8-13 km, now and then a
   weather balloon rising through 15-30 km. Each flies straight, now and then easing through a gentle turn; they're
   spawned 25-55 km out round the suit's heading, so they come into view ahead, and dropped past 70 km. All generic:
   no real airlines or aircraft, made-up callsigns. Seeded, so a page (and its tests) sees the same sky every time.
   SITE5.makeTraffic(seed).step(dt, suit) -> the contacts: where each is, and its direction and range from the suit
   (the Earth's curve taken off the height, so a far one sits a little lower), its span (km), and for the jets a
   trail: where it was every half second, the last 24, for its contrail. makeTraffic(seed, { near: true }) also puts
   an airliner 1 km out, 12 deg right of the nose, crossing (for a close look, and the tests). Loads in Node too. */
(function (root) {
  'use strict';
  var S = root.SITE5 || (root.SITE5 = {});
  var D = Math.PI / 180, R = S.RE || 6371, KEEP = 7, OUT = 70;   // the globe's radius (ball.js sets SITE5.RE)
  var TYPES = {
    AIRLINER: { w: 0.45, spd: 0.25, alt: [9.5, 12], span: 0.06 },
    BIZJET: { w: 0.25, spd: 0.24, alt: [11, 13], span: 0.02 },
    FREIGHTER: { w: 0.2, spd: 0.23, alt: [8, 10.5], span: 0.068 },
    BALLOON: { w: 0.1, spd: 0.002, alt: [15, 30], span: 0.004 }
  };
  var PREFIX = ['KTR', 'VAN', 'OSK', 'MRK', 'TLS', 'ORV', 'PEL', 'NAU'];   // made up
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function wrap(a) { return ((a % 360) + 540) % 360 - 180; }

  S.makeTraffic = function (seed, opts) {
    var rnd = mulberry32(seed), list = [], n = 0, near = opts && opts.near;
    function pick() {
      var r = rnd(), acc = 0, ks = Object.keys(TYPES);
      for (var i = 0; i < ks.length; i++) { acc += TYPES[ks[i]].w; if (r < acc) return ks[i]; }
      return ks[0];
    }
    function spawn(suit) {
      var type = pick(), T = TYPES[type], brg = suit.heading + (rnd() * 2 - 1) * 70, dist = 25 + rnd() * 30;
      var hdg = brg + 180 + (rnd() * 2 - 1) * 100;   // broadly toward or across the suit's way
      var no = 10 + Math.floor(rnd() * 890);
      list.push({
        id: 't' + n++, type: type, callsign: (type === 'BALLOON' ? 'WX' : PREFIX[Math.floor(rnd() * PREFIX.length)]) + ' ' + no,
        pos: [suit.pos[0] + Math.sin(brg * D) * dist, T.alt[0] + rnd() * (T.alt[1] - T.alt[0]), suit.pos[2] + Math.cos(brg * D) * dist],
        hdg: ((hdg % 360) + 360) % 360, spd: T.spd, turnTo: hdg, turnAt: 30 + rnd() * 30, age: 0, trail: [], trailT: 0
      });
    }
    function seen(a, suit) {
      var dx = a.pos[0] - suit.pos[0], dz = a.pos[2] - suit.pos[2], h = Math.hypot(dx, dz);
      var dy = a.pos[1] - suit.pos[1] - h * h / (2 * R), range = Math.hypot(dx, dy, dz) || 1e-6;
      return { range: range, d: [dx / range, dy / range, dz / range] };
    }
    return {
      step: function (dt, suit) {
        list.forEach(function (a) {
          a.age += dt;
          if (a.age > a.turnAt) { a.turnTo = a.hdg + (rnd() * 2 - 1) * 20; a.turnAt = a.age + 30 + rnd() * 30; }
          a.hdg = (((a.hdg + Math.max(-1.5 * dt, Math.min(1.5 * dt, wrap(a.turnTo - a.hdg)))) % 360) + 360) % 360;
          a.pos[0] += Math.sin(a.hdg * D) * a.spd * dt; a.pos[2] += Math.cos(a.hdg * D) * a.spd * dt;
          if (a.type === 'BALLOON') { a.pos[1] += 0.005 * dt; if (a.pos[1] > 30) a.pos[1] = 15; }
          else if ((a.trailT += dt) >= 0.5) { a.trailT = 0; a.trail.push(a.pos.slice()); if (a.trail.length > 24) a.trail.shift(); }
        });
        list.forEach(function (a) { a.v = seen(a, suit); });
        list = list.filter(function (a) { return a.v.range <= OUT; });
        if (near) {   // once: an airliner close by, crossing ahead
          near = false; var b = suit.heading + 12;
          list.push({ id: 't' + n++, type: 'AIRLINER', callsign: 'KTR 214', hdg: ((suit.heading + 90) % 360 + 360) % 360, spd: 0.25,
            pos: [suit.pos[0] + Math.sin(b * D), suit.pos[1] + 0.05, suit.pos[2] + Math.cos(b * D)], turnTo: suit.heading + 90, turnAt: 1e9, age: 0, trail: [], trailT: 0 });
        }
        while (list.length < KEEP) spawn(suit);
        return list.map(function (a) {
          var v = a.v || seen(a, suit); a.v = null;
          return { id: a.id, type: a.type, callsign: a.callsign, pos: a.pos.slice(), hdg: a.hdg, spd: a.spd, span: TYPES[a.type].span, d: v.d, range: v.range, trail: a.trail };
        });
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
