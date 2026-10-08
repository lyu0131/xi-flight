# The Seat Lit by the Monitor: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light the cockpit seat with the monitor's live picture of the world, and rebuild it in Three.js with real baked PBR materials.

**Architecture:**
- `sky.js` captures a 64² cube of the displayed world, one face per frame, and reads it back asynchronously into `SITE5.env`.
- `seat.js` becomes an ES module with its own Three.js renderer on `#seat`. It turns `SITE5.env` into a PMREM environment that lights the pod and the hand rings.
- Blender bakes the pod's look into an atlas exported as `assets/seat.glb`. The seat swaps to it in Task 4.

**Tech Stack:**
- three@0.181.0 (GLTFLoader, PMREMGenerator, CubeTexture of DataTextures, `readRenderTargetPixelsAsync`)
- postprocessing@6.38.0 (EffectComposer, BloomEffect)
- @takram/three-atmosphere@0.19.1 and @takram/three-clouds@0.7.6
- Blender 4.x (Cycles bake, glTF export)
- the headless-Chrome CDP harness

**Spec:** `site5/docs/2026-10-08-seat-light-design.md`

## Global Constraints

- **Code style:** static site with no build step. ES modules through the import map in `site5/index.html`. Relative paths only.
- **No commits or pushes** unless the owner asks. The branch carries the owner's uncommitted site4 work, and pushing main deploys site4. Track progress in `.superpowers/sdd/plan-seat-light/progress.md` and tick the boxes here.
- **Downloads** need the owner's explicit approval: name, source and size of each file, asked in chat.
- **The Cesium token** in `site5/js/keys.js` is never printed, logged or copied.
- **The light rule:** the cockpit is closed; the only light is the monitor's displayed picture plus the seat's own lights. No moon or sun light, and no shadowed key light.
- **Tone mapping:** the seat uses `THREE.NeutralToneMapping` at exposure 1. The capture is the world after AgX at the world's own exposure, stored as sRGB display bytes.
- **Seat axes in Three.js:** x right, y up, −z forward. That is the old seat frame (z forward) with z negated, in ball radii (1 ≈ 1.4 m), with the eye at the origin.
- **The camera** keeps the old seat projection: tan `S.cam.tx/ty`, `KX = clamp(tx/0.95, 0.42, 1)` as an x-scale on the scene, `LIFT = 0.035` as a raise of the scene, and the head from `pose.head.yaw/pitch`.
- **Test hooks that must keep working:**
  - `S.parts.seat` (sample-point visibility, refreshed every 15 frames);
  - `S.parts.seatAO`;
  - `S.parts.ringOpen`, `ringTurn`, `controls`, `controlsL`, `ringGroups`, `gripAt`;
  - `S.seatGL` (a WebGL context whose drawing buffer the tests read in a rAF).
- **Preferences:** respect `prefers-reduced-motion`. No orange-and-black hazard stripes.
- **Done means:** every page is checked at 375 px (no horizontal scroll) and at desktop with headless-Chrome screenshots.
- **Run tests from the repo root:** `node site5/tests/cockpit.test.js` (all 127 existing checks must still pass) and `node site5/tests/traffic.test.js` (8 checks).

## Review Focus

1. **The capture's composer must not resize the main renderer** (postprocessing's `EffectComposer.setSize` calls `renderer.setSize`). After a window resize, the world's drawing buffer must still be the main composer's size. Test in Task 1.
2. **The seat must never render black before the first capture** (a slow CDN or `?capture=0`): it gets the flat 0.02 grey. Test in Task 2.
3. **`seat.glb` failing to load:** the readout says `THE SEAT COULDN'T LOAD`, the flight runs on and there are no JS errors apart from the failed fetch. Test in Task 4.
4. **Reduced motion:** the capture still refreshes, so the seat's light still follows the world. Test in Task 1.
5. **Cube orientation:** a bright face to the seat's right lights its right-facing surfaces, not the left. Test in Task 2, with a synthetic env.

---

### Task 1: The monitor capture (`sky.js`)

**Files:**
- Modify: `site5/js/sky.js` (after the main composer; per frame at the end of the renderer function)
- Test: `site5/tests/cockpit.test.js` (new block `// ---- the monitor capture ----` after the "light & clouds" block)

