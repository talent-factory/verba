"""Generates the four monochrome menu-bar state icons (template images).
Run once: `python3 apps/macos/scripts/gen_state_icons.py`. Commit the PNGs."""
import os
from PIL import Image, ImageDraw

SIZE = 44
OUT = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons', 'state')
os.makedirs(OUT, exist_ok=True)
BLACK = (0, 0, 0, 255)

def canvas():
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)

img, d = canvas()                       # idle: ring
d.ellipse([10, 10, 34, 34], outline=BLACK, width=4)
img.save(os.path.join(OUT, 'idle.png'))

img, d = canvas()                       # recording: filled disc
d.ellipse([10, 10, 34, 34], fill=BLACK)
img.save(os.path.join(OUT, 'recording.png'))

img, d = canvas()                       # transcribing: three dots
for cx in (13, 22, 31):
    d.ellipse([cx - 3, 19, cx + 3, 25], fill=BLACK)
img.save(os.path.join(OUT, 'transcribing.png'))

img, d = canvas()                       # processing: rounded square
d.rounded_rectangle([12, 12, 32, 32], radius=5, fill=BLACK)
img.save(os.path.join(OUT, 'processing.png'))

print('wrote 4 state icons to', os.path.normpath(OUT))
