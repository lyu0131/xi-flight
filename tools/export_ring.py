"""site5 hand ring: export the detailed model in tools/hand_ring.blend (built in the live Blender, after the owner's
references) to site5/js/ring-data.js for seat.js. The pages open from file://, so the model ships as a script.

Run:  blender -b site5/tools/hand_ring.blend -P site5/tools/export_ring.py

The .blend is the source: Blender's frame, z up, the pilot at -y looking +y, metres, the origin at the ring's centre.
Its rig: yaw > pitch (the outer track) > roll (the inner ring and the L handbar) > hingeE (the ring's upper half);
pitch > hingeT (the track's upper half); the clamshell halves open about the hinge. Every part is written in its
rest place, tagged with the group that says what moves it:
  track, trackhatch, ring, hatch     the rig's four frames
  label                              stencils and lettering (ring frame; the mirrored left hand skips them)
  trigger, paddle, dial, toggle, cover   controls that turn about a pivot (`pivots`)
  key0-3, thumb, armbtn              controls that press in
  rollP_a, rollP_b, hingeP_a, ...    pistons: _a rides mount a and aims at mount b, _b the other way (`pistons`)
  boost, wheel, rocker, gauge0-4     the left hand's own controls (twist: the grip, turning on its axis)
The site mirrors the model for the left hand. Parts tagged `side` R (the targeting controls, the R lettering) are the
right hand's only, `side` L (collection HandRing_left: the thrust controls, lettering authored mirrored) the left's;
`lgroup` names a part's group on the left hand where it differs (the twist grip).
Contact shading is baked into each vertex at rest, with the clamshell shut and the ARM cover down.
"""
import bpy, os, base64, struct, json
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'js', 'ring-data.js')
O = bpy.data.objects
scene = bpy.context.scene

# the rest pose
for n in ('yaw', 'pitch', 'roll', 'hingeE', 'hingeT', 'cover_hinge'):
    O[n].rotation_euler = (0, 0, 0)
bpy.context.view_layer.update()

FRAMES = {'pitch': 'track', 'hingeT': 'trackhatch', 'roll': 'ring', 'hingeE': 'hatch'}
def frame_of(o):
    p = o.parent
    while p.name not in FRAMES:
        p = p.parent
    return FRAMES[p.name]

CONTROL = {'trigger': 'trigger', 'trigger_tip': 'trigger', 'pinky_paddle': 'paddle', 'thumb_dome': 'thumb',
           'toggle_bat': 'toggle', 'guard_cover': 'cover', 'guard_btn': 'armbtn',
           'boost_lever': 'boost', 'boost_tip': 'boost', 'wheel': 'wheel', 'wheel_notch': 'wheel', 'rocker': 'rocker', 'rocker_mark': 'rocker'}
for i, sfx in enumerate(('', '.001', '.002', '.003')):
    CONTROL['key' + sfx] = CONTROL['key_glow' + sfx] = 'key%d' % i

def group_of(o):
    if o.name in CONTROL:
        return CONTROL[o.name]
    if o.name.startswith('dial') and not o.name.startswith('dial_tick'):
        return 'dial'
    if o.name.startswith('wheel_rib'):
        return 'wheel'
    if o.name.startswith('gauge') and o.name != 'gauge_bezel':
        return o.name
    if o.type == 'FONT':
        return 'label'
    if any(c.type == 'DAMPED_TRACK' for c in o.constraints):
        return o.name.split('_')[0] + ('_a' if o.parent.name.endswith('mountA') else '_b')
    return frame_of(o)

src = [o for c in ('HandRing', 'HandRing_detail', 'HandRing_left') for o in bpy.data.collections[c].all_objects
       if (not o.hide_render or o.get('side') == 'L') and o.type in ('MESH', 'CURVE', 'FONT')]   # the left's parts hide in the .blend's renders
for o in src:   # the Bolt Factory screws come in at ~3k triangles each: a few hundred is plenty at this size
    if 'screw' in o.name:
        d = o.modifiers.new('lod', 'DECIMATE'); d.ratio = 0.12