**Interfaces:**
- Produces:
  - `SITE5.env = { n: number, size: 64, faces: Uint8Array[6] }`
    - Each face is 64·64·4 bytes, sRGB display values, rows as `readPixels` returns them.
    - Faces are in Three.js cube order (+x −x +y −y +z −z), in **seat axes**, which map to the world by seat vector `s = [x, y, -z]`, then `toECEF(m.qrot(pose.suitQ, s))`.
    - `n` goes up by 1 after each full set of six new faces.
  - `SITE5.envFreeze`: when true, `sky.js` stops writing `SITE5.env`. Tests use it to inject a synthetic env.
  - `SITE5.envClouds: boolean`: whether the capture includes the clouds.
  - URL `?capture=0` turns the capture off.
  - `SITE5.loaded(k)`: the existing `loaded`, exposed for `seat.js`. `LOADS` gains `'seat'` in Task 4, not here.

- [ ] **Step 1: Write the failing tests**

```js
// ---- the monitor capture ----
await p.goto(PAGE, 300); await ready(p);
const n0 = await p.eval('SITE5.env ? SITE5.env.n : -1'); await p.sleep(2000);
const env = JSON.parse(await p.eval('JSON.stringify(SITE5.env && { n: SITE5.env.n, size: SITE5.env.size, faces: SITE5.env.faces.length, len: SITE5.env.faces[0].length })'));
check('the monitor is captured: 6 faces of 64x64, refreshing', env && env.size === 64 && env.faces === 6 && env.len === 64 * 64 * 4 && env.n - n0 >= 3, JSON.stringify(env) + ' from ' + n0);
const faceMean = k => k.eval('(() => { let s = 0; for (const f of SITE5.env.faces) for (let i = 0; i < f.length; i += 4) s += f[i] + f[i + 1] + f[i + 2]; return s / (6 * 64 * 64 * 3 * 255); })()');
// day vs night: the capture is the displayed picture, so day is far brighter
await p.goto('../site5/index.html?seed=7&alt=18&hdg=90&time=2026-10-08T11:00:00Z', 300); await ready(p); await p.sleep(1500); const day = await faceMean(p);
await p.goto('../site5/index.html?seed=7&alt=18&hdg=90&time=2026-10-08T22:00:00Z', 300); await ready(p); await p.sleep(1500); const night = await faceMean(p);
check('the capture follows the world: day brighter than night', day > night * 3 && day > 0.15, day.toFixed(3) + ' vs ' + night.toFixed(3));
// up is up: at noon the sky (+y face, index 2) is brighter than the ground (-y, index 3)... at 18 km the ground is lit land/sea, the sky bright blue
// (checked on the day page)
// resize keeps the main picture's size (the capture composer mustn't resize the renderer)
await p.goto('../site5/index.html?seed=7&alt=18&hdg=90&time=2026-10-08T11:00:00Z', 300); await ready(p);
await p.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false }); await p.sleep(800);
check('after a resize the world picture is full size, not the capture\'s', await p.eval('SITE5.gl.drawingBufferWidth > 400 && SITE5.gl.drawingBufferHeight > 280'), await p.eval('SITE5.gl.drawingBufferWidth + "x" + SITE5.gl.drawingBufferHeight'));
await p.send('Emulation.clearDeviceMetricsOverride', {});
```

A reduced-motion check goes in the existing reduced-motion block. There, after it loads, capture `n` and assert that it rises by at least 2 in 1.5 s:

```js
check('reduced motion: the monitor capture still refreshes', <n after 1.5 s> - <n before> >= 2)
```

- [ ] **Step 2: Run the tests and make sure they fail**

Run: `node site5/tests/cockpit.test.js`

Expected: the four new checks FAIL (`SITE5.env` is undefined). All other checks PASS.

- [ ] **Step 3: Spike the clouds in the capture, and record the ruling in the ledger**

1. Build a second composer on the same renderer:
   - `RenderPass(scene, capCam)`;
   - `EffectPass(capCam, capClouds, capAp)`, where `capAp = new AerialPerspectiveEffect(capCam)` with `sky = true`, and `capClouds = new CloudsEffect(capCam)` with `temporalUpscale = false` and `qualityPreset = 'low'`;
   - `EffectPass(capCam, new ToneMappingEffect({ mode: ToneMappingMode.AGX }))`.
2. `capCam` is a `PerspectiveCamera(90, 1, 10, 1e7)`.
3. Share every texture with the main effects:
   - `gen.textures`, the cloud textures and the STBN (assign them where the main ones are assigned);
   - the overlay/shadow events wired from `capClouds` to `capAp`;
   - `sunDirection` copied each frame like the main ones.
