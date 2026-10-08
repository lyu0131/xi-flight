const fs = require('fs'), path = require('path'); const { check } = require('./cdp');
const f = path.join(__dirname, '../assets/seat.glb'); const ok = fs.existsSync(f); check('seat.glb exists', ok); if (!ok) process.exit(1);
const b = fs.readFileSync(f), len = b.readUInt32LE(12), J = JSON.parse(b.slice(20, 20 + len).toString());
const names = new Set(J.materials.map(m => m.name)), ex = (J.scenes[J.scene || 0].extras || J.asset.extras || {});
check('every A_ material is there', ['A_shell', 'A_plate', 'A_quilt', 'A_leather', 'A_perf', 'A_pipe', 'A_glow', 'A_metal', 'A_chrome', 'A_dark', 'A_ink', 'A_lens', 'A_rubber'].every(n => names.has(n)), [...names].join(','));
check('every primitive has UVs and tangents', J.meshes.every(m => m.primitives.every(p => 'TEXCOORD_0' in p.attributes && 'TANGENT' in p.attributes)));
check('the atlas maps are on the materials', J.materials.filter(m => m.name !== 'A_glow' && m.name !== 'A_lens').every(m => m.pbrMetallicRoughness.baseColorTexture && m.normalTexture && m.occlusionTexture && m.pbrMetallicRoughness.metallicRoughnessTexture));
check('extras carry glowMax, the ring centre and the sample points', ex.glowMax > 0 && ex.ring.length === 3 && ['seat', 'rail', 'grip', 'frame'].some(g => (ex.points[g] || []).length > 4), JSON.stringify(Object.keys(ex)));
// the same place as the old export: the ring centre matches the retired seat-data.js's (seat frame), z negated
const r0 = [0.38, -0.41363, 0.57841];
check('the glb sits where seat-data did (ring centre, Three axes)', Math.abs(ex.ring[0] - r0[0]) < 1e-3 && Math.abs(ex.ring[1] - r0[1]) < 1e-3 && Math.abs(ex.ring[2] + r0[2]) < 1e-3, JSON.stringify([ex.ring, r0]));
check('the strips\' lightmap is there', fs.existsSync(path.join(__dirname, '../assets/seat-light.jpg')));
check('seat.glb under 30 MB', fs.statSync(f).size < 30e6, (fs.statSync(f).size / 1e6).toFixed(1) + ' MB');
