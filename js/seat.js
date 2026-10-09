/* seat.js: what's fixed to the seat, as the pilot's eye is. The seat is the armoured pod (the owner's pick of the
   Blender concepts, 2026-10-07): a wide, laid-back shell with layered armour plates, hip and shoulder guards and a
   crown over the head; quilted, perforated and rolled leather where the body rests; armrest pods grown out of the
   shell's flanks with a forearm cradle on each; the legs split below the knee into two cradles ending at foot
   pedals. It's built and baked in Blender by tools/make_seat.py into assets/seat.glb (one 4096 atlas: base colour,
   normal, ORM with the contact shading) and assets/seat-light.jpg (the strips' light, on the same UV). Over each
   armrest floats a hand ring (tools/hand_ring.blend -> js/ring-data.js). ?seat=<name> loads assets/<name>.glb.
   An ES module: Three.js (the import map's), its own WebGLRenderer on canvas#seat over the HUD, transparent. The
   scene is in the seat's frame in Three.js axes: the eye at the origin, x right, y up, -z forward, in ball radii
   (1 is about 1.4 m); the data's frame (z forward) comes over with z negated. The eye is the reclined pilot's, so
   the lap, the leg cradles and the rings sit below the view.
   Lit the way a closed ball cockpit is (spec 2026-10-08-seat-light-design.md): by the panoramic monitor all round
   it -- the picture as the monitor displays it, captured by sky.js (SITE5.env, six faces in seat axes) and
   prefiltered (PMREM) into scene.environment -- plus the seat's own light strips (their light baked into a
   lightmap, their halo a bloom), the HUD's faint fill and the near-miss flash. No sun, no moon, no key light: the
   sun's light is already in the picture. The pilot's own body isn't drawn; no tablets. The eye rides the seat, so
   only the head turning moves it. Each frame: the scene, the strips' bloom, then Neutral tone mapping.
   SITE5.seat = { ready, captures, source: 'glb' | 'none' }; SITE5.seatGL is the renderer's context. */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing'

const S = window.SITE5, m = S.m, D = m.D
const canvas = document.getElementById('seat')

// ---- the hand rings' materials: albedo, roughness, metalness, emission (linear) ----
const MAT = {
  metal: { a: [0.56, 0.57, 0.58], r: 0.3, m: 1 },            // steel joints, collars, bolts
  grip: { a: [0.045, 0.045, 0.05], r: 0.85, m: 0 },          // the grip's rubber handle
  ring: { a: [0.30, 0.31, 0.33], r: 0.32, m: 0.55 },        // the hand ring's satin metal bands and handbar
  liner: { a: [0.055, 0.055, 0.06], r: 0.7, m: 0 },         // the soft liner inside the ring
  channel: { a: [0.03, 0.03, 0.034], r: 0.45, m: 0 },       // the recess the finger keys sit in
  key: { a: [0.02, 0.02, 0.024], r: 0.14, m: 0 },           // glossy black keys and the thumb dome
  glow: { a: [0.02, 0.03, 0.05], r: 0.3, m: 0, e: [0.22, 0.5, 0.95] },   // the keys' hairlines of light
  trim: { a: [0.2, 0.05, 0.1], r: 0.3, m: 0, e: [0.85, 0.22, 0.45] },   // the pink trim along the consoles and rings
  track: { a: [0.30, 0.31, 0.33], r: 0.32, m: 0.55 },
  // the hand rings' fittings, after the Blender look-dev (tools/hand_ring.blend)
  armor: { a: [0.15, 0.155, 0.17], r: 0.38, m: 0.6 },       // the knuckle, the sleeve, the grip's armour plates
  frame: { a: [0.06, 0.06, 0.066], r: 0.45, m: 0.5 },       // brackets, collars, clips, the trigger blade
  cable: { a: [0.05, 0.05, 0.05], r: 0.6, m: 0 },
  paint: { a: [0.75, 0.75, 0.78], r: 0.5, m: 0 },           // stencilled lettering
  red_anod: { a: [0.55, 0.03, 0.02], r: 0.3, m: 0.85 },     // the pistons' bands, the pinky paddle
  btn_red: { a: [0.6, 0.02, 0.02], r: 0.18, m: 0, e: [0.25, 0.02, 0.01] },   // the ARM button, lit from inside
  cover: { a: [0.12, 0.08, 0.03], r: 0.08, m: 0 },          // its smoked flip cover (drawn solid)
  stripe: { a: [0.85, 0.65, 0.1], r: 0.5, m: 0 },           // the cover's guard rails
  amber_anod: { a: [0.8, 0.42, 0.05], r: 0.3, m: 0.8 },     // the left hand's boost lever
  led_amber: { a: [0.05, 0.03, 0.01], r: 0.5, m: 0, e: [1.2, 0.6, 0.15] }   // the status light
}

