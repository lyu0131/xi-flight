"""site5 seat: build the armoured pod (the owner's pick of the seat concepts, 2026-10-07) and export it to
site5/assets/seat.glb (a baked 4096 atlas: base colour, normal, ORM) and site5/assets/seat-light.jpg (the strips'
light on the same UV, divided by glowMax).

Run:  blender -b --factory-startup -P site5/tools/make_seat.py            (builds, bakes, writes both; GPU)
      blender -b --factory-startup -P site5/tools/make_seat.py -- --atlas 512   (a quick, small atlas)
      blender --factory-startup -P site5/tools/make_seat.py -- --look      (builds it in an open Blender, to look at)

Scanned textures (ambientCG, CC0), 2K JPG, unzipped into site5/tools/tex-src/<Set>/ (git-ignored):
  Leather026    https://ambientcg.com/view?id=Leather026    A_quilt, A_leather, A_perf, A_pipe
  Metal027      https://ambientcg.com/view?id=Metal027      A_shell, A_plate (worn painted metal)
  Metal009      https://ambientcg.com/view?id=Metal009      A_metal, A_chrome (brushed)
  Rubber004     https://ambientcg.com/view?id=Rubber004     A_rubber, A_hose
  Plastic012A   https://ambientcg.com/view?id=Plastic012A   A_dark (bead-blasted plastic)
They sit under the procedural quilt, perforation and wear: colour and roughness are multiplied in (divided by the
map's own mean, so each part keeps its approved colour and roughness on average), the normal feeds the bumps.

Built in Blender's frame (x right, y forward, z up) in ball radii, as site5's seat frame is (1 is about 1.4 m), with
the upright pilot's eye at the origin. The pod is laid back: the back reclines RECLINE deg about the hips, the
thighs run to a knee break and the legs rest in two split cradles down to the foot pedals. The export moves the
origin to the reclined eye (EYE) and turns the axes to the site's (x right, y up, z forward).
Each part is tagged with a group the site uses to tell what's on screen: seat, rail (the armrest pods) and frame
(the leg cradles and pedals); each group is a node of the glb (extras.grp). Materials keep their names.
Contact shading (ambient occlusion) is baked into the atlas (ORM's R).
"""
import bpy, bmesh, math, sys, bisect, os, time
import numpy as np
from mathutils import Vector, Euler, Matrix

D = math.radians
LOOK = '--look' in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
SUB = 1      # the smoothing level the export uses (the .blend's own is 2): keeps the glb near 11 MB
scene = bpy.context.scene
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
GROUP = ['seat']

# ---------------------------------------------------------------- materials
def lin(hexs):
    h = hexs.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]

def newmat(name):
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    nt = m.node_tree
    return m, nt.nodes, nt.links, nt.nodes['Principled BSDF']

def objco(N):
    return N.new('ShaderNodeTexCoord').outputs['Object']

def mathn(N, L, op, a, b=0.0):
    m = N.new('ShaderNodeMath'); m.operation = op
    for i, x in enumerate((a, b)):
        if isinstance(x, (int, float)): m.inputs[i].default_value = x
        else: L.new(x, m.inputs[i])
    return m.outputs[0]

def noise(N, L, v, scale, detail=6.0):
    n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
    L.new(v, n.inputs['Vector']); return n.outputs['Fac']

def wave(N, L, v, scale, direction='X', profile='SIN'):
    w = N.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = direction; w.wave_profile = profile
    w.inputs['Scale'].default_value = scale; w.inputs['Distortion'].default_value = 0.0
    L.new(v, w.inputs['Vector']); return w.outputs['Fac']

