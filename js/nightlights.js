/* nightlights.js: sharper city lights near the suit (brief 2026-10-08). A 16 x 16 mosaic of NASA GIBS Black Marble
   tiles at zoom 8 (Web Mercator, about 500 m a pixel), 4096 px square, centred on the suit's tile. It re-centres once
   the suit's tile is more than 4 tiles from the centre: what's loaded moves over (the canvas drawn onto itself,
   shifted) and only the new tiles are fetched, at most 8 at a time. A tile that fails stays black; the shaders
   (earth3d.js, nightLight()) fall back to the global 3 km map wherever the mask says a tile isn't loaded.
   makeNightLights({ renderer }) -> { update(latDeg, lonDeg), texture, bounds: { x0, y0 }, loadedMask, state: { loaded, failed } }.
   texture, bounds and loadedMask always agree with each other: they change together, at most twice a second. */
import * as THREE from 'three'

const Z = 256, N = 16, PX = 256, MAX_IN_FLIGHT = 8, FLUSH_MS = 500
const URL_ = (x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/8/${y}/${x}.png`
const wrapX = x => ((x % Z) + Z) % Z

export function makeNightLights({ renderer }) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = N * PX
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  // (the pixels are sRGB, but the texture is uploaded raw and earth3d.js's nightLight() decodes them: tagged sRGB, Chrome
  // converted the whole 4096 px canvas on the CPU at each upload, ~130 ms frames that cost the flight sim its time)
  texture.colorSpace = THREE.NoColorSpace; texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const maskData = new Uint8Array(N * N), loadedMask = new THREE.DataTexture(maskData, N, N, THREE.RedFormat)
  loadedMask.minFilter = loadedMask.magFilter = THREE.NearestFilter; loadedMask.needsUpdate = true
  const bounds = { x0: 0, y0: 0 }, state = { loaded: 0, failed: 0 }
  const tiles = new Map()   // 'x,y' (absolute z8 tile) -> 'pending' | 'loaded' | 'failed', for the current window only
  let x0 = null, y0 = 0, inFlight = 0, dirty = false, flushAt = 0
  const inside = (x, y) => wrapX(x - x0) < N && y - y0 >= 0 && y - y0 < N

  function fetchTile(x, y) {
    const k = x + ',' + y
    tiles.set(k, 'pending'); inFlight++
    fetch(URL_(x, y)).then(r => r.ok ? r.blob() : Promise.reject(r.status)).then(createImageBitmap).then(img => {
      if (tiles.get(k) !== 'pending' || !inside(x, y)) return   // (re-centred away while it was in flight)
      ctx.drawImage(img, wrapX(x - x0) * PX, (y - y0) * PX); img.close && img.close()
      tiles.set(k, 'loaded'); dirty = true
    }).catch(() => { if (tiles.get(k) === 'pending') { tiles.set(k, 'failed'); dirty = true } })
      .finally(() => { inFlight--; pump() })
  }
  // the next tiles to fetch, nearest the centre first
  function pump() {
    if (x0 === null || inFlight >= MAX_IN_FLIGHT) return
    const want = []
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = wrapX(x0 + i), y = y0 + j
      if (y >= 0 && y < Z && !tiles.has(x + ',' + y)) want.push([Math.hypot(i - N / 2 + 0.5, j - N / 2 + 0.5), x, y])
    }
    want.sort((a, b) => a[0] - b[0])
    for (const [, x, y] of want) { if (inFlight >= MAX_IN_FLIGHT) break; fetchTile(x, y) }
  }
  function recentre(cx, cy) {
    const nx = wrapX(cx - N / 2), ny = cy - N / 2
    if (x0 !== null) {   // move what's loaded over: draw the canvas onto itself, shifted ('copy' clears the rest)
      const dx = ((nx - x0 + Z / 2) % Z + Z) % Z - Z / 2, dy = ny - y0
      ctx.globalCompositeOperation = 'copy'; ctx.drawImage(canvas, -dx * PX, -dy * PX); ctx.globalCompositeOperation = 'source-over'
    }
    x0 = nx; y0 = ny
    for (const k of [...tiles.keys()]) { const [x, y] = k.split(',').map(Number); if (!inside(x, y)) tiles.delete(k) }
    dirty = true; pump()
  }
  function flush() {
    let loaded = 0, failed = 0
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const s = tiles.get(wrapX(x0 + i) + ',' + (y0 + j)); maskData[j * N + i] = s === 'loaded' ? 255 : 0
      if (s === 'loaded') loaded++; else if (s === 'failed') failed++
    }
    state.loaded = loaded; state.failed = failed; bounds.x0 = x0; bounds.y0 = y0
    texture.needsUpdate = true; loadedMask.needsUpdate = true; dirty = false
  }
  return {
    texture, bounds, loadedMask, state,
    update(lat, lon) {
      const p = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180
      const cx = wrapX(Math.floor((lon + 180) / 360 * Z)), cy = Math.min(Z - 1, Math.max(0, Math.floor((1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2 * Z)))
      if (x0 === null) recentre(cx, cy)
      else {
        const ddx = Math.abs(((cx - (x0 + N / 2) + Z / 2) % Z + Z) % Z - Z / 2), ddy = Math.abs(cy - (y0 + N / 2))
        if (ddx > 4 || ddy > 4) recentre(cx, cy)
      }
      const now = performance.now()
      if (dirty && now >= flushAt) { flushAt = now + FLUSH_MS; flush() }
    }
  }
}
