"""
slice_sprite_sheet.py — Robust 3×3 sprite-sheet slicer with magenta
chroma-key + despill + content-bbox crop. Built 2026-05-15 after the
Hastati attack-animation cleanup pass left low-alpha magenta fringe in
the first cut. This pipeline produces production-clean transparent
backgrounds: zero magenta, zero pink halo, preserved sprite colors.

Usage:
    python3 tools/slice_sprite_sheet.py <raw_sheet.png> <output_prefix> [--target 512]

Example:
    python3 tools/slice_sprite_sheet.py \\
        public/assets/sprites/t1_velites_attack_sheet_raw.png \\
        public/assets/sprites/t1_velites_atk

Produces 9 files: t1_velites_atk_0.png ... t1_velites_atk_8.png

Algorithm notes:
1. Input is a single PNG with a 3×3 grid of sprite poses on a uniform
   magenta backdrop (RGB ~(255, 0-50, 255)). Higgs Field nano_banana_2
   at 4K resolution emits this format reliably.
2. Each cell is cropped with a 50px inset to strip any AI-generated
   grid-border lines between cells.
3. chroma_key_despill() does TWO things per pixel:
   a. Pure magenta → fully transparent (RGB=0, A=0). The RGB=0 is
      critical — leaving magenta color data in alpha=0 pixels lets
      the subsequent LANCZOS resize blend ghost magenta into nearby
      visible pixels, producing the pink halo bug.
   b. Edge-fringe magenta (anti-aliased blend pixels) → drop alpha
      proportional to magenta-ness, despill RGB toward neutral by
      clamping R and B down to G + small diff. This kills pink fringe
      without nuking the real sprite outline.
4. trim_to_content() crops the cell down to its non-transparent
   bounding box (plus 16px pad), so the figure is centered after
   the final resize.
5. final_cleanup() runs AFTER the resize and kills any low-alpha
   magenta-tinted pixel the LANCZOS interpolator might have
   resurrected from neighbor blending.

The default 0.35 magenta-ness threshold + 32 alpha cutoff have been
tested against the Hastati attack sheet — zero magenta and zero pink
fringe pixels survive in the output frames.
"""
import os
import sys
import argparse
from PIL import Image


def is_magenta_like(r, g, b):
    """Magenta signature: R and B both high, R ~ B, G much lower.
    Rejects red (which has R high but B low) and blue (B high but R low)."""
    if g >= 140:
        return False
    if r < 130 or b < 130:
        return False
    if abs(r - b) > 90:
        return False
    return (min(r, b) - g) > 40


def magenta_ness(r, g, b):
    """0.0 = no magenta, 1.0 = pure magenta. Used for partial alpha drop."""
    if not is_magenta_like(r, g, b):
        return 0.0
    return max(0.0, min(1.0, (min(r, b) - g) / 255.0))


def chroma_key_despill(im):
    """Hard kill magenta. Set RGB=(0,0,0) on EVERY transparent pixel so
    LANCZOS resize can't blend leftover magenta color into nearby
    visible pixels."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                px[x, y] = (0, 0, 0, 0)
                continue
            m = magenta_ness(r, g, b)
            if m >= 0.35:
                px[x, y] = (0, 0, 0, 0)
            elif m > 0.0:
                new_a = int(a * max(0.0, 1.0 - m * 1.8))
                if new_a < 32:
                    px[x, y] = (0, 0, 0, 0)
                else:
                    rd = max(g, r - int(m * 140))
                    bd = max(g, b - int(m * 140))
                    px[x, y] = (rd, g, bd, max(0, min(255, new_a)))
    return im


def trim_to_content(im, alpha_threshold=16, pad=16):
    """Crop to the non-transparent bounding box (plus padding) so the
    figure is centered when resized."""
    px = im.load()
    w, h = im.size
    x0, y0, x1, y1 = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            if px[x, y][3] >= alpha_threshold:
                found = True
                if x < x0: x0 = x
                if y < y0: y0 = y
                if x > x1: x1 = x
                if y > y1: y1 = y
    if not found:
        return im
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(w - 1, x1 + pad)
    y1 = min(h - 1, y1 + pad)
    return im.crop((x0, y0, x1 + 1, y1 + 1))


def final_cleanup(im):
    """Post-resize: hard kill any pixel that's BOTH low-alpha AND
    magenta-tinted. LANCZOS can resurrect ghost magenta through
    interpolation; this is the final scrub."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if a < 64 and is_magenta_like(r, g, b):
                px[x, y] = (0, 0, 0, 0)
                continue
            if magenta_ness(r, g, b) >= 0.45:
                px[x, y] = (0, 0, 0, 0)
                continue
            if a < 24 and r > 100 and b > 100 and g < min(r, b) - 30:
                px[x, y] = (0, 0, 0, 0)
    return im


