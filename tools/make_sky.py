"""make_sky.py: bakes the night sky's data (spec docs/2026-10-09-night-sky-design.md) into assets/sky/.
Run in Blender's Python (it reads the EXR):
  blender -b --factory-startup --python site5/tools/make_sky.py
Sources in tools/sky-src/ (git-ignored): milkyway_2020_4k.exr (NASA/GSFC SVS 4851, star-free Milky Way, RA/Dec plate
carree) and hyg.csv (HYG database v4.1, CC BY-SA 4.0). Writes milkyway.jpg and stars.bin, and prints MW_SCALE for
js/starsky.js. """
import bpy, csv, math, os, struct
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, 'sky-src'), os.path.join(HERE, '..', 'assets', 'sky')
MAG_MAX = 8.0
os.makedirs(OUT, exist_ok=True)

# ---- the Milky Way ----
img = bpy.data.images.load(os.path.join(SRC, 'milkyway_2020_4k.exr'))
w, h = img.size
px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px)
rgb = px.reshape(h, w, 4)[:, :, :3]                      # rows bottom up, as Blender keeps them
lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
scale = float(np.percentile(lum, 99.5))
enc = np.clip(rgb / scale, 0, 1) ** (1 / 2.2)
# where the band is brightest (a check of the map's orientation: the galactic centre is RA 266.4, Dec -28.9)
sm = lum.reshape(h // 64, 64, w // 64, 64).mean(axis=(1, 3)); j, i = np.unravel_index(np.argmax(sm), sm.shape)
print('MW size', w, h, 'MW_SCALE', scale, 'brightest block at u', (i + 0.5) / sm.shape[1], 'v(bottom up)', (j + 0.5) / sm.shape[0])
out = bpy.data.images.new('mw', w, h, alpha=False, float_buffer=False)
out.pixels.foreach_set(np.dstack([enc, np.ones((h, w, 1), np.float32)]).ravel())
out.file_format = 'JPEG'; out.save(filepath=os.path.join(OUT, 'milkyway.jpg'), quality=85)
# which way RA runs across the map: two more landmarks, each under both readings (u = RA/360, or u = 0.5 - RA/360)
def at(ra, dec): v = dec / 180 + 0.5; return [round(float(lum[int(v * h), int((u % 1) * w)] / scale), 3) for u in (ra / 360, 0.5 - ra / 360)]
print('Cygnus (u=RA/360, u=.5-RA/360)', at(310, 40), 'LMC', at(80.9, -69.75), 'galactic pole', at(192.9, 27.1))

# ---- the stars ----
def bv_rgb(bv):
    """a star's tint from its B-V colour index: Ballesteros' temperature, then a blackbody approximation (Helland)"""
    bv = min(2.0, max(-0.4, bv))
    t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)) / 100
    r = 255 if t <= 66 else 329.698727446 * (t - 60) ** -0.1332047592
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * (t - 60) ** -0.0755148492
    b = 255 if t >= 66 else (0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    c = [min(255, max(0, v)) for v in (r, g, b)]; k = 255 / max(c)
    return [round(v * k) for v in c]

pos, mags, cols = [], [], []
with open(os.path.join(SRC, 'hyg.csv'), newline='', encoding='utf-8') as f:
    for row in csv.DictReader(f):
        if row['id'] == '0' or not row['mag']: continue      # (the Sun)
        m = float(row['mag'])
        if m > MAG_MAX: continue
        ra, dec = float(row['ra']) * 15 * math.pi / 180, float(row['dec']) * math.pi / 180
        pos += [round(math.cos(dec) * math.cos(ra) * 32767), round(math.cos(dec) * math.sin(ra) * 32767), round(math.sin(dec) * 32767)]
        mags.append(min(255, max(0, round((m + 2) * 20))))
        cols += bv_rgb(float(row['ci']) if row['ci'] else 0.65)
n = len(mags)
with open(os.path.join(OUT, 'stars.bin'), 'wb') as f:
    f.write(struct.pack('<I', n)); f.write(struct.pack('<%dh' % (3 * n), *pos))
    if (6 * n) % 4: f.write(b'\0' * (4 - (6 * n) % 4))    # (pad, so the arrays after start on a 4-byte boundary)
    f.write(bytes(mags)); f.write(bytes(cols))
print('stars', n, 'brightest mag', (min(mags) / 20) - 2)
# a check: the colour of a hot (B-V -0.3), a Sun-like (0.65) and a red (1.8) star
assert bv_rgb(-0.3)[2] == 255 and bv_rgb(-0.3)[0] < 200 and bv_rgb(1.8)[0] == 255 and bv_rgb(1.8)[2] < 160, (bv_rgb(-0.3), bv_rgb(1.8))
