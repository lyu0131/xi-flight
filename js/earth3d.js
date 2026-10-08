/* earth3d.js: the photoreal 3D Earth (spec 2026-10-08-photoreal-earth-design.md). Google's Photorealistic 3D Tiles,
   streamed through Cesium ion (asset 2275207) by 3d-tiles-renderer, in ECEF metres: the frame the scene already uses,
   so the tile group needs no transform. sky.js creates it, calls update() each frame (after the camera is placed)
   and resize() when the picture changes size. Only the main camera drives the level of detail; the monitor
   capture's cameras see whatever it has loaded.
   makeEarth3D({ scene, camera, renderer, token, onFail }) -> { update, resize, state: { on, loaded, failed }, tiles,
   heightAt(latDeg, lonDeg), setNight(map, intensity) }. On an auth or root-tileset failure it calls onFail() once and takes the tiles away. */
import * as THREE from 'three'
import { TilesRenderer } from '3d-tiles-renderer'
import { CesiumIonAuthPlugin, GLTFExtensionsPlugin, TileCompressionPlugin } from '3d-tiles-renderer/plugins'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { Geodetic } from '@takram/three-geospatial'

const ASSET = 2275207   // Google Photorealistic 3D Tiles
const ERROR_TARGET = 16   // px of screen-space error a tile may show before it splits (see the spike in the task report)
const DRACO = 'https://cdn.jsdelivr.net/npm/three@0.181.0/examples/jsm/libs/draco/gltf/'
const D = Math.PI / 180, TOP = 12000   // heightAt casts down from 12 km

