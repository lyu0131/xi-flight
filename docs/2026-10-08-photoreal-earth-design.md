# The photoreal 3D Earth: design

2026-10-08. Phase 2 of `2026-10-08-realism-rebuild-design.md`, reshaped. The NASA-only flat imagery plan is
replaced by Google's photorealistic 3D tiles.

## What the owner asked for

- "The world is still flat and has very horrible quality."
- The owner chose Google Photorealistic 3D Tiles, through their Cesium ion account (asset 2275207).
- They accepted that the ion key ships in the public site, **restricted to the site's address** in the ion dashboard.

## What's wrong today

- The Earth is one smooth ellipsoid with two whole-planet photos on it:
  - day colour at 7.4 km a pixel;
  - city lights at 3 km a pixel.
- There's no relief and no buildings, and anything near is a blur.

## Success

1. Mountains, valleys, coastlines and cities are real 3D shapes with photographic ground. Detail streams in as the
   suit gets closer, from 1 km up to 1000 km.
2. The Takram atmosphere, the sun/moon light, the monitor's metering, and the seat's light from the monitor all work
   over the tiles as they do now.
3. At dusk and night the cities glow on the 3D ground.
4. **Fallback:** with no key, an exhausted quota, or the network down, the cockpit still flies over today's flat
   Earth, and the readout says why.
5. Google's attribution shows on screen, as its terms require.
6. **Frame time:** the median frame in the headless test at 1280×720 stays under 12 ms. Smooth on a laptop
   RX 6800S class GPU.

## Decisions

### The tiles

- `3d-tiles-renderer@0.5.3`, added to the import map (esm.sh) as `3d-tiles-renderer` and
  `3d-tiles-renderer/plugins`.
- A new module **`js/earth3d.js`** owns everything about the tiles. `sky.js` only:
  - creates it: `makeEarth3D({ scene, camera, renderer, token })`;
  - calls `update()` each frame;
  - hands it the light and the exposure.
- **Plugins:**
  - `CesiumIonAuthPlugin({ apiToken, assetId: 2275207, autoRefreshToken: true })`;
  - `GLTFExtensionsPlugin` with three's `DRACOLoader` (decoder from jsDelivr, three@0.181.0's
    `examples/jsm/libs/draco/gltf/`);
  - `TileCompressionPlugin`.
- **Placement:** the tiles are in ECEF metres, the frame the scene already uses, so the tile group needs no
  transform.
- **Camera:**
  - `tiles.setCamera(camera)` and `tiles.setResolutionFromRenderer(camera, renderer)` for the main camera only;
  - `errorTarget` 16 at first, tuned in the plan's spike.
- **The monitor capture:** it renders the same scene, so the seat is lit by the 3D Earth. Its six small cameras
  don't drive the level of detail; they see whatever the main view has loaded.

### Light

- **Day:** on load, each tile's material becomes a `MeshStandardMaterial` with the tile's photo as `map`
  (roughness 1, metalness 0). It's lit by Takram's `SunDirectionalLight` and `SkyLightProbe` exactly as today's
  Earth is.
  - The photos carry their own baked daylight shading. That's accepted; Takram's own Google-tiles examples do the same.
- **Night:** the same material gets the city lights as emission, through `onBeforeCompile`.
  - The fragment's world position is turned into geodetic latitude and longitude.
  - That samples today's Black Marble map, `assets/earth/BlackMarble_2016_3km.jpg`, as the emissive colour.
  - Intensity is `CITY / exposure`, as now, so cities keep their apparent brightness.
  - Swapping in a sharper night map is later work, not this phase.

### Fallback: the flat Earth stays, underneath

- Today's ellipsoid Earth stays in the scene, **200 m below** the WGS84 surface (scale (a − 200 m) / a).
  - It fills gaps while tiles stream in.
  - It's the whole Earth when tiles can't load.
- **Tiles off:** no key (`window.SITE5_KEYS` missing or without `cesiumIon`), or `?tiles=0`. There are no tiles and
  no error, and the readout shows nothing.
- **Tiles fail:** an auth failure or the quota is exhausted. The readout says
  `THE 3D EARTH COULDN'T LOAD · FLAT EARTH SHOWN` and the flight carries on.
- **`SITE5.world.tiles`** = `{ on: boolean, loaded: number (tiles with content), failed: boolean }`.