4. Measure the added frame time with six faces rendered per frame (worst case) at 1280×720 headless.
5. **Ruling:** if one face per frame adds ≤ 1.5 ms and the clouds look right on a face dumped to PNG, keep the clouds and set `envClouds = true`. Otherwise drop `capClouds` from the pass and set `envClouds = false`.
6. Write the measured numbers in the ledger.

**Pitfall:** never call the capture composer's `setSize` (it would resize the main renderer). Size its buffers and passes once to 64×64 with each pass's and buffer's own `setSize`, or save and restore `renderer.getSize()` around it.

- [ ] **Step 4: Implement the capture in `sky.js`**

- **Target:** `capRT = new THREE.WebGLRenderTarget(64, 64, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace })`. The capture composer's last pass writes into it.
- **Each frame:**
  1. Render face `k = frame % 6`.
  2. `capCam` sits at `P`, oriented to the face's Three.js `CubeCamera` direction and up, taken through seat axes: seat vector `[x, y, -z]`, then `toECEF(m.qrot(pose.suitQ, ·))`.
  3. `renderer.readRenderTargetPixelsAsync(capRT, 0, 0, 64, 64, buf[k])` with no awaiting in the frame. On resolve, store the face.
  4. When all six faces since the last publish are in, publish `SITE5.env = { n: n + 1, size: 64, faces }` with fresh arrays. Skip publishing when `S.envFreeze` is set.
- **Exposure and lights:** the capture uses the same `renderer.toneMappingExposure` and the same per-frame light state as the main picture, so it shows exactly what the monitor shows.
- **Off switch:** `?capture=0` skips all of it.
- **Expose:** `S.loaded = loaded` and `S.envClouds`.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `node site5/tests/cockpit.test.js`, then `node site5/tests/traffic.test.js`.

Expected: all checks PASS, including the four new ones, and the existing `frames hold up (avg under 25ms)`.

- [ ] **Step 6: Mark Task 1 done** in the ledger and tick the boxes above.

---

### Task 2: The seat on Three.js, lit by the capture (`seat.js`)

**Files:**
- Modify: `site5/js/seat.js` (rewrite: ES module; the ring motion code `work()`, the `F[g]` functions and the test projections are kept as they are)
- Modify: `site5/index.html` (`<script src="js/seat.js" type="module">`, placed after `sky.js`; keep `seat-data.js` and `ring-data.js` as classic scripts before the modules)
- Test: `site5/tests/cockpit.test.js` (new block `// ---- the seat's light ----`; a helper `seatStats(p)`)

**Interfaces:**
- Consumes: `SITE5.env`, `SITE5.envFreeze` and `?capture=0` (Task 1); `window.SITE5_SEAT` and `window.SITE5_RING` as today.
- Produces:
  - `SITE5.seat = { ready: boolean, captures: number, source: 'data' | 'glb' }`, where `captures` is the last `env.n` uploaded (`-1` before any).
  - `S.seatGL = renderer.getContext()`.
  - `patchSeatMaterial(material: THREE.MeshPhysicalMaterial): void`, inside `seat.js`. It adds a float vertex attribute `ao`, which multiplies indirect diffuse and indirect specular, and a vec3 attribute `spill`, which is added to the emissive radiance. Both go in through `onBeforeCompile`.
  - `buildPod(): THREE.Group`, which Task 4 replaces. Here it builds from `SITE5_SEAT`:
    - positions `P·q` with z negated, normals with z negated;
    - `ao = A/255`;
    - `spill = mt.a · PINK · (glow · glowMax/255)`, with PINK = (0.85, 0.22, 0.45);
    - one `MeshPhysicalMaterial` per part from `MAT` (`color = a`, `roughness = r`, `metalness = m`, `emissive = e`), `side: THREE.DoubleSide`.

- [ ] **Step 1: Write the failing tests**

