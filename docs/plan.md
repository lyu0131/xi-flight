# site5 flight, Earth and traffic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn site5's looping dogfight into a launch over a 3D night Earth, then calm flight among air traffic you can lock to identify, in three modes.

**Architecture:** The suit gets a real position in km over a spherical Earth; `traffic.js` simulates aircraft in that frame and hands `ball.js` their directions and ranges as contacts. `world.js` traces each ball pixel's world direction from the suit's altitude against the cloud shell and the Earth, then draws the aircraft as meshes mapped through the ball. The HUD keeps its targeting; locking now identifies.

**Tech Stack:** Plain static HTML/CSS/JS (`'use strict'` IIFEs, global `SITE5` only), WebGL2, Blender 5.2 headless for models, headless Chrome over CDP for tests (`site4/tests/cdp.js`), Node 22.

**Spec:** `site5/docs/2026-10-07-flight-earth-design.md`

## Global Constraints
- No build step, relative paths, pages open from `file://` (data ships as `.js`, no image textures).
- The only global is `SITE5` (data files may set `window.SITE5_*`, as `SITE5_RING` / `SITE5_SEAT` do).
- No weapons, beams, damage or near-miss shake; locking is identifying.
- No real airlines, makers, aircraft names or places: types are `AIRLINER`, `FREIGHTER`, `BIZJET`, `BALLOON`; callsigns are made up.
- Night only; the cockpit is closed (no moonlight on the seat).
- `prefers-reduced-motion`: no launch, no autopilot motion, the suit holds still at cruise; the keys and head still work.
- No orange-and-black hazard stripes. No boxed panels in the cockpit.
- Check at 375 px (no horizontal scroll) and desktop with headless-Chrome screenshots before calling a phase done.
- Units: world frame x east, y up, z north, km; heading 0 = north (+z), degrees clockwise; the suit's `dir(az, el)` convention.

## Review Focus
- **No contact in reach** (all traffic behind, or the list empty): targeting, the autopilot, the HUD radar and the aim assist must not throw on an empty or far list — Task 2 test `targeting with no contacts`.
- **Altitude at the limits** (2 km floor, 30 km ceiling) while a key holds the climb: the suit levels off, never NaN or below the floor — Task 2 test `the floor and ceiling hold`.
- **Mode switch mid-takeover** (M while MANUAL in HYBRID, or into FREE with a key held): the new mode's rule applies at once, no stuck MANUAL — Task 4 test `switching mode while a key is held`.
- **A skip during the launch's first frame or at its very end**: lands in the cruise state exactly once, strap-in still completes — Task 8 test `skip at once and skip late`.
- **The same aircraft identified twice**: `IDENT` counts it once — Task 7 test `identify counts once`.

---

## Phase 1: 3D flight and Earth

### Task 1: The traffic simulation

**Files:**
- Create: `site5/js/traffic.js`
- Create: `site5/tests/traffic.test.js`
- Modify: `site5/index.html` (load `js/traffic.js` after `js/ball.js`)

**Interfaces:**
- Produces: `SITE5.makeTraffic(seed: number) -> { step(dt: number, suit: {pos: [x, alt, z], heading: number}) -> Contact[] }`
  - `Contact = { id: string, type: 'AIRLINER'|'FREIGHTER'|'BIZJET'|'BALLOON', callsign: string, pos: [x, alt, z] (km), hdg: number (deg), spd: number (km/s), d: [x, y, z] (unit, from the suit, world frame, with the Earth's drop range²/(2·6371) taken off y), range: number (km) }`
  - Works in Node: the file attaches to `(typeof window !== 'undefined' ? window : globalThis).SITE5` (creating `{}` if absent in Node only).

