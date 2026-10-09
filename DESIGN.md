# site5: ball cockpit test, the contract

A private testing place (never deployed: Cloudflare serves only `site4/`). One page, a cockpit seen from the pilot's
seat inside a spherical panoramic monitor, mixing the two cockpits of the owner's reference clips. What was taken from
the clips, and why, is in `docs/reference.md`.

## Rules
- Clean: no boxed panels, no console tablet. Only the ball, its HUD and the arm rails with their grips.
- Original drawing only: geometry and behaviour from the clips, never their names, logos or caption text (the look
  switcher's labels are the one place the two cockpits are named).
- Plain static: no build, no dependencies, relative paths. JS is `'use strict'` IIFEs; the only global is `SITE5`.
- Respect `prefers-reduced-motion`: no scripted flight, no sway, no shake; the head and the keys still work.

## The model (`js/ball.js`)
world -> **suit** (attitude quaternion) -> **ball** (unit sphere, rigid with the suit) -> **seat** (spring-hung in the
ball: thrown outward in a turn, pressed down in a pull, lagging the roll) -> **eye** (seat + head
look; it sits at `EYE0`, a little above and behind the centre). Frames: x right, y up, z forward; degrees.
  `FLOAT` (0.75, owner 2026-10-05) scales how much the camera floats: the seat's sway and jolts, its roll and
  pitch, and the head leading the move.
- The ball is a **display**: a point p on it shows the world in direction p from the centre. Seen from the eye, which is
  never at the centre, everything on it bends, and the bend moves as the seat sways. That is the only source of
  curvature; nothing is pre-curved.
- **Flight, in km** (spec `docs/2026-10-07-flight-earth-design.md`): world frame x east, y up, z north; the suit
  flies along its nose, `pose.pos` = [x, alt, z], `pose.geo` = [lat, lon]. **Speed** (5x the real-scale range, owner
  2026-10-08): the throttle t sets it on a **cubic curve**, `SPD_HI` 40 km/s x t^3 (owner, 2026-10-09: going slowly was
  impossible): 0.1 is 40 m/s, 0.3 about 1 km/s, 0.5 is 5 km/s, 1 is 40. W/S move t 0.5 a second, in every mode. The flight
  **starts standing still** (on a touch screen, with no W, at 0.5, 5 km/s). Shift adds 1.5x the speed (at least 2 km/s,
  at most `BOOST` 20). **Height**: starts at `ALT0` **400 km**, ceiling `ALT_HI` **1000 km**, floor `ALT_LO` 1 km or
  0.3 km over loaded terrain (the highest of here, 0.5 s and 1 s ahead, every 0.2 s, below 30 km; at a limit the climb
  is taken out). **Relief 3x** (owner, 2026-10-09): every 3D tile vertex's height over the ellipsoid is tripled as the
  tile loads (`EXAG` in earth3d.js, `?exag=1` for the real Earth); buildings stretch with it, the floor follows it. `?alt=` sets the start, `?seed=` the sky,
  `?traffic=0` empties it. The dogfight is gone (owner, 2026-10-07: "no shooting").
- **Traffic** (`js/traffic.js`): seven aircraft round the suit (AIRLINER, FREIGHTER, BIZJET, BALLOON; generic, made-up
  callsigns), spawned 25–55 km out round the heading, dropped past 70 km, seeded. They're the contacts: `d` and
  `range` from the suit (the Earth's drop taken off), plus `az`, `el`, `off`. `node site5/tests/traffic.test.js`.
- **AUTO** cruises to the traffic: the nearest aircraft within 60 deg of the nose not done in the last 20s, closed on
  with a lag so it drifts into the sight, until a lock on it has held 4s; with none in reach, slow banks, levelling.
- **MANUAL**: arrows/WASD fly it (55°/s turn, 40°/s climb); AUTO resumes 4s after the last key.
  Fire control helps aim, as AUTO's chase does: once every key is let go with a contact within 12 deg, the nose
  eases onto it and tracks it (the one being locked, if in reach, so it won't hop round a bunched group). Held keys
  always fly at full rate; a key ramps the turn up smoothly and letting go brakes hard, so a tap stops about where
  it's let go. (Owner, 2026-10-05: no lock after WASD; then, slowing the keys near contacts made turning
  a crawl when they were bunched.)
- **Three modes** (owner, 2026-10-07), `M` or the MODE button (bottom left, the hint's voice, no box; above the hint on
  narrow screens; `#time` stacked on it in a `#dock` that grows up as the button wraps), `?mode=free|hybrid|input`, `pose.mode`; the triangle's word is `pose.modeWord`:
  **FREE** (the default) watches -- AUTO only, the keys don't fly; **HYBRID** shares -- AUTO, a key takes over (MANUAL,
  the word reads MANUAL) and it hands back 4s after the last key, with the aim assist; **INPUT** is yours -- the keys
  only, no assist, and let go it holds heading and altitude (the pitch eases level). A switch takes effect at once.
  `pose.pilot` says who's flying (AUTO or MANUAL); the right ring's toggle follows it.
- **Head**: no looking round by dragging (taken out by the owner, 2026-10-09), and the cursor is hidden over the view
  (`cursor: none` on `#cockpit`; the dock's buttons show it). The head **leads every move** (0.3 x the turn rate, up to 24°; 0.42 x the climb rate, up to 20°) on a slightly bouncy spring,
  and the **mouse steers the gaze** (up to 9° across, 6° up and down). The HUD is painted on the ball, so this is what
  moves it on screen: climb and the whole HUD drops, as in the FPV clip when the pilot looks up. Off under reduced
  motion. `SITE5.project(ballPoint)` gives a ball point's screen position (tests use it).
- **Targeting**: the aircraft nearest the boresight, once within 4.5 deg (inside the
  sight), is held 0.5s to lock; the target is kept until it passes 7 deg or another sits 2.5 deg nearer, so the
  lock doesn't flicker. `pose.lockId` names it.
- **TOUR** (the fourth mode, M; owner 2026-10-09): a scenic loop of Europe's mountains, rivers and valleys
  (`js/tour-data.js`: the Amalfi coast, the Iron Gates, the High Tatras, the Wachau, Lake Bled, the Dolomites,
  Lauterbrunnen, the Matterhorn, Mont Blanc, the Verdon, Ordesa, Glen Coe, the Geirangerfjord, the Rhine Gorge). Each
  pass is a path of waypoints through the towns along it, snapped to the lowest ground within ~1 km by a survey of the
  3D Earth, flown at **2000 km/h** `agl` over the ground. Between passes it cruises 40 km up at 10 km/s, slowing and
  descending with the distance left (0.03 km/s per km) and climbing out the same way; a leg aims at a gate on the pass's
  line, back by what a 30 deg glide needs, so it lines up with the valley (from orbit it swings out and glides in). The
  clock is moved to 10:30 local if a pass would be reached outside 9-16 h. Steering takes over as in HYBRID. The mode
  button reads `TOUR · NEXT: <PASS> · <KM>` / `TOUR · <PASS> · <KM LEFT>`; `pose.tour`; `?tour=<n>` starts at pass n.
- **No pause**: added 2026-10-08 (`P`, `#pause`), taken out again by the owner 2026-10-09.
- **Go to (Ctrl+K / Cmd+K)** (`js/search.js`, owner 2026-10-09): a `<dialog>` in the HUD's voice. A place name is looked up
  with OpenStreetMap's Nominatim on Enter only (its usage policy: no search-as-you-type; credited in the box), up to 5
  results, the first focused; or `lat, lon` (and `, km`). `SITE5.teleport(lat, lon, km = 5)` puts the suit there, the
  floor worked out afresh. While it's open `SITE5.typing` keeps the keys and the mouse from flying the suit.
- `SITE5.pose` is the one per-frame snapshot both renderers read; `SITE5.renderers` are called in order.

## The picture (`js/sky.js`)
The realism rebuild (spec `docs/2026-10-08-realism-rebuild-design.md`, Revision): an ES module on **Three.js** with
Takram's physical atmosphere and volumetric clouds, the library versions pinned in `index.html`'s import map (esm.sh).
It runs over http only (`.claude/launch.json` `site5`, or the tests' own server) and needs the network.
- **The Earth**: the WGS84 ellipsoid at real scale, NASA's land and sea colour and Black Marble city lights as emission (both in
  `assets/earth/`; if they can't load the readout says THE EARTH'S MAPS COULDN'T LOAD), lit through the air by the sun or the moon
  (Takram's sun light and sky light probe). **The night sky** (`js/starsky.js`, spec `docs/2026-10-09-night-sky-design.md`): the HYG catalogue's 41 487
  stars to magnitude 8 at their true colours, NASA's star-free Milky Way (SVS Deep Star Maps 2020) behind them, and Mercury,
  Venus, Mars, Jupiter and Saturn where they are on the date (`astronomy-engine`, CDN). Baked by `tools/make_sky.py`
  (Blender's Python) into `assets/sky/` (`stars.bin`, `milkyway.jpg`). Stars are Gaussian points, the brightest with a
  halo; they twinkle and dim low over the horizon when the suit is down in the air. All on spheres round the camera; the
  Earth hides them by a ray test on the ellipsoid (the flat Earth's depth offset put it level with them, so in the monitor
  capture they shone through it and held the night meter at a day exposure). Kept out of the capture (a star's light is
  set per pixel). Bright as seen at a night exposure (60) up, a tenth in daylight; credited on the credit line.
- **Daylight** (owner 2026-10-09, "the glare from the daylight is messed up"): the sun's disc drew as a bare 2 px dot, so
  it now has a glare: a bloom (`glare` in sky.js) only what's 20 or brighter on the display goes into, its threshold moved
  with the exposure. The flat Earth is pushed back by 0.3% of its distance (`EARTH_PUSH`, in its vertex shader) instead
  of a 2000-unit polygon offset, which had put its depth at the far value: the air's effect took it for sky and left it
  unhazed (pale patches from orbit, dark slabs along the horizon). Tiles shade with the smooth globe's normal past 30 km
  (fully by 200 km): their coarse facets caught the sun as a patchwork of blocks. Stars and the Milky Way are gone at a
  day exposure. (SkyMaterial's cosSunAngularRadius uniform is set through its setter: it starts at the radius itself.)
- **The 3D Earth's quality** (owner 2026-10-09, "make rendering a lot better"): the tile cache holds 1.2 GB (0.9 kept on
  a trim; the library's 0.4 GB filled at ~1300 tiles and stopped any finer one loading), the detail tunes between 2 and
  24 px (finer under 7.5 ms a frame, coarser over 12), tile photos get 8x anisotropic filtering. Mipmaps stay off (the
  plugin's default): with them on, a third fewer tiles fit and the atlases bled into seams. With the 3x relief each tile's
  culling volume is lifted too (its box grown to hold its corners lifted, heights clamped -0.5..9 km): without it the
  tiles near the suit fell outside their own volumes and were culled, and the flat Earth showed through low over hills.
- **The 3D Earth** (`js/earth3d.js`, spec `docs/2026-10-08-photoreal-earth-design.md`): Google's Photorealistic 3D Tiles,
  streamed through Cesium ion (asset 2275207) by `3d-tiles-renderer`, in ECEF metres (the scene's own frame, so the tile group
  needs no transform). Only the main camera drives the level of detail (`errorTarget` 16). Each tile's material is a lit
  `MeshStandardMaterial` (photo as `map`, normals computed where a tile has none), so Takram's sun and sky light reach it
  and the monitor capture and seat light work over it; at night the Black Marble city lights glow on it through a shared
  shader patch (`setNight`). The flat Earth above stays as the fallback, **1000 m below** the WGS84 surface (coarse far tiles
  sag up to ~400 m under it): it fills gaps while tiles stream in and is the whole Earth with no tiles.
  - **The key**: `js/keys.js` (`window.SITE5_KEYS = { cesiumIon }`) is git-ignored and loaded as an optional classic script;
    without it, or with an exhausted quota or no network, the flat Earth flies and (on an auth or root failure) the readout
    says THE 3D EARTH COULDN'T LOAD. Never print, log or commit the key. Publishing `keys.js` waits for the token's Allowed
    URLs to be restricted in the Cesium ion dashboard (the owner has confirmed they are).
  - **`?tiles=0`** turns the tiles off (flat Earth, `world.tiles.on === false`); `?tilestoken=bad` is a test hook that
    puts in a key ion refuses.
  - **The terrain floor** (`js/ball.js`): twice a second the model asks `SITE5.world.heightAt(lat, lon)` (a ray down the
    ellipsoid normal into the loaded tiles) and keeps the suit at least 0.3 km above the ground (`ALT_LO` where nothing is loaded).
  - **Attribution** (`#attrib`, bottom right, the HUD's quiet text): `tiles.getAttributions()` joined with ` · `, refreshed
    at most once a second, empty with the tiles off; `pointer-events: none`, wraps within the width at 375 px.
- **Clouds**: Takram's volumetric clouds (their tileable weather; NASA's global cover is a stretch goal), lit by the
  same light, shadows on the ground, composited into the aerial perspective (the sky and the air between).
- **The light**: the real sun (twilight glow included) until twilight has ended (-10 deg); after that, with the moon
  up, the moon stands in for it at night exposure (0.45 against 10), easing over 3 s. Under the sun the monitor meters
  its own picture like a camera: never below the day's 10, opening up to 300 as the twilight dims (wall-clock, 3 s).
  **The meter reads the Earth only** (owner, 2026-10-08: from 400 km black space dragged the mean down until the ground
  blew out): of the capture's samples (every 4th pixel; each face's directions in seat axes worked out once) it keeps
  those below the geometric horizon, `dot(dir, upSeat) < -sin(horizonDip(alt))`; under 2% Earth the goal stays.
  City lights and stars keep their apparent brightness whatever the exposure. **City lights only where it's dark on the
  ground**: on the flat Earth (`earthMat`, `onBeforeCompile`) and the tiles (`setNight(map, k, sunDir)`) they're scaled by
  `1 - smoothstep(-6, +2 deg)` of the real sun's elevation over that point (never the moon's, even when it lights the
  scene); `SITE5.world.cityGlowAt(lat, lon)` is the same factor in JS.
  **Two maps, by altitude** (brief 2026-10-08; the owner on a town seen low down as a huge soft orange disc: "look at
  how ugly this is"). Both materials share one shader function (`earth3d.js`: `NIGHT_GLSL`, `nightLight()`, its
  uniforms in the exported `night`, set each frame by the exported `setNight(map, k, sun, light, glow, nightLights)`):
  - the **global 3 km map** (`BlackMarble_2016_3km.jpg`) x `smoothstep(40, 60, alt km)`: gone below 40 km, full above 60;
  - the **500 m mosaic** (`js/nightlights.js`): NASA GIBS Black Marble tiles at z8 (Web Mercator, no key, CORS), 16 x 16
    tiles on a 4096 px canvas centred on the suit's tile, re-centred when the suit is more than 4 tiles off centre (the
    loaded part moves over by drawing the canvas onto itself; only new tiles are fetched, nearest first, at most 8 in
    flight); a failed tile stays black. (Its texture is uploaded raw, mipmapped, and the shader decodes the sRGB: tagged sRGB, Chrome converted the whole canvas on the CPU at every upload, ~130 ms frames.) A 16 x 16 mask texture says which tiles are in; the texture, the mask and the
    mosaic's top-left tile change together, at most twice a second. Where a point's z8 tile is in the mosaic and loaded
    it shows x `smoothstep(8, 15, alt km)` (fading out below ~10 km, where even 500 m pixels are blobs), blended into the
    global map over the mosaic's last tile; elsewhere the global map. Colour, `CITY / exposure` and the sun gate are as
    before. `?nightlights=0` turns the mosaic off. `SITE5.world.nightGlow = { global, near }` (the two factors, 0..1),
    `SITE5.world.nightTiles = { loaded, failed }` (in the current mosaic).
- **The world clock** (owner, 2026-10-08): the world's date is `START + pose.t + offset`, and each frame the offset
  runs at (rate - 1) x the wall-clock frame time (capped 0.25 s), so it works under reduced motion too (where pose.t
  stands still, and x0 and x1 both hold the clock). Rates x0 (paused), x1, x60, x600, x3600: `]` faster, `[` slower
  (each stops at the end), `\` back to x1 and now (keys ignored while typing in a field). `#time` (bottom left,
  stacked on MODE, its voice) reads `HH:MM LOCAL · ×RATE` (`⏸` paused), local being mean solar time (UTC + lon/15 h);
  a tap steps the rate on, x3600 wrapping to x0. `SITE5.world.time` = { rate, date }. The hint says `[ ] TIME`. The volumetric clouds are off for now
  (owner, 2026-10-08); `?clouds=1` brings them back. The start: 40.92 N 14.95 E (east of Naples), 400 km, heading 258
  (west, the city and the afterglow ahead), `2026-10-08T17:10:00Z` (dusk); `?lat ?lon ?alt ?hdg ?time ?throttle ?clouds`.
- **The ball**: the camera sits at the suit and looks where the eye looks (local east-north-up x suit x eye), with
  1.62 x the screen's field; the last pass warps it through the ball (screen pixel -> ray from the eye -> ball point
  -> its direction -> the wide picture), so the world bends as on a spherical monitor seen from off its centre.
  Rendered at 1.3 x the screen (DPR capped 1.5), stepping down by 0.15 (to 0.6) while frames average over 21 ms.
- **Loading**: `#loading` counts the nine loads in; if the module or a library can't load, it says THE WORLD
  COULDN'T LOAD and the cockpit runs on. `SITE5.world` = { ready, cloudsReady, light, exposure, loads, camera,
  srcTan, time, cityGlowAt, nightGlow, nightTiles, tiles, heightAt }; `SITE5.warp(x, y)` is the warp in JS; `SITE5.horizonDip(alt)`.
- Not yet (later phases): the cockpit relit by this world (Phase 3),
  the aircraft as 3D models (Phase 4; until then only their HUD marks).

## The HUD (`js/hud.js`)
A 2D canvas of vectors authored on the ball and projected through the same geometry as the picture, every line
subdivided every ~1.2 deg. **The layout is measured, not composed** (owner, 2026-10-05: "you have the elements,
but you don't position them correctly"): every front position was read off the owner's front frame (ref, 1:26:32)
and turned into ball angles; the side rings come from the side frame (29:50). A test checks the anchors land
within 2.5% of where that frame has them, on a 16:9 screen in the still (reduced-motion) pose.
- **Lowered under the triangle** (owner, 2026-10-05): the rail and the cluster sit 4 deg lower than the frame has
  them, and the view rests on the nose itself, so the triangle sight is right in front of the eyes (the cluster
  at the bottom of the screen; look down a touch for all of it).
- **The pink rail**: a parallel at el -22 right round the ball (pink core over a lighter line, white tick rails),
  open in front between az +-30 where diamond caps close it (each line ends on the cap's edge at its own height, the
  same on both sides; the ticks are spaced to fit between the caps), salmon chevrons at +-26 pointing in.
- **Side rings** at az +-90 and 180, centred on the rail: a 3.4 deg crosshair circle with radial ticks, a dotted ring (26), two dot grids. (Their ring of coffin cells was
  removed, owner 2026-10-07.)
- **Element size**: everything is drawn at `SZ` = 0.75 of its measured size, in place (owner: too cluttered).
- **The tall rulers**: full circles round a point off each side (az +-90, el -10, radius 48), through the measured
  ruler path, so they bow toward the middle and curve wherever you look; their dashes slide round with the
  suit's pitch (1.6 deg of arc per degree, a long one every fifth); a coffin column round the same centre just
  outside, the whole way round, points toward the nose; a plate on each at eye level.
- **The centre**: heading ticks at el 22 across +-12 deg that scroll with the heading (one a degree, taller every 5,
  tallest every 10, fading at the ends) under a
  fixed caret; under the caret the speed (`… KM/H`, `parts.speedText`) and under that, in the same style, where the
  suit is: `40.92°N 14.95°E · ALT 18.4 KM` (2 decimals, S/W when negative, ALT to 0.1 km under 100 km and whole km
  above; `parts.posText`); and the nose designator at el -10 (salmon bars, dash text, a small V). The pitch ladder, the
  centre line, the slashes, the frame dashes and the dotted lead arc were removed (owner, 2026-10-05).
- **The cluster** under the nose, scaled by `SZ` about its centre (el -27), from the frame's (el -24 .. -36): V, dash text, caret, salmon caret, a salmon triangle plate;
  sized up by what each holds (owner, 2026-10-05): the badges (radar, thrust vector) 3.5 at +-11.8, the bar plates 4
  at +-20.5, the turn tabs 1.9 above and below each badge, the cell grids at +-28, the centre stack about 25% up.
  Every shape reads the flight (the owner's picks of the cluster demos): the upper dash row scrolls with the turn
  and the lower is a scrolling trace that spikes with each manoeuvre; the left badge is the radar (heading-up, a
  sweep arm at site4's 3.4s with a fading trail, the view wedge, a blip per contact lit as the arm passes, the
  target's pink) and the right one the thrust vector; the turn tabs light on the turn's side, chevrons running
  out; the plates hold bars (thrust left, its verniers firing for the turns; reactor right, a row going pink in a
  dive); the cell grids blink on their own. The pitch arrows are the cluster's blue: the up arrow on top pointing
  up, the down arrow under the trace pointing down; climbing pushes the up arrow up (on a spring) with echoes peeling
  off upward and fading, diving the same downward. Only the triangle and its caret carry a state colour, always
  together: salmon, pink once locked. The triangle pulses while a lock builds; on lock a pulse runs in along the rail to the caps,
  which flash, a flash runs up the chevron stack, and the triangle stays pink while locked. Lit pieces draw at tier 1
  for that moment. Reduced motion: the radar arm parks at the top and nothing scrolls, ripples, flashes or blinks.
- **World-fixed**: the contacts as doubled W marks (UNKNOWN, MS), small (about 2 deg across for the opponent); the
  current target reads first (tier 1) and turns pink with LOCK once locked, whichever contact it is.
- **The triangle sight** (or the Y, `?look=penelope`), at about half its earlier size (`TRI` 0.55), with the
  AUTO/MANUAL word; the owner's pick "E" of the lock demos, all on springs. The big triangle rides the nose but
  sways: it lags the suit's turns and drifts a little at rest. Idle it all sits faint (15%, no halo). While a lock
  builds, the brackets and V flare open, close in (jittering, settling) and slew onto the target, brightening; on
  lock they clunk past full size, blink twice (60ms beats), then breathe and follow the target tightly, the V pink,
  and a faint outline pings out each second. When the lock breaks a copy of the brackets flies apart. Reduced
  motion: no springs, sway, jitter or pings. No look switcher on screen.
- **Cells**: flat translucent slate with a very faint gradient (lighter at the wide end, darker toward the point) and
  a soft luminous border (a faint wide halo under a fine edge). The ruler columns are spaced evenly the whole way
  round (an even count, so the stagger meets itself where the circle closes).
- **The glow**: lit runs move along the coffin cells, each cell lighting up (a brighter face, a lit edge, a soft
  halo) and fading as the run moves on -- four runs climbing each ruler column (18 cells a second). Driven by the flight clock, so it holds still under reduced motion.
- `SITE5.parts` (`rail`, `caps`, `markers`, `lockSight`, `rear`, `seat`), `SITE5.tapes`
  (`stream`: the rulers' pitch phase, `heading`), `SITE5.anchors` are there for the tests.

## The eye and the camera
The eye sits 0.2 ball radii behind the centre (`EYE0`; 0.4 until the realism rebuild, as the reference camera does, but
at 0.4 the world camera needed a 160 deg field to feed the warp): from the exact centre every
great circle would look straight; from behind it, everything on the ball curves the way the inside of a dome does.
The view rests on the nose (it was 7 deg below, as the frame is shot). The eye distance, a 78-deg width and that tilt were fitted together so the
measured layout lands on the frame (rms ~1%); the owner then asked for a wider view, three times, so it runs at 120 deg across
(90 tall on a portrait screen; the hand rings show at the bottom of the front view) and the layout test scales the frame's positions to match.

**Hierarchy** (brightness, opacity and weight only; the colours stay): `tier(n)` before each group.
1 the triangle sight and the active target: full, the reticle bars and brackets a touch heavier, a sharp core over a
restrained halo; 2 the pink rail's core: a fainter, tighter halo; 3 rulers, rings, coffin cells, heading ticks,
escorts: crisp, no halo, 0.82 opacity; 4 plates, badges, tabs, dash text, dot grids: the finest, 0.7 (the cluster's pieces step up to tier 1 while lit). A halo is a
second wider faint stroke under the core (never a blur), capped at 4px (tier 1) / 3px (tier 2) past the core's edge,
so it never runs neighbouring shapes together. The coffin glow keeps a quieter halo than before.

Line weight follows depth: with the eye behind the centre, nearer parts of the monitor draw a little heavier
(`depthScale`: the square root of the distance ratio, held to 0.85..1.35). Long lines (the rail, rings, ruler
circles) are stroked a few segments at a time with round joins, so the weight changes smoothly with no seam.

## The panels (`js/hud.js`)
92 near-equal panels, drawn by the HUD as vectors (the Voronoi edges, worked out once): the Voronoi of a 3-frequency subdivided icosahedron (12 of them pentagons, the rest
hexagons), turned so a hexagon sits square on the nose and the pattern mirrors left to right. No per-panel tone. The seams ease off to 45% within ~20 deg of the nose,
so the aiming area reads clean.

## The seat (`js/seat.js`)
A real 3D model, WebGL2 on its own canvas (`#seat`) over the HUD. **The seat is the armoured pod** (the owner's pick
of the Blender concepts, 2026-10-07, shaped after their sketch): one laid-back shell from the head to the knees (the
back reclined 22 deg about the hips), graphite paint worn at the edges, with layered armour plates and seams, hip
and shoulder guards and a crown with a sensor pod at each end over the head; where the body rests, quilted and
perforated leather panels between fat bolster rolls with pink piping, a lit pommel ridge between the thighs, a lumbar
roll, a lit spine channel and a horseshoe headrest; armrest pods grown out of the shell's flanks down to its belly
(owner: nothing sticking out unsupported), each with a forearm cradle in three pads, an elbow cup and a ribbed wrist
plate; below the knee the legs split into two cradles on their own knee hinges, ending at foot pedals (an axle, a
ribbed footplate, a heel cup, a toe bar, a return strut; parked, not animated). No seatbelts, no legs to a floor, no
base. The source is `tools/make_seat.py`, which builds it, bakes a 4096 atlas (base colour, tangent normal, ORM with
the contact shading; scanned CC0 textures under the procedural quilt and wear) and writes `assets/seat.glb` (about
11 MB; a node per group, `extras.grp`; scene extras `glowMax`, `ring`, `points` in Three axes) and
`assets/seat-light.jpg` (the strips' light, linear, over glowMax): `blender -b --factory-startup -P
site5/tools/make_seat.py` (GPU, about 6 min); add `-- --look` in an open Blender to look at it. The eye is the reclined pilot's: the export puts the origin there, so the lap, the
leg cradles and the rings sit below the view. Then the hand rings (the owner's design, from their sketch: no joystick) -- modelled in Blender, in the live session
over the MCP, after the owner's references (pistons, mechanics, a HOTAS's switches). The source is
`tools/hand_ring.blend`; `tools/export_ring.py` bakes its contact shading and writes `js/ring-data.js`. One floats over the front of each armrest pod (the glb's `extras.ring`): the forearm goes through a slim inner ring
(a soft liner inside) and the hand closes on an L handbar -- a rail from the ring's outer side through a clamp collar
and an armoured sleeve (a lit channel, cap screws), a knuckle housing at the L's corner (vents, an amber status light,
a stencilled R), then 90 deg inward into a rubber grip under three armour plates, with four flat glossy keys, one per
finger, in a recessed channel, and a domed thumb control in a ring of light on the knurled end cap. Two cables run
from the knuckle to the collar in clips. The outer track (a pink trim line round it) yaws and pitches; the inner ring
rolls inside it; the upper halves of both open together as a clamshell about one hinge on the outer side: on load
they start open and swing shut as the pilot straps in (closed at once under reduced motion). Two pistons (a red
band, a chrome rod) work between the frames: one from the track to the handbar, stroking as the ring rolls, one
across the hinge, driving the clamshell. They move with `pose.stick` (from the turn and climb rates, so AUTO moves
them too) as **twin sticks** (owner, 2026-10-07): a climb pulls both back, a dive pushes both forward (up to 18 deg);
a turn pushes them opposite ways (turning right, the left forward and the right back), and the inner ring rolls up
to 35 deg into it inside the outer track (owner: the inner circle turns as well as the outer).
The right hand's controls (targeting) are worked by the flight: the thumb holds the dome in while a lock builds, the
trigger blade under the index finger snaps in on the lock, the red pinky paddle squeezes when a lock breaks; on the
knuckle, the SEL dial clicks round a position for each new target and the toggle flicks to MANUAL when the pilot
takes over; once strapped in, the guarded ARM button's flip cover goes up, the button goes in, and the four keys
ripple through a check (under reduced motion, the cover is simply up). The left hand is the right mirrored, with its own
controls for thrust (parts tagged `side` L or R in the .blend; the left's lettering is authored mirrored so it reads
right): the whole grip is a twist throttle that winds up with how hard the suit manoeuvres (further on boost), an
amber boost lever under the index finger snaps in on a jink, a hard pull or a near miss, a ribbed thumb wheel in the
end cap runs with the turn, and on the knuckle a CRUISE / COMBAT rocker tips to COMBAT while a target is held beside
a five-segment throttle gauge (lit a segment per fifth; it sweeps up once as a check on strap-in). Re-export after editing the .blend: `blender -b site5/tools/hand_ring.blend -P site5/tools/export_ring.py`.
**The pipeline** (spec `docs/2026-10-08-seat-light-design.md`): `seat.js` is an ES module on Three.js r181 with its
own WebGLRenderer on `#seat`. Layering stays **world canvas -> HUD canvas -> seat canvas** (the HUD is painted on
the ball, behind the seat; the seat canvas is transparent, premultiplied). Each frame:
capture -> PMREM -> glb atlas + lightmap -> bloom -> Neutral.
- **Capture**: `sky.js` renders the monitor's picture as the monitor shows it into six faces round the eye
  (`SITE5.env`); `seat.js` uploads each new set as a cube and prefilters it (PMREM) into `scene.environment`: the
  diffuse light and the rough reflections. A flat dim grey (0.02) until the first capture.
- **The pod**: `assets/seat.glb` through `GLTFLoader` (glTF PBR; clearcoat on the shell and plates, sheen on the
  leathers), each material with `assets/seat-light.jpg` as its `lightMap` (uv0) at glowMax x pi (Three's lightmap is
  irradiance; the bake already holds the strips' pink). `A_glow` and `A_lens` are emissive. If the glb can't load the
  readout says `THE SEAT COULDN'T LOAD` and only the rings are drawn. `?seat=<name>` loads `assets/<name>.glb`.
- **The rings** keep `js/ring-data.js` as Three meshes with physical materials (`MAT`), their contact shading a
  vertex attribute, lit by the same environment.
- **Bloom, then tone mapping**: postprocessing's `EffectComposer` (half float, 4x multisampled): the scene, a
  `BloomEffect` (threshold 0.9, intensity 0.6, mipmap blur at radius 0.5: only the strips pass, and the halo stays
  near them), then `ToneMappingEffect`
  Neutral at exposure 1 (the renderer's own is off). Off the seat the halo has alpha 0, so through the premultiplied
  canvas it adds onto what's behind.
- **The light rule** (owner, 2026-10-07): the cockpit is closed. The seat is lit only by the monitor's picture and its
  own lights (the strips), plus the HUD's faint periwinkle fill from ahead and above (fixed to the ball) and the
  near-miss flash. No sun, moon or key light: the sun's light is already in the picture.

Only the head turning moves it. The pilot's body isn't drawn, so looking straight down shows the seat under where it would be. No tablets (no panels).
Narrow screens draw the seat and rings closer (`KX`).

## Palette (sampled off the clips)
Lines `#AFC0EC` (mix) / `#9CB3E8` / `#BAC4F4`, white ticks `#EEF3FA`, mode word `#FFA3DC`, horizon bars `#FF4F8B` over
`#FFC6E8`, target label `#EBA89C`, hex cells `rgba(63,78,92,.2)`, waist rail `#5D7391`; sky `#05080F` to `#1B2D3A`,
clouds `#3D5266`. Type: Michroma (HUD words), B612 Mono fallback.

## Tests
Three files in `tests/`, run from the repo root. They need only Node (22+) and, for the first, Chrome or Edge;
`tests/cdp.js` (a copy of site4's headless-Chrome driver) and `tests/serve.js` (a small static server on a free port,
since the site is http-only) come with them.
- `node site5/tests/cockpit.test.js` (about 8 minutes, needs the network for the CDN libraries): the ball, the HUD
  and the world draw; AUTO flies and sways the seat; the hand rings open and close on strap-in and carry their own
  controls; keys take over and hand back; a drag doesn't look round; it starts stopped and W/S go and stop; the three modes and the arcade keys; targeting and
  locks; altitude limits; the seat at rest; the world's light, clouds and night cities, and a world that
  fails says so; the monitor capture (six 64² faces, day brighter than night); the seat's light (from seat.glb, noon
  brighter than night, its lit side follows the sun, warm at a sunset, a synthetic right-hand monitor lights the
  right-facing walls, dim but never black before a capture, a missing seat says so and the rings still draw); frame
  time (and a 30 s fast flight over the tiles); every look; reduced motion holds still; a 375px phone fits (the attribution too). The 3D block uses the real key and skips with a note without `js/keys.js`; `ONLY=3d,phone node site5/tests/cockpit.test.js` runs chosen blocks (the names in the `want('...')` wrappers). The harness launches Chrome with BackForwardCache off (old pages kept their WebGL alive and hung later loads). Its `ready()` waits for the world and the seat.
  One timing check ("MANUAL: steering at the enemy... locks within 3s") is a known flake.
- `node site5/tests/traffic.test.js` (plain Node, instant): the traffic sim -- same seed same sky, 6 to 9 aircraft
  within 70 km, they leave and are replaced, heights by type, callsigns, contrails, `?near`.
- `node site5/tests/seat-glb.test.js` (plain Node, instant): `assets/seat.glb` has every A_ material, UVs and tangents,
  the atlas maps, the extras (glowMax, the ring centre, the sample points), sits where the old seat did, is under
  30 MB, and `assets/seat-light.jpg` is beside it. Run it after `tools/make_seat.py`.