// The rings' materials are Three's physical ones with two baked vertex attributes: `ao`, the contact shading, which
// darkens the indirect light (diffuse and reflected), and `spill`, the strips' light where it falls, added to the
// emission. A face is lit from whichever side the eye sees (as the old shader did), whatever its winding: the data's
// z flip and the left hand's mirror both turn the winding over.
function patchSeatMaterial(material) {
  material.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float ao;\nattribute vec3 spill;\nvarying float vAo;\nvarying vec3 vSpill;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvAo = ao; vSpill = spill;')
    sh.fragmentShader = 'varying float vAo;\nvarying vec3 vSpill;\n' + sh.fragmentShader
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', 'dot( vNormal, vViewPosition ) >= 0.0 ? 1.0 : - 1.0'))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vSpill;')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= vAo;\n\treflectedLight.indirectSpecular *= vAo;\n#include <aomap_fragment>')
  }
}
const mats = {}
function matFor(name, own) {   // one material per MAT entry, shared; `own` for one that changes on its own (the gauge)
  if (mats[name] && !own) return mats[name]
  const mt = MAT[name], e = mt.e || [0, 0, 0]
  const x = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(...mt.a), roughness: mt.r, metalness: mt.m, emissive: new THREE.Color(...e), side: THREE.DoubleSide })
  patchSeatMaterial(x)
  return own ? x : (mats[name] = x)
}
function decode(b64, Type) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Type(u.buffer) }
function geometry(pos, nrm, ao, spill) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  g.setAttribute('ao', new THREE.BufferAttribute(ao, 1)); g.setAttribute('spill', new THREE.BufferAttribute(spill, 3))
  return g
}

// ---- the pod, from the glb: a node per group (frame, rail, seat), a primitive per material, glTF PBR with the
// atlas (MeshPhysicalMaterial where it has clearcoat or sheen), and the strips' light as a lightmap on the same UV.
// The glb's extras are in Three axes; the sample points and RING_C stay in the seat's old frame (z forward), as the
// ring code and the tests' projections use it. The lightmap holds received light (Cycles' DIFFUSE direct+indirect,
// the strips' pink in it) over glowMax; Three's lightmap is irradiance (it gets albedo / pi), so x pi. ----
const points = { seat: [], rail: [], grip: [], frame: [] }, flipZ = p => [p[0], p[1], -p[2]]
let RING_C = [0.38, -0.41363, 0.57841]   // the right hand ring's centre, over the pod's armrest (the glb's, once in)
const want = new URLSearchParams(location.search).get('seat') || '', GLB = 'assets/' + (/^[\w-]+$/.test(want) ? want : 'seat') + '.glb'
async function loadPod() {
  const [gltf, light] = await Promise.all([new GLTFLoader().loadAsync(GLB), new THREE.TextureLoader().loadAsync('assets/seat-light.jpg')])
  const ex = gltf.scene.userData
  light.colorSpace = THREE.NoColorSpace; light.flipY = false   // stored linear, on glTF's UV
  gltf.scene.traverse(o => { if (o.isMesh) { o.material.lightMap = light; o.material.lightMapIntensity = ex.glowMax * Math.PI } })
  Object.keys(ex.points).forEach(g => { points[g] = ex.points[g].map(flipZ) })
  RING_C = flipZ(ex.ring)
  return gltf.scene
}

