# site5: the realism rebuild (design)

Owner, 2026-10-07/08: the hand-written renderer "looks like shit", the seat "doesn't look like any other texture I
know", "I want it to actually feel realistic, to have space, to have everything"; chose **A**: stay a website, on a
real engine, with the real Earth streamed. Cesium ion account and token set up (`site5/js/keys.js`, git-ignored).

## What stays, what goes
**Stays** (logic, not looks): the flight model, the arcade controls and the three modes (`ball.js`), the traffic sim
(`traffic.js`), the HUD painted on the ball (`hud.js`), the hand rings' rig and controls, the armoured pod's design
(`tools/make_seat.py`), the aircraft designs (`tools/make_traffic.py`), the test harness.
**Goes**, once its replacement works: the hand-written world shader (`world.js`), the packed NASA imagery
(`earth.js`, `js/earth-*.js`, 35 MB, `tools/make_earth.py`), the hand-written seat shader (`seat.js`'s GL code).

## The pieces
1. **The world: CesiumJS** (loaded from its CDN, pinned version). The real Earth at real scale (WGS84):
   - **Cesium World Terrain** (asset 1): real mountains, everywhere.
   - **Imagery**: Bing Maps Aerial (2) on the day side, NASA **Earth at Night** (3812) on the night side, blended
     across the terminator by Cesium's day/night lighting.
   - **Google Photorealistic 3D Tiles** (2275207): real cities and landscapes in 3D, faded in below ~8 km.
   - Cesium's own **sky atmosphere**, ground atmosphere, fog, sun, moon and star field, all real-time and correct
     for the date and time. Rendered in HDR with tone mapping.
   - **Clouds**: two layers. A global cloud-cover layer seen from high up (NASA cloud imagery draped just above the
     surface, see "Downloads"), and Cesium's 3D cumulus clouds placed by that cover near the suit, so lower down
     you fly among real-looking clouds. True volumetric clouds come later (phase 5).
2. **The ball display**: Cesium renders a wide view from the suit; a post-process warp then maps it through the
   ball exactly as now (each screen pixel -> the ball point it sees -> the world direction that point shows), so the
   picture still bends like a spherical monitor seen from off-centre. The panel seams are drawn in the same pass.
3. **The cockpit: Three.js** (CDN, pinned), on its own canvas over the world, as the seat is now:
   - The pod and the hand rings exported from Blender as **glTF** with UV maps, using **real scanned PBR textures**
     (CC0): quilted and perforated leather, painted metal with worn edges, brushed metal, rubber, carbon.
   - **Lighting**: image-based light from the outside picture (the warp's output, filtered into an environment
     map each few frames: the cockpit is lit by what the monitor shows), the pink strips as real area lights,
     soft **shadows**, **bloom** on the strips and the HUD glow, ACES tone mapping, anti-aliasing.
4. **The HUD**: unchanged (2D canvas, painted on the ball), on top.
5. **Traffic**: the four aircraft as glTF models in Cesium at their real positions, with navigation lights
   and contrails; the W marks within 30 km as now.

## Flight on the real Earth
- The suit's position is geodetic (latitude, longitude, altitude), moved by its speed along its heading on the
  real globe. Start: 35 km over the Tyrrhenian Sea heading north (Naples and Rome ahead), `?lat= ?lon= ?alt=`.
- **Speed, at real scale**: the globe is full size again, so the throttle goes much higher: 0.5 to 8 km/s
  (Mach 1.5 to near orbital), cruise 2 km/s, Shift boost +4. Ceiling 100 km (the edge of space), floor 1 km.
- **Time of day**: the flight starts at dusk on the terminator, so one side shows a sunlit Earth and the other
  city lights, with the sun just below the horizon ahead. `?time=` for any other, or real time.

## Running it
Streamed tiles and Cesium's web workers don't work from `file://`, so site5 runs from a small local server
(`.claude/launch.json`, `python -m http.server`), and the page needs an internet connection. site5 is still never
deployed; before anything goes public, the token gets restricted to the domain.
Loading takes as long as it takes (the owner asked for a full experience over a fast load); a readout shows it.

## Downloads (need approval)
- **CC0 PBR texture sets** from ambientCG or Poly Haven, 2K: leather (quilted), leather (perforated), painted
  metal, brushed metal, rubber, carbon fiber, plastic. About 6-8 sets, ~60-100 MB as downloaded, packed down for
  the page.
- **NASA cloud cover** at full resolution (if the 2048 px one is too coarse from 35 km).
CesiumJS and Three.js load from their CDNs at run time; nothing to download.

## Testing
The headless-Chrome harness stays. Checks that don't need the network run with `?offline=1` (Cesium's plain globe,
no tiles): the flight, controls, modes, HUD, cockpit, lighting hooks. A smaller set needs the network and the token
(tiles load, imagery switches at the terminator, 3D tiles appear low down) and is marked as such. Screenshots at
desktop and 375 px before each phase is called done; frame time measured on this machine (the quality steps down
on its own if it drops).