- [ ] **Step 1: Write the failing tests** in `site5/tests/traffic.test.js` (plain `assert`, run with `node`):
  - `same seed, same sky`: two `makeTraffic(7)` stepped with the same suit give identical first-step `id`, `type`, `pos`.
  - `6 to 9 aircraft, all within 70 km`: step 600 s at dt 0.1 with the suit flying north at 0.25 km/s, 11 km; every step's count in [6, 9], every `range` in (0, 70].
  - `they leave and are replaced`: over those 600 s at least 3 distinct ids have come and gone.
  - `directions are unit vectors`: `|d|` within 1e-6 of 1.
  - `heights by type`: AIRLINER 9.5–12, FREIGHTER 8–10.5, BIZJET 11–13, BALLOON 15–30 km, at every step.
  - `callsigns`: AIRLINER/FREIGHTER/BIZJET match `/^[A-Z]{3} \d{2,3}$/`, BALLOON `/^WX \d{2,3}$/`; none contain a real airline code (check against `['AAL','DAL','UAL','BAW','AFR','DLH','UAE','QFA','JAL','ANA','SIA','CPA','KLM','RYR','EZY']`).

- [ ] **Step 2: Run** `node site5/tests/traffic.test.js` — expected: fails (`makeTraffic is not a function`).

- [ ] **Step 3: Implement `makeTraffic(seed)`** — a seeded mulberry32; keep 7 aircraft (spawn when under 6, never above 9); spawn 25–55 km out within ±70° of the suit's heading; type weights AIRLINER .45, BIZJET .25, FREIGHTER .2, BALLOON .1; speeds AIRLINER .25, FREIGHTER .23, BIZJET .24 km/s, BALLOON .002 drifting with a .005 km/s climb (wraps back to 15 km at 30); every 30–60 s a heading change of ±20° at 1.5°/s; remove beyond 70 km. Callsign prefixes from a fixed made-up list (`KTR VAN OSK MRK TLS ORV PEL NAU`).

- [ ] **Step 4: Run** `node site5/tests/traffic.test.js` — expected: all PASS lines, exit 0.

- [ ] **Step 5: Commit** `site5: a traffic sim -- airliners, freighters, jets and balloons over a seeded sky`.

### Task 2: The suit flies in km; the dogfight goes

**Files:**
- Modify: `site5/js/ball.js` (state, `step`, pose; remove `LOOP`, `KEYS`, `oppAt`, `EVENTS`, `events`, the opponent and escorts)
- Modify: `site5/tests/cockpit.test.js` (contacts and lock checks for traffic)
- Modify: `site5/DESIGN.md` (The model)

**Interfaces:**
- Consumes: `SITE5.makeTraffic(seed)` (Task 1). Seed from `?seed=N`, default 1.
- Produces, on `SITE5.pose`: `pos: [x, alt, z]` (km), `alt` (km), `speed` (km/s, 0.25), `heading`, `pitch` (the flight path angle, deg), `contacts: Contact[]` each with `off` (deg off the nose), `az`, `el` (deg, world) added; `pilot: 'AUTO'|'MANUAL'`; existing `lockId`, `locked`, `lockT`, `stick`, `flash` (now always decaying from 0), `t`. `opp` is removed.

- [ ] **Step 1: Write the failing tests** in `cockpit.test.js` (main run `?mode=hybrid&seed=7`, replacing the dogfight checks):
  - `the suit flies forward`: `pos` moves about 0.25 km/s along the heading (2 s: 0.4–0.6 km).
  - `6 to 9 aircraft in the world` (replaces `three contacts in the world`), and the radar's `blips` equals `contacts.length`.
  - `climbing raises the altitude`: ArrowUp held 2 s raises `alt` by more than 0.5 km.
  - `the floor and ceiling hold`: with `?alt=29.8` and ArrowUp held 3 s, `alt` stays ≤ 30 and finite; with `?alt=2.2` and ArrowDown held 3 s, `alt` ≥ 2.
  - `targeting with no contacts`: with `?traffic=0` the page runs 2 s with no JS errors and `lockId === null`.
  - Keep, re-pointed at traffic, every targeting check in the current file (sight states, lock, follow, ping, pulse, cascade, dial, paddle, thumb, trigger, rocker, the brackets flying apart, MANUAL locks within 3 s of steering at the nearest aircraft, the lock goes to the contact nearest the sight).
