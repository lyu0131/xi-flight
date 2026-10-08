/* sky.js: the outside world, in Three.js with Takram's physical atmosphere (the realism rebuild, 2026-10-08).
   An ES module (index.html's import map names the library versions). It draws on canvas#world, under the HUD and
   the seat: the real Earth (WGS84, at real scale) as seen from the suit, then the ball.
   - The camera sits at the suit (SITE5.pose.geo, .alt) and looks where the pilot's eye looks: the local
     east-north-up frame, turned by the suit's attitude and then by the eye (pose.suitQ x pose.eyeQ). Its field is
     WIDE (K x the screen's), because the ball spreads the picture: a point on the ball shows the world in its own
     direction from the ball's centre, and the eye sits off the centre, so the edges of the screen look further out
     into the world than the screen's own field.
   - The postprocessing chain renders the scene, lights it and adds the air (aerial perspective, the sky), tone
     maps it, and last the ball warp: each screen pixel -> the ray from the eye -> the ball point it meets -> that
     point's direction, read from the wide picture. The panel seams are the HUD's (hud.js), drawn as vectors.
   The light: the sun while it stands above -4 deg; below that the moon stands in for it (moonlight is sunlight,
   ~400 000 times dimmer), the exposure falls to night levels and the city lights (NASA's Black Marble, emissive
   on the ground) and the stars (the Yale bright-star catalogue) are kept at their apparent brightness. Volumetric
   clouds (Takram), lit by the same light, cast their shadows and sit in the air.
   SITE5.world = { ready, cloudsReady, light, exposure, loads, camera, renderer, srcTan }; SITE5.gl is its WebGL
   context; SITE5.warp(x, y) is the warp in JS (screen px -> picture uv, or null); SITE5.horizonDip(altKm).
   It also captures the monitor for the seat's light (see capture(), at the end): SITE5.env, SITE5.envFreeze,
   SITE5.envClouds; SITE5.loaded(k) is the loading readout's tick. */
import * as THREE from 'three'
import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, Effect } from 'postprocessing'
import { AerialPerspectiveEffect, PrecomputedTexturesGenerator, getSunDirectionECEF, getMoonDirectionECEF, getECIToECEFRotationMatrix,
  SunDirectionalLight, SkyLightProbe, StarsGeometry, StarsMaterial, DEFAULT_STARS_DATA_URL } from '@takram/three-atmosphere'
import { CloudsEffect, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE } from '@takram/three-clouds'
import { ArrayBufferLoader, DataTextureLoader, Ellipsoid, Geodetic, parseUint8Array, STBNLoader, DEFAULT_STBN_URL } from '@takram/three-geospatial'

const S = window.SITE5, m = S.m, D = Math.PI / 180
const canvas = document.getElementById('world')
const qp = new URLSearchParams(location.search)
const START = new Date(qp.get('time') || '2026-10-08T17:10:00Z')   // dusk over Italy (the spec's start)
const K = 1.62   // the camera's field, as a multiple of the screen's (tan): enough for the ball's spread with EYE0 at -0.2
const world = S.world = { ready: false, cloudsReady: false, light: 'sun', exposure: 10, loads: {}, srcTan: [1, 1] }
// the loading readout: what's in so far
const note = document.getElementById('loading')
const LOADS = ['atmosphere', 'land', 'cities', 'weather', 'shape', 'detail', 'turbulence', 'noise', 'stars', 'seat'], fails = []
function loaded(k, fail) {   // fail: what couldn't load, which the readout then keeps saying
  world.loads[k] = true; if (fail && !fails.includes(fail)) fails.push(fail)
  const n = LOADS.filter(x => world.loads[x]).length, say = fails.concat(n < LOADS.length ? ['LOADING THE EARTH · ' + Math.round(n / LOADS.length * 100) + '%'] : [])
  if (note) { note.textContent = say.join(' · '); note.hidden = !say.length }
  world.cloudsReady = ['weather', 'shape', 'detail', 'turbulence'].every(x => world.loads[x])
}
S.loaded = loaded   // (seat.js reports its own load here)
if (note) note.textContent = 'LOADING THE EARTH · 0%'
S.horizonDip = alt => Math.acos(S.RE / (S.RE + alt)) / D

