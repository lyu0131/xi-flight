# site5 realism rebuild, Phase 1 (revised): the world in Three.js + Takram. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `world.js` with a Three.js world (Takram atmosphere and volumetric clouds over a NASA-textured
WGS84 Earth with city lights), seen through the ball display, flown with the existing flight model.

**Architecture:** `ball.js` stays the source of `SITE5.pose` (geodetic flight, done in Tasks 1-2 of the first plan).
A new ES module `js/sky.js` renders on `canvas#world`: a camera at the suit's ECEF position, oriented by the local
ENU frame x the suit attitude x the eye's look, with a wider field than the screen; a postprocessing chain (render,
normal, clouds + aerial perspective, tone mapping, then a ball-warp effect that maps each screen pixel through the
ball to the wider picture and draws the 92 panel seams). The HUD and seat canvases stay on top.

**Tech Stack:** Three.js 0.181.0, postprocessing 6.38.0, @takram/three-{geospatial 0.9.1, atmosphere 0.19.1,
clouds 0.7.6} via an esm.sh import map in `index.html`; Takram's cloud assets from jsDelivr; NASA images from
`assets/earth/` over the local server (moved there from the git-ignored `tools/earth-src/` on 2026-10-08).

**Spec:** `site5/docs/2026-10-08-realism-rebuild-design.md` (Revision section governs)

## Global Constraints
- Library versions exactly as above; the import map is the only place they're named.
- Start: 40.0 N 13.0 E, 18 km, heading 90 (east), `2026-10-08T17:10:00Z` (sun about -4 deg there: dusk);
  `?lat ?lon ?alt ?hdg ?time` override. Real scale (`SITE5.RE = 6371`).
- Light: sun when its elevation > -4 deg, else the moon; exposure from 10 (sun) to 0.45 (moon); a cool grade at night.
- The page works over http only (Tasks 1-2 done); tests use `site5/tests/serve.js`.
- `prefers-reduced-motion`: the world still renders, nothing moves on its own; 375 px without sideways scroll.

## Review Focus
- **The CDN is unreachable**: the page still shows the cockpit and HUD, the readout says the world couldn't load — Task 3 test `a world that fails to load says so`.
- **Looking backwards** (head yaw 150): the warp still finds picture — Task 2 test.
- **Resize to a phone**: the camera aspect and warp follow — Task 2 test.
- **The moon below the horizon at night**: the scene is dark but not black (sky light, city lights) — Task 3 test `a moonless night still shows the cities`.
- **Cloud textures arrive late**: no errors before they do — Task 3 test (no JS errors over the load).

---
### Task 1 (done in the first plan): http serving, real-scale flight.
### Task 2: Three.js world through the ball
**Files:** Create `site5/js/sky.js` (module); modify `site5/index.html` (import map, `canvas#world` kept, `world.js`/`earth.js` removed from the page, `sky.js` added), `site5/js/ball.js` (start values above).
**Produces:** `SITE5.world = { ready, renderer, camera, srcTan: [sx, sy] }`; `SITE5.gl` (the renderer's context); `SITE5.warp(x, y) -> [u, v] | null`; `SITE5.horizonDip(alt)` (kept).
- [ ] Tests: `the world is up` (`SITE5.world.ready`, no errors); `the camera is at the suit` (|camera ECEF - geodetic(pose)| < 50 m); `the camera looks where the eye looks` (< 0.5 deg); `the centre maps to the centre`; `looking back still shows the world`; `the seams draw`; `a resize keeps the picture filling the screen`; frame time < 33 ms.
- [ ] Red, implement, green; screenshots.
### Task 3: Atmosphere, clouds, Earth, light
**Files:** Modify `site5/js/sky.js`, `site5/css/cockpit.css` (loading readout).
- [ ] Tests: `the sky is lit at dusk` (a pixel above the western horizon is warm/bright at the start time); `a moonless night still shows the cities` (`?time=` a moonless night over Naples, looking down: warm city pixels); `clouds draw` (`SITE5.world.clouds.ready`, the cloud textures in); `a world that fails to load says so` (the import map pointed at a dead host via `?cdn=dead`: the readout says so, the HUD still draws).
- [ ] Red, implement, green; screenshots at dusk 18 km, night 18 km, 35 km, 375 px.
### Task 4: Retire the old world
**Files:** Delete `site5/js/world.js`, `site5/js/earth.js`, `site5/js/earth-*.js`, `site5/tools/make_earth.py`, `site5/spike/`; modify `site5/tests/cockpit.test.js` (drop the world.js internals checks), `site5/DESIGN.md`, `CLAUDE.md` (site5 row).
- [ ] Whole suite green; final screenshots; ledger.