- [ ] **Step 2: Run** `node site5/tests/cockpit.test.js` — expected: the new checks FAIL.
- [ ] **Step 3: Implement** in `ball.js`: `pos` integrates `dir(yaw, pitch) * speed * dt` (alt from y); alt clamped [2, 30], and at a limit the pitch springs to 0 against it; `?alt=` sets the start (default 11). The autopilot (`AUTO`) picks the nearest contact within 60° of the nose that it hasn't locked in the last 20 s, chases it on the existing springs (yaw to its `az`, pitch toward its `el` clamped ±20) until it has held a lock 4 s, then picks the next; with none, a slow wander (yaw rate `6·sin(t·0.05)`, pitch to 0). Targeting and aim assist run over `contacts` and tolerate an empty list. `?traffic=0` passes an empty list.
- [ ] **Step 4: Run** the suite — expected: all PASS.
- [ ] **Step 5: Update** DESIGN.md (The model: km, altitude, the autopilot, no dogfight) and **commit** `site5: the suit flies in km over traffic; the dogfight goes`.

### Task 3: The Earth below, traced from the suit's altitude

**Files:**
- Modify: `site5/js/world.js` (the `sky()` below the horizon; uniforms `uPos` -> `vec3` km, new `uAlt`, `uCon[10]` as `vec4(dir, range)`, `uConN`; drop `uOpp`, `uDots`)
- Modify: `site5/tests/cockpit.test.js`, `site5/DESIGN.md` (The picture)

**Interfaces:**
- Consumes: `pose.pos`, `pose.alt`, `pose.contacts[].d`, `.range` (Task 2).
- Produces: `SITE5.horizonDip(alt) -> deg` (acos(R/(R+alt)), R 6371) for tests; `SITE5.parts.world = { hit: 'ground'|'cloud'|'sky' }` sampled at the screen centre each frame.