def process_sheet(input_path, output_prefix, target=512, grid_inset=50):
    """Slice a 3x3 grid sprite sheet into 9 chroma-keyed frame PNGs."""
    src = Image.open(input_path).convert("RGBA")
    W, H = src.size
    cell_w = W // 3
    cell_h = H // 3
    print(f"Input: {input_path} ({W}x{H}, cells {cell_w}x{cell_h})")

    for i in range(9):
        row = i // 3
        col = i % 3
        x0 = col * cell_w
        y0 = row * cell_h
        cell = src.crop((x0, y0, x0 + cell_w, y0 + cell_h))
        cell = cell.crop((grid_inset, grid_inset,
                          cell.width - grid_inset,
                          cell.height - grid_inset))
        cell = chroma_key_despill(cell)
        cell = trim_to_content(cell)
        cw, ch = cell.size
        side = max(cw, ch)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(cell, ((side - cw) // 2, (side - ch) // 2), cell)
        canvas = canvas.resize((target, target), Image.LANCZOS)
        canvas = final_cleanup(canvas)
        out_path = f"{output_prefix}_{i}.png"
        canvas.save(out_path, "PNG", optimize=True)
        size_kb = os.path.getsize(out_path) / 1024
        print(f"  Frame {i}: {out_path} ({size_kb:.1f} KB)")


def verify_clean(output_prefix, count=9):
    """Re-scan output frames to confirm zero magenta + zero pink fringe."""
    print(f"\nVerifying cleanliness:")
    all_clean = True
    for i in range(count):
        path = f"{output_prefix}_{i}.png"
        if not os.path.exists(path):
            print(f"  Frame {i}: MISSING")
            all_clean = False
            continue
        im = Image.open(path).convert("RGBA")
        px = im.load()
        w, h = im.size
        magenta = 0
        pink = 0
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a < 5: continue
                if r > 200 and g < 80 and b > 200:
                    magenta += 1
                elif r > 180 and g < 140 and b > 180 and (r-g) > 50 and (b-g) > 50:
                    pink += 1
        status = "CLEAN" if (magenta == 0 and pink == 0) else "RESIDUAL"
        if status != "CLEAN":
            all_clean = False
        print(f"  Frame {i}: {status} (magenta={magenta}, pink={pink})")
    print(f"\nResult: {'ALL FRAMES CLEAN' if all_clean else 'NEEDS RE-PROCESSING'}")
    return all_clean


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Slice a 3x3 sprite sheet with robust chroma-key.")
    p.add_argument("input", help="Path to raw sheet PNG (3x3 grid, magenta backdrop).")
    p.add_argument("output_prefix", help="Output frame prefix (e.g. t1_velites_atk).")
    p.add_argument("--target", type=int, default=512, help="Output frame size (default 512).")
    p.add_argument("--grid-inset", type=int, default=50, help="Pixels to trim off each cell edge (default 50).")
    p.add_argument("--verify", action="store_true", help="Run cleanliness verifier after processing.")
    args = p.parse_args()
    process_sheet(args.input, args.output_prefix, target=args.target, grid_inset=args.grid_inset)
    if args.verify:
        verify_clean(args.output_prefix)