## Phases (each a working page)
1. **The real Earth in Cesium**, with the ball warp, the seams, the HUD and the flight on top; the old world
   shader retired.
2. **The cockpit in Three.js**: the pod and rings as glTF with PBR textures, image-based light from the world,
   strip lights, shadows, bloom.
3. **Traffic** as glTF models in Cesium, nav lights, contrails.
4. **Clouds and time of day**: the cloud layers, the dusk start, the 3D tiles low down.
5. **Volumetric clouds and polish**, as far as the frame budget allows.

## Not doing
Weapons; a score; real airlines or aircraft; Unreal or any desktop build; sound (unless asked).

## Revision, 2026-10-08: the engine is Three.js + Takram (owner: "how do I make photorealistic clouds?", then
"Three.js + Takram, night", then "go ahead" after the spike)
Cesium has no volumetric clouds, so the world moves to **Three.js** with Takram's open-source geospatial packages,
loaded from esm.sh with an import map (no build step): `three@0.181.0`, `postprocessing@6.38.0`,
`@takram/three-geospatial@0.9.1`, `@takram/three-atmosphere@0.19.1`, `@takram/three-clouds@0.7.6`, later
`3d-tiles-renderer@0.5.3`. The spike (`site5/spike/clouds.html`, throwaway) showed: volumetric clouds and a
physical atmosphere run fast in a plain page; moonlit night works by lighting with the moon as if it were the sun
(it's the same light, dimmer) and exposing down; the cloud tiling shows from 35 km but holds at 12-20 km; dusk on
the terminator is the strongest image.
**Replaces the Cesium parts above:**
- **Sky and air**: Takram's atmosphere (precomputed on the GPU at load), aerial perspective, sun, moon, stars.
- **Clouds**: Takram's volumetric clouds (their tileable weather for now; NASA's global cover is a stretch goal).
- **Light**: the sun while it's above -4 deg; below that the moon stands in, the exposure falling to night levels
  and the image graded cool. The start is dusk on the terminator over Italy, heading east into the night; cruise
  18 km (35 km default replaced; the climb to 100 km stays).
- **The Earth**: Phase 1, the WGS84 ellipsoid with NASA's land/sea colour and Black Marble city lights (emissive,
  so they glow through the dark and under the clouds); Phase 2, streamed terrain and imagery through the ion token
  (3d-tiles-renderer: Cesium World Terrain 1, Earth at Night 3812, Bing 2) so the ground is sharp up close.
- **The ball warp**: a final postprocessing effect remaps the picture through the ball and draws the seams.
- **Cockpit** (Phase 3, was 2), **traffic models** (Phase 4, was 3) as before, in the same Three.js scene family.
  - **Phase 3, the seat: done (2026-10-08).** The pod is `assets/seat.glb` (baked PBR atlas) with the strips' light
    as a lightmap and a bloom, lit by the monitor's picture; see `2026-10-08-seat-light-design.md` and
    `plan-seat-light.md`. The hand rings are still the old exported meshes (their atlases are out of that scope).