def ramp(N, L, x, stops):
    r = N.new('ShaderNodeValToRGB'); L.new(x, r.inputs['Fac']); cr = r.color_ramp
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*stops[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for p, c in stops[1:-1]:
        e = cr.elements.new(p); e.color = (*c, 1)
    return r.outputs['Color']

def bump(N, L, h, strength, dist, nrm=None):
    b = N.new('ShaderNodeBump'); b.inputs['Strength'].default_value = strength; b.inputs['Distance'].default_value = dist
    L.new(h, b.inputs['Height'])
    if nrm is not None: L.new(nrm, b.inputs['Normal'])
    return b.outputs['Normal']

def flipx(N, L, v):
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (-1, 1, 1); L.new(v, mp.inputs['Vector']); return mp.outputs['Vector']

def mat(name, col, rough=0.5, metal=0.0, coat=0.0, emit=None, es=0.0, aniso=0.0, grain=0.0, gscale=300.0):
    m, N, L, b = newmat(name)
    b.inputs['Base Color'].default_value = (*lin(col), 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal; b.inputs['Coat Weight'].default_value = coat
    if aniso: b.inputs['Anisotropic'].default_value = aniso
    if emit:
        b.inputs['Emission Color'].default_value = (*lin(emit), 1); b.inputs['Emission Strength'].default_value = es
    if grain:
        L.new(bump(N, L, noise(N, L, objco(N), gscale, 8), grain, 0.0006), b.inputs['Normal'])
    return m

def leather(name, col, quilt=0.0, perforate=0.0, rough=0.55):
    """grained leather; quilt: diamond scale (about 0.6/quilt m a diamond); perforate: a hole grid"""
    m, N, L, b = newmat(name)
    v = objco(N)
    g = noise(N, L, v, 420, 10)
    b.inputs['Roughness'].default_value = rough
    nrm = bump(N, L, g, 0.25, 0.0005)
    base = lin(col)
    if quilt:
        w1 = wave(N, L, v, quilt, 'DIAGONAL'); w2 = wave(N, L, flipx(N, L, v), quilt, 'DIAGONAL')
        h = ramp(N, L, mathn(N, L, 'MINIMUM', w1, w2), [(0.0, (0, 0, 0)), (0.28, (1, 1, 1)), (1.0, (1, 1, 1))])
        nrm = bump(N, L, h, 0.7, 0.0035, nrm)
        dark = ramp(N, L, mathn(N, L, 'MINIMUM', w1, w2), [(0.0, [c * 0.35 for c in base]), (0.2, base), (1.0, base)])
        L.new(dark, b.inputs['Base Color'])
    elif perforate:
        w1 = wave(N, L, v, perforate, 'DIAGONAL'); w2 = wave(N, L, flipx(N, L, v), perforate, 'DIAGONAL')
        holes = ramp(N, L, mathn(N, L, 'MULTIPLY', w1, w2), [(0.0, (1, 1, 1)), (0.82, (1, 1, 1)), (0.9, (0, 0, 0)), (1.0, (0, 0, 0))])
        nrm = bump(N, L, holes, 0.6, 0.002, nrm)
        col_ = ramp(N, L, mathn(N, L, 'MULTIPLY', w1, w2), [(0.0, base), (0.82, base), (0.9, (0.004, 0.004, 0.004)), (1.0, (0.004, 0.004, 0.004))])
        L.new(col_, b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Sheen Weight'].default_value = 0.15
    L.new(nrm, b.inputs['Normal'])
    return m

def paint(name, col, bare='#9AA0A8', rough=0.42, coat=0.25):
    """painted metal, worn to bare metal on the sharpest edges (Cycles pointiness)"""
    m, N, L, b = newmat(name)
    pnt = N.new('ShaderNodeNewGeometry').outputs['Pointiness']
    wear = mathn(N, L, 'MULTIPLY', ramp(N, L, pnt, [(0.0, (0, 0, 0)), (0.64, (0, 0, 0)), (0.72, (1, 1, 1)), (1.0, (1, 1, 1))]),
                 ramp(N, L, noise(N, L, objco(N), 60, 4), [(0.0, (0, 0, 0)), (0.5, (0, 0, 0)), (0.62, (1, 1, 1)), (1.0, (1, 1, 1))]))
    mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'; L.new(wear, mix.inputs['Factor'])
    mix.inputs['A'].default_value = (*lin(col), 1); mix.inputs['B'].default_value = (*lin(bare), 1)
    L.new(mix.outputs['Result'], b.inputs['Base Color'])
    L.new(wear, b.inputs['Metallic'])
    b.inputs['Roughness'].default_value = rough; b.inputs['Coat Weight'].default_value = coat
    L.new(bump(N, L, noise(N, L, objco(N), 900, 3), 0.05, 0.0003), b.inputs['Normal'])   # orange peel
    return m

def glass(name, col='#AFC0EC'):
    m, N, L, b = newmat(name)
    b.inputs['Base Color'].default_value = (*lin(col), 1); b.inputs['Roughness'].default_value = 0.02
    b.inputs['Transmission Weight'].default_value = 1.0; b.inputs['IOR'].default_value = 1.5
    return m

# the scanned sets: each one's real tile size in metres (1 ball radius is about 1.4 m), and which materials wear it
TEXDIR = os.path.join(HERE, 'tex-src')
TILE = {'Leather026': 0.3, 'Metal027': 1.0, 'Metal009': 0.5, 'Rubber004': 0.5, 'Plastic012A': 0.5}
TEXSET = {'A_quilt': 'Leather026', 'A_leather': 'Leather026', 'A_perf': 'Leather026', 'A_pipe': 'Leather026',
          'A_shell': 'Metal027', 'A_plate': 'Metal027', 'A_metal': 'Metal009', 'A_chrome': 'Metal009',
          'A_rubber': 'Rubber004', 'A_hose': 'Rubber004', 'A_dark': 'Plastic012A'}
MEAN = {}

def texmap(s, kind):
    im = bpy.data.images.load(os.path.join(TEXDIR, s, '%s_2K-JPG_%s.jpg' % (s, kind)), check_existing=True)
    if kind != 'Color': im.colorspace_settings.name = 'Non-Color'
    if (s, kind) not in MEAN:                           # its mean, linear, so the map can be divided by it
        a = np.empty(len(im.pixels), np.float32); im.pixels.foreach_get(a); a = a.reshape(-1, 4)[:, :3]
        if kind == 'Color': a = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
        MEAN[s, kind] = [float(x) for x in a.mean(0)]
    return im

def textured(m, s):
    """lay set s under m: box-projected on object coordinates; colour and roughness multiplied in, normal under the bumps"""
    N, L = m.node_tree.nodes, m.node_tree.links; b = N['Principled BSDF']
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = [1.4 / TILE[s]] * 3; L.new(objco(N), mp.inputs['Vector'])
    def img(kind):
        t = N.new('ShaderNodeTexImage'); t.image = texmap(s, kind); t.projection = 'BOX'; t.projection_blend = 0.2
        L.new(mp.outputs['Vector'], t.inputs['Vector']); return t.outputs['Color']
    def src(sock):
        return sock.links[0].from_socket if sock.links else sock.default_value
    def vmul(a, b_):
        n = N.new('ShaderNodeVectorMath'); n.operation = 'MULTIPLY'
        for i, x in enumerate((a, b_)):
            if isinstance(x, bpy.types.NodeSocket): L.new(x, n.inputs[i])
            else: n.inputs[i].default_value = x[:3]
        return n.outputs['Vector']
    cin = b.inputs['Base Color']; L.new(vmul(vmul(src(cin), img('Color')), [1 / x for x in MEAN[s, 'Color']]), cin)
    rin = b.inputs['Roughness']; r = mathn(N, L, 'MULTIPLY', img('Roughness'), 1 / MEAN[s, 'Roughness'][0])
    r = mathn(N, L, 'MULTIPLY', r, src(rin)); r.node.use_clamp = True; L.new(r, rin)
    nm = N.new('ShaderNodeNormalMap'); L.new(img('NormalGL'), nm.inputs['Color'])
    for n in [n for n in N if n.bl_idname == 'ShaderNodeBump' and not n.inputs['Normal'].links] or [b]:
        L.new(nm.outputs['Normal'], n.inputs['Normal'])

# ---------------------------------------------------------------- geometry
COLL = [None]
def put(o): COLL[0].objects.link(o); o['grp'] = GROUP[0]; return o

def from_bm(bm, m, loc=(0, 0, 0), smooth=True):
    me = bpy.data.meshes.new('m'); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    if m: me.materials.append(m)
    o = bpy.data.objects.new('o', me); o.location = loc
    return put(o)

def bevel(o, w, seg=3):
    md = o.modifiers.new('bev', 'BEVEL'); md.width = w; md.segments = seg; md.limit_method = 'ANGLE'; md.harden_normals = True
    return o

def orient(o, rot):
    if isinstance(rot, Matrix):
        o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = rot.to_quaternion()
    else:
        o.rotation_euler = Euler([D(a) for a in rot], 'XYZ')
    return o

def rbox(c, h, m, bev=0.006, rot=(0, 0, 0), seg=3):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=2)
    for v in bm.verts: v.co = Vector((v.co.x * h[0], v.co.y * h[1], v.co.z * h[2]))
    o = orient(from_bm(bm, m, c), rot)
    if bev > 0: bevel(o, min(bev, min(h) * 0.95), seg)
    return o

def pillow(c, h, m, rot=(0, 0, 0), puff=0.006, cuts=6):
    """a soft pad: a subdivided box, its top pushed into a dome, smoothed"""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=2)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        x, y, z = v.co
        dome = max(0.0, (1 - x * x) * (1 - y * y)) if z > 0.99 else 0.0
        v.co = Vector((x * h[0], y * h[1], z * h[2] + dome * puff))
    o = orient(from_bm(bm, m, c), rot)
    s = o.modifiers.new('sub', 'SUBSURF'); s.levels = s.render_levels = 2
    return o

def cyl(p0, p1, r, m, seg=32, bev=0.0015, r2=None):
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=max(d.length, 1e-5))
    o = from_bm(bm, m, (p0 + p1) / 2)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    if bev: bevel(o, bev, 2)
    return o

