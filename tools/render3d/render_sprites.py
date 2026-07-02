# render_sprites.py — Westwood-style sprite pre-renderer.
# Builds low-poly models in code, renders them with Cycles from a fixed
# tilted orthographic camera (one NW sun + soft fill, shadow-catcher ground),
# and writes raw 4x PNG frames + projection metadata for tools/render3d/post.js.
#
# Run:  blender -b -P tools/render3d/render_sprites.py -- --out /tmp/render3d_raw
#
# Conventions:
#   1 world unit = 1 map cell = 24 final px (rendered at 4x = 96 raw px/unit)
#   Facing 0 = NORTH = +Y; facings go clockwise on screen (rotate -22.5deg/step)
#   Camera looks from the south, elevation 55deg; buildings are depth-scaled by
#   1/sin(55) so ground squares project to square pixels (heights foreshorten
#   naturally, walls stay visible) — vehicles keep natural foreshortening.

import bpy, math, json, os, sys

# ---- args -------------------------------------------------------------------
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = '/tmp/render3d_raw'
for i, a in enumerate(argv):
    if a == '--out':
        OUT = argv[i + 1]
os.makedirs(OUT, exist_ok=True)

SS = 6                       # raw supersample: 144 raw px/unit -> 48 final px/cell
PX_PER_UNIT = 24 * SS        # raw pixels per world unit (horizontal)
ELEV = math.radians(55)      # camera elevation above the ground plane
DEPTH_K = 1.0 / math.sin(ELEV)  # building depth pre-scale -> square ground cells

# ---- scene ------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 160          # no denoiser in this build: brute-force it
scene.cycles.use_denoising = False
scene.cycles.device = 'CPU'
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'   # no filmic washout

# camera: south of origin, looking north-down at ELEV
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
tilt = math.pi / 2 - ELEV                    # rotation from straight-down
cam.rotation_euler = (tilt, 0.0, 0.0)
DIST = 30.0
cam.location = (0.0, -DIST * math.cos(ELEV), DIST * math.sin(ELEV))
scene.camera = cam

# key sun from the screen NW (upper-left), warm-ish
sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 4.0
sun_data.angle = math.radians(4)
sun = bpy.data.objects.new('sun', sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(38), math.radians(-28), math.radians(-18))

# cool dim fill from the SE so shaded faces keep detail
fill_data = bpy.data.lights.new('fill', 'SUN')
fill_data.energy = 0.9
fill_data.angle = math.radians(30)
fill = bpy.data.objects.new('fill', fill_data)
scene.collection.objects.link(fill)
fill.rotation_euler = (math.radians(55), math.radians(25), math.radians(160))

# soft ambient
scene.world = bpy.data.worlds.new('world')
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.45, 0.47, 0.5, 1.0)
bg.inputs[1].default_value = 0.5

# shadow-catcher ground: shadows land in the alpha channel
gplane = bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
ground = bpy.context.active_object
ground.name = 'ground'
ground.is_shadow_catcher = True

