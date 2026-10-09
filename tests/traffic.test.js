// site5 traffic sim checks, plain Node: node site5/tests/traffic.test.js
const assert = require('assert');
require('../js/traffic.js');
const { makeTraffic } = globalThis.SITE5;

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '  ' + e.message); }
}
// the suit flying north at 0.25 km/s, 11 km up
function fly(seed, secs, dt, each) {
  const tr = makeTraffic(seed), suit = { pos: [0, 11, 0], heading: 0 };
  for (let t = 0; t < secs; t += dt) { suit.pos[2] += 0.25 * dt; each(tr.step(dt, suit), t); }
}
const HEIGHTS = { AIRLINER: [9.5, 12], FREIGHTER: [8, 10.5], BIZJET: [11, 13], BALLOON: [15, 30] };
const REAL = ['AAL', 'DAL', 'UAL', 'BAW', 'AFR', 'DLH', 'UAE', 'QFA', 'JAL', 'ANA', 'SIA', 'CPA', 'KLM', 'RYR', 'EZY'];

check('same seed, same sky', () => {
  const suit = { pos: [0, 11, 0], heading: 0 };
  const a = makeTraffic(7).step(0.1, suit), b = makeTraffic(7).step(0.1, suit);
  assert.deepStrictEqual(a.map(c => [c.id, c.type, c.pos]), b.map(c => [c.id, c.type, c.pos]));
});
check('6 to 9 aircraft, all within 70 km', () => {
  fly(3, 600, 0.1, cs => {
    assert.ok(cs.length >= 6 && cs.length <= 9, 'count ' + cs.length);
    cs.forEach(c => assert.ok(c.range > 0 && c.range <= 70, c.id + ' range ' + c.range));
  });
});
check('they leave and are replaced', () => {
  const seen = new Set(); let last = new Set();
  fly(3, 600, 0.1, cs => { cs.forEach(c => seen.add(c.id)); last = new Set(cs.map(c => c.id)); });
  const gone = [...seen].filter(id => !last.has(id)).length;
  assert.ok(gone >= 3, 'gone ' + gone);
});
// high above the airways nothing can come within 70 km: the sky is empty, not refilled with new aircraft every step
// (from 400 km it spawned 7 and dropped them again every frame, ~1500 a second, so nothing could ever be locked)
check('from 400 km up the sky is empty, no churn', () => {
  const tr = makeTraffic(7), suit = { pos: [0, 400, 0], heading: 0 };
  for (let i = 0; i < 100; i++) assert.strictEqual(tr.step(0.1, suit).length, 0, 'step ' + i);
});
check('coming back down, aircraft return and stay', () => {
  const tr = makeTraffic(7), suit = { pos: [0, 400, 0], heading: 0 };
  for (let i = 0; i < 20; i++) tr.step(0.1, suit);
  suit.pos[1] = 11; const a = tr.step(0.1, suit).map(c => c.id), b = tr.step(0.1, suit).map(c => c.id);
  assert.ok(a.length >= 6, 'count ' + a.length);
  assert.ok(a.every(id => b.includes(id)), 'the same aircraft a step later: ' + a + ' / ' + b);
});
check('directions are unit vectors', () => {
  fly(5, 30, 0.5, cs => cs.forEach(c => assert.ok(Math.abs(Math.hypot(...c.d) - 1) < 1e-6, c.id)));
});
check('heights by type', () => {
  fly(11, 600, 0.5, cs => cs.forEach(c => {
    const [lo, hi] = HEIGHTS[c.type];
    assert.ok(c.pos[1] >= lo && c.pos[1] <= hi, c.type + ' at ' + c.pos[1]);
  }));
});
check('callsigns', () => {
  fly(13, 120, 0.5, cs => cs.forEach(c => {
    assert.ok(c.type === 'BALLOON' ? /^WX \d{2,3}$/.test(c.callsign) : /^[A-Z]{3} \d{2,3}$/.test(c.callsign), c.callsign);
    assert.ok(!REAL.includes(c.callsign.slice(0, 3)), c.callsign);
  }));
});
check("jets leave contrails, balloons don't", () => {
  let seed = 1, tr, cs;   // a sky with a balloon in it from the start
  for (; seed < 200; seed++) { tr = makeTraffic(seed); cs = tr.step(0.1, { pos: [0, 11, 0], heading: 0 }); if (cs.some(c => c.type === 'BALLOON')) break; }
  const suit = { pos: [0, 11, 0], heading: 0 };
  for (let t = 0; t < 3; t += 0.1) { suit.pos[2] += 0.025; cs = tr.step(0.1, suit); }
  cs.forEach(c => c.type === 'BALLOON' ? assert.strictEqual(c.trail.length, 0, c.id) : assert.ok(c.trail.length > 4, c.id + ' trail ' + c.trail.length));
});
check('?near puts an airliner close ahead', () => {
  const c = makeTraffic(7, { near: true }).step(0.1, { pos: [0, 11, 0], heading: 0 }).filter(c => c.type === 'AIRLINER' && c.range < 1.5);
  assert.ok(c.length === 1 && c[0].d[2] > 0.9 && c[0].span === 0.06, JSON.stringify(c.map(k => [k.range, k.d, k.span])));
});
process.exitCode = failed ? 1 : 0;