const renderer = new THREE.WebGLRenderer({ canvas, depth: false, antialias: false, powerPreference: 'high-performance' })
renderer.toneMapping = THREE.NoToneMapping
renderer.setPixelRatio(1)
S.gl = renderer.getContext()
const camera = world.camera = new THREE.PerspectiveCamera(60, 16 / 9, 10, 1e7)
world.renderer = renderer
const scene = new THREE.Scene()

// the Earth: the WGS84 ellipsoid (poles on z, longitude 0 on +x, as ECEF), lit by the sun or the moon through the
// air (Takram's sun light and sky light probe), NASA's land and sea colour on it and its city lights glowing
const earthGeo = new THREE.SphereGeometry(1, 720, 360); earthGeo.rotateX(Math.PI / 2)
const earthMat = new THREE.MeshStandardMaterial({ color: 0x24303c, roughness: 0.92, metalness: 0, emissive: 0x000000 })
const earth = new THREE.Mesh(earthGeo, earthMat); earth.scale.set(6378137, 6378137, 6356752.314245); scene.add(earth)
const tex = (url, srgb, k, use) => new THREE.TextureLoader().load(url, t => {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); use(t); loaded(k)
}, undefined, () => loaded(k, "THE EARTH'S MAPS COULDN'T LOAD"))
tex('assets/earth/world.topo.200407.3x5400x2700.jpg', true, 'land', t => { earthMat.map = t; earthMat.color.set(0xffffff); earthMat.needsUpdate = true })
tex('assets/earth/BlackMarble_2016_3km.jpg', true, 'cities', t => { earthMat.emissiveMap = t; earthMat.emissive.set(0xffd9a8); earthMat.needsUpdate = true })
const sunLight = new SunDirectionalLight({ distance: 300 }), skyLight = new SkyLightProbe()
scene.add(sunLight, sunLight.target, skyLight)
// the stars: points at infinity, turned with the Earth
const starsMat = new StarsMaterial({ background: true }); starsMat.pointSize = 1.6
let stars = null
new ArrayBufferLoader().load(DEFAULT_STARS_DATA_URL, data => { stars = new THREE.Points(new StarsGeometry(data), starsMat); scene.add(stars); loaded('stars') }, undefined, () => loaded('stars'))

// the ball warp, last in the chain
const WARP = `
uniform vec3 uEye; uniform mat3 uEyeM; uniform vec2 uTan, uSrc;
void mainUv(inout vec2 uv) {
  vec3 d = normalize(uEyeM * normalize(vec3((uv * 2. - 1.) * uTan, 1.)));        // the ray from the eye, ball frame
  float b = dot(uEye, d), t = -b + sqrt(max(b * b - dot(uEye, uEye) + 1., 0.));
  vec3 p = uEye + t * d;                                                            // the ball point it meets
  vec3 c = vec3(dot(uEyeM[0], p), dot(uEyeM[1], p), dot(uEyeM[2], p));             // its direction, in the eye's frame
  uv = c.z > .01 ? c.xy / c.z / uSrc * .5 + .5 : vec2(-1.);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = all(greaterThanEqual(uv, vec2(0.))) && all(lessThanEqual(uv, vec2(1.))) ? inputColor : vec4(0., 0., 0., 1.);
}`
class BallWarp extends Effect {
  constructor() {
    super('BallWarp', WARP, { uniforms: new Map([['uEye', new THREE.Uniform(new THREE.Vector3())], ['uEyeM', new THREE.Uniform(new THREE.Matrix3())],
      ['uTan', new THREE.Uniform(new THREE.Vector2(1, 1))], ['uSrc', new THREE.Uniform(new THREE.Vector2(1, 1))]]) })
  }
}
const warp = new BallWarp()

