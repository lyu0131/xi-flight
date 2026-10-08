# The Photoreal 3D Earth: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat two-photo Earth with Google's photorealistic 3D tiles, streamed through the owner's Cesium ion key. The atmosphere, the light, the cities at night and the seat's monitor light all keep working over them.

**Architecture:**
- A new ES module, `site5/js/earth3d.js`, owns a `3d-tiles-renderer` `TilesRenderer`, its plugins, and the tile materials.
- `sky.js` creates it and drives it each frame.
- Today's ellipsoid Earth stays 200 m below the surface. It fills gaps while tiles load and is the whole Earth when tiles can't load.

**Tech Stack:**
- three@0.181.0
- 3d-tiles-renderer@0.5.3 (`TilesRenderer`, `CesiumIonAuthPlugin`, `GLTFExtensionsPlugin`, `TileCompressionPlugin`)
- Takram atmosphere 0.19.1
- the headless-Chrome CDP harness (`site5/tests/cdp.js`)

**Spec:** `site5/docs/2026-10-08-photoreal-earth-design.md`

## Global Constraints

- **Code style:** a static site with no build step. ES modules through the import map in `site5/index.html`, from esm.sh, pinned. Relative paths only.
- **No commits or pushes in the neocities repo.** Track progress in `.superpowers/sdd/plan-earth3d/progress.md`. Publishing to the xi-flight repo is the controller's job, after the owner asks.
- **The key:** `site5/js/keys.js` (`window.SITE5_KEYS = { cesiumIon, earthAtNightAssetId }`) is git-ignored. Its value is never printed, logged, copied into another file, or put in a test's output.
- **The tiles:** Cesium ion asset **2275207** (Google Photorealistic 3D Tiles), `errorTarget` 16 to start.
- **Fallback Earth:** the existing ellipsoid, scaled to (a − 200 m) / a on each axis (a = 6378137, b = 6356752.314245).
- **Failure readout:** `THE 3D EARTH COULDN'T LOAD · FLAT EARTH SHOWN`.
- **Interface:** `SITE5.world.tiles = { on, loaded, failed }`. `?tiles=0` turns the tiles off.
- **Night city light on tiles:** `CITY / exposure`, with today's `CITY` and today's map `assets/earth/BlackMarble_2016_3km.jpg`.
- **Clouds stay off.** Keep the light rule (a closed cockpit). Respect `prefers-reduced-motion`.
- **Tests:**
  - Run `node site5/tests/cockpit.test.js` (144 checks now), `node site5/tests/traffic.test.js` (8) and `node site5/tests/seat-glb.test.js` (8) from the repo root.
  - Tile checks run only when `site5/js/keys.js` exists. Otherwise they print `SKIP <name> (no key)`.
  - Median frame under 12 ms at 1280×720.

## Review Focus

1. **Flying into a mountain:** with real terrain, the 1 km floor would put the suit inside the Alps. The floor rises to terrain + 0.3 km under the suit. Test in Task 2.
2. **No key, a bad key, or an exhausted quota:** the flat Earth shows, the readout says so for a bad key, and the flight runs on. Tests in Task 1.
3. **A resize** (a phone rotating, a window snapping): the tiles keep resolving at the new size, with no errors. Test in Task 1.
4. **A long, fast flight:** the tile cache stays bounded and frames hold. Test in Task 3.
5. **The seat's light** still follows the monitor with tiles on. The existing seat-light checks run with tiles on (they use the default page). Covered by Task 2's run of the full suite.

---

### Task 1: Tiles stream in, with the flat Earth as fallback

**Files:**
- Create: `site5/js/earth3d.js`
- Modify:
  - `site5/index.html` (import map; optional `js/keys.js` classic script before the modules)
  - `site5/js/sky.js` (create and update the tiles; lower the ellipsoid; `world.tiles`)
- Test: `site5/tests/cockpit.test.js` (new block `// ---- the 3D Earth ----` after the "light & clouds" block)

