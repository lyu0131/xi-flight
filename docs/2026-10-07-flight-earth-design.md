# site5: launch, free flight over a 3D Earth, air traffic to identify (design)

Owner's brief (2026-10-07): "B and D" — a launch cinematic, then calm free flight; "some targets like airplanes and
stuff, but no shooting"; three flight modes, "free flight + hybrid + input only"; "can I make it 3D?" — yes.

## What it becomes
site5 opens on a short launch: the ball display boots, the HUD draws on, the hand rings clamp shut, and the suit
climbs out of the night cloud deck to cruising height over a curved Earth. Then it's yours: the suit drifts on a
scenic autopilot, or you fly it, among airliners, freighters, jets and weather balloons with their navigation lights
blinking. Lock one (hold it in the sight, as now) and the HUD identifies it: type, altitude, speed, heading, range.
Nothing shoots; locking is looking.

## Decisions
- **A real 3D world**, in km. Earth is a sphere (R 6371) with the suit above it; the suit has a position, a heading,
  a speed (cruise 0.25 km/s) and an altitude (kept 2–30 km). Everything outside is placed in that world: the cloud
  deck (a shell at 2–4 km), the ground's city lights, the aircraft. Directions to things come from positions, so they
  have distance, parallax and size.
- **Earth is procedural** (no image files; the pages open from file://): ocean and land from 3D noise on the sphere,
  city lights clustered on land, a cloud shell with its own coverage and moonlit tops, the atmosphere as a thin
  bright limb along the curved horizon. Night, the moon as now. The sky above keeps its stars and moon.
- **The ball pass stays one full-screen shader** (world.js): per pixel the ray meets the ball, the ball point gives
  a world direction as now, and that direction is traced from the suit's position against the cloud shell and the
  Earth (analytic sphere hits), so the horizon dips and curves with altitude.
- **Aircraft are 3D models**, built by a Blender script (tools/make_traffic.py -> js/traffic-data.js, a few thousand
  triangles each, contact shading baked), drawn on the world canvas after the sky pass by a vertex shader that maps
  each vertex to its direction from the ball's centre, then through the ball to the screen (the same mapping the HUD
  uses; aircraft are small, so per-vertex is exact enough). Depth tested among themselves. Far away (under ~3 px) an
  aircraft is drawn as its lights only. Navigation lights: red left wingtip, green right, white tail; strobes and a
  red beacon blinking. Contrails behind the jets: fading ribbons from a short position history.
- **Types, all generic** (no real airlines, makers or names): AIRLINER (twin-engine wide-body), FREIGHTER
  (four-engine, high wing), BIZJET (small T-tail), BALLOON (a weather balloon with its payload, rising slowly).
  Callsigns are made up (three letters and digits). The suit's own HUD marks stay the doubled W.
- **Traffic sim** (traffic.js): 6–9 aircraft within ~60 km, on airways at 8–12 km (balloons 15–30 km), straight
  legs with gentle turns; spawned out of sight ahead or to the sides, removed beyond range. Deterministic from a seed
  so tests can rely on it.
- **Locking = identifying.** Targeting is unchanged (nearest to the boresight inside 4.5 deg, held 0.5 s); once
  locked, a readout under the target: `AIRLINER  FTK 214` / `ALT 10.8 KM  SPD 245  HDG 071  RNG 12.4 KM`. An
  `IDENT n` counter grows as new aircraft are identified. No firing beams, no damage, no near-miss shake.
- **Three modes**, cycled by M or by tapping the mode word (a real button over the HUD, labelled for screen
  readers); the mode word on the triangle shows which:
  - **FREE** (the default after the launch): a scenic autopilot — slow banks, altitude drifting, now and then it
    turns to pass near an aircraft. The keys do nothing but a nudge it absorbs; this is the calm one to watch.
  - **HYBRID**: the autopilot flies as FREE; a key takes over (MANUAL) and it hands back 4 s after the last key,
    with the aim assist onto aircraft as now.
  - **INPUT**: only your input flies it; let go and it holds heading and altitude. No autopilot ever.
- **The launch** (about 25 s, skippable by any key, click or tap; skipped under reduced motion, which starts at
  cruise and holds still): 0–3 s the ball's panels light up one by one from the nose outward; 2–6 s the HUD draws on
  (rail, rulers, cluster, sight); the rings clamp as now; 4–16 s climb from 1 km inside the cloud deck (grey, the
  moon a smear) up through its top at ~4 km into clear night; 16–25 s level off toward 11 km as an airliner crosses
  ahead, lights blinking; then the mode word reads FREE and the hint appears.
