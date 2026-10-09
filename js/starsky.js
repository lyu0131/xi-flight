/* starsky.js: the night sky (spec docs/2026-10-09-night-sky-design.md). The HYG catalogue's 41 000 stars to magnitude 8
   at their true colours (assets/sky/stars.bin, from tools/make_sky.py), NASA's star-free Milky Way behind them
   (assets/sky/milkyway.jpg, RA/Dec plate carree) and the five naked-eye planets where they are on the date
   (astronomy-engine). All on spheres round the camera (stars STARS_R, the Milky Way MW_R): inside the far plane and behind
   the Earth from any height, turned ECI -> ECEF with the date. Stars are Gaussian points, their total light the
   magnitude's flux (gently compressed, as a long exposure stretches it); the brightest grow a soft halo. They twinkle low
   over the horizon when the suit is down in the air (none in orbit, none under reduced motion); planets don't.
   makeStarSky({ scene, base, onLoad }) -> { update(date, camPos, exposure, altKm, upECEF), state: { stars, planets } } */
import * as THREE from 'three'
import { getECIToECEFRotationMatrix } from '@takram/three-atmosphere'

const STARS_R = 5e6, MW_R = 5.5e6
// brightness at exposure 1 (display = this x exposure): a magnitude-0 star's light, the Milky Way's at the map's white
// (99.5th percentile, MW_SCALE of radiance in the source EXR). GAMMA < 1 compresses the magnitudes, as a long exposure
// does, so the faint ones read without the bright ones blowing out.
const STAR_K = 3, MW_K = 0.08, GAMMA = 0.6, NIGHT_EXPO = 60
const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)

// The Earth hides them by a ray test against the WGS84 ellipsoid, not by depth: the flat fallback Earth is drawn with a
// large depth offset (so the 3D tiles always win over it), which puts its depth at the far value, level with these
// spheres; where only it covered the sky (the monitor capture's other faces) the stars shone through the Earth and kept
// the night meter at a day exposure (2026-10-09). (The tiles still hide them by depth: mountains over the limb.)
const EARTH = `
bool hitsEarth(vec3 o, vec3 d) {
  const vec3 INV = vec3(1. / 6378137., 1. / 6378137., 1. / 6356752.3);
  vec3 p = o * INV, q = d * INV;
  float a = dot(q, q), b = dot(p, q), c = dot(p, p) - 1.;
  return b < 0. && b * b - a * c > 0.;
}`
const STAR_VS = EARTH + `
uniform float uK, uTime, uTwinkle, uExt;
uniform vec3 uUp;
attribute float mag;
attribute vec3 tint;
varying vec3 vCol;
varying float vSize, vHalo;
void main() {
  float m = mag / 20. - 2.;
  float flux = pow(10., -0.4 * m * ${GAMMA.toFixed(2)}) * uK;
  vec3 d = normalize(mat3(modelMatrix) * position);
  float el = dot(d, uUp);   // sine of the height over the horizon (the geocentric one: fine for this)
  // through the air low down: dimmed by the airmass, and twinkling (a per-star flicker of mixed frequencies)
  flux *= exp(-uExt / (max(el, 0.) + 0.03));
  float id = float(gl_VertexID);
  flux *= 1. + uTwinkle * (1. - smoothstep(0., 0.5, el)) * (0.6 * sin(uTime * (11. + mod(id, 7.)) + id) + 0.4 * sin(uTime * (23. + mod(id, 5.)) + id * 1.7));
  float big = smoothstep(2.5, -1.5, m);   // the brightest few: a halo
  vSize = 2.2 + 8. * big; vHalo = 0.3 * big;
  vCol = tint * flux;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  gl_PointSize = vSize;
  if (hitsEarth(cameraPosition, (modelMatrix * vec4(position, 1.)).xyz - cameraPosition)) gl_Position = vec4(0., 0., 2., 1.);   // (behind the Earth: clipped)
}`
const STAR_FS = `
varying vec3 vCol;
varying float vSize, vHalo;
void main() {
  vec2 p = (gl_PointCoord - .5) * vSize;   // px from the centre
  float r2 = dot(p, p);
  // a tight core (sigma .55 px) and, for the bright ones, a wide halo (sigma a fifth of the sprite), each normalised
  float sc = .55, sh = vSize / 5.;
  float g = (1. - vHalo) * exp(-r2 / (2. * sc * sc)) / (6.2832 * sc * sc) + vHalo * exp(-r2 / (2. * sh * sh)) / (6.2832 * sh * sh);
  gl_FragColor = vec4(vCol * g * 1.9, 1.);   // (1.9: the core's peak back to about the flux)
}`
const MW_VS = `
varying vec3 vDir, vRay;
void main() { vDir = position; vRay = (modelMatrix * vec4(position, 1.)).xyz - cameraPosition; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`
const MW_FS = EARTH + `
uniform sampler2D uMap;
uniform float uK;
varying vec3 vDir, vRay;
void main() {
  if (hitsEarth(cameraPosition, vRay)) discard;
  vec3 d = normalize(vDir);   // ECI: x to RA 0, z to the north pole
  // the map: RA runs right to left from its centre (RA 0), Dec up (checked on the LMC, Cygnus and the galactic centre)
  vec2 uv = vec2(fract(.5 - atan(d.y, d.x) / 6.2832), asin(clamp(d.z, -1., 1.)) / 3.14159 + .5);
  vec3 c = texture2D(uMap, uv).rgb;
  gl_FragColor = vec4(pow(c, vec3(2.2)) * uK, 1.);
}`

function starMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uK: { value: 0 }, uTime: { value: 0 }, uTwinkle: { value: 0 }, uExt: { value: 0 }, uUp: { value: new THREE.Vector3(0, 0, 1) } }
  })
}

export function makeStarSky({ scene, base = 'assets/sky/', onLoad }) {
  const state = { stars: 0, planets: 0 }
  const starMat = starMaterial(), planetMat = starMaterial()
  const eci = new THREE.Matrix4(), objs = []
  let stars = null, planets = null, mw = null, A = null, planetAt = -1e18
  const done = () => { if (stars && mw !== null) onLoad && onLoad() }

  fetch(base + 'stars.bin').then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status)).then(buf => {
    const n = new DataView(buf).getUint32(0, true), o = 4 + Math.ceil(6 * n / 4) * 4
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Int16Array(buf, 4, 3 * n), 3, true))
    g.setAttribute('mag', new THREE.BufferAttribute(new Uint8Array(buf, o, n), 1, false))
    g.setAttribute('tint', new THREE.BufferAttribute(new Uint8Array(buf, o + n, 3 * n), 3, true))
    stars = new THREE.Points(g, starMat); stars.scale.setScalar(STARS_R); stars.frustumCulled = false; stars.renderOrder = 2
    scene.add(stars); objs.push(stars); state.stars = n; done()
    // the planets, once the stars are up (a library from the CDN: if it can't load, the sky goes on without them)
    import('astronomy-engine').then(lib => {
      A = lib
      const pg = new THREE.BufferGeometry()
      pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3))
      pg.setAttribute('mag', new THREE.BufferAttribute(new Float32Array(5), 1))
      pg.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(PLANETS.flatMap(p => p[1])), 3))
      planets = new THREE.Points(pg, planetMat); planets.scale.setScalar(STARS_R * 0.99); planets.frustumCulled = false; planets.renderOrder = 3
      scene.add(planets); objs.push(planets); state.planets = 5
    }).catch(() => {})
  }).catch(() => { stars = false; done() })

  new THREE.TextureLoader().load(base + 'milkyway.jpg', t => {
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping
    mw = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.ShaderMaterial({
      vertexShader: MW_VS, fragmentShader: MW_FS, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: t }, uK: { value: 0 } }
    }))
    mw.scale.setScalar(MW_R); mw.frustumCulled = false; mw.renderOrder = 1
    scene.add(mw); objs.push(mw); done()
  }, undefined, () => { mw = false; done() })

  const PLANETS = [['Mercury', [1, 0.86, 0.75]], ['Venus', [1, 0.97, 0.88]], ['Mars', [1, 0.62, 0.42]], ['Jupiter', [1, 0.93, 0.82]], ['Saturn', [1, 0.88, 0.66]]]
  function placePlanets(date) {
    const p = planets.geometry.attributes.position, mg = planets.geometry.attributes.mag
    PLANETS.forEach(([name], i) => {
      const v = A.GeoVector(A.Body[name], date, true), l = Math.hypot(v.x, v.y, v.z)   // J2000 equatorial, AU
      p.setXYZ(i, v.x / l, v.y / l, v.z / l); mg.setX(i, (A.Illumination(A.Body[name], date).mag + 2) * 20)
    })
    p.needsUpdate = mg.needsUpdate = true
  }

  return {
    state,
    // the stars and planets in or out of the picture (out for the monitor capture: a star's light is set per pixel, so in
    // its 64 px faces each one covered 400x the sky it does on screen and the night sky read as bright as dusk)
    showStars(on) { if (stars) stars.visible = on; if (planets) planets.visible = on },
    update(date, camPos, exposure, altKm, up) {
      getECIToECEFRotationMatrix(date, eci)
      for (const o of objs) { o.setRotationFromMatrix(eci); o.position.copy(camPos) }
      // as bright as they look from a night exposure (NIGHT_EXPO) up, fading out through the dusk exposures to none by day
      const k = THREE.MathUtils.smoothstep(exposure, 12, NIGHT_EXPO) / exposure, t = performance.now() / 1000   // (k: none at a day exposure, 6)
      const air = 1 - THREE.MathUtils.smoothstep(altKm, 8, 20)
      for (const mt of [starMat, planetMat]) {
        const u = mt.uniforms; u.uK.value = STAR_K * k; u.uTime.value = t; u.uUp.value.copy(up); u.uExt.value = 0.12 * (1 - THREE.MathUtils.smoothstep(altKm, 2, 30))
      }
      starMat.uniforms.uTwinkle.value = reduce ? 0 : 0.35 * air
      if (mw) mw.material.uniforms.uK.value = MW_K * k
      if (planets && Math.abs(date.getTime() - planetAt) > 10000) { planetAt = date.getTime(); placePlanets(date) }
      state.mwK = mw ? mw.material.uniforms.uK.value : 0
    }
  }
}