**Interfaces:**
- Produces, in `earth3d.js`:
  - `export function makeEarth3D({ scene, camera, renderer, token, onFail }): { update(): void, resize(): void, state: { on, loaded, failed }, tiles: TilesRenderer, heightAt(latDeg, lonDeg): number | null }`
  - `heightAt` gives the height above the WGS84 ellipsoid in metres, from a downward raycast against the loaded tiles (`null` where no tile is loaded).
- Produces in sky.js:
  - `SITE5.world.tiles` (the `state` object above, or `{ on: false, loaded: 0, failed: false }` when off);
  - `SITE5.world.heightAt` (`(lat, lon) => number | null`, always defined, `null` when off).
- Import map additions:
  - `"3d-tiles-renderer": "https://esm.sh/3d-tiles-renderer@0.5.3?external=three"`
  - `"3d-tiles-renderer/plugins": "https://esm.sh/3d-tiles-renderer@0.5.3/plugins?external=three"`

- [ ] **Step 1: Write the failing tests**

```js
// ---- the 3D Earth ----
const KEY = require('fs').existsSync(require('path').join(__dirname, '../js/keys.js'));
const skip = n => console.log('SKIP ' + n + ' (no key)');
{
  const t = await launch({ width: 1280, height: 720 });
  if (KEY) {
    await t.goto('../site5/index.html?seed=7', 300); await ready(t);
    for (let i = 0; i < 80 && !(await t.eval('SITE5.world.tiles.loaded > 20')); i++) await t.sleep(250);
    check('the 3D Earth streams in', await t.eval('SITE5.world.tiles.on && SITE5.world.tiles.loaded > 20 && !SITE5.world.tiles.failed'), JSON.stringify(await t.eval('SITE5.world.tiles')));
    await t.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true }); await t.sleep(3000);
    check('after a resize the tiles keep loading, no errors', (await t.eval('SITE5.world.tiles.loaded')) > 20 && t.errors.length === 0, t.errors.join(' | '));
    await t.send('Emulation.clearDeviceMetricsOverride', {});
    await t.goto('../site5/index.html?seed=7&tilestoken=bad', 300); await ready(t); await t.sleep(4000);
    check('a bad key says so and the flat Earth flies on', (await t.eval('document.getElementById("loading").textContent')).includes("THE 3D EARTH COULDN'T LOAD") && await t.eval('SITE5.world.tiles.failed && SITE5.frames > 30'));
  } else ['the 3D Earth streams in', 'after a resize the tiles keep loading, no errors', 'a bad key says so and the flat Earth flies on'].forEach(skip);
  await t.goto('../site5/index.html?seed=7&tiles=0', 300); await ready(t); await t.sleep(1500);
  check('?tiles=0: the flat Earth, no tiles, no errors', await t.eval('SITE5.world.tiles.on === false && SITE5.world.heightAt(46, 8) === null') && t.errors.length === 0, t.errors.join(' | '));
  t.close();
}
```

`?tilestoken=bad` is a test hook: it replaces the key with the literal string `bad`.

- [ ] **Step 2: Run the tests and make sure they fail**

Run: `node site5/tests/cockpit.test.js`

Expected: the new checks FAIL (`SITE5.world.tiles` is undefined). The existing 144 PASS.

- [ ] **Step 3: Spike (record the outcome in the report)**

1. Load the tiles with `CesiumIonAuthPlugin({ apiToken, assetId: 2275207, autoRefreshToken: true })`, `GLTFExtensionsPlugin({ dracoLoader })` and `TileCompressionPlugin`.
   - The `DRACOLoader` decoder path is `https://cdn.jsdelivr.net/npm/three@0.181.0/examples/jsm/libs/draco/gltf/`.
2. Confirm the tiles appear in the right place, in ECEF and in the scene's frame, with no transform on `tiles.group`, by looking at a screenshot over Naples.
3. Try `errorTarget` 16. If frames at 1280×720 exceed 12 ms, raise it (up to 32). Record the value used.
4. Check that Takram's AerialPerspectiveEffect applies over the tiles. They render in the same `RenderPass`; the effect reads depth.
5. If the effect needs anything else, record it.