// ---- the renderer, the scene, the camera, the light ----
S.seat = { ready: false, captures: -1, source: null }
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: false })
renderer.toneMapping = THREE.NoToneMapping   // the composer's last effect tone maps
renderer.setClearColor(0x000000, 0)
S.seatGL = renderer.getContext()
const scene = new THREE.Scene(), root = new THREE.Group()   // root: the narrow-screen squeeze and the lift
const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 4)
scene.add(root, camera)
// the frame: the scene (multisampled, half float), the strips' halo (bloom: only the strips pass 0.9; radius 0.5 keeps
// it near them, the default 0.85 washes the whole seat pink at night and outweighs the monitor's light), then Neutral
// tone mapping at exposure 1 into the canvas. Off the seat the halo has alpha 0, so through the canvas's
// premultiplied alpha it adds onto the HUD and the monitor behind.
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 })
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new EffectPass(camera, new BloomEffect({ luminanceThreshold: 0.9, intensity: 0.6, mipmapBlur: true, radius: 0.5 }), new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })))
// the HUD painted on the ball ahead and above the nose: a soft periwinkle fill from there, in the seat's frame (the
// ball turns with the suit, so this light doesn't move); the near-miss flash lights everything. The fill is the
// old shader's colour (linear) at 0.35: as bright as #1A1F30 at 3, less blue. (At the old shader's strength, ~1.6,
// its blue outweighs a sunset on the screen.)
const hudFill = new THREE.DirectionalLight(new THREE.Color().setRGB(0.10, 0.12, 0.19, THREE.LinearSRGBColorSpace), 0.35)
hudFill.position.set(0, 0.55, -0.85); scene.add(hudFill, hudFill.target)
const flash = new THREE.AmbientLight(new THREE.Color(0.7, 0.8, 1), 0); scene.add(flash)

// The monitor's light: SITE5.env's six faces (sRGB display values, rows as readPixels gives them) are what a
// CubeCamera writes into a cube render target; a plain CubeTexture is sampled mirrored in x (Three flips it), so the
// faces go in mirrored to match: +x and -x swap places and each face is flipped left to right. Then PMREM, into
// the same target each time. Until the first capture, a flat dim grey (0.02, linear) so the seat never goes black.
// The faces go up at 128 (each captured pixel 2x2): three r181's PMREM leaves the rough mips black under 112 px.
const CS = 64, UP = 128, pmrem = new THREE.PMREMGenerator(renderer)
const faces = [0, 1, 2, 3, 4, 5].map(() => new THREE.DataTexture(new Uint8Array(UP * UP * 4), UP, UP))
const cube = new THREE.CubeTexture(faces)
cube.colorSpace = THREE.SRGBColorSpace; cube.generateMipmaps = false; cube.minFilter = THREE.LinearFilter
let envRT = null, envN = -1
function upload(src) {
  for (let k = 0; k < 6; k++) {
    const s = src[k], d = faces[k < 2 ? 1 - k : k].image.data
    for (let y = 0; y < UP; y++) for (let x = 0; x < UP; x++) {
      const i = ((y >> 1) * CS + (x >> 1)) * 4, j = (y * UP + UP - 1 - x) * 4
      d[j] = s[i]; d[j + 1] = s[i + 1]; d[j + 2] = s[i + 2]; d[j + 3] = 255
    }
  }
  cube.needsUpdate = true
  envRT = pmrem.fromCubemap(cube, envRT)
  scene.environment = envRT.texture
}
{ const grey = new Uint8Array(CS * CS * 4).fill(39); upload([0, 1, 2, 3, 4, 5].map(() => grey)) }   // 39/255 sRGB = 0.02 linear

