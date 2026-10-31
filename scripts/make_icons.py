#!/usr/bin/env python3
"""Generate the PWA icons for lostless (plain PIL, no external assets).

Draws the 'navigation arrow' glyph in the accent color on the dark background.
Run once:  python3 scripts/make_icons.py
"""
import os
from PIL import Image, ImageDraw

ACCENT = (200, 255, 46)      # #c8ff2e
BG = (11, 13, 14)             # #0b0d0e

# material 'near_me' arrow, scaled to a 0..1 box
ARROW = [(0.875, 0.125), (0.125, 0.4375), (0.4375, 0.5625), (0.5625, 0.875)]


def draw_icon(size: int, padding_ratio: float) -> Image.Image:
    img = Image.new('RGBA', (size, size), BG + (255,))
    d = ImageDraw.Draw(img)
    pad = size * padding_ratio
    box = [pad, pad, size - pad, size - pad]
    pts = [(box[0] + x * (box[2] - box[0]), box[1] + y * (box[3] - box[1])) for x, y in ARROW]
    d.polygon(pts, fill=ACCENT + (255,))
    return img


def main() -> None:
    out = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
    os.makedirs(out, exist_ok=True)
    draw_icon(192, 0.18).save(os.path.join(out, 'icon-192.png'))
    draw_icon(512, 0.18).save(os.path.join(out, 'icon-512.png'))
    # maskable: full-bleed safe zone (keep glyph within the inner 80%)
    draw_icon(512, 0.28).save(os.path.join(out, 'icon-512-maskable.png'))
    print('icons written to', os.path.normpath(out))


if __name__ == '__main__':
    main()