def tube(pts, r, m, cyclic=False, res=4):
    cu = bpy.data.curves.new('t', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = res; cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1); sp.use_cyclic_u = cyclic
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    cu.materials.append(m)
    return put(bpy.data.objects.new('t', cu))

def circle(c, axis, R, n=48):
    """points round c, in the plane normal to axis"""
    a = Vector(axis).normalized(); u = a.orthogonal().normalized(); w = a.cross(u)
    return [Vector(c) + (u * math.cos(2 * math.pi * i / n) + w * math.sin(2 * math.pi * i / n)) * R for i in range(n)]

def ringtube(c, axis, R, r, m):
    return tube(circle(c, axis, R), r, m, cyclic=True)

def bolts(pts, axis_of, r, m, h=0.003):
    for p in pts:
        a = axis_of(p) if callable(axis_of) else Vector(axis_of)
        cyl(p, Vector(p) + a.normalized() * h, r, m, seg=6, bev=0.0006)

def piston(a, b, r, body, rod, band):
    a, b = Vector(a), Vector(b); d = b - a; mid = a + d * 0.56
    cyl(a, mid, r, body); cyl(mid - d * 0.03, b, r * 0.45, rod)
    cyl(a + d * 0.42, a + d * 0.46, r * 1.12, band)
    cyl(mid - d * 0.01, mid + d * 0.015, r * 1.08, body)
    side = d.orthogonal().normalized()
    for p in (a, b): cyl(p - side * r * 0.9, p + side * r * 0.9, r * 0.75, body, seg=20)

def label(txt, loc, rot, size, m, align='CENTER'):
    cu = bpy.data.curves.new('lbl', 'FONT'); cu.body = txt; cu.size = size; cu.align_x = align; cu.align_y = 'CENTER'
    cu.extrude = 0.0002; cu.materials.append(m)
    o = put(bpy.data.objects.new('lbl', cu)); o.location = loc
    return orient(o, rot)

def ribbon(pts, nrms, w, thick, m):
    bm = bmesh.new(); prev = None
    for i, (p, n) in enumerate(zip(pts, nrms)):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        sd = t.cross(n).normalized() * (w / 2)
        row = (bm.verts.new(p - sd), bm.verts.new(p + sd))
        if prev: bm.faces.new((prev[0], prev[1], row[1], row[0]))
        prev = row
    o = from_bm(bm, m)
    s = o.modifiers.new('sol', 'SOLIDIFY'); s.thickness = thick; s.offset = 1
    return o

# ---- the seat path: one curve from the front lip, under the pilot, up the back to the head; sections across it
def catmull(ctrl, per=60):
    P = [Vector(c) for c in ctrl]; P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(per):
            t = k / per; t2 = t * t; t3 = t2 * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2]); return out