# ---- materials --------------------------------------------------------------
def mat(name, rgb, rough=0.7, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit > 0:
        b.inputs['Emission Color'].default_value = (*rgb, 1.0)
        b.inputs['Emission Strength'].default_value = emit
    return m

# srgb-ish component helper
def c(r, g, b):
    return (pow(r / 255, 2.2), pow(g / 255, 2.2), pow(b / 255, 2.2))

M = {
    'gdi':      mat('gdi', c(196, 168, 84), 0.62),
    'gdiDark':  mat('gdiDark', c(138, 114, 48), 0.7),
    'metal':    mat('metal', c(120, 120, 128), 0.45, 0.6),
    'darkMetal': mat('darkMetal', c(58, 58, 66), 0.55, 0.5),
    'track':    mat('track', c(40, 40, 44), 0.9),
    'concrete': mat('concrete', c(139, 139, 130), 0.9),
    'concDark': mat('concDark', c(95, 95, 88), 0.9),
    'glass':    mat('glass', c(30, 48, 66), 0.2, 0.3),
    'hazard':   mat('hazard', c(224, 184, 64), 0.6),
    'redLight': mat('redLight', c(240, 60, 40), 0.35, 0.0, 9.0),
    'obsidian': mat('obsidian', c(7, 7, 11), 0.2, 0.5),
    'obsLite':  mat('obsLite', c(26, 26, 38), 0.3, 0.5),
    'nodRed':   mat('nodRed', c(160, 32, 24), 0.6),
    'gunmetal': mat('gunmetal', c(70, 72, 78), 0.5, 0.55),
    'engine':   mat('engine', c(52, 48, 40), 0.8),
    'crane':    mat('crane', c(238, 186, 44), 0.55),
    'beacon':   mat('beacon', c(230, 40, 24), 0.4, 0.0, 1.5),
}

# ---- geometry helpers ---------------------------------------------------------
PARTS = []  # objects belonging to the current model

def _register(obj, material):
    obj.data.materials.append(material)
    PARTS.append(obj)
    return obj

def box(x, y, z, sx, sy, sz, material, rz=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    o.rotation_euler = (0, 0, rz)
    return _register(o, material)

def cyl(x, y, z, r, depth, material, vertices=20, rx=0.0, ry=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=vertices,
                                        location=(x, y, z))
    o = bpy.context.active_object
    o.rotation_euler = (rx, ry, 0)
    return _register(o, material)

def cone(x, y, z, r1, r2, depth, material, vertices=16):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth,
                                    vertices=vertices, location=(x, y, z))
    o = bpy.context.active_object
    return _register(o, material)

def wedge(x, y, z, sx, sy, sz, material, rz=0.0):
    # box with its top-north edge pulled down: a glacis plate
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    o.rotation_euler = (0, 0, rz)
    mesh = o.data
    for v in mesh.vertices:
        if v.co.y > 0 and v.co.z > 0:
            v.co.z = -0.15
    return _register(o, material)

def clear_parts():
    global PARTS
    for o in PARTS:
        bpy.data.objects.remove(o, do_unlink=True)
    PARTS = []

def group_under_empty(scale_y=1.0, rot_z=0.0):
    bpy.ops.object.empty_add(location=(0, 0, 0))
    e = bpy.context.active_object
    for o in PARTS:
        o.parent = e
    e.scale = (1.0, scale_y, 1.0)
    e.rotation_euler = (0, 0, rot_z)
    return e

# ---- render helpers ------------------------------------------------------------
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

def setup_frame(view_units_w, res_x, res_y):
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    cam.data.ortho_scale = view_units_w if res_x >= res_y else view_units_w * res_y / res_x
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.ortho_scale = view_units_w

def project(p):
    v = world_to_camera_view(scene, cam, Vector(p))
    return [v.x * scene.render.resolution_x,
            (1.0 - v.y) * scene.render.resolution_y]

def render_to(name):
    scene.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)

META = {'ss': SS, 'pxPerUnit': PX_PER_UNIT, 'frames': {}}

# =================================================================================
# MEDIUM TANK — hull (facing +Y) and turret, 16 rotations each
# =================================================================================
def build_mtnk_hull():
    # M1-style main battle tank: long low hull, track skirts, sharp glacis
    for sx in (-0.27, 0.27):
        box(sx, 0, 0.07, 0.16, 0.86, 0.14, M['track'])           # long tracks
        box(sx, 0, 0.145, 0.17, 0.82, 0.045, M['gdiDark'])       # armored side skirt
    # low wide hull
    box(0, -0.04, 0.155, 0.40, 0.80, 0.13, M['gdi'])
    wedge(0, 0.32, 0.20, 0.38, 0.26, 0.09, M['gdi'])             # long sloped glacis
    box(0, -0.36, 0.225, 0.34, 0.14, 0.04, M['engine'])          # rear engine deck
    box(0, -0.36, 0.235, 0.30, 0.10, 0.04, M['darkMetal'])       # exhaust grille
    box(0, 0.10, 0.225, 0.34, 0.30, 0.02, M['gdiDark'])          # deck plate line