// the air over everything (light-source lighting: the scene is lit by the lights above, the effect adds the sky and
// the air between), and the volumetric clouds composited into it
const ap = new AerialPerspectiveEffect(camera); ap.sky = true
const clouds = new CloudsEffect(camera); clouds.coverage = 0.45; clouds.qualityPreset = 'high'
clouds.events.addEventListener('change', e => {
  if (e.property === 'atmosphereOverlay') ap.overlay = clouds.atmosphereOverlay
  if (e.property === 'atmosphereShadow') ap.shadow = clouds.atmosphereShadow
  if (e.property === 'atmosphereShadowLength') ap.shadowLength = clouds.atmosphereShadowLength
})
// the monitor capture's own air and clouds (the capture is below): a 90 deg camera of its own, so its own effects;
// they share every texture with the main ones. Its clouds have no temporal upscaling (each face is a fresh view)
const CAPTURE = qp.get('capture') !== '0'
const capCam = new THREE.PerspectiveCamera(90, 1, 10, 1e7)
// (the clouds stay in: the 2026-10-08 spike measured +0.5 ms a frame for one face at 1280x720, +0.1 ms without them,
// and without them the ground below reads as grey haze instead of white cloud tops)
S.envClouds = CAPTURE
const capAp = CAPTURE ? new AerialPerspectiveEffect(capCam) : null
if (capAp) capAp.sky = true
const capClouds = S.envClouds ? new CloudsEffect(capCam) : null
if (capClouds) {
  capClouds.coverage = clouds.coverage; capClouds.qualityPreset = 'low'; capClouds.temporalUpscale = false
  capClouds.events.addEventListener('change', e => {
    if (e.property === 'atmosphereOverlay') capAp.overlay = capClouds.atmosphereOverlay
    if (e.property === 'atmosphereShadow') capAp.shadow = capClouds.atmosphereShadow
    if (e.property === 'atmosphereShadowLength') capAp.shadowLength = capClouds.atmosphereShadowLength
  })
}
const CL = capClouds ? [clouds, capClouds] : [clouds], APS = capAp ? [ap, capAp] : [ap]
const setAll = (os, k, t) => { for (const o of os) o[k] = t }
const CA = 'https://cdn.jsdelivr.net/npm/@takram/three-clouds@0.7.6/assets/'
const rep2 = t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearMipMapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t }
new THREE.TextureLoader().load(CA + 'local_weather.png', t => { setAll(CL, 'localWeatherTexture', rep2(t)); loaded('weather') }, undefined, () => loaded('weather'))
new THREE.TextureLoader().load(CA + 'turbulence.png', t => { setAll(CL, 'turbulenceTexture', rep2(t)); loaded('turbulence') }, undefined, () => loaded('turbulence'))
const tex3 = (url, n, k, set) => new DataTextureLoader(THREE.Data3DTexture, parseUint8Array, { width: n, height: n, depth: n }).load(url, t => {
  t.format = THREE.RedFormat; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; set(t); loaded(k)
}, undefined, () => loaded(k))
tex3(CA + 'shape.bin', CLOUD_SHAPE_TEXTURE_SIZE, 'shape', t => setAll(CL, 'shapeTexture', t))
tex3(CA + 'shape_detail.bin', CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, 'detail', t => setAll(CL, 'shapeDetailTexture', t))
new STBNLoader().load(DEFAULT_STBN_URL, t => { setAll(APS.concat(CL), 'stbnTexture', t); loaded('noise') }, undefined, () => loaded('noise'))
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 })
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new EffectPass(camera, clouds, ap))
composer.addPass(new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.AGX })))
composer.addPass(new EffectPass(camera, warp))
// the capture's chain: the scene, the air and clouds, then (by hand, below) AgX into capRT. Never the composer's own
// setSize: it resizes the renderer, i.e. the world canvas. Its buffers and passes are sized to 64 once, here.
const CS = 64
let capComposer = null, capTone = null, capRT = null
if (CAPTURE) {
  capComposer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 })
  capComposer.autoRenderToScreen = false
  capComposer.addPass(new RenderPass(scene, capCam))
  capComposer.addPass(new EffectPass(capCam, ...(capClouds ? [capClouds, capAp] : [capAp])))
  capComposer.inputBuffer.setSize(CS, CS); capComposer.outputBuffer.setSize(CS, CS)
  for (const ps of capComposer.passes) ps.setSize(CS, CS)
  capTone = new EffectPass(capCam, new ToneMappingEffect({ mode: ToneMappingMode.AGX }))
  capTone.initialize(renderer, false, THREE.HalfFloatType); capTone.setSize(CS, CS)
  capRT = new THREE.WebGLRenderTarget(CS, CS, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, depthBuffer: false })
}
const gen = new PrecomputedTexturesGenerator(renderer)
for (const o of [starsMat, ...APS, ...CL]) Object.assign(o, gen.textures)
sunLight.transmittanceTexture = gen.textures.transmittanceTexture; skyLight.irradianceTexture = gen.textures.irradianceTexture
let atmo = false
gen.update().then(() => { atmo = true; loaded('atmosphere') }).catch(e => { console.error(e); atmo = true; loaded('atmosphere') })