class Seat:
    """a seat surface: centre path (y, z) and, along it, a half width, a wing (how far the sides rise toward the
    pilot) and a power (how flat the bottom is). pt(s, u, out) is a point on it: s 0 front lip .. 1 head top,
    u -1 left edge .. 1 right edge, out: offset along the surface normal, + outward (away from the pilot)"""
    def __init__(self, ctrl, hw, wing, pw=3.0):
        self.p = catmull([(0, y, z) for y, z in ctrl]); self.L = [0.0]
        for a, b in zip(self.p, self.p[1:]): self.L.append(self.L[-1] + (b - a).length)
        self.hw, self.wing, self.pw = hw, wing, pw
        self.x0 = 0.0
        self.SK = self.L[3 * 60] / self.L[-1]; self.FEET = -self.SK / (1 - self.SK)
    @staticmethod
    def key(keys, s):
        if s <= keys[0][0]: return keys[0][1]
        for (s0, v0), (s1, v1) in zip(keys, keys[1:]):
            if s <= s1: f = (s - s0) / (s1 - s0); f = f * f * (3 - 2 * f); return v0 + (v1 - v0) * f
        return keys[-1][1]
    def at(self, s):
        t = min(max(self.SK + s * (1 - self.SK), 0), 1) * self.L[-1]; i = max(0, min(len(self.p) - 2, bisect.bisect_right(self.L, t) - 1))
        f = (t - self.L[i]) / max(self.L[i + 1] - self.L[i], 1e-9)
        T = (self.p[i + 1] - self.p[i]).normalized()
        return self.p[i].lerp(self.p[i + 1], f), Vector((0, T.z, -T.y)), T
    def frame(self, s, u):
        C, n, T = self.at(s); hw, wg, pw = self.key(self.hw, s), self.key(self.wing, s), self.pw
        au = abs(u); sg = 1 if u >= 0 else -1
        P = C + Vector((self.x0 + u * hw, 0, 0)) + n * (wg * au ** pw)
        dx, dh = hw, wg * pw * au ** (pw - 1)
        ln = math.hypot(dx, dh); o = Vector((sg * dh / ln, 0, 0)) - n * (dx / ln)   # outward normal of the section
        return P, o.normalized(), T
    def pt(self, s, u, out=0.0):
        P, o, _ = self.frame(s, u); return P + o * out
    def basis(self, s, u):
        """a matrix: z outward from the surface, y along the path"""
        _, o, T = self.frame(s, u); y = (T - o * T.dot(o)).normalized(); x = y.cross(o)
        return Matrix((x, y, o)).transposed()
    def loft(self, m, s0, s1, ns, u0, u1, nu, out=0.0, thick=0.012, sub=2, offset=0.0):
        bm = bmesh.new()
        rows = [[bm.verts.new(self.pt(s0 + (s1 - s0) * i / (ns - 1), u0 + (u1 - u0) * j / (nu - 1), out)) for j in range(nu)] for i in range(ns)]
        for a, b in zip(rows, rows[1:]):
            for j in range(nu - 1): bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
        o = from_bm(bm, m)
        if thick:
            so = o.modifiers.new('sol', 'SOLIDIFY'); so.thickness = thick; so.offset = offset; so.use_even_offset = False; so.use_quality_normals = True
        if sub:
            sb = o.modifiers.new('sub', 'SUBSURF'); sb.levels = sb.render_levels = sub
        return o
    def line(self, s0, s1, u, out=0.0, n=16, u1=None):
        u1 = u if u1 is None else u1
        return [self.pt(s0 + (s1 - s0) * i / (n - 1), u + (u1 - u) * i / (n - 1), out) for i in range(n)]

# laid back: the back reclines RECLINE deg about the hips (PIV), the thighs lift a little at the front. Hardware on the
# back is built upright and swung back with it (snap / recline).
PIV, RECLINE = Vector((0, -0.17, -0.55)), 22.0
def rec(y, z, a=RECLINE):
    c, s_ = math.cos(D(a)), math.sin(D(a)); dy, dz = y - PIV.y, z - PIV.z
    return (PIV.y + dy * c - dz * s_, PIV.z + dy * s_ + dz * c)
UPRIGHT = [(-0.2, -0.49), (-0.215, -0.36), (-0.22, -0.2), (-0.212, -0.04), (-0.198, 0.1), (-0.19, 0.18)]
PATH = [(0.61, -0.94), (0.5, -0.82), (0.4, -0.71), (0.32, -0.645), (0.2, -0.63), (0.06, -0.61), (-0.07, -0.6), (-0.155, -0.572)] +        [rec(y, z, RECLINE * (0.5 if i == 0 else 1)) for i, (y, z) in enumerate(UPRIGHT)]
def snap(): return set(COLL[0].objects)
def recline(before):
    R = Matrix.Translation(PIV) @ Matrix.Rotation(D(RECLINE), 4, 'X') @ Matrix.Translation(-PIV)
    for o in COLL[0].objects:
        if o not in before: o.matrix_basis = R @ o.matrix_basis   # basis: world isn't evaluated yet for new objects
def V(x, y, z): return Vector((x, *rec(y, z)))
SIDES = (-1, 1)


def cradle(X, y0, y1, ztop, w, m, edge=.022, thick=.026, n=8, nu=11):
    """an armrest pad shaped as a trough: raised edges either side of the forearm"""
    bm = bmesh.new()
    rows = [[bm.verts.new((X + (-1 + 2 * j / (nu - 1)) * w, y0 + (y1 - y0) * i / (n - 1), ztop + edge * abs(-1 + 2 * j / (nu - 1)) ** 3)) for j in range(nu)] for i in range(n)]
    for a, b in zip(rows, rows[1:]):
        for j in range(nu - 1): bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    o = from_bm(bm, m)
    so = o.modifiers.new('sol', 'SOLIDIFY'); so.thickness = thick; so.offset = 0
    sb = o.modifiers.new('sub', 'SUBSURF'); sb.levels = sb.render_levels = 2
    return o


RING_X = 0.38   # the pod is wide, so its armrests (and the hand rings over them) sit well out