def build_mtnk_turret():
    # wide, flat, angular western MBT turret set slightly forward
    box(0, 0.02, 0.30, 0.34, 0.34, 0.10, M['gdi'])               # main turret block
    wedge(0, 0.22, 0.30, 0.30, 0.10, 0.10, M['gdi'])             # angled turret cheeks
    box(0, -0.18, 0.30, 0.28, 0.14, 0.09, M['gdiDark'])          # rear bustle rack
    box(0, 0.02, 0.36, 0.26, 0.26, 0.03, M['gdiDark'])           # roof plate
    box(-0.10, -0.02, 0.395, 0.07, 0.07, 0.04, M['gdiDark'])     # commander cupola
    box(0.10, 0.04, 0.385, 0.05, 0.05, 0.025, M['darkMetal'])    # loader hatch
    cyl(0, 0.42, 0.315, 0.026, 0.52, M['gunmetal'], rx=math.pi / 2)  # long main gun
    box(0, 0.36, 0.315, 0.07, 0.09, 0.055, M['gdiDark'])         # mantlet
    cyl(0, 0.66, 0.315, 0.036, 0.06, M['darkMetal'], rx=math.pi / 2)  # muzzle ref

def render_vehicle(key, builder, frame_units=1.0):
    raw = int(frame_units * PX_PER_UNIT)
    setup_frame(frame_units, raw, raw)
    for i in range(16):
        clear_parts()
        builder()
        group_under_empty(rot_z=-i * math.tau / 16)
        render_to('%s_%02d' % (key, i))
    clear_parts()
    META['frames'][key] = {'kind': 'vehicle', 'raw': raw, 'units': frame_units,
                           'center': project((0, 0, 0))}

render_vehicle('mtnk_body', build_mtnk_hull)
render_vehicle('mtnk_turret', build_mtnk_turret)

# =================================================================================
# CONSTRUCTION YARD — 3x2 footprint, crane above the roof, south facade
# =================================================================================
def build_fact():
    # The construction yard's silhouette is the huge open GANTRY CRANE spanning
    # a central assembly bay — the buildings around it stay low.
    # low perimeter structure: an L of workshops around the open bay
    box(-1.05, 0.15, 0.28, 0.85, 1.5, 0.55, M['gdi'])            # west workshop
    box(-1.05, 0.15, 0.58, 0.75, 1.38, 0.05, M['gdiDark'])       # its roof rim
    box(-0.05, 0.62, 0.21, 2.8, 0.65, 0.42, M['gdi'])            # north workshop strip
    box(-0.05, 0.62, 0.44, 2.7, 0.55, 0.05, M['gdiDark'])
    # control cab on the NW corner, slightly taller, glazed
    box(-1.05, 0.60, 0.72, 0.55, 0.5, 0.35, M['gdiDark'])
    box(-1.05, 0.38, 0.70, 0.45, 0.06, 0.22, M['glass'])
    # open assembly bay: dark work slab with a vehicle chassis being built
    box(0.35, -0.15, 0.02, 2.1, 1.15, 0.04, M['concDark'])
    box(0.35, -0.15, 0.10, 0.55, 0.35, 0.12, M['metal'])         # chassis on the pad
    box(0.35, -0.15, 0.17, 0.4, 0.25, 0.06, M['darkMetal'])
    box(-0.5, -0.55, 0.10, 0.25, 0.25, 0.2, M['engine'])         # crates
    box(-0.22, -0.62, 0.08, 0.18, 0.18, 0.16, M['gdiDark'])
    # THE GANTRY: two A-frame legs + spanning beam, high over the bay
    for lx in (-0.55, 1.25):
        box(lx, -0.65, 0.70, 0.14, 0.14, 1.4, M['crane'])        # south legs
        box(lx, 0.35, 0.70, 0.14, 0.14, 1.4, M['crane'])         # north legs
        box(lx, -0.15, 1.42, 0.16, 1.2, 0.12, M['crane'])        # side rails
    box(0.35, -0.15, 1.52, 2.0, 0.20, 0.18, M['crane'])          # main cross beam
    box(0.35, -0.15, 1.42, 2.06, 0.10, 0.06, M['darkMetal'])     # beam underside
    box(0.1, -0.15, 1.36, 0.22, 0.22, 0.14, M['darkMetal'])      # trolley
    cyl(0.1, -0.15, 1.02, 0.015, 0.6, M['darkMetal'])            # cable
    box(0.1, -0.15, 0.68, 0.16, 0.16, 0.08, M['metal'])          # hook block
    # hazard chevrons on the beam + beacon
    box(0.35, -0.26, 1.52, 1.9, 0.02, 0.12, M['hazard'])
    box(1.25, -0.65, 1.33, 0.04, 0.04, 0.05, M['beacon'])
    # south facade door on the west workshop
    box(-1.05, -0.58, 0.22, 0.5, 0.05, 0.34, M['darkMetal'])
    box(-1.05, -0.60, 0.42, 0.56, 0.03, 0.07, M['hazard'])

