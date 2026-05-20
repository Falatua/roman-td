#!/usr/bin/env python3
"""
crop_undead_tileset.py — one-shot helper for the Map Visual Overhaul.

Reads the Free-Undead-Tileset-Top-Down-Pixel-Art folder, crops the
Ground_rocks.png sheet into 4 cursed-ground variants + 3 cracked-stone
path variants, copies 14 curated prop PNGs, and normalizes all output
to power-of-two-friendly sizes (32 or 64).

The output directory is the project's public/assets/sprites/. Filename
convention: un_<category>_<id>.png. The MANIFEST update in
src/render/Assets.ts (Commit M2) registers each key.

Usage:
  python3 tools/crop_undead_tileset.py
"""
import os
import sys
from PIL import Image

# ── Path setup ─────────────────────────────────────────────────────
SRC_ROOT = '/Users/redsky/Library/CloudStorage/Dropbox/06 Video Games/Gem TD/Assets/Free-Undead-Tileset-Top-Down-Pixel-Art/PNG'
DST_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'public', 'assets', 'sprites'
)

def src(rel):
    return os.path.join(SRC_ROOT, rel)

def dst(name):
    return os.path.join(DST_ROOT, name)

# ── Ground_rocks crops ────────────────────────────────────────────
# Sheet is 496×592 with 32-px nominal tile grid (some rows have 16-px
# offsets — we sample by visual inspection). Each entry is
# (sheet_filename, (left, top, right, bottom), out_name).
GROUND_CROPS = [
    # Cursed ground variants — dark cracked stone with thorn tufts.
    # Picked from the upper-center band where the cracked-rock pattern
    # reads as "tilable cursed dirt" without prominent edge motifs.
    ('Ground_rocks.png', (224, 144, 256, 176), 'un_ground_a.png'),  # cracked stone with skull bits
    ('Ground_rocks.png', (256, 144, 288, 176), 'un_ground_b.png'),  # darker stone slab
    ('Ground_rocks.png', (224, 176, 256, 208), 'un_ground_c.png'),  # mossy crack variant
    ('Ground_rocks.png', (256, 176, 288, 208), 'un_ground_d.png'),  # bone-dusted variant

    # Cracked stone path tiles — picked from the bone/sand area.
    ('Ground_rocks.png', (304, 144, 336, 176), 'un_path_a.png'),    # bone-cobble main
    ('Ground_rocks.png', (336, 144, 368, 176), 'un_path_b.png'),    # cracked-stone variant
    ('Ground_rocks.png', (304, 176, 336, 208), 'un_path_c.png'),    # weathered variant
]

# ── Object copies (with resize-to-fit) ────────────────────────────
# Source filename → (out_name, target_size). Props larger than the
# target get downscaled with LANCZOS; smaller stay as-is.
PROP_COPIES = [
    # Bones (scatter clutter)
    ('Objects_separately/Bones_shadow1_5.png',    'un_prop_bones_s.png',     32),
    ('Objects_separately/Bones_shadow2_8.png',    'un_prop_bones_l.png',     48),

    # Graves (Roman-grave-shaped, fitting "battlefield burial")
    ('Objects_separately/Grave_shadow1_2.png',    'un_prop_grave_a.png',     32),
    ('Objects_separately/Grave_shadow1_5.png',    'un_prop_grave_b.png',     32),

    # Skull pile — small "marker" feature for the cursed ground
    ('Objects_separately/Pile_sculls_shadow1.png', 'un_prop_skull_pile.png', 48),

    # Dead trees — big edge decorations
    ('Objects_separately/Dead_tree_shadow1_3.png', 'un_prop_dead_tree.png',   64),
    ('Objects_separately/Dead_tree_shadow1_1.png', 'un_prop_dead_tree_b.png', 64),

    # Broken tree — mid-size
    ('Objects_separately/Broken_tree_shadow1_3.png', 'un_prop_broken_tree.png', 32),

    # Thorn plants — small ground clutter
    ('Objects_separately/Thorn_palnt_shadow2_1.png', 'un_prop_thorn_a.png',  32),
    ('Objects_separately/Thorn_plant_shadow1_3.png', 'un_prop_thorn_b.png',  32),

    # Rocks — small filler
    ('Objects_separately/Rock_shadow1_3.png',     'un_prop_rock_a.png',     48),
    ('Objects_separately/Rock_shadow2_1.png',     'un_prop_rock_b.png',     32),

    # Ruin — medium feature
    ('Objects_separately/Ruin_shadow1_3.png',     'un_prop_ruin.png',       48),

    # Dead arm — small grim accent
    ('Objects_separately/Dead_arm_shadow1_1.png', 'un_prop_dead_arm.png',   32),

    # ── Static "animated" feature props (procedural pulse in code) ──
    # These get one static PNG; the renderer applies an alpha/scale
    # sine pulse in drawAmbient() so we don't need multi-frame sheets.
    ('Objects_separately/Crystal_shadow1_1.png',  'un_anim_crystal.png',    48),
    ('Objects_separately/Grave_shadow2_3.png',    'un_anim_grave.png',      32),
    ('Objects_separately/Thorn_plant_shadow1_3.png', 'un_anim_thorn.png',   32),
]


def main():
    if not os.path.isdir(SRC_ROOT):
        print(f'ERROR: source folder not found: {SRC_ROOT}')
        sys.exit(1)
    if not os.path.isdir(DST_ROOT):
        print(f'ERROR: destination folder not found: {DST_ROOT}')
        sys.exit(1)

    print(f'src: {SRC_ROOT}')
    print(f'dst: {DST_ROOT}')
    print()

    # ── Ground crops ─────────────────────────────────────────────
    print('Cropping Ground_rocks.png …')
    sheet_path = src('Ground_rocks.png')
    sheet = Image.open(sheet_path).convert('RGBA')
    print(f'  sheet size: {sheet.size}')
    for sheet_name, (left, top, right, bottom), out_name in GROUND_CROPS:
        crop = sheet.crop((left, top, right, bottom))
        # Defensive: skip empty cells
        bbox = crop.getbbox()
        if bbox is None:
            print(f'  SKIP empty crop → {out_name}')
            continue
        crop.save(dst(out_name), 'PNG')
        print(f'  {out_name:25} ← {sheet_name} [{left},{top},{right},{bottom}]  ({crop.size[0]}x{crop.size[1]})')

    # ── Prop copies (with resize) ────────────────────────────────
    print()
    print('Copying props (resize to target size if larger) …')
    missing = []
    ok_count = 0
    for src_rel, out_name, target in PROP_COPIES:
        sp = src(src_rel)
        if not os.path.exists(sp):
            missing.append((src_rel, out_name))
            continue
        img = Image.open(sp).convert('RGBA')
        w, h = img.size
        m = max(w, h)
        if m > target:
            # Downscale uniformly to keep aspect ratio, target on long side
            ratio = target / m
            new_w = max(1, int(round(w * ratio)))
            new_h = max(1, int(round(h * ratio)))
            img = img.resize((new_w, new_h), Image.LANCZOS)
        img.save(dst(out_name), 'PNG')
        print(f'  {out_name:25} ← {src_rel}  ({img.size[0]}x{img.size[1]})')
        ok_count += 1

    print()
    print(f'wrote {ok_count + len(GROUND_CROPS)} files to {DST_ROOT}')
    if missing:
        print()
        print(f'WARNING: {len(missing)} source files missing:')
        for s, d in missing:
            print(f'  - {s}  (intended → {d})')


if __name__ == '__main__':
    main()
