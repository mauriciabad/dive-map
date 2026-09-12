"""Turn the Crosshead 2048px terrain PNGs into the habitat pattern set.

Emits every texture at four sizes so the app can trade grain for memory: 512 by
default, 2048 when the machine can take it or a card is being printed. WebP
because MapLibre's addImage takes an ImageBitmap and the files are a third the
size of PNG.

Textures whose opposite edges do not match get an edge blend first. A seam that
is invisible on a phone is obvious on a laminated A3 sheet.
"""

import argparse, json, math, pathlib, re, sys
import numpy as np
from PIL import Image

SIZES = (2048, 1024, 512, 256)
SEAM_MARGIN = 0.08  # fraction of the edge that gets blended


def seam_ratios(a: np.ndarray) -> tuple[float, float]:
    """Wrap-around edge difference over the image's own internal variation."""
    sx = np.abs(a[:, -1] - a[:, 0]).mean() / max(np.abs(a[:, 1:] - a[:, :-1]).mean(), 1e-6)
    sy = np.abs(a[-1, :] - a[0, :]).mean() / max(np.abs(a[1:, :] - a[:-1, :]).mean(), 1e-6)
    return float(sx), float(sy)


def _ramp(n: int, margin: int) -> np.ndarray:
    """1.0 across the middle, easing to 0.5 at both edges."""
    w = np.ones(n, dtype=np.float32)
    for i in range(margin):
        t = i / margin
        w[i] = w[n - 1 - i] = 0.5 + 0.5 * (0.5 - 0.5 * math.cos(math.pi * t))
    return w


def make_seamless(a: np.ndarray, axis: int) -> np.ndarray:
    """Blend the image with its own mirror near the edges.

    A mirror puts column 0 against column W-1, so an equal blend at both edges
    makes them identical and the texture wraps. Weighting the blend to the
    margins leaves the middle of the image untouched.
    """
    n = a.shape[axis]
    w = _ramp(n, max(8, int(n * SEAM_MARGIN)))
    w = w[:, None, None] if axis == 0 else w[None, :, None]
    return a * w + np.flip(a, axis=axis) * (1.0 - w)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=pathlib.Path, required=True)
    ap.add_argument("--out", type=pathlib.Path, required=True)
    ap.add_argument("--registry", type=pathlib.Path, required=True)
    ap.add_argument("--threshold", type=float, default=1.5)
    args = ap.parse_args()

    wanted = sorted(set(re.findall(r"texture: '([\w.]+)'", args.registry.read_text())))
    print(f"{len(wanted)} textures referenced by the habitat registry")

    index: dict[str, dict[str, object]] = {}
    missing: list[str] = []

    for name in wanted:
        hits = list(args.src.rglob(f"{name}.png"))
        if not hits:
            missing.append(name)
            continue
        src = hits[0]
        a = np.asarray(Image.open(src).convert("RGB"), dtype=np.float32)
        before = seam_ratios(a)
        fixed = []
        if before[0] > args.threshold:
            a, fixed = make_seamless(a, axis=1), [*fixed, "x"]
        if before[1] > args.threshold:
            a, fixed = make_seamless(a, axis=0), [*fixed, "y"]
        after = seam_ratios(a)

        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        for size in SIZES:
            d = args.out / str(size)
            d.mkdir(parents=True, exist_ok=True)
            img.resize((size, size), Image.LANCZOS).save(d / f"{name}.webp", quality=88, method=6)

        index[name] = {
            "source": src.name,
            "seamBefore": [round(v, 2) for v in before],
            "seamAfter": [round(v, 2) for v in after],
            "blended": fixed,
        }
        flag = f"blended {'+'.join(fixed)}" if fixed else "clean"
        print(f"  {name:22s} {before[0]:5.2f}/{before[1]:5.2f} -> {after[0]:5.2f}/{after[1]:5.2f}  {flag}")

    (args.out / "index.json").write_text(
        json.dumps({"sizes": list(SIZES), "textures": index}, indent=2)
    )
    if missing:
        print(f"\nMISSING from the source pack: {', '.join(missing)}", file=sys.stderr)
    print(f"\nwrote {len(index)} textures x {len(SIZES)} sizes to {args.out}")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
