"""Report how badly a texture seams when tiled: wrap-around edge difference
versus the image's own internal variation. Ratio near 1.0 tiles cleanly."""
import sys, numpy as np
from PIL import Image

def score(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    h, w, _ = a.shape
    seam_h = np.abs(a[:, -1] - a[:, 0]).mean()
    seam_v = np.abs(a[-1, :] - a[0, :]).mean()
    inner_h = np.abs(a[:, 1:] - a[:, :-1]).mean()
    inner_v = np.abs(a[1:, :] - a[:-1, :]).mean()
    return (w, h, seam_h / max(inner_h, 1e-6), seam_v / max(inner_v, 1e-6))

print(f"{'texture':28s} {'size':>11s} {'seam-x':>7s} {'seam-y':>7s}  verdict")
for p in sys.argv[1:]:
    w, h, sx, sy = score(p)
    worst = max(sx, sy)
    verdict = "tiles clean" if worst < 1.5 else ("visible seam" if worst < 3 else "BAD SEAM")
    print(f"{p.split('/')[-1]:28s} {w:5d}x{h:<5d} {sx:7.2f} {sy:7.2f}  {verdict}")
