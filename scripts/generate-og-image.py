#!/usr/bin/env python3
"""Build the 1200x630 social share banner (og-image.png).

Centers the full MOIST wordmark (logo.png) on the same dark background
used by the app icons (--night-3 / BG_TARGET in generate-icons.py) so the
Facebook / Twitter link preview reads as a branded banner instead of a
cropped square icon.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

# Matches BG_TARGET in generate-icons.py (the icon background).
BG = (26, 48, 69)
# Facebook's recommended share-image size (1.91:1).
SIZE = (1200, 630)
# Fraction of the banner width the logo should span.
LOGO_WIDTH_FRAC = 0.62


def build(logo_path: Path, out_path: Path) -> None:
    logo = Image.open(logo_path).convert("RGBA")
    banner = Image.new("RGB", SIZE, BG)

    target_w = int(SIZE[0] * LOGO_WIDTH_FRAC)
    scale = target_w / logo.width
    target_h = int(logo.height * scale)
    logo_resized = logo.resize((target_w, target_h), Image.Resampling.LANCZOS)

    x = (SIZE[0] - target_w) // 2
    y = (SIZE[1] - target_h) // 2
    banner.paste(logo_resized, (x, y), logo_resized)

    banner.save(out_path, format="PNG", compress_level=1)
    print(f"wrote {out_path.name} ({SIZE[0]}x{SIZE[1]})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--logo",
        type=Path,
        default=ROOT / "logo.png",
        help="Path to the transparent wordmark PNG (default: logo.png).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "og-image.png",
        help="Output banner path (default: og-image.png).",
    )
    args = parser.parse_args()
    build(args.logo, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
