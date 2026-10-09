# Night sky: design (2026-10-09)

Owner's ask: "better the stars system". Scope chosen: the real night sky (no bloom, AA or shadows in this round).
Approved in chat 2026-10-09, with the two downloads; the owner asked for a light test pass.

## Data (offline, `tools/make_sky.py`, run in Blender's Python: it reads EXR)
- Sources in `tools/sky-src/` (git-ignored): NASA/GSFC SVS Deep Star Maps 2020 `milkyway_2020_4k.exr` (star-free Milky
  Way, celestial RA/Dec plate carrée; credit "NASA/Goddard Space Flight Center Scientific Visualization Studio") and
  the HYG database v4.1 `hyg.csv` (CC BY-SA 4.0, astronexus).
- `assets/sky/milkyway.jpg`: 4096x2048, the radiance over its 99.5th percentile scaled to 1, gamma 1/2.2 (the scale
  goes in the JS as `MW_SCALE`).
- `assets/sky/stars.bin`: every HYG star to visual magnitude 8 (the Sun left out). Little-endian: Uint32 count N, then
  Int16 x 3N (J2000 unit direction x 32767: x to RA 0, z to the north pole, the ECI axes), Uint8 x N (magnitude,
  (m + 2) x 20), Uint8 x 3N (colour from B-V: Ballesteros' temperature, then a blackbody tint, brightest channel 255).

## Runtime (`js/starsky.js`, replaces Takram's StarsGeometry/StarsMaterial in sky.js)
- `makeStarSky({ scene, renderer })` -> `{ ready, update(date, camPos, exposure, altKm, upECEF), count }`.
- Everything sits on spheres round the camera (stars 5000 km, Milky Way 5500 km): inside the far plane, behind the Earth
  from any height, under the air's haze. Turned ECI -> ECEF by the date, as before.
- Stars: Points, additive. Flux 10^(-0.4 m). A faint star is a 1.5-2 px Gaussian; brighter ones grow a soft halo up to
  ~9 px (Sirius), the total light kept to the flux. Colour from the data.
- Planets: Mercury, Venus, Mars, Jupiter, Saturn from `astronomy-engine` (CDN, pinned), geocentric J2000 direction and
  magnitude, refreshed every 10 s of world time; drawn like stars, tinted, no twinkle.
- Twinkle: brightness x (1 + a noise), a = 0.35 x (low over the local horizon) x (1 - smoothstep(8, 20 km) of the
  height); none under reduced motion.
- Brightness with the exposure as today: apparent brightness from a night exposure (60) up, a tenth in daylight. The
  Milky Way fades the same way (only on a dark sky).
- Credit: "Milky Way: NASA/GSFC SVS · Stars: HYG (CC BY-SA)" on the credit line.

## Checks (light, by the owner's ask)
One `stars` block: the catalogue loads (over 30 000 stars), Sirius is the brightest and points at RA 101.29, Dec
-16.72; at night the sky shows the Milky Way (Sagittarius brighter than near the galactic pole); no errors.
