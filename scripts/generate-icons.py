#!/usr/bin/env python3
"""Build favicon / PWA / iOS icons from the original 512px master.

Re-keys the background from the baked-in dark teal to --night-3 while
preserving anti-aliased strokes (unpremultiply old bg, apply new bg).
"""

from __future__ import annotations

import io
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

BG_REF = (0, 14, 24)
BG_TARGET = (26, 48, 69)
# Pixels within this distance of BG_REF are solid new background.
SOLID_BG_DIST = 10
# Beyond this distance, keep foreground pixels unchanged.
MATTE_OUTER = 55

OUTPUTS: dict[str, int] = {
    "icon-512.png": 512,
    "icon-192.png": 192,
    "apple-touch-icon.png": 180,
    "icon-180.png": 180,
    "favicon-32.png": 32,
    "icon-32.png": 32,
    "favicon-16.png": 16,
}


def clamp(v: int) -> int:
    return max(0, min(255, v))


def dist_to_bg(r: int, g: int, b: int) -> float:
    dr, dg, db = r - BG_REF[0], g - BG_REF[1], b - BG_REF[2]
    return (dr * dr + dg * dg + db * db) ** 0.5


def saturation(r: int, g: int, b: int) -> float:
    mx, mn = max(r, g, b), min(r, g, b)
    return 0.0 if mx == 0 else (mx - mn) / mx


def recolor_pixel(r: int, g: int, b: int) -> tuple[int, int, int]:
    d = dist_to_bg(r, g, b)

    if d <= SOLID_BG_DIST:
        return BG_TARGET

    if d >= MATTE_OUTER:
        return r, g, b

    # Bright / saturated pixels are artwork, not background fringe.
    if max(r, g, b) > 200 or saturation(r, g, b) > 0.35:
        return r, g, b

    # Foreground coverage: 0 on old bg, 1 on true foreground.
    span = MATTE_OUTER - SOLID_BG_DIST
    fg = max(0.0, min(1.0, (d - SOLID_BG_DIST) / span))

    # Dark anti-alias at strokes should stay dark, not snap to flat bg.
    peak = max(r, g, b)
    if peak < 50:
        fg = max(fg, 1.0 - peak / 50.0)

    bg_mix = 1.0 - fg
    return (
        clamp(int(round(r - bg_mix * BG_REF[0] + bg_mix * BG_TARGET[0]))),
        clamp(int(round(g - bg_mix * BG_REF[1] + bg_mix * BG_TARGET[1]))),
        clamp(int(round(b - bg_mix * BG_REF[2] + bg_mix * BG_TARGET[2]))),
    )


def recolor_background(im: Image.Image) -> Image.Image:
    out = im.convert("RGB")
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            px[x, y] = recolor_pixel(*px[x, y])
    return out


def load_git_master() -> Image.Image:
    data = subprocess.check_output(["git", "show", "HEAD:icon-512.png"], cwd=ROOT)
    return Image.open(io.BytesIO(data))


def resize_icon(im: Image.Image, size: int) -> Image.Image:
    if im.size == (size, size):
        return im
    return im.resize((size, size), Image.Resampling.LANCZOS)


def save_png(im: Image.Image, path: Path) -> None:
    im.save(path, format="PNG", compress_level=1)


def main() -> int:
    source = recolor_background(load_git_master())
    for name, size in OUTPUTS.items():
        out = resize_icon(source, size)
        path = ROOT / name
        save_png(out, path)
        print(f"wrote {path.name} ({size}×{size})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