def render_building(key, builder, w_cells, h_cells, y_off_px, bib_px, view_pad=1.6):
    clear_parts()
    builder()
    group_under_empty(scale_y=DEPTH_K)
    view_w = w_cells + view_pad
    raw_w = int(view_w * PX_PER_UNIT)
    raw_h = int(raw_w * 1.0)
    setup_frame(view_w, raw_w, raw_h)
    render_to(key)
    k = DEPTH_K
    META['frames'][key] = {
        'kind': 'building', 'w': w_cells, 'h': h_cells,
        'yOff': y_off_px, 'bib': bib_px,
        'raw': [raw_w, raw_h],
        # ground-plane footprint corners after depth scaling
        'nw': project((-w_cells / 2, (h_cells / 2) * k, 0)),
        'se': project((w_cells / 2, (-h_cells / 2) * k, 0)),
    }
    clear_parts()

render_building('fact', build_fact, 3, 2, 14, 8)

# =================================================================================
# OBELISK OF LIGHT — 1x1 pad, tall black spike, red emitter
# =================================================================================
def build_obli():
    # slender near-black monolith with a notched tip holding the red emitter
    oy = 0.06
    cyl(0, oy, 0.025, 0.40, 0.05, M['concrete'], vertices=28)    # low round pad
    box(0, oy, 0.12, 0.30, 0.30, 0.12, M['obsLite'])             # small plinth
    # tall slim square-section shaft, very slight taper, ~2.2 units
    cone(0, oy, 1.20, 0.125, 0.085, 2.05, M['obsidian'], vertices=4)
    # notch: the tip splits — a fin rises on the north side, the south side
    # steps down, and the red emitter crystal sits in the cut
    box(0, oy + 0.05, 2.32, 0.09, 0.045, 0.30, M['obsidian'])    # north fin
    box(0, oy + 0.05, 2.44, 0.10, 0.05, 0.04, M['obsLite'])      # fin cap catchlight
    box(0, oy - 0.035, 2.24, 0.075, 0.05, 0.10, M['obsLite'])    # south step
    box(0, oy - 0.02, 2.33, 0.055, 0.055, 0.09, M['redLight'])   # emitter crystal
    # faint red feed line down the south face
    box(0, oy - 0.075, 1.35, 0.018, 0.012, 1.8, M['nodRed'])

render_building('obli', build_obli, 1, 1, 24, 0, view_pad=1.2)

# ---- write metadata -------------------------------------------------------------
with open(os.path.join(OUT, 'meta.json'), 'w') as f:
    json.dump(META, f, indent=1)
print('RENDER COMPLETE ->', OUT)