// The pod: the rings wait for it (they sit at its ring centre). If it can't load, the readout says so and only
// the rings are drawn.
try {
  root.add(await loadPod()); S.seat.source = 'glb'; S.parts.seatAO = true   // the contact shading: the atlas's ORM
  S.loaded && S.loaded('seat')
} catch (e) {
  console.warn('seat: ' + GLB + " couldn't load", e); S.seat.source = 'none'
  S.loaded && S.loaded('seat', "THE SEAT COULDN'T LOAD")
}

// ---- the hand rings: the Blender model (js/ring-data.js, exported from tools/hand_ring.blend), one floating over
// the front of each console. The forearm goes through the inner ring and the hand closes on the L handbar. The
// outer track yaws and pitches, the inner ring rolls inside it; the upper halves of both open as a clamshell about
// one hinge on the outer side, and two pistons work between the frames as they move. The right hand's controls --
// trigger, finger keys, pinky paddle, thumb dome, and on the knuckle the guarded ARM button, the SEL dial and the
// AUTO/MANUAL toggle -- are worked by the flight (see work()). The left hand is the model mirrored, with its own
// controls for thrust in place of the targeting ones: a twist throttle (the whole grip turns on its axis), an amber
// boost lever under the index finger, a thumb wheel in the end cap, and on the knuckle a five-segment throttle gauge
// and a CRUISE / COMBAT rocker. The rings move as twin sticks, each its own way for the move (see the renderer).
// The motion works in the data's frame (z forward); each group is a Mesh whose matrix is that motion, z flipped. ----
function rot(axis, a) {
  const c = Math.cos(a * D), s = Math.sin(a * D)
  return [p => [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c],
    p => [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c],
    p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]][axis]
}
const rotX = a => rot(0, a), rotY = a => rot(1, a), rotZ = a => rot(2, a)
function add(p, q) { return [p[0] + q[0], p[1] + q[1], p[2] + q[2]] }
function sub(p, q) { return [p[0] - q[0], p[1] - q[1], p[2] - q[2]] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
const ROLL = 35, PUSH = 18, OPEN = 115                   // full stick, degrees; the clamshell fully open
const RING = window.SITE5_RING
const ringParts = RING ? RING.parts.map(pt => ({ g: pt.group, side: pt.side, lg: pt.lg, mat: pt.mat, n: pt.count, P: decode(pt.pos, Float32Array), N: decode(pt.nrm, Int8Array), A: decode(pt.ao, Uint8Array) })) : []
const rings = (RING ? [-1, 1] : []).map(sd => {
  const X = p => [sd * p[0], p[1], p[2]], byGroup = {}
  ringParts.forEach(pt => {
    if (pt.side && pt.side !== (sd > 0 ? 'R' : 'L')) return   // one hand's own parts
    const g = sd < 0 && pt.lg || pt.g;
    (byGroup[g] = byGroup[g] || []).push(pt)
  })
  // each group one Mesh, its parts sorted by material into one draw each
  const meshes = {}
  Object.keys(byGroup).forEach(g => {
    const names = [...new Set(byGroup[g].map(pt => pt.mat))], total = byGroup[g].reduce((s, pt) => s + pt.n, 0)
    const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), ao = new Float32Array(total)
    const geo = geometry(pos, nrm, ao, new Float32Array(total * 3))
    let at = 0
    names.forEach((name, mi) => {
      const first = at
      byGroup[g].filter(pt => pt.mat === name).forEach(pt => {
        for (let v = 0; v < pt.n; v++, at++) {
          pos[at * 3] = sd * pt.P[v * 3]; pos[at * 3 + 1] = pt.P[v * 3 + 1]; pos[at * 3 + 2] = -pt.P[v * 3 + 2]
          nrm[at * 3] = sd * pt.N[v * 3] / 127; nrm[at * 3 + 1] = pt.N[v * 3 + 1] / 127; nrm[at * 3 + 2] = -pt.N[v * 3 + 2] / 127
          ao[at] = pt.A[v] / 255
        }
      })
      geo.addGroup(first, at - first, mi)
    })
    const mesh = new THREE.Mesh(geo, names.map(name => matFor(name, g.indexOf('gauge') === 0)))
    mesh.matrixAutoUpdate = false; root.add(mesh); meshes[g] = mesh
  })
  const c = [sd * RING_C[0], RING_C[1], RING_C[2]], piv = {}, pistons = {};
  [[0, 0.05, 0], [0, -0.05, 0], [sd * 0.06, 0, 0], [0, -0.01, 0.12], [-sd * 0.02, -0.01, 0.125]].forEach(q => { points.grip.push(add(c, q)) })
  Object.keys(RING.pivots).forEach(k => { piv[k] = X(RING.pivots[k]) })
  Object.keys(RING.pistons).forEach(k => { const ps = RING.pistons[k]; pistons[k] = { a: X(ps.a), b: X(ps.b), fa: ps.fa, fb: ps.fb } })
  return { meshes, c, hinge: X(RING.hinge), piv, pistons, sd }
})
function cols(f) { return f([1, 0, 0]).concat(f([0, 1, 0]), f([0, 0, 1])) }   // a turn as a column-major mat3
function about(F, q, R) { return p => F(add(q, R(sub(p, q)))) }   // R about the point q, then F
function turnTo(a, b) {   // the shortest turn taking direction a to direction b (Rodrigues)
  a = m.norm(a); b = m.norm(b)
  let k = cross(a, b)
  const s = Math.hypot(k[0], k[1], k[2]), c = m.dot(a, b)
  if (s < 1e-9) return p => p
  k = [k[0] / s, k[1] / s, k[2] / s]
  return p => { const kp = cross(k, p), kd = m.dot(k, p); return [0, 1, 2].map(i => p[i] * c + kp[i] * s + k[i] * kd * (1 - c)) }
}