def build_A():
    S = Seat(PATH,
             hw=[(-.35, .2), (-.05, .23), (0, .255), (.15, .275), (.33, .29), (.45, .29), (.6, .28), (.75, .29), (.85, .21), (.9, .17), (1, .17)],
             wing=[(-.35, .08), (-.05, .06), (0, .05), (.15, .1), (.33, .15), (.45, .13), (.6, .16), (.75, .22), (.85, .12), (.9, .13), (1, .16)], pw=3)
    shell = paint('A_shell', '#17191E', '#8A9099'); plate = paint('A_plate', '#2A2F37', '#B5BBC4', rough=0.36)
    lea = leather('A_quilt', '#141416', quilt=13); lea2 = leather('A_leather', '#1E1F24'); perf = leather('A_perf', '#18191D', perforate=110, rough=0.8)
    pipe = leather('A_pipe', '#B8305F'); glow = mat('A_glow', '#FF4F8B', 0.4, emit='#FF4F8B', es=9)
    met = mat('A_metal', '#8A8F98', 0.28, 1, aniso=0.5); chrome = mat('A_chrome', '#D4D8DE', 0.08, 1)
    dark = mat('A_dark', '#0C0D10', 0.55, grain=0.1); ink = mat('A_ink', '#E6E9EF', 0.5)
    lens = glass('A_lens'); hose = mat('A_hose', '#2A1E26', 0.6); rub = mat('A_rubber', '#16171A', 0.8, grain=0.3)
    S.loft(shell, -.02, 1, 56, -1, 1, 29, thick=0.036)
    tube(S.line(-.02, -.02, -1.0, .0, 23, u1=1.0), .022, plate)                      # the knee edge, a heavy rolled lip
    # ---- the resting surfaces ----
    def pads(s0, s1, ns):
        for sg in SIDES:
            rng = lambda a, b: (a, b) if sg > 0 else (-b, -a)
            S.loft(lea, s0, s1, ns, *rng(.1, .34), 7, out=-.038, thick=.036)            # quilted inner panel
            S.loft(perf, s0, s1, ns, *rng(.38, .6), 7, out=-.038, thick=.036)           # perforated outer panel
            S.loft(lea2, s0 - .01, s1 + .01, ns, *rng(.63, .92), 8, out=-.052, thick=.062)   # a fat bolster roll
            for u in (.36, .615): tube(S.line(s0, s1, sg * u, -.058, ns), .0038, pipe)
    pads(.03, .32, 16)                                                                 # thighs
    S.loft(plate, .02, .33, 16, -.08, .08, 5, out=-.045, thick=.05)                   # the pommel ridge between them
    tube(S.line(.03, .32, 0, -.072, 16), .0036, glow)
    S.loft(lea2, .515, .595, 7, -.8, .8, 17, out=-.066, thick=.085)                    # lumbar roll
    tube(S.line(.525, .525, -.78, -.092, 17, u1=.78), .0036, pipe)
    pads(.6, .84, 14)                                                                  # shoulder-blade panels
    S.loft(dark, .6, .84, 12, -.085, .085, 5, out=-.03, thick=.018)                   # the spine channel, lit
    tube(S.line(.61, .83, 0, -.041, 12), .0042, glow)
    for k in range(6): rbox(S.pt(.63 + k * .04, 0, -.041), (.03, .004, .004), met, .002, rot=S.basis(.63 + k * .04, 0))
    S.loft(lea, .885, .99, 8, -.32, .32, 9, out=-.05, thick=.06)                   # horseshoe headrest
    for sg in SIDES:
        S.loft(lea2, .875, .995, 8, *((.4, .82) if sg > 0 else (-.82, -.4)), 7, out=-.06, thick=.07)
        tube(S.line(.88, .99, sg * .37, -.058, 8), .0038, pipe)
    # ---- armour: plates with seams, hip guards, shoulder guards; a light under the rim ----
    for s0, s1 in ((.04, .19), (.205, .3), (.53, .665), (.68, .86)):
        for sg in SIDES:
            S.loft(plate, s0, s1, 9, *((.5, 1.04) if sg > 0 else (-1.04, -.5)), 8, out=.038, thick=.022, sub=1)
            for s in (s0 + .02, s1 - .02):
                bolts([S.pt(s, sg * .6, .05), S.pt(s, sg * .9, .05)], lambda p, s=s: S.frame(s, sg * .75)[1], .005, met)
    for sg in SIDES:
        S.loft(plate, .3, .52, 10, *((.62, 1.1) if sg > 0 else (-1.1, -.62)), 7, out=.066, thick=.044, sub=2)      # hip guards
        rbox(S.pt(.41, sg * .95, .094), (.055, .006, .004), glow, .001, rot=S.basis(.41, sg * .95))
        S.loft(plate, .72, .9, 9, *((.66, 1.12) if sg > 0 else (-1.12, -.66)), 7, out=.072, thick=.046, sub=2)     # shoulder guards
        tube(S.line(.0, .86, sg * 1.0, .026, 44), .0036, glow)
        label('A-04' if sg > 0 else 'PILOT', S.pt(.79, sg * .93, .099), S.basis(.79, sg * .93) @ Matrix.Rotation(D(90 * sg), 3, 'Z'), .03, ink)
        for s in (.75, .87): bolts([S.pt(s, sg * .82, .098)], S.frame(s, sg * .82)[1], .0065, chrome)
        cyl(S.pt(.94, sg * .6, -.024), S.pt(.94, sg * .6, -.038), .024, dark, seg=40)
        for k in range(7): cyl(S.pt(.94, sg * .6, -.037) + Vector(((k - 3) * .0065, 0, 0)), S.pt(.94, sg * .6, -.04) + Vector(((k - 3) * .0065, 0, 0)), .002, met, seg=8)
    GROUP[0] = 'frame'
    # ---- the split legs: a cradle for each, on its own knee hinge and strut ----
    for sg in SIDES:
        P = Seat(PATH, hw=[(-.5, .085), (0, .1)], wing=[(-.5, .095), (0, .075)], pw=2.5); P.x0 = sg * .135
        P.loft(shell, P.FEET, -.045, 16, -1, 1, 15, thick=.032)
        for s in (P.FEET + .06, P.FEET + .14, P.FEET + .22):
            pillow(P.pt(s, 0, -.044), (.066, .034, .018), lea, rot=P.basis(s, 0), puff=.013)
        for u in (-.82, .82): tube(P.line(P.FEET + .03, -.06, u, -.045, 12), .0036, pipe)
        P.loft(plate, P.FEET + .02, -.06, 10, *((.45, 1.06) if sg > 0 else (-1.06, -.45)), 7, out=.034, thick=.022, sub=1)
        tube(P.line(P.FEET + .01, -.05, sg * 1.0, .024, 14), .0034, glow)
        # the foot pedal: an axle across the cradle's end, a ribbed footplate facing the sole, heel cup, toe bar, return strut
        _, o, T = P.frame(P.FEET, 0); xa = Vector((1, 0, 0)); up = -o
        axle = P.pt(P.FEET, 0, -.03) - T * .012
        cyl(axle - xa * .1, axle + xa * .1, .015, chrome, seg=32)
        for e in (-1, 1): cyl(axle + xa * e * .085, axle + xa * e * .1, .026, plate, seg=32)
        R = Matrix.Rotation(D(14 if sg < 0 else 4), 3, xa)                    # the left pedal is pressed in a little
        M = R @ Matrix((xa, T, up)).transposed()
        at = lambda lx, ly, lz: axle + R @ (xa * lx + T * ly + up * lz)
        rbox(at(0, .01, .12), (.072, .008, .115), plate, .006, rot=M)                                   # footplate
        for i in range(7): rbox(at(0, .02, .04 + i * .024), (.06, .003, .004), rub, .0015, rot=M)      # grip ribs
        rbox(at(0, .035, .015), (.07, .028, .012), plate, .008, rot=M)                                 # heel cup
        for e in (-1, 1): rbox(at(e * .068, .03, .025), (.006, .025, .03), plate, .004, rot=M)
        cyl(at(-.07, .045, .2), at(.07, .045, .2), .009, chrome, seg=24)                             # toe bar on two posts
        for e in (-1, 1): cyl(at(e * .066, .012, .2), at(e * .066, .045, .2), .006, met, seg=16)
        rbox(at(0, .002, .235), (.06, .003, .003), glow, .001, rot=M)
        piston(P.pt(P.FEET + .09, 0, .045), at(0, -.012, .09), .009, dark, chrome, met)              # return strut
        k = P.pt(-.035, 0, .055)
        cyl(k - Vector((.118, 0, 0)), k + Vector((.118, 0, 0)), .038, plate, seg=48, bev=.004)
        cyl(k - Vector((.132, 0, 0)), k + Vector((.132, 0, 0)), .022, chrome, seg=32)
    GROUP[0] = 'rail'
    # ---- armrests: solid side pods grown out of the shell's flanks, down to its underside; the forearm in a cradle on top ----
    for sg in SIDES:
        X = sg * RING_X
        xi = sg * .285                                                                  # the inner face, against the shell wall
        cx, hx = (xi + X + sg * .07) / 2, abs(X + sg * .07 - xi) / 2
        rbox((cx, .14, -.555), (hx, .29, .1), shell, .022)                              # the pod, floor of the armrest to the shell's belly
        rbox((cx, .41, -.6), (hx * .9, .06, .07), shell, .02, rot=(-35, 0, 0))          # its nose, raked back under the knee
        rbox((cx, -.14, -.6), (hx * .92, .05, .07), shell, .02, rot=(30, 0, 0))         # its tail, swept into the hip
        rbox((cx, .14, -.66), (hx * .95, .26, .012), dark, .006)                        # a dark belly seam
        for (y0, y1, m) in ((-.11, -.005, lea), (.005, .115, perf), (.125, .235, lea)):
            cradle(X, y0, y1, -.445, .052, m)
        for y in (-.008, .12): rbox((X, y, -.45), (.054, .004, .006), pipe, .002)
        pillow((X, -.145, -.438), (.054, .022, .024), lea2, puff=.012)                  # elbow cup
        rbox((X, .27, -.452), (.048, .028, .009), plate, .006)                         # wrist plate, ribbed
        for i in range(5): rbox((X, .252 + i * .009, -.442), (.04, .0022, .0018), chrome, .0008)
        rbox((X, .43, -.47), (.068, .036, .03), plate, .014)                            # the ring's mount, lit
        rbox((X, .467, -.468), (.048, .002, .004), glow, .001)
        ox = X + sg * .072                                                              # the outer face: armour, vents, bolts
        for (yy, hh) in ((-.02, .12), (.25, .12)):
            rbox((ox, yy, -.53), (.01, hh, .055), plate, .008)
            bolts([Vector((ox + sg * .01, yy + dy, z)) for dy in (-hh + .016, hh - .016) for z in (-.57, -.49)], (sg, 0, 0), .005, met)
        rbox((ox + sg * .002, .115, -.53), (.004, .012, .05), dark, .002)
        for i in range(9): rbox((ox + sg * .003, .03 + i * .02, -.6), (.004, .006, .018), met, .0015)
        rbox((ox + sg * .011, .115, -.47), (.002, .26, .003), glow, .001)
        label('HANDS CLEAR', (ox + sg * .0205, -.02, -.53), (90, 0, 90 * sg), .014, ink)
        label('A-04' if sg > 0 else 'PILOT', (ox + sg * .0205, .25, -.53), (90, 0, 90 * sg), .02, ink)
    GROUP[0] = 'seat'
    # ---- the crown over the head ----
    mk = snap()
    arcp = lambda a, z, R=.19: Vector((R * math.cos(D(a)), -.035 + R * math.sin(D(a)), z))
    tube([arcp(a, .18, .19) for a in range(212, 329, 4)], .025, shell)
    tube([arcp(a, .155, .19) for a in range(214, 327, 4)], .005, glow)
    tube([arcp(a, .208, .19) for a in range(220, 321, 4)], .007, met)
    for a in (240, 270, 300): rbox((arcp(a, .14, .19).x, arcp(a, .14, .19).y - .005, .13), (.018, .018, .05), met, .004, rot=(0, 0, a))
    for a in (212, 328):
        p = arcp(a, .18, .19); dvec = Vector((math.cos(D(a)), math.sin(D(a)), 0))
        cyl(p, p + dvec * .035, .03, plate, seg=36); q = p + dvec * .035
        cyl(q, q + dvec * .005, .02, lens, seg=36); ringtube(q, dvec, .024, .003, glow)
    recline(mk)