```js
// ---- the seat's light ----
// the seat's own pixels (alpha > 0), read in a frame: mean luminance overall, in the left and right thirds, mean r and b
const seatStats = k => k.eval(`new Promise(r => requestAnimationFrame(() => { const g = SITE5.seatGL, w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(4 * w * h);
  g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px); const s = { n: 0, lum: 0, r: 0, b: 0, nl: 0, l: 0, nr: 0, rr: 0 };
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const i = 4 * (y * w + x), a = px[i + 3]; if (a < 250) continue;
    const L = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; s.n++; s.lum += L; s.r += px[i] / 255; s.b += px[i + 2] / 255;
    if (x < w / 3) { s.nl++; s.l += L } else if (x > 2 * w / 3) { s.nr++; s.rr += L } }
  r({ n: s.n, lum: s.lum / s.n, r: s.r / s.n, b: s.b / s.n, left: s.l / s.nl, right: s.rr / s.nr }); }))`);
const lookDown = async k => { await k.mouse('mousePressed', 700, 650, 1); for (let j = 1; j <= 8; j++) await k.mouse('mouseMoved', 700, 650 - 40 * j, 1); await k.mouse('mouseReleased', 700, 330); await k.sleep(1500); };
const at = async (q) => { await p.goto('../site5/index.html?seed=7&alt=18&' + q, 300); await ready(p); await lookDown(p); return seatStats(p); };
check('the seat is on Three.js', await p.eval('SITE5.seat && SITE5.seat.ready === true && SITE5.seat.source === "data"'));
const noon = await at('hdg=90&time=2026-10-08T11:00:00Z'), late = await at('hdg=90&time=2026-10-08T22:00:00Z');
check('the seat is lit by the monitor: noon at least 3x night', noon.lum > 3 * late.lum, noon.lum.toFixed(3) + ' vs ' + late.lum.toFixed(3));
check('the bright side of the ball lights its side of the seat (sun to the right)', noon.right > noon.left, noon.right.toFixed(3) + ' vs ' + noon.left.toFixed(3));
const dusk = await at('hdg=262&time=2026-10-08T16:50:00Z');
check('facing a sunset the seat is warm', dusk.r > dusk.b, dusk.r.toFixed(3) + ' r vs ' + dusk.b.toFixed(3) + ' b');
// orientation, with a synthetic monitor: only the seat's right (+x) face white
await p.goto(PAGE, 300); await ready(p); await lookDown(p);
await p.eval(`(() => { SITE5.envFreeze = true; const f = i => new Uint8Array(64 * 64 * 4).map((_, j) => j % 4 === 3 ? 255 : (i === 0 ? 255 : 0)); SITE5.env = { n: 1e6, size: 64, faces: [0, 1, 2, 3, 4, 5].map(f) }; })()`);
await p.sleep(500); const side = await seatStats(p);
check('a white right-hand monitor lights the seat\'s right side', side.right > 1.5 * side.left, side.right.toFixed(3) + ' vs ' + side.left.toFixed(3));
// before any capture the seat is a dim grey, never black
await p.goto(PAGE + '&capture=0', 300); await ready(p); await lookDown(p); const none = await seatStats(p);
check('with no capture the seat still shows (dim, not black)', none.n > 1000 && none.lum > 0.01, JSON.stringify(none));
// the budget, at 1280x720
const q = await launch({ width: 1280, height: 720 }); await q.goto(PAGE, 300); await ready(q); await q.sleep(3000);
check('frames hold up with the seat lit (under 12 ms)', (await q.eval('SITE5.frameMs')) < 12, (await q.eval('SITE5.frameMs')).toFixed(1) + 'ms'); await q.close();
```

- [ ] **Step 2: Run the tests and make sure they fail**

Run: `node site5/tests/cockpit.test.js`

Expected: the new checks FAIL (`SITE5.seat` is undefined). All other checks PASS.

- [ ] **Step 3: Rewrite `seat.js` as a module**

- **Renderer:** `new THREE.WebGLRenderer({ canvas: #seat, alpha: true, premultipliedAlpha: true, antialias: true })`.
  - `toneMapping = THREE.NeutralToneMapping`, `toneMappingExposure = 1`.
  - Pixel ratio `min(dpr, 2)`; size the canvas to the window as today.