- **The dogfight goes**: the scripted opponent loop, its escorts, the jinks, the near miss and the roll.

## Pieces and interfaces
- `ball.js`: the suit's kinematics (position, heading, speed, altitude, attitude from turn and climb), the modes and
  their input rules, the launch timeline (`pose.launch`, 0..1 progress, and its phase), targeting over
  `pose.contacts` (now aircraft: id, type, dir, range, alt, spd, hdg). `pose.pos` becomes [x, alt, z] in km.
- `traffic.js` (new): the aircraft sim; `SITE5.traffic.step(dt, suit)` returns the contacts; seeded.
- `world.js`: the Earth/cloud/sky trace from the suit's altitude; then the aircraft and contrail draw.
- `tools/make_traffic.py` (new) -> `js/traffic-data.js`: the four models, as the seat's exporter writes the seat.
- `hud.js`: marks and labels per aircraft type, the identify readout, `IDENT n`, the mode word; the launch's
  draw-on.
- `seat.js`: unchanged but for reading the launch's strap-in timing.
- `index.html`: the mode button, the new scripts.

## Not doing
Weapons of any kind; a score or an ending; real-world places, airlines or aircraft; day-time lighting (night only);
the pilot's body; sound.

## Testing
Headless, as now (tests/cockpit.test.js): the launch runs and a key skips it; reduced motion starts at cruise and
holds; each mode's input rule (FREE ignores keys, HYBRID hands back after 4 s, INPUT holds course); altitude moves
the horizon; the traffic sim is deterministic, spawns within range and removes out of range; locking an aircraft
shows its readout and counts it once; aircraft draw (pixels on the world canvas where one projects); frame time
under budget; a phone at 375 px. Screenshots at desktop and 375 px before calling a phase done.

## Phases
1. **3D flight and Earth**: kinematics, altitude, the Earth/cloud trace, the three modes, the dogfight removed
   (contacts empty for now).
2. **Traffic**: the sim, the models, the draw, nav lights and contrails, locking as identifying, the readout.
3. **The launch**: the timeline, the boot and draw-on, the climb-out, skip, reduced motion.

## Addendum, 2026-10-07: near space, arcade controls, the real Earth
Owner, through the build: "almost in space but not really"; "speed everything up by like x3"; the arcade controls
("lets do 1"); "the earth doesn't look real"; "make clouds realistic and make the terrain 3d"; "I want it to
actually feel realistic, to have space, to have everything"; "don't shrink ... make the website massive and make it
take like 20 seconds to load and have a full experience".
- **Height**: cruise 35 km by default (near space: a black sky overhead, the curve obvious), ceiling 60 km; the
  autopilot holds the height it's handed.
- **Speed**: x3 -- the throttle sets 0.3-1.5 km/s (cruise 0.75, 2700 km/h), Shift boosts +1.05 km/s.
- **Controls** (arcade): the mouse steers (offset from the centre past a dead zone), W/S throttle (it stays), A/D bank
  into a turn, Q/E yaw, Shift boost, a right-drag or C looks; arrows still a stick. HYBRID opens (the mouse works at
  once); FREE ignores all of it.
- **The real Earth**, from NASA's public-domain imagery in `tools/earth-src/` (not shipped as is):
  Black Marble 2016 city lights (13500x6750), Blue Marble topography and bathymetry (5400x2700), cloud cover
  (2048x1024), GEBCO elevation (21600x10800). `tools/make_earth.py` packs each as base64 in its own `js/earth-*.js`
  (the pages open from file://, and a data: image is same-origin for WebGL), at full resolution -- the page decides at
  load what the GPU can hold (MAX_TEXTURE_SIZE; split over two textures past it; downscaled on the page, never in
  the files). The suit starts over a real place at night (a coast with cities), its position turned into latitude and
  longitude as it flies.
- **3D terrain**: the elevation shades the ground (relief lit by the moon) and, near the ground and along the
  horizon, a heightfield march gives the mountains their silhouettes.
- **Realistic clouds**: the real cover decides where cloud is; within it, a short march through the deck gives
  puffed tops, shadowed sides and thin edges; inside it, fog.
- **Loading**: the page loads for as long as it needs; a loading readout in the HUD's voice shows the Earth arriving.