# ---------------------------------------------------------------- build, bake, export
COLL[0] = bpy.data.collections.new('Seat'); scene.collection.children.link(COLL[0])
build_A()
for m in bpy.data.materials:
    if m.name in TEXSET: textured(m, TEXSET[m.name])
EYE = Vector((0, *rec(0, 0)))                     # the reclined pilot's eye: the site's seat frame has it at the origin
RING = Vector((RING_X, 0.36, -0.39))              # the right hand ring's centre
site = lambda v: [round(v.x, 5), round(v.z - EYE.z, 5), round(v.y - EYE.y, 5)]
three = lambda p: [p[0], p[1], -p[2]]             # the seat frame to Three's axes (-z forward), as the glb has them
if LOOK:
    raise SystemExit

for o in COLL[0].objects:
    for md in o.modifiers:
        if md.type == 'SUBSURF': md.levels = min(md.levels, SUB)
    if o.type == 'CURVE':                      # the piping and light lines are thin: a few sides and steps will do
        o.data.resolution_u = 4; o.data.bevel_resolution = 1
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
src = [o for o in COLL[0].objects if o.type in ('MESH', 'CURVE', 'FONT')]
work = bpy.data.collections.new('export'); scene.collection.children.link(work)
copies = []
for o in src:
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
    if not me.polygons: continue
    me.transform(o.matrix_world)
    c = bpy.data.objects.new(o.name + '_x', me); work.objects.link(c)
    c['grp'] = o.get('grp', 'seat'); c['mat'] = o.active_material.name
    copies.append(c)