- [ ] **Step 4: Implement**

- **`earth3d.js`:** `makeEarth3D` as in the Interfaces block.
  - Call `tiles.setCamera(camera)`, and `tiles.setResolutionFromRenderer(camera, renderer)` in `resize()`.
  - `update()` calls `tiles.update()`.
  - `state.loaded` counts tiles whose content has loaded (from the `load-model` / `dispose-model` events).
  - **Failure:** an auth or root-tileset load error (`load-error` event on the root, or the ion endpoint rejecting the token) sets `state.failed = true`, calls `onFail()`, removes `tiles.group` from the scene, and disposes it.
- **`sky.js`:**
  - Read `window.SITE5_KEYS?.cesiumIon`, or `bad` under `?tilestoken=bad`.
  - When a key exists and there's no `?tiles=0`, create the tiles with `onFail` showing the failure readout. It's shown the same way the seat's failure is shown: unhide `#loading` with the text.
  - Call `update()` every frame before `composer.render()`, and `resize()` when the composer resizes.
  - Scale the ellipsoid Earth by (a − 200 m) / a.
  - Set `world.tiles` and `world.heightAt`.
- **`index.html`:** add `<script src="js/keys.js"></script>` before the module scripts. A missing file only 404s; no `onerror` text is needed.

- [ ] **Step 5: Run all three suites and make sure everything passes**

Expected: the new checks PASS (or SKIP with no key), and the existing checks PASS.

- [ ] **Step 6: Mark Task 1 done in the ledger.**

---

### Task 2: Tiles lit like the Earth (day and night), the terrain floor

**Files:**
- Modify:
  - `site5/js/earth3d.js` (tile materials)
  - `site5/js/sky.js` (hand the night map and the city intensity to the tiles each frame)
  - `site5/js/ball.js` (the terrain floor)
- Test: `site5/tests/cockpit.test.js` (the "3D Earth" block)

**Interfaces:**
- Consumes: Task 1's `makeEarth3D` and `SITE5.world.heightAt(lat, lon)`.
- Adds to the `makeEarth3D` return:
  - `setNight(map: THREE.Texture, intensity: number): void`. It's called once when the Black Marble texture loads, then with the intensity each frame (`CITY / exposure`).
- `ball.js` reads `S.world && S.world.heightAt` (optional), at most every 0.5 s.

- [ ] **Step 1: Write the failing tests** (in the 3D Earth block, under `if (KEY)`)

```js
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
const warm = await t.eval(`new Promise(r => requestAnimationFrame(() => { const g = SITE5.gl, w = g.drawingBufferWidth, h = g.drawingBufferHeight, px = new Uint8Array(4 * w * h);
  g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px); let n = 0; for (let i = 0; i < px.length; i += 4 * 9) if (px[i] > 40 && px[i] - px[i + 2] > 20) n++; r(n / (px.length / 36)); }))`);
await t.mouse('mouseReleased', 640, 250);
check('the cities glow on the 3D Earth at night', warm > 0.002, (warm * 100).toFixed(2) + '% warm');
```

Check that `SITE5.pose.geo` is `[lat, lon]`; the code calls `new Geodetic(pose.geo[1]·D, pose.geo[0]·D, …)`, so it is.

- [ ] **Step 2: Run the tests and make sure they fail**

Expected: the floor check FAILS (the suit sinks to 1 km, inside the mountain) and the night check FAILS (the tiles have no emission). Mont Blanc may already pass after Task 1. That's fine: it pins Task 1's `heightAt`.

- [ ] **Step 3: Implement the tile materials**

- In the `load-model` handler, replace each tile mesh's material with `new THREE.MeshStandardMaterial({ map: <the tile's texture>, roughness: 1, metalness: 0 })`, and dispose the original material.
- Patch it with `onBeforeCompile`:
  - **vertex:** pass the world position;
  - **fragment:** convert it to geodetic latitude and longitude (WGS84, with the iterative or Bowring formula), sample `uNight` with equirectangular coordinates (u = lon/2π + 0.5, v = lat/π + 0.5), and add it times `uNightK` and the colour `#FFD9A8` (today's `earthMat.emissive`) to `totalEmissiveRadiance`.