// a tile's material: its photo, lit by the scene's lights (Takram's sun light and sky light probe) like the flat
// Earth, instead of the unlit material the tiles arrive with. (The photo keeps its own baked daylight shading.)
// At night the city lights glow on it as on the flat Earth: NASA's Black Marble, looked up by the fragment's geodetic
// latitude and longitude (Bowring's formula on WGS84), in today's earthMat.emissive colour. The uniforms are shared,
// so setNight() reaches every tile at once.
// (the dispose-model handler below disposes it with the tile, the photo included)
const night = { uNight: { value: null }, uNightK: { value: 0 }, uNightC: { value: new THREE.Color(0xffd9a8) } }
function nightPatch(s) {
  Object.assign(s.uniforms, night)
  s.vertexShader = 'varying vec3 vNightW;\n' + s.vertexShader.replace('#include <project_vertex>',
    '#include <project_vertex>\nvNightW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
  s.fragmentShader = 'varying vec3 vNightW;\nuniform sampler2D uNight;\nuniform float uNightK;\nuniform vec3 uNightC;\n' +
    s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    {
      const float A = 6378137.0, B = 6356752.314245, E2 = 0.00669437999014, EP2 = 0.00673949674228;
      float p = length(vNightW.xy), th = atan(vNightW.z * A, p * B), st = sin(th), ct = cos(th);
      float lat = atan(vNightW.z + EP2 * B * st * st * st, p - E2 * A * ct * ct * ct), lon = atan(vNightW.y, vNightW.x);
      totalEmissiveRadiance += uNightK * uNightC * texture2D(uNight, vec2(lon / 6.283185307 + 0.5, lat / 3.141592654 + 0.5)).rgb;
    }`)
}
function tileMaterial(m) {
  const mat = new THREE.MeshStandardMaterial({ map: m.map || null, roughness: 1, metalness: 0 })
  mat.onBeforeCompile = nightPatch
  return mat
}

export function makeEarth3D({ scene, camera, renderer, token, onFail }) {
  const state = { on: true, loaded: 0, failed: false }
  const tiles = new TilesRenderer()
  tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: token, assetId: ASSET, autoRefreshToken: true }))
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: new DRACOLoader().setDecoderPath(DRACO) }))
  tiles.registerPlugin(new TileCompressionPlugin())
  tiles.errorTarget = ERROR_TARGET
  // (the Google auth plugin, registered once ion answers, sets its own errorTarget of 20: put ours back)
  tiles.addEventListener('load-root-tileset', () => { tiles.errorTarget = ERROR_TARGET })
  tiles.addEventListener('load-model', e => {
    state.loaded++
    e.scene.traverse(o => {
      if (!o.isMesh || !o.material) return
      // (the tiles come without normals, which a lit material needs: without them it draws black)
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals()
      const m = o.material; o.material = tileMaterial(m); m.dispose()
    })
  })
  // (3d-tiles-renderer disposes the material it collected before load-model, not our replacement: dispose that here,
  // and the photo with it; the night uniforms and map are shared and stay)
  tiles.addEventListener('dispose-model', e => { state.loaded--; e.scene.traverse(o => { if (o.material) { o.material.map && o.material.map.dispose(); o.material.dispose() } }) })
  tiles.addEventListener('load-error', e => {
    if (e.tile !== null || state.failed) return   // (a single tile that fails just stays a gap; only the root is fatal)
    state.failed = true
    if (credit) credit.replaceChildren()
    tiles.dispose()   // (also takes tiles.group out of the scene; each tile's dispose-model counts loaded down, so zero it after)
    state.loaded = 0
    onFail && onFail()
  })
  tiles.setCamera(camera)
  scene.add(tiles.group)

  // the credit line (Google's and Cesium ion's terms). First what ion's endpoint for this asset requires (its
  // `attributions` array, which 3d-tiles-renderer doesn't surface): the ion logo (a link), the commercial-use link and
  // the Google logo. Then the tiles' own attributions, text as text and logos as <img>s (built from their src, never
  // from remote HTML); a plain 'Google' text is dropped, the logo says it. Joined with a dot, at most once a second,
  // rebuilt only when it changed.
  const ION = [
    { src: 'https://assets.ion.cesium.com/ion-credit.png', alt: 'Cesium ion', href: 'https://cesium.com' },
    { text: 'Upgrade for commercial use.', href: 'https://cesium.com/pricing/' },
    { src: 'https://assets.ion.cesium.com/google-credit.png', alt: 'Google' }]
  const credit = document.getElementById('attrib'); let creditAt = 0, creditKey = ''
  function updateCredit() {
    const now = performance.now(); if (!credit || now < creditAt) return
    creditAt = now + 1000
    const parts = ION.slice()
    for (const a of tiles.getAttributions()) {
      if (a.type === 'string') parts.push({ text: a.value })
      else if (a.type === 'image') parts.push({ src: a.value, alt: 'credit' })
      else if (a.type === 'html') {   // (parsed inert, only its text and its <img src> kept)
        const d = new DOMParser().parseFromString(a.value, 'text/html')
        d.querySelectorAll('img').forEach(i => parts.push({ src: i.getAttribute('src'), alt: 'credit' }))
        const t = d.body.textContent.trim(); if (t) parts.push({ text: t })
      }
    }
    const list = parts.filter(p => (p.text ? p.text.trim().toLowerCase() !== 'google' : /^https?:/.test(p.src || ''))), key = JSON.stringify(list)
    if (key === creditKey) return
    creditKey = key
    credit.replaceChildren(...list.flatMap((p, i) => {
      let n = p.text ? document.createTextNode(p.text) : Object.assign(document.createElement('img'), { src: p.src, alt: p.alt })
      if (p.href) { const a = Object.assign(document.createElement('a'), { href: p.href, target: '_blank', rel: 'noopener' }); a.append(n); n = a }
      return i ? [document.createTextNode(' · '), n] : [n]
    }))
  }

  const ray = new THREE.Raycaster(), hits = [], top = new THREE.Vector3()
  ray.firstHitOnly = true
  return {
    state, tiles,
    update() { if (!state.failed) { tiles.update(); updateCredit() } },
    resize() { if (!state.failed) tiles.setResolutionFromRenderer(camera, renderer) },
    // the city lights: the Black Marble map (null until it loads) and their strength (sky.js: CITY / exposure)
    setNight(map, k) { night.uNight.value = map; night.uNightK.value = map ? k : 0 },
    // the height above the WGS84 ellipsoid: a ray down the ellipsoid's normal from TOP, so the height is TOP less the
    // distance to the first hit (null where nothing is loaded under it)
    heightAt(lat, lon) {
      if (state.failed) return null
      new Geodetic(lon * D, lat * D, TOP).toECEF(top)
      const c = Math.cos(lat * D)
      ray.set(top, new THREE.Vector3(-c * Math.cos(lon * D), -c * Math.sin(lon * D), -Math.sin(lat * D)))
      ray.far = TOP + 1000
      hits.length = 0; ray.intersectObject(tiles.group, true, hits)
      return hits.length ? TOP - hits[0].distance : null
    }
  }
}