for o in src: o.hide_render = True

if not scene.world: scene.world = bpy.data.worlds.new('w')
scene.render.engine = 'CYCLES'

def gpu():
    """bake on the GPU (OptiX, else CUDA); --factory-startup resets the preferences, so it's set here"""
    p = bpy.context.preferences.addons['cycles'].preferences
    for t in ('OPTIX', 'CUDA'):
        try: p.compute_device_type = t
        except TypeError: continue
        p.get_devices()
        if any(d.type == t for d in p.devices):
            for d in p.devices: d.use = d.type == t
            scene.cycles.device = 'GPU'; return t
    return 'CPU'
print('seat: baking on', gpu())
scene.world.light_settings.distance = 0.06        # the contact shading's reach (the atlas's AO bake)
# the seat's own lights: what the pink strips throw on what's near them. The world goes dark and the only light is
# the emissive parts' (Cycles lights with emissive surfaces), baked as received light into seat-light.jpg below.
wn = scene.world.node_tree.nodes.get('Background') if scene.world.node_tree else None
if wn: wn.inputs['Strength'].default_value = 0.0
GLOW_MAX = 1.5      # received light stored up to this

# the tests' sample points: about 30 vertices per (material, group), in the seat frame
merged, points = {}, {}
for c in copies: merged.setdefault((c['mat'], c['grp']), []).extend(site(v.co) for v in c.data.vertices)
for (mt, g), P in merged.items(): points.setdefault(g, []).extend(P[::max(1, len(P) // 30)])

# ---------------------------------------------------------------- the glb: a mesh per group, one atlas, Cycles bakes
ATLAS = int(sys.argv[sys.argv.index('--atlas') + 1]) if '--atlas' in sys.argv else 4096
GLB = os.path.join(HERE, '..', 'assets', 'seat.glb'); LIGHT = os.path.join(HERE, '..', 'assets', 'seat-light.jpg')
os.makedirs(os.path.dirname(GLB), exist_ok=True)
T0 = time.time()

def select(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

pods = []                                         # one object per group (its node's extras.grp), a primitive per material
groups = {}
for c in copies: groups.setdefault(c['grp'], []).append(c)
for g, grp in sorted(groups.items()):
    select(grp); bpy.ops.object.join()
    o = grp[0]; o.name = 'seat_' + g; del o['mat']
    o.data.transform(Matrix.Translation(-EYE))    # the eye to the origin: glTF's +Y up then gives the seat's Three axes
    md = o.modifiers.new('tri', 'TRIANGULATE'); md.keep_custom_normals = True   # ngons get no tangents in the export
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='tri')
    pods.append(o)
select(pods)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=D(66), island_margin=0.0)
bpy.ops.uv.pack_islands(margin_method='FRACTION', margin=4 / 4096, rotate=True)
bpy.ops.object.mode_set(mode='OBJECT')
print('seat: atlas UV %.0f s' % (time.time() - T0))

def image(name, srgb=True, flt=False):
    im = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False, float_buffer=flt)
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'; return im

mats = {m for o in pods for m in o.data.materials}
for m in mats:
    t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.name = 'bake'; m.node_tree.nodes.active = t

def bake(im, kind, samples, **kw):
    for m in mats: m.node_tree.nodes['bake'].image = im
    scene.cycles.samples = samples; t0 = time.time()
    bpy.ops.object.bake(type=kind, target='IMAGE_TEXTURES', **kw)
    print('seat: bake %s %s, %d px, %d samples: %.0f s' % (kind, im.name, ATLAS, samples, time.time() - t0))
    a = np.empty(ATLAS * ATLAS * 4, np.float32); im.pixels.foreach_get(a); return a.reshape(-1, 4)

col, nrm, tmp = image('seat_color'), image('seat_normal', False), image('bake_tmp', False, True)
bake(nrm, 'NORMAL', 16, normal_space='TANGENT')
rough = bake(tmp, 'ROUGHNESS', 16)[:, 0].copy()
ao = bake(tmp, 'AO', 48)[:, 0].copy()             # today's contact shading: 48 samples, distance 0.06 (set above)
for m in mats:                                    # metallic, through an Emit bake of its value
    N, L = m.node_tree.nodes, m.node_tree.links; b = N['Principled BSDF']; e = N.new('ShaderNodeEmission'); e.name = 'metal'
    mi = b.inputs['Metallic']
    if mi.links: L.new(mi.links[0].from_socket, e.inputs['Color'])
    else: e.inputs['Color'].default_value = (mi.default_value,) * 3 + (1,)
    L.new(e.outputs[0], N['Material Output'].inputs['Surface'])
metal = bake(tmp, 'EMIT', 16)[:, 0].copy()
for m in mats:                                    # back to the BSDF, with no metal or glass, so the diffuse bakes see
    N, L = m.node_tree.nodes, m.node_tree.links; b = N['Principled BSDF']   # every part's colour and the light it gets
    L.new(b.outputs[0], N['Material Output'].inputs['Surface'])
    for k in ('Metallic', 'Transmission Weight'):
        for l in list(b.inputs[k].links): L.remove(l)
        b.inputs[k].default_value = 0.0
bake(col, 'DIFFUSE', 16, pass_filter={'COLOR'})
light = bake(tmp, 'DIFFUSE', 96, pass_filter={'DIRECT', 'INDIRECT'})   # the world is dark: the strips' light only
one = np.ones((ATLAS * ATLAS, 1), np.float32)
orm = image('seat_orm', False); orm.pixels.foreach_set(np.concatenate([ao[:, None], rough[:, None], metal[:, None], one], 1).ravel())
li = image('seat_light', False); li.pixels.foreach_set(np.concatenate([np.clip(light[:, :3] / GLOW_MAX, 0, 1), one], 1).ravel())
li.filepath_raw = LIGHT; li.file_format = 'JPEG'; li.save(quality=92)   # linear (Non-Color), as the vertex glow was

# the export materials: the atlas through a Principled BSDF, occlusion through glTF's own output node
gout = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
gout.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
for m in mats:
    N, L = m.node_tree.nodes, m.node_tree.links; N.clear()
    b = N.new('ShaderNodeBsdfPrincipled'); L.new(b.outputs[0], N.new('ShaderNodeOutputMaterial').inputs['Surface'])
    if m.name in ('A_glow', 'A_lens'):            # the lights stay plain and emissive, in their own colours
        c, rough_, es = ('#FF4F8B', 0.4, 9.0) if m.name == 'A_glow' else ('#AFC0EC', 0.02, 0.17)
        b.inputs['Base Color'].default_value = b.inputs['Emission Color'].default_value = (*lin(c), 1)
        b.inputs['Roughness'].default_value = rough_; b.inputs['Emission Strength'].default_value = es
        continue
    def tex(im):
        t = N.new('ShaderNodeTexImage'); t.image = im; return t.outputs['Color']
    L.new(tex(col), b.inputs['Base Color'])
    nm = N.new('ShaderNodeNormalMap'); L.new(tex(nrm), nm.inputs['Color']); L.new(nm.outputs['Normal'], b.inputs['Normal'])
    sp = N.new('ShaderNodeSeparateColor'); L.new(tex(orm), sp.inputs['Color'])
    L.new(sp.outputs['Green'], b.inputs['Roughness']); L.new(sp.outputs['Blue'], b.inputs['Metallic'])
    go = N.new('ShaderNodeGroup'); go.node_tree = gout; L.new(sp.outputs['Red'], go.inputs['Occlusion'])
    b.inputs['Coat Weight'].default_value = 0.6 if m.name in ('A_shell', 'A_plate') else 0.0
    if m.name in ('A_quilt', 'A_leather', 'A_perf'):   # sheen 0.3: glTF takes the tint as the sheen, the weight as on/off
        b.inputs['Sheen Weight'].default_value = 1.0; b.inputs['Sheen Tint'].default_value = (0.3, 0.3, 0.3, 1)

scene['glowMax'] = GLOW_MAX; scene['ring'] = three(site(RING))   # the scene's extras, in Three's axes
scene['points'] = {g: [three(p) for p in pts] for g, pts in points.items()}
select(pods)
bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', export_tangents=True, export_extras=True,
                          export_image_format='JPEG', export_jpeg_quality=92, use_selection=True)
print('seat: %d px atlas, %.1f MB -> %s; lightmap %.1f MB; %.0f s' % (ATLAS, os.path.getsize(GLB) / 1e6, os.path.normpath(GLB),
      os.path.getsize(LIGHT) / 1e6, time.time() - T0))