// the warp in JS, for the tests: screen px -> picture uv
function mat(q) { const x = m.qrot(q, [1, 0, 0]), y = m.qrot(q, [0, 1, 0]), z = m.qrot(q, [0, 0, 1]); return x.concat(y, z) }
S.warp = (x, y) => {
  const p0 = S.pose, tx = S.cam.tx, ty = S.cam.ty, e = p0.eye
  const r = m.qrot(p0.eyeQ, m.norm([(x / innerWidth * 2 - 1) * tx, (1 - y / innerHeight * 2) * ty, 1]))
  const b = m.dot(e, r), t = -b + Math.sqrt(Math.max(b * b - m.dot(e, e) + 1, 0)), p = [e[0] + t * r[0], e[1] + t * r[1], e[2] + t * r[2]]
  const c = m.qrot(m.qconj(p0.eyeQ), p)
  return c[2] > 0.01 ? [c[0] / c[2] / world.srcTan[0] * 0.5 + 0.5, c[1] / c[2] / world.srcTan[1] * 0.5 + 0.5] : null
}

// render scale: 1.3 x the screen (capped DPR 1.5): the ball shows the middle of the picture a little smaller, so
// this keeps it sharp; it steps down while frames run long
let scale = 1.3 * Math.min(window.devicePixelRatio || 1, 1.5), checkAt = 0, bw = 0, bh = 0
const P = new THREE.Vector3(), enu = new THREE.Matrix4(), E = new THREE.Vector3(), N = new THREE.Vector3(), U = new THREE.Vector3()
const toECEF = l => new THREE.Vector3().addScaledVector(E, l[0]).addScaledVector(U, l[1]).addScaledVector(N, l[2])
const sun = new THREE.Vector3(), moon = new THREE.Vector3(), light = new THREE.Vector3(), eci = new THREE.Matrix4()
// the city lights and stars keep their apparent brightness whatever the exposure (CITY, STAR: at exposure 1)
const CITY = 0.28, STAR = 1.4   // (the 3 km city map reads as blotches if brighter; Phase 2's 500 m map sharpens it)
let expo = null, lastT = 0
S.renderers.push(function (pose, Wd, Hd) {
  if (pose.t > checkAt) { checkAt = pose.t + 2; if (S.frameMs > 21 && scale > 0.6) scale = Math.max(0.6, scale - 0.15) }
  const w = Math.max(1, Math.round(Wd * scale)), h = Math.max(1, Math.round(Hd * scale))
  if (w !== bw || h !== bh) { bw = w; bh = h; composer.setSize(w, h, false) }
  const tx = S.cam.tx, ty = S.cam.ty, sx = tx * K, sy = ty * K
  world.srcTan = [sx, sy]
  camera.fov = 2 * Math.atan(sy) / D; camera.aspect = sx / sy; camera.updateProjectionMatrix()
  new Geodetic(pose.geo[1] * D, pose.geo[0] * D, pose.alt * 1000).toECEF(P)
  Ellipsoid.WGS84.getEastNorthUpFrame(P, enu); enu.extractBasis(E, N, U)
  const qc = m.qmul(pose.suitQ, pose.eyeQ), f = toECEF(m.qrot(qc, [0, 0, 1])), u = toECEF(m.qrot(qc, [0, 1, 0]))
  camera.position.copy(P); camera.up.copy(u); camera.lookAt(P.clone().add(f)); camera.updateMatrixWorld()
  // the light: the real sun (its twilight glow included) until twilight has ended (-10 deg); after that, if the moon
  // is up, the moon stands in for it everywhere at night exposure; with no moon the sun stays (a dark sky, the cities
  // and the stars). The exposure eases over 3 s when the light changes hands.
  const date = new Date(START.getTime() + pose.t * 1000)
  getSunDirectionECEF(date, sun); getMoonDirectionECEF(date, moon)
  const el = v => Math.asin(Math.max(-1, Math.min(1, v.dot(U)))) / D
  const byMoon = el(sun) < -10 && el(moon) > 2
  light.copy(byMoon ? moon : sun); world.light = byMoon ? 'moon' : 'sun'
  const goal = byMoon ? 0.45 : 10
  expo = expo === null || S.reduce ? goal : expo * Math.pow(goal / expo, Math.min(1, Math.max(0, pose.t - lastT) / 3)); lastT = pose.t
  const exposure = world.exposure = expo
  renderer.toneMappingExposure = exposure
  for (const o of [ap, clouds, sunLight, skyLight, starsMat]) o.sunDirection.copy(light)
  ap.moonDirection && ap.moonDirection.copy(moon)
  sunLight.target.position.copy(P); sunLight.update(); skyLight.position.copy(P); skyLight.update()
  earthMat.emissiveIntensity = CITY / exposure; starsMat.intensity = STAR / exposure
  if (stars) { getECIToECEFRotationMatrix(date, eci); stars.setRotationFromMatrix(eci) }
  const U_ = warp.uniforms
  U_.get('uEye').value.set(pose.eye[0], pose.eye[1], pose.eye[2]); U_.get('uEyeM').value.fromArray(mat(pose.eyeQ))
  U_.get('uTan').value.set(tx, ty); U_.get('uSrc').value.set(sx, sy)
  composer.render()
  if (atmo && !world.ready) world.ready = true
  if (capComposer && atmo) capture(pose)
})

