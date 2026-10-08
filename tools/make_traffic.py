"""site5 traffic: build the four generic aircraft (no real makes or liveries) and export them to site5/js/traffic-data.js.

Run:  blender -b --factory-startup -P site5/tools/make_traffic.py [-- --render DIR]   (DIR: a turntable check)

Modelled in metres in Blender's frame (x right, y forward = the nose, z up), centred on the middle of each; the
export turns them to km and the site's frame (x right, y up, z forward). Contact shading is baked into each vertex.
  AIRLINER   twin-engine wide-body: low wing swept 30 deg, engines under it, conventional tail; span 60 m
  FREIGHTER  four engines under a high wing, a T-tail, the rear upswept; span 68 m
  BIZJET     small: low wing, two engines on the rear fuselage, a T-tail; span 20 m
  BALLOON    a weather balloon: the envelope, a 30 m line, a payload box under a folded parachute
lights: where the navigation lights sit (red on the left wingtip, green on the right, white on the tail, the red
beacon on top), for the site's sprites. A self-check runs before writing.
"""
import bpy, bmesh, math, sys, os, json, base64, struct
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'js', 'traffic-data.js')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = ARGS[ARGS.index('--render') + 1] if '--render' in ARGS else None
scene = bpy.context.scene
for o in list(bpy.data.objects): bpy.data.objects.remove(o)

MATS = {'T_body': (0.62, 0.64, 0.66), 'T_belly': (0.36, 0.37, 0.39), 'T_engine': (0.14, 0.15, 0.16),
        'T_glass': (0.02, 0.02, 0.025), 'T_envelope': (0.78, 0.76, 0.70), 'T_payload': (0.85, 0.86, 0.88)}
for k, c in MATS.items():
    m = bpy.data.materials.new(k); m.diffuse_color = (*c, 1)
    try: m.use_nodes = True
    except Exception: pass
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*c, 1)

COLL = [None]
def put(bm, mat, name, smooth=True, bevel=0.0):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    me.materials.append(bpy.data.materials[mat])
    o = bpy.data.objects.new(name, me); COLL[0].objects.link(o)
    if bevel:
        md = o.modifiers.new('bev', 'BEVEL'); md.width = bevel; md.segments = 2; md.limit_method = 'ANGLE'; md.harden_normals = True
    return o

def tube(p0, p1, r0, r1, mat, seg=16):
    """a cylinder or cone from p0 to p1"""
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=d.length)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((p0 + p1) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4(), verts=bm.verts)
    return put(bm, mat, 'tube')

def slab(le0, te0, le1, te1, t0, t1, n, mat):
    """a tapered surface (wing, fin, tailplane): root leading/trailing edge, tip leading/trailing edge, thickness at
    root and tip, n the thickness direction"""
    n = Vector(n).normalized(); bm = bmesh.new()
    P = [Vector(le0), Vector(te0), Vector(te1), Vector(le1)]; T = [t0, t0 * 0.4, t1 * 0.4, t1]   # thinner at the trailing edge
    top = [bm.verts.new(p + n * t / 2) for p, t in zip(P, T)]; bot = [bm.verts.new(p - n * t / 2) for p, t in zip(P, T)]
    bm.faces.new(top); bm.faces.new(bot[::-1])
    for i in range(4): bm.faces.new((top[i], bot[i], bot[(i + 1) % 4], top[(i + 1) % 4]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return put(bm, mat, 'slab', smooth=False, bevel=0.0)

def sphere(c, r, mat, sz=1.0):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=r)
    for v in bm.verts: v.co = Vector((v.co.x, v.co.y, v.co.z * sz)) + Vector(c)
    return put(bm, mat, 'sphere')

def box(c, h, mat):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=2)
    for v in bm.verts: v.co = Vector((v.co.x * h[0], v.co.y * h[1], v.co.z * h[2])) + Vector(c)
    return put(bm, mat, 'box', smooth=False, bevel=min(h) * 0.3)