- **Scene:**
  - `buildPod()`;
  - the rings: each `rg.ranges` group becomes a `Mesh` with `matrixAutoUpdate = false`, whose `matrix` is set each frame from `cols(f)` and `add(rg.c, o)` (today's `uRot` and `uOrg`), with x mirrored per hand as today and z negated into Three axes;
  - the gauge segments set `emissiveIntensity` to 1 or 0.08.
- **Camera:** a `PerspectiveCamera` whose projection comes from the tan:
  - `fov = 2·atan(ty)`, `aspect = tx/ty`, near 0.01, far 4;
  - the quaternion from the head (yaw, pitch) in Three axes;
  - the scene root group has `scale.x = KX` and `position.y = LIFT`.
- **Environment:**
  - Start with `scene.environment` = a PMREM of a flat 0.02 grey (`RoomEnvironment` is not used).
  - On each new `S.env.n`, build a `THREE.CubeTexture` from 6 `THREE.DataTexture(face, 64, 64)` (sRGB, `needsUpdate`), then `pmrem.fromCubemap(cube)`. Swap it into `scene.environment` and dispose the old target.
  - Set `SITE5.seat.captures = n`.
  - If the orientation test fails, fix it here by flipping or swapping faces, not by moving the capture.
- **Lights:**
  - the HUD fill: `DirectionalLight(0x1A1F30)` from (0, .55, −.85), intensity tuned so the night seat matches today's look;
  - the flash: `AmbientLight((.7, .8, 1))` with intensity `pose.flash·1.6`.
- **Kept as is:**
  - the `S.parts.*` hooks and the 15-frame test projection; their projection math is unchanged because it works in the old seat frame;
  - `S.parts.seatAO = true` once the pod is built.
- **Removed:** the GLSL, `screen0`, `irradiance0`, `MOON` and `updateEnv`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node site5/tests/cockpit.test.js`, then `node site5/tests/traffic.test.js`.

Expected: all checks PASS, including the existing ring and seat checks.

- [ ] **Step 5: Take screenshots for the owner**

Use headless Chrome to capture:
- dusk (the default page);
- noon (`hdg=90&time=…T11:00:00Z`);
- night (`…T22:00:00Z`);

each at 1440×900 and 375×812, looking down. Save them to the scratchpad and send them with SendUserFile.

- [ ] **Step 6: Mark Task 2 done** in the ledger.

---

### Task 3: The pod's materials, baked (`tools/make_seat.py`)

**Files:**
- Modify: `site5/tools/make_seat.py` (add the textures to the `A_*` node trees, the atlas UV, the bakes and the glb export; the old `seat-data.js` export stays until Task 4)
- Create: `site5/assets/seat.glb`, `site5/assets/seat-light.jpg`
- Create: `site5/tools/tex-src/` (git-ignored: add `site5/tools/tex-src/` to `.gitignore`)
- Test: `site5/tests/seat-glb.test.js`

**Interfaces:**
- Produces: `assets/seat.glb`, in which:
  - the scene is in seat Three axes (eye at the origin, −z forward, ball radii);
  - each mesh primitive keeps its `A_*` material name;
  - each node's `extras.grp` is one of `seat`, `rail`, `grip`, `frame`;
  - `asset.extras` (or the scene's extras) holds `{ glowMax: number, ring: [x, y, z], points: { grp: [[x, y, z], …] } }`, in Three axes;
  - the atlas images are embedded (base colour, normal, ORM), each 4096², and every primitive has `TEXCOORD_0` and `TANGENT`.
- Produces: `assets/seat-light.jpg`, 4096² on the same UV. It holds the strips' received light divided by `glowMax`.

- [ ] **Step 1: Get the owner's approval for the textures (controller, in chat)**

1. Pick one ambientCG set (2K-JPG zip) per row of the spec's table: leather grain, worn painted metal, brushed metal, rubber, bead-blasted plastic.
2. List each set's name, URL and zip size.
3. Ask the owner. Download nothing before a clear yes.
4. Unzip each set into `site5/tools/tex-src/<SetName>/`, one new folder each.

- [ ] **Step 2: Write the failing test `site5/tests/seat-glb.test.js`**

It parses the glb's JSON chunk with Node only, with no new dependencies.

```js
const fs = require('fs'), path = require('path'); const { check } = require('../../site4/tests/cdp');
const f = path.join(__dirname, '../assets/seat.glb'); const ok = fs.existsSync(f); check('seat.glb exists', ok); if (!ok) process.exit(1);
const b = fs.readFileSync(f), len = b.readUInt32LE(12), J = JSON.parse(b.slice(20, 20 + len).toString());
const names = new Set(J.materials.map(m => m.name)), ex = (J.scenes[J.scene || 0].extras || J.asset.extras || {});
check('every A_ material is there', ['A_shell', 'A_plate', 'A_quilt', 'A_leather', 'A_perf', 'A_pipe', 'A_glow', 'A_metal', 'A_chrome', 'A_dark', 'A_ink', 'A_lens', 'A_rubber'].every(n => names.has(n)), [...names].join(','));
check('every primitive has UVs and tangents', J.meshes.every(m => m.primitives.every(p => 'TEXCOORD_0' in p.attributes && 'TANGENT' in p.attributes)));
check('the atlas maps are on the materials', J.materials.filter(m => m.name !== 'A_glow' && m.name !== 'A_lens').every(m => m.pbrMetallicRoughness.baseColorTexture && m.normalTexture && m.occlusionTexture && m.pbrMetallicRoughness.metallicRoughnessTexture));
check('extras carry glowMax, the ring centre and the sample points', ex.glowMax > 0 && ex.ring.length === 3 && ['seat', 'rail', 'grip', 'frame'].some(g => (ex.points[g] || []).length > 4), JSON.stringify(Object.keys(ex)));
// the same place as the old export: the ring centre matches seat-data.js's, z negated
global.window = {}; require('../js/seat-data.js'); const r0 = window.SITE5_SEAT.ring;
check('the glb sits where seat-data did (ring centre, Three axes)', Math.abs(ex.ring[0] - r0[0]) < 1e-3 && Math.abs(ex.ring[1] - r0[1]) < 1e-3 && Math.abs(ex.ring[2] + r0[2]) < 1e-3, JSON.stringify([ex.ring, r0]));
check('the strips\' lightmap is there', fs.existsSync(path.join(__dirname, '../assets/seat-light.jpg')));
check('seat.glb under 30 MB', fs.statSync(f).size < 30e6, (fs.statSync(f).size / 1e6).toFixed(1) + ' MB');
```

- [ ] **Step 3: Run it and make sure it fails**

Run: `node site5/tests/seat-glb.test.js`

Expected: FAIL `seat.glb exists`.

- [ ] **Step 4: Extend `make_seat.py`**

1. **Textures:** in each `A_*` material, mix the ambientCG maps under the existing procedural quilt, perforation and wear.
   - Use Image Texture nodes with box projection on Object coordinates, blend 0.2, with the scale set per set to its real-world tile size.
   - Colour multiplies the base colour, the normal combines through a Normal Map node, and the roughness modulates the existing roughness.
2. **Atlas UV:** smart UV project, then pack islands with a margin of 4 px at 4096 on the export copies (after `me.transform`).
3. **Move to the eye:** translate the copies by −EYE, so that Blender's (x, y, z) exported as glTF +Y-up becomes (x, z, −y), which is exactly the seat's Three axes.
4. **Bakes** with Cycles into 4096² images on that UV, keeping today's AO and strip-light settings:
   - DIFFUSE colour only → base colour;
   - NORMAL in tangent space → normal;
   - ROUGHNESS → G, AO → R, metallic → B (metallic via an Emit bake of the metallic value) → packed into ORM;
   - the strip light (the existing emissive-only DIFFUSE bake) → `seat-light.jpg` divided by `GLOW_MAX`.
5. **Rebuild the materials for export:** Principled BSDF with the atlas textures plus the glTF Material Output node's Occlusion. Keep `A_glow` and `A_lens` emissive with their colours. Add clearcoat 0.6 on `A_shell` and `A_plate`, and sheen 0.3 on `A_quilt`, `A_leather` and `A_perf`.
6. **Export:** `bpy.ops.export_scene.gltf(filepath=site5/assets/seat.glb, export_format='GLB', export_tangents=True, export_extras=True, export_image_format='JPEG', export_jpeg_quality=92, use_selection=True)`.
   - Put `glowMax`, `ring` and `points` (in Three axes) in the scene's custom properties so they export as scene extras.
7. **Header:** list the texture sets used (name and URL) in the script's header docstring.

- [ ] **Step 5: Run the bake and the test**

Run: `blender -b --factory-startup -P site5/tools/make_seat.py` (it runs for a long time; run it in the background), then `node site5/tests/seat-glb.test.js`.

Expected: all checks PASS, and `seat-data.js` is still written.

- [ ] **Step 6: Render the glb for the owner**

Import `seat.glb` into a fresh Blender scene under a neutral HDRI-free studio light. Take two Eevee stills (3/4 front and the pilot's eye looking down), send them with SendUserFile, then mark Task 3 done in the ledger.

---

### Task 4: The seat from the glb; the strips' bloom; loading (`seat.js`)

**Files:**
- Modify: `site5/js/seat.js` (`buildPod()` → `loadPod(): Promise<THREE.Group>` via `GLTFLoader` from `three/addons/loaders/GLTFLoader.js`; bloom; remove the `A_*` `MAT` entries)
- Modify: `site5/js/sky.js` (`LOADS` gains `'seat'`)
- Modify: `site5/index.html` (remove the `js/seat-data.js` script)
- Delete: `site5/js/seat-data.js`; the `seat-data.js` export in `make_seat.py` (and Task 3's test switches its ring check to compare against a constant: the old ring centre copied into the test)
- Test: `site5/tests/cockpit.test.js`

**Interfaces:**
- Consumes: `assets/seat.glb` and `assets/seat-light.jpg` (Task 3); `SITE5.loaded` (Task 1); `patchSeatMaterial` (Task 2, kept for the rings only).
- Produces: `SITE5.seat.source === 'glb'`. URL `?seat=<name>` loads `assets/<name>.glb` (default `seat`), so the failure test can request a missing file.

- [ ] **Step 1: Write the failing tests**

```js
await p.goto(PAGE, 300); await ready(p); for (let i = 0; i < 80 && !(await p.eval('SITE5.seat.ready')); i++) await p.sleep(250);
check('the seat comes from seat.glb', await p.eval('SITE5.seat.source === "glb" && SITE5.parts.seatAO === true'));
await p.goto(PAGE + '&seat=nope', 300); await ready(p); await p.sleep(2000);
check('a missing seat says so and the flight runs on', (await p.eval('document.getElementById("loading").textContent')).includes("THE SEAT COULDN'T LOAD") && (await p.eval('SITE5.frames')) > 30,
  await p.eval('document.getElementById("loading").textContent'));
```

Change the existing `check('the seat is on Three.js', …)` in the Task 2 block to accept `source === "glb"`. Keep all of Task 2's lighting checks.

- [ ] **Step 2: Run the tests and make sure they fail**

Run: `node site5/tests/cockpit.test.js`

Expected: the two new checks FAIL.

- [ ] **Step 3: Implement**

- **`loadPod()`:**
  - Load the glb and read the extras into `points` and `RING_C`, converting Three axes back to the old seat frame (negate z), because the test projections and the ring code use the old frame.
  - Each material: `lightMap = seat-light.jpg` (`channel 0`), `lightMapIntensity = glowMax` (the bake already holds the strips' pink, so no tint).
  - Set `S.loaded('seat')`.
  - On error: show `THE SEAT COULDN'T LOAD` in `#loading` (unhide it), set `S.loaded('seat')`, draw the rings only, and log the error with `console.warn`. The tests' `no JS errors` check counts uncaught exceptions only, so use warn.
- **Bloom:** an `EffectComposer` on the seat renderer (`frameBufferType: HalfFloatType`), with `RenderPass` then `EffectPass(camera, new BloomEffect({ luminanceThreshold: 0.9, intensity: 0.6, mipmapBlur: true }))`.
  - If the halo over the transparent canvas shows a dark fringe or none at all, drop the bloom and record that in the ledger. The spec allows this fallback.
- **Tone mapping:** with the composer, the tone mapping moves into a `ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })` at the end, and the renderer's own goes to `NoToneMapping`.

- [ ] **Step 4: Run all tests**

Run: `node site5/tests/cockpit.test.js`, `node site5/tests/traffic.test.js` and `node site5/tests/seat-glb.test.js`.

Expected: all checks PASS.

- [ ] **Step 5: Screenshots and docs**

- **Screenshots:** take Task 2's six shots again and send them to the owner.
- **`site5/DESIGN.md`:** in the seat section, replace the GLSL description with the new pipeline (capture → PMREM → glb atlas + lightmap → bloom → Neutral), and record the light rule and the two-renderer layering.
- **The realism spec:** in `site5/docs/2026-10-08-realism-rebuild-design.md`, mark Phase 3 (seat) as done, with a pointer to this plan.
- **The ledger:** mark Task 4 done.

---

### Final: the whole-branch review

- [ ] Dispatch the final code reviewer on the site5 diff, run against the spec and this plan.
- [ ] Fix what it finds and re-run all three test files.
- [ ] Report to the owner: the screenshots, the frame time, the clouds ruling, and the bloom ruling.