bpy.context.view_layer.update()

# bake-ready copies: each part as a plain mesh in its rest place (modifiers, curves and text all made mesh)
dg = bpy.context.evaluated_depsgraph_get()
work = bpy.data.collections.new('export'); scene.collection.children.link(work)
copies = []
for o in src:
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
    me.transform(o.matrix_world)
    c = bpy.data.objects.new(o.name + '_x', me); work.objects.link(c)
    c['group'] = group_of(o); c['mat'] = o.active_material.name; c['side'] = o.get('side', ''); c['lgroup'] = o.get('lgroup', '')
    me.color_attributes.new('ao', 'FLOAT_COLOR', 'POINT'); me.color_attributes.active_color = me.color_attributes['ao']
    copies.append(c)
for o in src:
    o.hide_render = True

scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 64
scene.world.light_settings.distance = 0.025
bpy.ops.object.select_all(action='DESELECT')
for c in copies:
    c.select_set(True)
bpy.context.view_layer.objects.active = copies[0]
bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')

SCALE = 1 / 1.4   # metres to ball radii; and Blender's (x, y fwd, z up) to the site's (x, y up, z fwd)
site = lambda v: [round(v.x * SCALE, 6), round(v.z * SCALE, 6), round(v.y * SCALE, 6)]
def b64(fmt, vals):
    return base64.b64encode(struct.pack('<%d%s' % (len(vals), fmt), *vals)).decode()

parts = []
for c in copies:
    me = c.data; me.calc_loop_triangles()
    ao, norms = me.color_attributes['ao'].data, me.corner_normals
    P, N, A = [], [], []
    for tri in me.loop_triangles:
        for li, vi in zip(tri.loops, tri.vertices):
            v = me.vertices[vi].co
            P += [v.x * SCALE, v.z * SCALE, v.y * SCALE]
            n = norms[li].vector
            N += [round(n.x * 127), round(n.z * 127), round(n.y * 127)]
            A.append(round(max(0.0, min(1.0, ao[vi].color[0])) * 255))
    tags = {k: v for k, v in (('side', c['side']), ('lg', c['lgroup'])) if v}
    parts.append({'group': c['group'], **tags, 'mat': c['mat'], 'pos': b64('f', P), 'nrm': b64('b', N), 'ao': b64('B', A), 'count': len(A)})

wl = lambda n: O[n].matrix_world.translation
meta = {
    'hinge': site(wl('hingeE')),
    'pivots': {'trigger': site(Vector((-0.016, 0.155, -0.012))), 'paddle': site(Vector((0.028, 0.155, -0.012))),
               'dial': site(wl('dial')), 'toggle': site(wl('toggle_bat')), 'cover': site(wl('cover_hinge')),
               'boost': site(Vector((-0.016, 0.155, -0.012))), 'wheel': site(wl('wheel')), 'twist': site(Vector((0, 0.155, -0.012))),
               'rocker': site(wl('rocker') - Vector((0, 0, 0.0015)))},
    'pistons': {p: {'a': site(wl(p + '_mountA')), 'b': site(wl(p + '_mountB')),
                    'fa': frame_of(O[p + '_mountA']), 'fb': frame_of(O[p + '_mountB'])} for p in ('rollP', 'hingeP')},
    'parts': parts,
}
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('/* generated by site5/tools/export_ring.py from tools/hand_ring.blend: the right hand ring, in ball radii,\n'
            '   y up, z forward, about the ring\'s centre, every part in its rest place. Groups and what moves them are\n'
            '   listed in the exporter. Triangles as base64: positions float32, normals int8, baked contact shading u8. */\n')
    f.write('window.SITE5_RING = ' + json.dumps(meta, separators=(',', ':')) + ';\n')
print('ring: %d parts, %d triangles, groups %s -> %s' % (len(parts), sum(p['count'] for p in parts) // 3,
      sorted({p['group'] for p in parts}), os.path.normpath(OUT)))