- All tile materials share the same two uniforms objects, so `setNight` updates every tile at once.

- [ ] **Step 4: Implement the floor in `ball.js`**

- Every 0.5 s, sample `S.world.heightAt(lat, lon)`.
- The floor is `max(ALT_LO, ground / 1000 + 0.3)` km.
- At the floor, the climb is taken out exactly as at today's `ALT_LO`.

- [ ] **Step 5: Run all three suites and make sure everything passes**

This includes the seat-light, metering and capture checks, now running over the tiles.

- [ ] **Step 6: Mark Task 2 done in the ledger.**

---

### Task 3: Attribution, the long-flight budget, docs and screenshots

**Files:**
- Modify:
  - `site5/js/earth3d.js` (attribution text)
  - `site5/index.html` (`<p id="attrib">`)
  - `site5/css/cockpit.css`
  - `site5/DESIGN.md`
  - `site5/docs/2026-10-08-photoreal-earth-design.md` (an "As built" section)
- Test: `site5/tests/cockpit.test.js`

**Interfaces:**
- Consumes: `makeEarth3D(...).tiles`.
- `#attrib` text comes from `tiles.getAttributions()`, joined with ` · `, refreshed at most once a second, and empty when the tiles are off.

- [ ] **Step 1: Write the failing tests** (in the 3D Earth block, under `if (KEY)`)

```js
await t.goto('../site5/index.html?seed=7', 300); await ready(t); await t.sleep(4000);
check('Google\'s attribution shows with the tiles', /google/i.test(await t.eval('document.getElementById("attrib").textContent')));
await t.goto('../site5/index.html?seed=7&mode=input&throttle=1', 300); await ready(t);
await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 }); await t.sleep(30000);
await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
check('a long fast flight: frames hold, no errors', (await t.eval('SITE5.frameMs')) < 12 && t.errors.length === 0, (await t.eval('SITE5.frameMs')).toFixed(1) + 'ms ' + t.errors.join(' | '));
```

At 375 px, add to the existing phone block:

```js
check('phone: the attribution fits', await m.eval('(() => { const a = document.getElementById("attrib").getBoundingClientRect(); return a.right <= innerWidth && a.width < innerWidth; })()'))
```

- [ ] **Step 2: Run the tests and make sure they fail**

Expected: `#attrib` is missing.

- [ ] **Step 3: Implement**

- `#attrib` sits bottom-right, in the HUD's quiet text style: the existing `.hint` or `#mode` styles, small and low-contrast but readable. `pointer-events: none`.
- At 375 px it wraps within the width and never covers the centre.

- [ ] **Step 4: Docs**

- In `DESIGN.md`'s "The picture (`js/sky.js`)" section, describe:
  - the 3D tiles (`earth3d.js`);
  - the flat Earth 200 m under them;
  - the key rule;
  - `?tiles=0`;
  - the terrain floor;
  - the attribution.
- Add an "As built" section to the spec (the errorTarget used, anything Takram needed).
- Update the CLAUDE.md site5 row only if its one-line description is now wrong.

- [ ] **Step 5: Run all three suites and make sure everything passes. Take screenshots.**

Take dusk (default), noon (`time=…T11:00:00Z`) and night (`…T22:00:00Z`) at 1440×900 and 375×812, plus one over the Alps at noon from 8 km. Save them to the scratchpad and list the paths.

- [ ] **Step 6: Mark Task 3 done in the ledger.**

---

### Final: the whole-branch review

- [ ] Dispatch the final reviewer on the site5 diff against the spec and this plan.
- [ ] Run one fix wave and re-run all three suites.
- [ ] Report the screenshots and any rulings to the owner.
- [ ] Publish to xi-flight only when the owner asks. Include `js/keys.js` only after the owner confirms the token is restricted to the allowed URLs.