// the monitor capture, for the seat's light (spec 2026-10-08-seat-light-design.md): the world as the monitor displays
// it (tone mapped at the world's exposure), seen from the eye by six 90 deg cameras turned with the suit (not the
// head), 64 px a face, one face a frame. Each face is read back without stalling (PBO + fence) and once all six are
// new they go out as SITE5.env = { n, size: 64, faces: [6 x Uint8Array(64*64*4)] }: sRGB display values, rows as
// readPixels gives them, in Three.js cube order (+x -x +y -y +z -z) and in the seat's Three.js axes (x right, y up,
// -z forward), each face exactly what a THREE.CubeCamera at the eye would put in a WebGLCubeRenderTarget. (That
// camera's fov is -90, i.e. its picture turned 180 deg; a +90 camera with the up reversed is the same picture.)
// SITE5.envFreeze stops the publishing (the tests put in their own). ?capture=0 turns it all off.
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const FACE_UP = [[0, -1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, -1, 0]]
const seatToECEF = (q, v) => toECEF(m.qrot(q, [v[0], v[1], -v[2]]))   // a seat (Three.js) vector -> ECEF
let capF = 0, capN = 0, capGot = 0, capFaces = new Array(6)
const gl = renderer.getContext()
function capture(pose) {
  const k = capF++ % 6
  capCam.position.copy(P); capCam.up.copy(seatToECEF(pose.suitQ, FACE_UP[k])); capCam.lookAt(P.clone().add(seatToECEF(pose.suitQ, FACES[k])))
  capCam.updateMatrixWorld()
  if (capClouds) capClouds.sunDirection.copy(light)
  capAp.sunDirection.copy(light); capAp.moonDirection && capAp.moonDirection.copy(moon)
  capComposer.render()
  capTone.render(renderer, capComposer.outputBuffer, capRT, 0)
  const buf = new Uint8Array(CS * CS * 4)
  renderer.readRenderTargetPixelsAsync(capRT, 0, 0, CS, CS, buf).then(() => {
    capFaces[k] = buf; capGot |= 1 << k
    if (capGot === 63) {
      capN++
      if (!S.envFreeze) S.env = { n: capN, size: CS, faces: capFaces }
      capFaces = new Array(6); capGot = 0
    }
  }, () => {})
  // three leaves its read buffer bound while it waits (any readPixels into an array would fail) and the capture's
  // target bound: put both back, so the world's canvas is the current framebuffer between frames, as before
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); renderer.setRenderTarget(null)
}