// The right hand's controls, worked by the flight, each 0 (rest) to 1 (in), the dial in degrees: the thumb holds
// the dome in while a lock builds, the trigger snaps in on the lock, the pinky squeezes its paddle when a lock
// breaks, the dial clicks round a position for each new target, the toggle flicks to MANUAL when the pilot takes
// over. Once strapped in, the ARM cover flips up, the button goes in, and the four keys ripple through a check.
// The left hand's work the thrust: the throttle winds up with how hard the suit manoeuvres (and further on boost),
// the boost lever snaps in on a jink, a hard pull or a near miss, the thumb wheel runs with the turn, the rocker
// tips to COMBAT while a target is held, and the gauge reads the throttle (sweeping up once as a check on strap-in).
const ctl = { thumb: 0, trigger: 0, paddle: 0, dial: 0, toggle: 0, cover: 0, arm: 0, keys: [0, 0, 0, 0] }
const ctlL = { twist: 0, boost: 0, wheel: 0, rocker: 0, gauge: 0 }
let dialTo = 0, lastId = null, wasLocked = false, letGo = -9, lastT = 0, t0 = null   // t0: the rings' first frame
function work(pose) {
  var t = pose.t - t0, dt = S.reduce ? 1 : m.clamp(t - lastT, 0, 0.1); lastT = t;
  if (pose.lockId !== null && pose.lockId !== lastId) dialTo += 30;
  if (wasLocked && !pose.locked) letGo = t;
  lastId = pose.lockId; wasLocked = pose.locked;
  var ease = function (v, to, rate) { return v + (to - v) * Math.min(1, dt * rate); }, on = function (a, b) { return t > a && t < b ? 1 : 0; };
  ctl.thumb = ease(ctl.thumb, pose.lockId !== null && !pose.locked ? 1 : 0, 18);
  ctl.trigger = ease(ctl.trigger, pose.locked ? 1 : 0, 14);
  ctl.paddle = ease(ctl.paddle, t - letGo < 0.35 ? 1 : 0, 16);
  ctl.dial = ease(ctl.dial, dialTo, 20);
  ctl.toggle = ease(ctl.toggle, pose.pilot === 'MANUAL' ? 1 : 0, 16);
  ctl.cover = ease(ctl.cover, S.reduce || t > 2 ? 1 : 0, 6);
  ctl.arm = ease(ctl.arm, on(2.5, 2.75), 25);
  ctl.keys = ctl.keys.map(function (k, i) { return ease(k, on(2.9 + i * 0.12, 3.05 + i * 0.12), 25); });
  var st = pose.stick || [0, 0], hard = Math.min(1, Math.hypot(st[0], st[1]));
  // the left hand is the throttle: the grip twists to it, the boost lever snaps in while boosting
  var boost = pose.boost || pose.flash > 0.15 ? 1 : 0;
  ctlL.boost = ease(ctlL.boost, boost, 16);
  ctlL.twist = ease(ctlL.twist, m.clamp((pose.throttle === undefined ? 0.375 : pose.throttle) + 0.2 * boost, 0, 1), 5);
  ctlL.wheel += st[0] * 240 * (S.reduce ? 0 : dt);
  ctlL.rocker = ease(ctlL.rocker, pose.lockId !== null ? 1 : 0, 14);
  ctlL.gauge = Math.max(ctlL.twist, t > 2.5 && t < 3.3 ? Math.sin(Math.PI * (t - 2.5) / 0.8) : 0);
}
const KEY_IN = [0, 0.00046, 0.00064], ARM_IN = [0, -0.0013, 0], THUMB_IN = 0.00086   // how far each goes in