def fuselage(L, r, nose, tail, mat='T_body', tail_up=0.0):
    """a body along y: a nose cone, the barrel, a tail cone (raised by tail_up at its end)"""
    y0, y1 = -L / 2, L / 2
    tube((0, y1 - nose, 0), (0, y1, 0), r, r * 0.12, mat)
    tube((0, y0 + tail, 0), (0, y1 - nose, 0), r, r, mat, seg=20)
    tube((0, y0 + tail, 0), (0, y0, tail_up), r, r * 0.18, mat)
    tube((0, y1 - nose * 0.55, r * 0.35), (0, y1 - nose * 0.2, r * 0.25), r * 0.45, r * 0.3, 'T_glass', seg=12)   # the cockpit glazing
    return y0, y1

def wings(y_root, chord_r, chord_t, span, sweep, z, dihedral, mat='T_body'):
    """a pair of swept, tapered wings; returns the two tips' leading points (left, right)"""
    tips = []
    for sg in (-1, 1):
        tx, ty, tz = sg * span / 2, y_root - math.tan(math.radians(sweep)) * span / 2, z + math.tan(math.radians(dihedral)) * span / 2
        slab((0, y_root, z), (0, y_root - chord_r, z), (tx, ty, tz), (tx, ty - chord_t, tz), chord_r * 0.12, chord_t * 0.1, (0, 0, 1), mat)
        tips.append(Vector((tx, ty - chord_t * 0.5, tz)))
    return tips

def engine(c, r, L, mat='T_engine'):
    c = Vector(c)
    tube(c + Vector((0, -L / 2, 0)), c + Vector((0, L / 2, 0)), r * 0.85, r, mat)
    tube(c + Vector((0, L / 2, 0)), c + Vector((0, L / 2 + 0.05, 0)), r * 0.95, r * 0.95, 'T_glass')   # the intake, dark

def airliner():
    y0, y1 = fuselage(60, 3.0, 7, 12)
    tips = wings(4, 9, 2.6, 60, 30, -1.4, 6)
    for sg in (-1, 1):
        engine((sg * 10, 2.5, -3.6), 1.7, 6)
        slab((sg * 10, 4, -2.0), (sg * 10, 0.5, -2.0), (sg * 10, 4.5, -2.8), (sg * 10, 1, -2.8), 0.4, 0.4, (1, 0, 0), 'T_engine')   # pylon
    slab((0, y0 + 10, 2.6), (0, y0 + 2, 2.6), (0, y0 + 5, 12), (0, y0 + 1, 12), 0.5, 0.25, (1, 0, 0), 'T_body')          # fin
    for sg in (-1, 1): slab((0, y0 + 7, 0.6), (0, y0 + 2, 0.6), (sg * 10, y0 + 3, 1.4), (sg * 10, y0 + 1, 1.4), 0.4, 0.2, (0, 0, 1), 'T_body')
    box((0, 2, -2.6), (2.2, 9, 0.6), 'T_belly')
    return {'red': tips[0], 'green': tips[1], 'white': Vector((0, y0 - 0.3, 0.5)), 'beacon': Vector((0, 4, 3.1))}

def freighter():
    y0, y1 = fuselage(55, 3.2, 6, 13, tail_up=2.2)
    tips = wings(6, 8, 3, 68, 22, 3.0, -2)
    for sg in (-1, 1):
        for x in (11, 20):
            engine((sg * x, 6 - math.tan(math.radians(22)) * x + 1.5, 1.4), 1.3, 5)
            slab((sg * x, 6 - math.tan(math.radians(22)) * x + 2, 2.9), (sg * x, 6 - math.tan(math.radians(22)) * x - 1, 2.9),
                 (sg * x, 6 - math.tan(math.radians(22)) * x + 2.2, 2.0), (sg * x, 6 - math.tan(math.radians(22)) * x - 0.6, 2.0), 0.35, 0.35, (1, 0, 0), 'T_engine')
    slab((0, y0 + 11, 3.0), (0, y0 + 3, 4.0), (0, y0 + 6, 13), (0, y0 + 2, 13), 0.5, 0.3, (1, 0, 0), 'T_body')           # fin
    for sg in (-1, 1): slab((0, y0 + 6, 13), (0, y0 + 1.5, 13), (sg * 9, y0 + 3, 13.2), (sg * 9, y0 + 1, 13.2), 0.35, 0.2, (0, 0, 1), 'T_body')   # T-tail
    box((0, 6, -2.8), (2.5, 7, 0.5), 'T_belly')
    return {'red': tips[0], 'green': tips[1], 'white': Vector((0, y0 + 1.2, 13.5)), 'beacon': Vector((0, 6, 3.6))}