### The key

- `site5/js/keys.js` (`window.SITE5_KEYS = { cesiumIon: '…' }`) stays **git-ignored in the neocities repo**.
- `index.html` loads it as an optional classic script. A missing file is fine.
- **Publishing:** the xi-flight copy includes `js/keys.js` **only after the owner confirms** that the token's
  Allowed URLs in the Cesium ion dashboard are restricted to:
  - `https://lyu0131.github.io`
  - `http://localhost:8735`
  - `http://127.0.0.1`

  Until then the published site runs on the flat fallback.

### Attribution

- A small line, bottom-right, reads `tiles.getAttributions()` (Google's logo text and data providers). It updates as
  they change and is styled like the HUD's quiet text.
- It never covers the HUD centre.
- It stays readable at 375 px.

## Testing

All of these run in `tests/cockpit.test.js`. They use the real key when `js/keys.js` exists and skip with a note
when it doesn't.

- **Tiles stream:** `SITE5.world.tiles.loaded > 20` within 20 s of ready, at the default start.
- **It's 3D:** over the Alps (`?lat=46.5&lon=8&alt=8&hdg=0&time=2026-10-08T11:00:00Z`), the depth (or the picture)
  varies across the horizon band far more than over the flat sea. The plan's spike pins the exact measure.
- **Night cities on the tiles:** over Naples at night (`?lat=40.85&lon=14.27&alt=10&time=2026-10-08T22:00:00Z`,
  looking down), there are warm city pixels, as today's check does.
- **Fallback:**
  - `?tiles=0` gives `world.tiles.on === false`, the flat Earth is drawn and there are no errors;
  - a bad token (a test hook `?tilestoken=bad`) gives the failure readout, and the flight runs on.
- **Attribution:** the attribution text is visible when tiles are on.
- **Budget:** median frame under 12 ms at 1280×720.
- **No regressions:** the existing 144 cockpit, 8 traffic and 8 seat checks still pass.
- **Screenshots:** dusk, day and night at desktop and 375 px, sent to the owner.

## Out of scope

- A sharper night-lights map.
- Bringing the clouds back (they stay off).
- The flight redesign (400 km start, the tour, the Hybrid leash, metering the Earth only, the horizon staircase).
  That's the next spec.

## As built (2026-10-08)

- **Tiles:** `js/earth3d.js`, `TilesRenderer` with `CesiumIonAuthPlugin` (asset 2275207), `GLTFExtensionsPlugin` (Draco) and
  `TileCompressionPlugin`. **errorTarget 16**, not the library's default: the Google auth plugin resets it to 20 when the root
  tileset loads, so it is set again in a `load-root-tileset` listener.
- **Normals:** the tiles arrive without normals, which a lit material draws black. `load-model` computes them for any mesh that
  lacks them.
- **Lit material, in Task 1:** the lit `MeshStandardMaterial` (photo as `map`, roughness 1) moved from the night work into
  the first task, since unlit tiles broke the monitor capture's and the seat's day/night checks. Night city emission stayed in Task 2.
- **Fallback Earth 1000 m below,** not 200 m: coarse far tiles are flat chords that sag up to ~400 m under the curve, and
  the flat Earth showed through near the horizon.
- **Terrain floor** (not in this spec's Decisions): the model keeps the suit 0.3 km above `heightAt`, sampled every 0.5 s.
- **Attribution:** `#attrib` under the HUD canvases, from `tiles.getAttributions()` (text only; HTML entries have their tags
  stripped), every second. At the default start it reads `Google; Data SIO, NOAA, U.S. Navy, NGA, GEBCO; IBCAO; Landsat / Copernicus`.
- **Takram:** nothing special beyond the existing atmosphere light and light probe; `Geodetic` from `@takram/three-geospatial`
  gives `heightAt`'s ECEF start point.
- **Tests:** `cockpit.test.js` gained an `ONLY=<blocks>` filter; `tests/cdp.js` launches Chrome with BackForwardCache disabled
  (otherwise old pages kept their WebGL contexts and later loads hung). The night-cities check on the tiles needs more than
  0.2% warm: it read 1.8% before the night emission (flat Earth showing past the tiles) and 56% after.
- **Budget:** a 30 s boosted flight (`mode=input&throttle=1`, Shift held) holds the frame at about 4 ms with no errors.