// On a narrow (portrait) screen the view is too tight to ever take in the grips, so the pair is drawn closer
// together there (KX < 1); LIFT raises everything a touch.
const LIFT = 0.035, size = new THREE.Vector2()
S.seat.ready = true
S.renderers.push(function (pose, W, H) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  if (renderer.getPixelRatio() !== dpr || renderer.getSize(size).x !== W || size.y !== H) { renderer.setPixelRatio(dpr); composer.setSize(W, H, false) }
  const tx = S.cam.tx, ty = S.cam.ty, KX = m.clamp(tx / 0.95, 0.42, 1), HQ = m.euler(pose.head.yaw, pose.head.pitch, 0), HQi = m.qconj(HQ)
  // the camera: the old projection (x / z over the tan), the head's turn with z flipped into Three axes
  camera.fov = 2 * Math.atan(ty) / D; camera.aspect = tx / ty; camera.updateProjectionMatrix()
  camera.quaternion.set(-HQ[0], -HQ[1], HQ[2], HQ[3])
  root.scale.x = KX; root.position.y = LIFT
  flash.intensity = pose.flash * 1.6 * Math.PI   // (Three's ambient gives albedo x light / pi: this is the old strength)
  if (S.env && S.env.faces && S.env.n !== envN) { envN = S.env.n; upload(S.env.faces); S.seat.captures = envN }
  // strapping in: the clamshells start open and swing shut over the first two seconds once the seat is in (closed
  // under reduced motion; the controls' strap-in check runs on the same clock);
  // the roll eases to centre while they're open, so the halves meet
  if (t0 === null) t0 = pose.t
  const shut = S.reduce ? 1 : m.clamp((pose.t - t0 - 0.6) / 1.2, 0, 1), open = OPEN * (1 - shut * shut * (3 - 2 * shut))
  // twin sticks: a climb pulls both arms back, a dive pushes both forward; a turn pushes them opposite ways (turning
  // right, the left arm forward and the right back), the inner ring rolling into it inside the outer track
  const st = pose.stick || [0, 0], turns = rings.map(rg => ({ pitch: PUSH * m.clamp(-st[1] - rg.sd * st[0], -1, 1), roll: st[0] * ROLL * (1 - open / OPEN) }))
  work(pose)
  rings.forEach(function (rg, ri) {
    var turn = turns[ri], YP = rotX(turn.pitch), YPR = function (p) { return YP(rotZ(-turn.roll)(p)); };
    // each group's place, as a function of a rest point (about the ring's centre); the clamshell swings about the
    // hinge's axis (the forearm's line): up and over, outward, on either hand
    var Ho = rotZ(-rg.sd * open), c = ctl, cL = ctlL, pv = rg.piv;
    var push = function (d, k) { return function (p) { return YPR([p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k]); }; };
    var F = { track: YP, ring: YPR, label: YPR, trackhatch: about(YP, rg.hinge, Ho), hatch: about(YPR, rg.hinge, Ho),
      trigger: about(YPR, pv.trigger, rotX(20 * c.trigger)), paddle: about(YPR, pv.paddle, rotX(20 * c.paddle)),
      dial: about(YPR, pv.dial, rotY(c.dial)), toggle: about(YPR, pv.toggle, rotX(-50 * c.toggle)),
      cover: about(YPR, pv.cover, rotX(115 * c.cover)), armbtn: push(ARM_IN, c.arm), thumb: push([rg.sd * THUMB_IN, 0, 0], c.thumb) };
    c.keys.forEach(function (k, i) { F['key' + i] = push(KEY_IN, k); });
    var TW = about(YPR, pv.twist, rotX(-35 * cL.twist));   // the left grip's twist, and what it carries
    F.twist = TW; F.wheel = about(YPR, pv.wheel, rotX(cL.wheel));
    F.boost = about(YPR, pv.boost, rotX(20 * cL.boost)); F.rocker = about(YPR, pv.rocker, rotX(12 * (2 * cL.rocker - 1)));
    for (var gi = 0; gi < 5; gi++) F['gauge' + gi] = YPR;
    // the pistons: each half rides its own mount and points at the other's
    Object.keys(rg.pistons).forEach(function (n) {
      var ps = rg.pistons[n], aw = F[ps.fa](ps.a), bw = F[ps.fb](ps.b), Rm = turnTo(sub(ps.b, ps.a), sub(bw, aw));
      F[n + '_a'] = function (p) { return add(aw, Rm(sub(p, ps.a))); };
      F[n + '_b'] = function (p) { return add(bw, Rm(sub(p, ps.b))); };
    });
    // each group's matrix: the turn (uRot) and place (uOrg) the old shader took, with z flipped on both sides
    Object.keys(rg.meshes).forEach(function (g) {
      var f = F[g], o = f([0, 0, 0]), R = cols(function (v) { return sub(f(v), o); }), t = add(rg.c, o), mesh = rg.meshes[g];
      mesh.matrix.set(R[0], R[3], -R[6], t[0], R[1], R[4], -R[7], t[1], -R[2], -R[5], R[8], -t[2], 0, 0, 0, 1);
      mesh.matrixWorldNeedsUpdate = true;
      if (g.indexOf('gauge') === 0) { var lit = cL.gauge * 5 > +g[5] + 0.5 ? 1 : 0.08; mesh.material.forEach(function (x) { x.emissiveIntensity = lit; }); }   // a segment per fifth
    });
  });
  composer.render()
  S.parts.ringTurn = turns; S.parts.ringOpen = Math.round(open); S.parts.controls = ctl; S.parts.controlsL = ctlL
  S.parts.ringGroups = rings.map(rg => Object.keys(rg.meshes))
  // what shows, per group: how many of its sample points land on the screen (for the tests; in the data's frame)
  const drawn = {}, proj = function (p) { var e = m.qrot(HQi, [p[0] * KX, p[1] + LIFT, p[2]]); return e[2] > 0.02 ? [W / 2 + e[0] / e[2] / tx * W / 2, H / 2 - e[1] / e[2] / ty * H / 2] : null; }
  if (S.frames % 15 === 0) {   // for the tests only: no need every frame
    Object.keys(points).forEach(function (g) { drawn[g] = points[g].filter(function (p) { var s = proj(p); return s && s[0] >= 0 && s[0] <= W && s[1] >= 0 && s[1] <= H; }).length; });
    S.parts.seat = drawn
  }
  S.parts.gripAt = proj(add(RING_C, [0, 0, 0.06]))   // the right hand ring's handbar
})
