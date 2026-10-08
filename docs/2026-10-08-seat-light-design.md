# The seat, lit by the monitor: design

2026-10-08. Phase 3 of `2026-10-08-realism-rebuild-design.md` (the cockpit relit), narrowed to the seat.

## What the owner asked for

- "Get atmospheric lights for the seat, right now it still looks like shit." The owner chose both:
  - the monitor's real picture lights the seat (A);
  - the seat is rebuilt on Three.js with real PBR materials (C).
- Standing rule (2026-10-07): the cockpit is closed. The only light comes from the monitor and the seat's own lights. No moonlight comes in.

## What's wrong today

- **No world light.** `seat.js` reads its light from `SITE5.env`, and only the retired `world.js` wrote that. Since Phase 1 the seat has been lit by `screen0()`, a painted blue night that ignores sunset, clouds, cities and the moon on the screen.
- **A fake moon.** The shader carries a hard-coded `MOON` glint that has nothing to do with the real moon.
- **Its own made-up surfaces.** The seat's materials are procedural relief faked in its own GLSL. This is why it "doesn't look like any texture I know".

## Success

1. The seat's colour and brightness follow the monitor:
   - warm and bright at day;
   - tinted by a sunset when one is on the screen;
   - near-dark at night apart from its strips, the HUD's faint fill and the glow of cities below.
   - The side of the seat facing the bright part of the ball is the brighter side.
2. Its surfaces read as real materials: grained and quilted leather, worn paint, brushed metal and rubber, built from scanned CC0 textures.
3. Everything else keeps working: the rings' motion, the HUD layering, the tests, 375 px, and reduced motion.

## Decisions

### Two renderers, one picture