def bizjet():
    y0, y1 = fuselage(20, 1.1, 3.2, 5)
    tips = wings(1.5, 3.2, 1.0, 20, 25, -0.5, 4)
    for sg in (-1, 1):
        engine((sg * 1.9, y0 + 5.5, 0.7), 0.6, 3)
        slab((sg * 0.9, y0 + 6.2, 0.5), (sg * 0.9, y0 + 5, 0.5), (sg * 1.5, y0 + 6, 0.65), (sg * 1.5, y0 + 5, 0.65), 0.25, 0.25, (0, 0, 1), 'T_engine')
    slab((0, y0 + 4, 1.0), (0, y0 + 1, 1.0), (0, y0 + 2.2, 4.0), (0, y0 + 0.6, 4.0), 0.25, 0.15, (1, 0, 0), 'T_body')     # fin
    for sg in (-1, 1): slab((0, y0 + 2.2, 4.0), (0, y0 + 0.6, 4.0), (sg * 3.2, y0 + 1.2, 4.1), (sg * 3.2, y0 + 0.4, 4.1), 0.2, 0.12, (0, 0, 1), 'T_body')
    return {'red': tips[0], 'green': tips[1], 'white': Vector((0, y0 + 0.4, 4.2)), 'beacon': Vector((0, 0, 1.2))}

def balloon():
    sphere((0, 0, 15), 2.0, 'T_envelope', sz=1.15)
    tube((0, 0, 12.8), (0, 0, -15), 0.03, 0.03, 'T_engine', seg=6)                   # the line
    tube((0, 0, -11), (0, 0, -12.5), 0.6, 0.08, 'T_envelope', seg=10)               # the folded parachute
    box((0, 0, -15.3), (0.2, 0.2, 0.25), 'T_payload')
    return {}

MODELS = {'AIRLINER': (airliner, 60), 'FREIGHTER': (freighter, 68), 'BIZJET': (bizjet, 20), 'BALLOON': (balloon, 4)}
built = {}
for i, (name, (fn, span)) in enumerate(MODELS.items()):
    COLL[0] = bpy.data.collections.new(name); scene.collection.children.link(COLL[0])
    built[name] = (COLL[0], fn(), span)

# ---- bake: contact shading per vertex, every model at once (spread apart so they don't shade each other)
bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
copies = {}
for k, (name, (coll, lights, span)) in enumerate(built.items()):
    off = Vector((k * 200, 0, 0)); copies[name] = []
    for o in coll.objects:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg); me.transform(Matrix.Translation(off) @ o.matrix_world)
        c = bpy.data.objects.new(o.name + '_x', me); scene.collection.objects.link(c); c['off'] = k * 200.0
        me.color_attributes.new('ao', 'FLOAT_COLOR', 'POINT'); me.color_attributes.active_color = me.color_attributes['ao']
        copies[name].append(c)
    for o in coll.objects: o.hide_render = True
if not scene.world: scene.world = bpy.data.worlds.new('w')
scene.render.engine = 'CYCLES'; scene.cycles.samples = 48; scene.world.light_settings.distance = 4.0
bpy.ops.object.select_all(action='DESELECT')
allc = [c for cs in copies.values() for c in cs]
for c in allc: c.select_set(True)
bpy.context.view_layer.objects.active = allc[0]
bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')

