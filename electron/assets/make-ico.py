"""Generate a multi-size Windows .ico from the source PNG.

Usage: python make-ico.py [src.png] [out.ico]
Mirrors make-profile-icon.py: keeps the repo asset pipeline in Python so the
Windows build has a real .ico without extra npm tooling.
"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "icon.png"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "icon.ico"
SIZES = [16, 24, 32, 48, 64, 128, 256]

img = Image.open(SRC).convert("RGBA")
# Square canvas, transparent padding if the source is not square.
side = max(img.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
frames = [canvas.resize((s, s), Image.LANCZOS) for s in SIZES]
frames[-1].save(OUT, format="ICO", sizes=[(s, s) for s in SIZES])
print(f"wrote {OUT} ({OUT.stat().st_size} bytes, sizes {SIZES})")