- The layering stays **world canvas → HUD canvas → seat canvas**, because the HUD is painted on the ball, behind the seat.
- `seat.js` becomes an ES module with its own `THREE.WebGLRenderer` on `#seat`, using the same import map and the same `three@0.181.0`.
- The seat canvas keeps its transparent, premultiplied background.
- *(This changes the chat design, which put the seat into the world's renderer. Doing that would cover the HUD with the seat or blur it.)*

### The light is the picture as the monitor displays it

- A monitor emits what it shows. That means the tone-mapped picture: AgX, with the world's exposure of 10 by day and 0.45 by night. It does not emit the scene's raw radiance.
- So the seat is lit by **display values** (linearised sRGB, 0..1).
- A white seat facing an all-white screen comes out white, and it can never be brighter than the screen.
- The seat renders with `THREE.NeutralToneMapping` at exposure 1, which stays almost linear below about 0.8 and only rolls off the strip highlights and bloom.
- **No key light.**
  - On the screen the sun is a small disc at the monitor's maximum white.
  - Its light is already in the captured picture: the bright sky round it and the bright side of the ball.
  - It's far too small to cast a hard shadow.
  - Occlusion comes from the baked AO.
- *(This also changes the chat design, which had a shadowed key light.)*

### The capture (`sky.js`)

- Six 90° cameras at the eye, oriented by **ENU × suitQ**: the suit's attitude and the seat's frame, without the head's look.
- They render the world through a small composer of their own:
  - the Earth and the stars;
  - the AerialPerspectiveEffect;
  - the clouds;
  - ToneMapping AGX at the world's current exposure.
- Each face is 64², rendered into an RGBA8 target.
- **One face per frame**, so the whole cube refreshes about every 6 frames.
- Each face is read back asynchronously (PBO plus fence; the pattern `world.js` used) into `SITE5.env`:
  `{ n, size: 64, faces: [6 × Uint8Array(64·64·4)] }`
  - in Three.js cube face order (+x −x +y −y +z −z), in the seat scene's axes (see below);
  - `n` goes up by one each time all six faces are new.
- **Clouds:** the main CloudsEffect depends on the main camera's previous frames.
  - The capture gets its own `CloudsEffect` with temporal upscaling off and `qualityPreset 'low'`, sharing the main one's textures.
  - If it can't be made to work on six cameras within the frame budget, the capture renders **sky and Earth without clouds**. That fallback is set by the first task in the plan.
- Under `prefers-reduced-motion` the capture still runs; it's light, not motion.

### The seat scene (`seat.js`)

- **Axes:** Three.js convention, with x right, y up and −z forward. The seat's old frame (z forward) maps over with z negated.
  - The eye sits at the origin.
  - The camera reproduces today's projection:
    - the tan from `S.cam.tx/ty`;
    - the narrow-screen squeeze `KX` (scale x on the scene);
    - `LIFT` 0.035 (raise the scene);
    - the head's yaw and pitch (`pose.head`).
  - Units stay in ball radii (1 is about 1.4 m), so the eye's geometry is unchanged.
- **Environment:** each new `SITE5.env.n` is uploaded as a `CubeTexture` (sRGB) and passed through `PMREMGenerator.fromCubemap`. The result becomes `scene.environment`.
  - The diffuse light and the roughness-blurred reflections come from that.
  - The cube is in seat axes, so the seat needs no environment rotation.
  - Until the first capture arrives, the environment is a flat dim grey (0.02) so the seat never renders black.
- **The pod** comes from `assets/seat.glb`, loaded with `GLTFLoader`. Its materials are glTF PBR (`MeshPhysicalMaterial` where the glTF has clearcoat or sheen).
- **The strips' light:** a baked lightmap, `material.lightMap` on uv0, at intensity 1.
  - The `A_glow` and `A_lens` surfaces are emissive.
  - A `BloomEffect` (postprocessing) gives the strips their halo. Over the transparent canvas the halo adds through premultiplied alpha.
  - **Fallback:** if the halo doesn't composite cleanly over the HUD, there's no bloom. The plan checks this.
- **The HUD's fill:** a `DirectionalLight` from the seat-frame direction (0, .55, −.85), colour `#1A1F30`, intensity tuned so the seat matches today's `hud * .5` fill. No shadow.
- **The near-miss flash:** an `AmbientLight` with intensity `pose.flash × 1.6`, colour (.7, .8, 1).
- **The hand rings** keep `js/ring-data.js` and their motion code unchanged.
  - Each ring group becomes a `Mesh` whose matrix is set from the same `F[g]` functions: today's `uRot` and `uOrg` become `mesh.matrix`.
  - Their materials are `MeshPhysicalMaterial` with today's `MAT` values (albedo, roughness, metalness, emission), and their baked AO is a vertex colour.
  - The gauge segments' lit/unlit state drives `emissiveIntensity`.
  - They're lit by the same environment.
  - They get no texture atlas in this phase. That can come later.
- **Kept for the tests:**
  - `S.parts.seat` (sample-point visibility);
  - `seatAO`;
  - `ringOpen`, `ringTurn`, `controls`, `controlsL`, `ringGroups`, `gripAt`;
  - `S.seatGL` (the renderer's context).
- **New:** `SITE5.seat = { ready, captures }`, where `captures` is the last `env.n` uploaded.
- **Loading:** `sky.js` exposes its `loaded(k)` as `SITE5.loaded`, and `LOADS` gains `'seat'`.
  - If `seat.glb` fails, the readout says `THE SEAT COULDN'T LOAD`, the cockpit flies on and no seat is drawn.

### The pod's materials (`tools/make_seat.py`)

- **Geometry and the pod's look are unchanged.** The owner's approved armoured pod stays exactly as it is.
- **Real textures in Blender.** Each `A_*` material's node tree gains a scanned CC0 set from ambientCG (colour, normal, roughness), box-projected on object coordinates, so no extra UVs are needed. They sit under the existing procedural quilt, perforation and wear.
  - The sets are picked and listed (name, URL, size) for the owner's approval before download.
  - About 6 sets at 2K JPG, roughly 25 MB, in `site5/tools/tex-src/` (git-ignored; the sets used are listed in the script's header).

  | material | texture set |
  |---|---|
  | `A_quilt`, `A_leather`, `A_perf`, `A_pipe` | leather grain |
  | `A_shell`, `A_plate` | worn painted metal |
  | `A_metal`, `A_chrome` | brushed metal |
  | `A_rubber`, `A_hose` | rubber |
  | `A_dark` | bead-blasted plastic |
  | `A_ink` | painted stencil (plain) |

- **Baked to one atlas.** One non-overlapping UV (smart-projected and packed) and a 4096² atlas. Cycles bakes:

  | bake | format |
  |---|---|
  | base colour | JPG |
  | normal (tangent space) | JPG q92 |
  | roughness, metallic and AO (as glTF's ORM: R occlusion, G roughness, B metallic) | JPG |
  | the strips' light: the same emissive-only DIFFUSE bake as today, written to an image | `assets/seat-light.jpg`, scaled by `glowMax` (stored in the glb's `extras`) |

- **Exported** as `site5/assets/seat.glb` with the atlas embedded, tangents and per-material clearcoat and sheen. The sample points and the ring centre go in the glb's `extras`, replacing `SEAT.points` and `SEAT.ring`.
  - Expected size: about 20–25 MB, which is fine; the owner prefers a full load.
- The bake runs once, maybe 30–60 min on the CPU. Run it with `blender -b --factory-startup -P site5/tools/make_seat.py`.
- **Retired:** `js/seat-data.js`, the seat's GLSL, and the `A_*` entries of `MAT`.

## Testing

All of these run in `tests/cockpit.test.js` through the http server in `tests/serve.js`.

- **The seat loads:** `SITE5.seat.ready`, `parts.seatAO`, and `parts.seat.grip > 4 && rail > 4` looking down. These keep working.
- **The capture refreshes:** `SITE5.seat.captures` rises by at least 3 within 2 s.
- **Day vs night:** at 40N 13E,
  - `?time=2026-10-08T11:00:00Z` (local noon) and `…T22:00:00Z` (night): the mean luminance over the seat's own pixels (alpha > 0) is at least 3× brighter by day.
- **The light's direction:** at noon with `?hdg=90`, the sun is south, which is to the pilot's right. The mean luminance of the seat's pixels in the right third of the screen is greater than in the left third.
- **Sunset:** at `?time=2026-10-08T16:50:00Z&hdg=262` (facing the sunset), the seat's mean red is greater than its mean blue.
- **Budget:** the median frame at 1280×720 headless stays under 12 ms; Phase 1 measured about 4.2 ms.
- **No regressions:** the existing 127 cockpit tests and 8 traffic tests still pass, with the rings, the HUD layering and the phone checks.
- **Screenshots:** dusk, night and day at desktop and at 375 px, sent to the owner.

## Out of scope

- Texture atlases for the hand rings.
- Shadows from the monitor.
- Bloom on the world.
- Terrain (Phase 2) and traffic models (Phase 4).

## As built (2026-10-08)
Where the build differs from the text above:
- **Lightmap intensity** is `glowMax × π`, not 1: since Three r155 a lightmap is irradiance, so π turns the bake back into radiance.
- **HUD fill:** linear colour (.10, .12, .19) at intensity 0.35, not `#1A1F30` matched to the old `hud * .5`; at the old strength its blue outweighed a sunset on the screen.
- **Flash:** `pose.flash × 1.6π` (the ×π for the same reason as the lightmap).
- **PMREM:** the 64² captured faces are uploaded at 128 px (each pixel 2×2), because r181's PMREM leaves the rough mips black under 112 px.
- **Bloom radius** 0.5 (the default 0.85 washed the seat pink at night).
- **Orientation checks:** the noon right-third test became two: a synthetic monitor with only the +x face white lights the left third (looking down, that's the left armrest's inner walls, which face +x), and at dusk the lit side follows the sun between `hdg=224` and `hdg=304`.
- **Strap-in:** the rings' clock starts when they first appear (once the glb is in), not at page load.
- **Earth maps:** the land and city-light maps ship in `assets/earth/` (they were in the git-ignored `tools/earth-src/`); if they fail the readout says THE EARTH'S MAPS COULDN'T LOAD.