# ---- pack: km, the site's frame, indexed, int16 positions
KM, Q = 0.001, 0.04 / 32767
def b64(fmt, vals): return base64.b64encode(struct.pack('<%d%s' % (len(vals), fmt), *vals)).decode()
site = lambda v: [round(v.x * KM, 6), round(v.z * KM, 6), round(v.y * KM, 6)]
out, report = {}, []
for name, cs in copies.items():
    merged = {}
    for c in cs:
        me = c.data; me.calc_loop_triangles(); ao = me.color_attributes['ao'].data; norms = me.corner_normals; off = c['off']
        P, N, A, I, seen = merged.setdefault(c.active_material.name, ([], [], [], [], {}))
        base = len(A)
        for tri in me.loop_triangles:
            for li, vi in zip(tri.loops, tri.vertices):
                n = norms[li].vector; nq = (round(n.x * 127), round(n.z * 127), round(n.y * 127)); key = (base, vi, nq)
                if key not in seen:
                    v = me.vertices[vi].co; seen[key] = len(A)
                    P += [round((v.x - off) * KM / Q), round(v.z * KM / Q), round(v.y * KM / Q)]; N += nq
                    A.append(round(max(0.0, min(1.0, ao[vi].color[0])) * 255))
                I.append(seen[key])
    parts = [{'mat': mt, 'pos': b64('h', P), 'nrm': b64('b', N), 'ao': b64('B', A), 'idx': b64('H', I), 'idx32': False,
              'verts': len(A), 'count': len(I)} for mt, (P, N, A, I, _) in merged.items()]
    tris = sum(p['count'] for p in parts) // 3
    xs = [v.co.x for c in cs for v in c.data.vertices]
    span_m = (max(xs) - min(xs)) if name != 'BALLOON' else 2 * 2.0
    lights = built[name][1]
    out[name] = {'span': MODELS[name][1] * KM, 'parts': parts, 'lights': {k: site(v) for k, v in lights.items()}}
    report.append((name, tris, span_m, sorted(lights)))

# ---- self-check
for name, tris, span_m, lights in report:
    assert 500 <= tris <= 6000, (name, tris)
    assert abs(span_m - MODELS[name][1]) <= 0.1 * MODELS[name][1], (name, span_m)
    if name != 'BALLOON': assert lights == ['beacon', 'green', 'red', 'white'], (name, lights)
text = ('/* generated by site5/tools/make_traffic.py: four generic aircraft, in km, x right, y up, z forward (the nose),\n'
        '   centred. Per model its span, its parts by material (indexed, base64: positions int16 times q, normals int8,\n'
        '   contact shading u8, indices u16) and where its navigation lights sit. */\n'
        'window.SITE5_TRAFFIC = ' + json.dumps({'q': Q, 'models': out}, separators=(',', ':')) + ';\n')
assert len(text) < 800000, len(text)
with open(OUT, 'w', encoding='utf-8') as f: f.write(text)
print('traffic: %d models, %d triangles, %.2f MB -> %s' % (len(out), sum(r[1] for r in report), len(text) / 1e6, os.path.normpath(OUT)))
for r in report: print('  %-10s %5d tris, span %.1f m' % r[:3])

if RENDER:   # a turntable check: the four side by side, from front-left above and from below
    for o in allc: o.hide_render = False
    for name, cs in copies.items():
        for c in cs:
            for mm in c.data.materials: pass
    lamp = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); lamp.data.energy = 4; scene.collection.objects.link(lamp)
    lamp.rotation_euler = (0.8, 0.2, 0.6)
    scene.world.use_nodes = True; scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 1600, 600; scene.cycles.samples = 32
    for tag, loc in (('above', (300, -620, 300)), ('below', (300, -620, -240))):
        cam.location = loc; cam.data.lens = 24
        cam.rotation_mode = 'QUATERNION'; cam.rotation_quaternion = (Vector((300, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y')
        scene.render.filepath = os.path.join(RENDER, 'traffic_%s.png' % tag); bpy.ops.render.render(write_still=True)