- [ ] **Step 1: Write the failing tests**: `altitude drops the horizon` (the screen row where the picture turns from sky to cloud moves down by more than 3% of the height between `?alt=8` and `?alt=28`, at reduced motion, nose level); `the horizon dip matches the Earth` (`SITE5.horizonDip(11)` within 0.05 of 3.36); `an aircraft shows as a speck` (with `?seed=7` reduced motion, the world canvas pixel at `SITE5.project` of the nearest contact's ball point is darker or warmer than its neighbours 6 px away).
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement**: ray from `O = (0, 6371 + alt, 0)` along `w`: hit the cloud shell (top radius 6371 + 5, base 6371 + 3) and the Earth (6371). Above the shell: the cloud tops as now, coordinates from the hit point's x/z plus `uPos.xz` (km) at the current look's scale; through gaps (coverage < .4) the ground: near-black land/sea from 3D noise on the hit point, city lights clustered on land (warm points, `fbm`-gated). Above the horizon: the sky as now; along the limb a thin airglow band (deep teal, falling off over ~1.5° above the dip). Inside the shell (3–5 km) a grey fog by depth; below it, the shell's underside overhead and the ground below. Specks: each `uCon` a dark dot sized `0.045 / range` rad (min 1.5 px) with a red, green and white glint (strobe 1 Hz).
- [ ] **Step 4: Run** — expected: all PASS; frame time check still under 25 ms.
- [ ] **Step 5: Screenshots** at desktop and 375 px (nose level at 11 km; looking down; `?alt=28`), **update** DESIGN.md, **commit** `site5: a curved night Earth below, the cloud deck a shell, traced from the altitude`.

### Task 4: Three modes

**Files:**
- Modify: `site5/js/ball.js` (mode state, `M`, input rules), `site5/js/hud.js` (mode word), `site5/index.html` (a `<button id="mode">`), `site5/css/cockpit.css`
- Modify: `site5/tests/cockpit.test.js`, `site5/DESIGN.md`

**Interfaces:**
- Produces: `pose.mode: 'FREE'|'HYBRID'|'INPUT'`, `pose.modeWord` (what the triangle shows: `FREE`, `HYBRID` while AUTO, `MANUAL` while you fly in HYBRID, `INPUT`); `?mode=free|hybrid|input` (default `free`); `SITE5.setMode(name)`.

- [ ] **Step 1: Write the failing tests**: `FREE ignores the keys` (ArrowLeft held 1 s in FREE: `pilot` stays AUTO and the heading change is under 5° beyond the autopilot's own over the same second, measured against a no-key run with the same seed); `HYBRID hands back` (the existing takeover/handback checks, with `modeWord` MANUAL then HYBRID); `INPUT holds course` (in INPUT, 3 s without keys: heading changes under 0.5°, alt under 0.05 km; ArrowLeft 1 s turns more than 35°); `M cycles FREE -> HYBRID -> INPUT -> FREE`; `the mode button cycles and says so` (click `#mode`; its `aria-label` names the new mode); `switching mode while a key is held` (ArrowLeft held, M to FREE: `pilot` is AUTO within one frame; M to INPUT: still flying left while held).
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement**: FREE — the autopilot only, keys ignored; HYBRID — today's rule (a key takes over, back 4 s after the last, aim assist); INPUT — keys only, no assist, on release the turn rate brakes to 0 and the pitch eases to 0 so heading and altitude hold. The button sits bottom-left under the hint, text `MODE: FREE` in the hint's style (no box), and the hint gains `· M MODE`.
- [ ] **Step 4: Run** — expected: all PASS.
- [ ] **Step 5: Screenshots**, DESIGN.md, **commit** `site5: three modes -- FREE watches, HYBRID shares, INPUT is yours`.

## Phase 2: Traffic you can see and identify

### Task 5: The aircraft models

**Files:**
- Create: `site5/tools/make_traffic.py` (builds the four in Blender, bakes contact shading, writes `js/traffic-data.js`; the same writer as `tools/make_seat.py`: indexed, int16 positions × `q`, int8 normals, u8 AO; per model its parts by material)
- Create: `site5/js/traffic-data.js` (generated)

**Interfaces:**
- Produces: `window.SITE5_TRAFFIC = { q, models: { AIRLINER|FREIGHTER|BIZJET|BALLOON: { span: km, parts: [{ mat, pos, nrm, ao, idx, idx32, verts, count }], lights: { red: [x,y,z], green: [x,y,z], white: [x,y,z], beacon: [x,y,z] } } } }`, in km, nose +z, up +y, centred on the centre of mass. Spans: AIRLINER 0.06, FREIGHTER 0.068, BIZJET 0.02, BALLOON 0.004 (envelope) with a 0.03 tether and payload.
- Materials: `T_body` (light grey paint), `T_belly` (mid grey), `T_engine` (dark grey metal), `T_glass` (black gloss), `T_envelope` (pale latex), `T_payload` (white box).

- [ ] **Step 1: Write a self-check** at the end of the script (`assert`): each model's triangle count 500–6000, its bounding span within 10% of the value above, lights present for the three powered types; total file under 0.8 MB.
- [ ] **Step 2: Run** `blender -b --factory-startup -P site5/tools/make_traffic.py` — expected: prints `traffic: 4 models, N triangles, X MB` with no assertion error.
- [ ] **Step 3: Model** them from primitives and lofts (generic shapes only): AIRLINER low wing swept 30°, two underwing engines, conventional tail; FREIGHTER high wing, four engines, T-tail, upswept rear; BIZJET small, two rear-mounted engines, T-tail; BALLOON a sphere envelope, a line, a box payload with a parachute bundle.
- [ ] **Step 4: Render** a turntable check of the four to the scratchpad and look at it (no stray parts, no inside-out faces).
- [ ] **Step 5: Commit** `site5: four generic aircraft, modelled and baked in Blender`.

### Task 6: Aircraft in the picture: meshes, lights, contrails

**Files:**
- Modify: `site5/js/world.js` (a second program after the full-screen pass: aircraft meshes; a third: light sprites and contrail points), `site5/index.html` (load `js/traffic-data.js` before `world.js`)
- Modify: `site5/js/traffic.js` (each contact keeps `trail: [x, alt, z][]`, a sample every 0.5 s, 24 long, jets only)
- Modify: `site5/tests/cockpit.test.js`, `site5/DESIGN.md`

**Interfaces:**
- Consumes: `SITE5_TRAFFIC` (Task 5), contacts with `pos`, `hdg`, `trail` (Task 1/this task), `pose.suitQ`, `pose.eye`, `pose.eyeQ`.
- Produces: `SITE5.parts.aircraft = { meshes: n drawn as meshes, sprites: n drawn as lights only }`.

- [ ] **Step 1: Write the failing tests**: `near aircraft draw as models` (`?seed=7&traffic=near` places one AIRLINER 2 km ahead: `parts.aircraft.meshes >= 1` and the world canvas has > 400 non-sky pixels in its screen box); `far aircraft show their lights` (default seed: `sprites >= 3`); `nav lights blink` (the white strobe pixel differs between two frames 0.5 s apart); `jets leave contrails, balloons don't` (`trail.length > 4` after 3 s for jets, 0 for BALLOON).
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement**: vertex shader takes model-space vertices, rotates by `hdg`, adds the contact's `pos − suit pos` (with the Earth's drop), maps the world direction through `uSuitM`ᵀ to a ball point, then through `uEye`/`uEyeM` and `uTan` to clip space, depth from range/80 km; lit by the monitor's average and a faint moon, AO baked. Sub-3-px aircraft skip the mesh. Light sprites as `gl.POINTS` (additive): red left, green right, white tail steady; white strobes and the red beacon blink (1 Hz, offset per id). Contrails: the trail samples as soft points fading over their age.
- [ ] **Step 4: Run** — expected: all PASS; frame time under 25 ms.
- [ ] **Step 5: Screenshots** (an airliner crossing close; a far field of lights), DESIGN.md, **commit** `site5: the traffic in 3D -- models, nav lights, contrails`.

### Task 7: Locking identifies

**Files:**
- Modify: `site5/js/hud.js` (marks per type, the readout under the target, `IDENT n`), `site5/js/ball.js` (the identified set)
- Modify: `site5/tests/cockpit.test.js`, `site5/DESIGN.md`

**Interfaces:**
- Consumes: contacts (Task 1–2), `lockId`, `locked`.
- Produces: `pose.ident: number` (count), `SITE5.parts.readout: string[] | null` (the two lines while locked).

- [ ] **Step 1: Write the failing tests**: `a lock shows the readout` (once `locked`, `parts.readout` is `['<TYPE>  <CALLSIGN>', 'ALT <a.a> KM  SPD <m/s>  HDG <ddd>  RNG <r.r> KM']` with the target's own values: ALT one decimal, SPD in m/s rounded (an AIRLINER reads `SPD 250`), HDG three digits, RNG one decimal); `identify counts once` (lock the same aircraft twice: `ident` goes up by 1); `the mark names the type` (labels read the type's short form: `AIRLINER`, `FRTR`, `BIZJET`, `BALLOON` in place of `UNKNOWN`/`MS`).
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement**: the readout in the target label's salmon under the W mark, tier 1; `IDENT n` beside the heading ticks; the identified set keyed by `id`.
- [ ] **Step 4: Run** — expected: all PASS.
- [ ] **Step 5: Screenshot** a lock with its readout, DESIGN.md, **commit** `site5: lock to identify -- type, callsign, altitude, speed, heading, range`.

## Phase 3: The launch

### Task 8: The launch timeline and skip

**Files:**
- Modify: `site5/js/ball.js` (a 25 s timeline before the modes take over; skip), `site5/js/seat.js` (strap-in timed from the launch, not `pose.t`)
- Modify: `site5/tests/cockpit.test.js`, `site5/DESIGN.md`

**Interfaces:**
- Produces: `pose.launch = { p: 0..1, phase: 'boot'|'climb'|'level'|'done' }`; `?launch=0` starts done (tests other than the launch's use it); reduced motion starts done.

- [ ] **Step 1: Write the failing tests**: `the launch climbs out of the cloud` (`alt` starts at 1 km, passes 5 km by 16 s, ends at 11 km by 25 s; `parts.world.hit` reads `cloud` around 6–12 s); `a key skips it` and `skip at once and skip late` (a key at frame 1 and at 24.5 s each land in `phase 'done'`, `alt` 11, `mode` FREE, exactly one transition; the rings still close); `reduced motion starts at cruise` (`phase 'done'`, `alt` 11, still).
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement**: 0–4 s `boot` (still, at 1 km under the deck); 4–16 s `climb` (pitch eases to 20°, through the shell 3–5 km); 16–25 s `level` (pitch eases to 0 toward 11 km, one AIRLINER spawned to cross 3 km ahead at 11.5 km — `traffic.spawnCrossing(suit)`); then `done`, `mode` FREE. Keys, clicks and taps during it skip; the flight keys don't fly until `done`.
- [ ] **Step 4: Run** — expected: all PASS.
- [ ] **Step 5: Commit** `site5: the launch -- up through the cloud deck to cruise`.

### Task 9: The boot and the draw-on

**Files:**
- Modify: `site5/js/world.js` (`uBoot`: panels light from the nose outward, the picture fades in), `site5/js/hud.js` (groups draw on by time: rail, rulers, cluster, sight), `site5/css/cockpit.css` + `site5/index.html` (the hint and mode button appear at `done`)
- Modify: `site5/tests/cockpit.test.js`, `site5/DESIGN.md`, `CLAUDE.md` (site5's row: what it is now)

**Interfaces:**
- Consumes: `pose.launch` (Task 8).

- [ ] **Step 1: Write the failing tests**: `the panels light from the nose outward` (at 1 s the centre's seam pixel is lit and a seam 60° out is not; at 3.5 s both); `the HUD draws on` (at 2 s `parts.rail` false, at 6 s true; the sight last); `the hint waits for the launch` (`#hint` hidden until `done`).
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement** with the existing tiers' alphas scaled by each group's draw-on (0→1 over 0.6 s from its start: rail 2 s, rulers 2.6 s, cluster 3.2 s, sight 4 s).
- [ ] **Step 4: Run** the whole suite and `node site5/tests/traffic.test.js` — expected: all PASS.
- [ ] **Step 5: Screenshots** of the launch at 2, 8 and 20 s and the cruise at desktop and 375 px; DESIGN.md and CLAUDE.md; **commit** `site5: the ball boots and the HUD draws on`.

## Phase 4: the real Earth (addendum)

### Task 10: Pack and load the NASA imagery
**Files:** Create `site5/tools/make_earth.py` (PIL; run `python -I site5/tools/make_earth.py site5/tools/earth-src`), `site5/js/earth-{night,topo,cloud,elev}.js` (generated), `site5/js/earth.js` (loads the four as textures, splitting past MAX_TEXTURE_SIZE, reports progress); modify `index.html`, `.gitignore` (`site5/tools/earth-src/`).
**Produces:** `SITE5.earth = { ready: bool, progress: 0..1, tex: { night, topo, cloud, elev: [tex, ...] }, size: {...} }`; `window.SITE5_EARTH_<NAME> = { w, h, parts: [dataURL, ...] }`.
- [ ] Tests: `the Earth's images load` (within 60 s `SITE5.earth.ready`, four textures, no GL errors); `a loading readout shows until then` (`#loading` visible at start, hidden when ready).
- [ ] Implement; run; screenshot the loading readout.

### Task 11: The real Earth in the picture
**Files:** Modify `site5/js/world.js` (ground from the textures by latitude/longitude: moonlit land and sea colour, city lights; the real cloud cover in the deck), `site5/js/ball.js` (`pose.geo = [lat, lon]` from the start point and `pos`).
- [ ] Tests: `the suit has a place` (`pose.geo` near the start, changing as it flies); `city lights where the map has them` (a ground pixel under a lit city brighter than one over open sea).
- [ ] Implement; screenshots at 35 km and 11 km.

### Task 12: Relief and 3D terrain
**Files:** Modify `site5/js/world.js` (elevation-lit relief; a heightfield march near the ground and along the horizon).
- [ ] Tests: `mountains rise` (`SITE5.worldHit` over high ground at a low angle hits terrain above sea level); frame time under 25 ms (the quality step-down may engage).
- [ ] Implement; screenshots.

### Task 13: Realistic clouds
**Files:** Modify `site5/js/world.js` (a short march through the deck guided by the real cover).
- [ ] Tests: `cloud where the map has it`; frame time under budget.
- [ ] Implement; screenshots above, inside and under the deck.
