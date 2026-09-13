"""Turn the Crosshead 2048px terrain PNGs into the habitat pattern set.

Emits every texture at four sizes so the app can trade grain for memory: 512 by
default, 2048 when the machine can take it or a card is being printed.

Two formats. Only Safari decodes JPEG XL without a flag today, so WebP ships
alongside it and the app picks at runtime. The two quality scales are not
comparable: measured against the source at 512px, JXL q82 lands on the same PSNR
as WebP q88 and runs 15 to 20 percent smaller on the smooth textures, about even
on the noisy ones.

Textures whose opposite edges do not match get an edge blend first. A seam that
is invisible on a phone is obvious on a laminated A3 sheet.
"""

import argparse, json, math, pathlib, re, sys
import numpy as np
import pillow_jxl  # noqa: F401 - registers the JXL encoder with Pillow
from PIL import Image

SIZES = (2048, 1024, 512, 256)
SOURCE_SIZE = 2048
WEBP_QUALITY = 88
JXL_QUALITY = 82
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


def unsurveyed(rng: np.random.Generator) -> Image.Image:
    """The seabed the habitat survey never reached, as a hatch rather than a class.

    Hatching is what a chart uses for unknown ground, and it cannot be mistaken for
    one of the 21 pack textures a real class is painted with. The spacing divides
    the tile exactly, so the diagonal wraps and needs no edge blend.
    """
    n = SOURCE_SIZE
    y, x = np.mgrid[0:n, 0:n]
    # A mid tone, because the hillshade multiplies a near-white highlight over
    # whatever is underneath and a dark base came out as a white smear in the
    # shallows. The 21 pack textures all sit in this range, so this one takes the
    # light the same way they do and the hatch survives it.
    base = np.array([94.0, 104.0, 109.0], dtype=np.float32)
    line = np.array([72.0, 82.0, 88.0], dtype=np.float32)
    stripe = ((x + y) % 128) < 11
    a = np.where(stripe[..., None], line, base)
    a = a + rng.normal(0.0, 5.0, size=(n, n, 1)).astype(np.float32)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


SYNTHETIC = {"unsurveyed": unsurveyed}


def emitted(out: pathlib.Path, name: str) -> bool:
    files = [out / str(size) / f"{name}.{fmt}" for size in SIZES for fmt in ("webp", "jxl")]
    return all(f.exists() for f in files) and (out / "swatch" / f"{name}.jpg").exists()


def main() -> int:
    ap = argparse.ArgumentParser()
    # Optional: once every texture is emitted the pack is not needed again, and a
    # clean clone does not carry it.
    ap.add_argument("--src", type=pathlib.Path, default=pathlib.Path("data/raw/crosshead"))
    ap.add_argument("--out", type=pathlib.Path, required=True)
    ap.add_argument("--registry", type=pathlib.Path, required=True)
    ap.add_argument("--threshold", type=float, default=1.5)
    args = ap.parse_args()

    wanted = sorted(set(re.findall(r"texture: '([\w.]+)'", args.registry.read_text())) | set(SYNTHETIC))
    print(f"{len(wanted)} textures referenced by the habitat registry")

    # Rerunning re-encodes nothing: a texture whose eight files and swatch are all
    # on disk keeps the entry the previous run recorded. Without this the step
    # cannot run at all once the source pack is gone, which it is on a clean clone.
    previous: dict[str, dict[str, object]] = {}
    if (args.out / "index.json").exists():
        previous = json.loads((args.out / "index.json").read_text()).get("textures", {})

    index: dict[str, dict[str, object]] = {}
    missing: list[str] = []
    total_webp = 0
    total_jxl = 0
    rng = np.random.default_rng(11)

    for name in wanted:
        if emitted(args.out, name) and name in previous:
            index[name] = previous[name]
            continue
        if name in SYNTHETIC:
            src = pathlib.Path(f"<generated {name}>")
            a = np.asarray(SYNTHETIC[name](rng), dtype=np.float32)
        else:
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
        bytes_by_format: dict[str, int] = {"webp": 0, "jxl": 0}
        for size in SIZES:
            d = args.out / str(size)
            d.mkdir(parents=True, exist_ok=True)
            scaled = img.resize((size, size), Image.LANCZOS)
            scaled.save(d / f"{name}.webp", quality=WEBP_QUALITY, method=6)
            scaled.save(d / f"{name}.jxl", quality=JXL_QUALITY, effort=7)

            bytes_by_format["webp"] += (d / f"{name}.webp").stat().st_size
            bytes_by_format["jxl"] += (d / f"{name}.jxl").stat().st_size
        total_webp += bytes_by_format["webp"]
        total_jxl += bytes_by_format["jxl"]

        # pdf-lib embeds PNG and JPEG only, so the printed legend needs a raster
        # swatch the browser can hand it directly.
        swatch = args.out / "swatch"
        swatch.mkdir(parents=True, exist_ok=True)
        img.resize((160, 160), Image.LANCZOS).save(swatch / f"{name}.jpg", quality=86, optimize=True)

        index[name] = {
            "source": src.name,
            "seamBefore": [round(v, 2) for v in before],
            "seamAfter": [round(v, 2) for v in after],
            "blended": fixed,
            "bytes": bytes_by_format,
        }
        flag = f"blended {'+'.join(fixed)}" if fixed else "clean"
        print(f"  {name:22s} {before[0]:5.2f}/{before[1]:5.2f} -> {after[0]:5.2f}/{after[1]:5.2f}  {flag}")

    (args.out / "index.json").write_text(
        json.dumps(
            {"sizes": list(SIZES), "formats": ["jxl", "webp"], "textures": index},
            indent=2,
        )
    )
    print(f"\nwebp {total_webp / 1e6:.2f} MB   jxl {total_jxl / 1e6:.2f} MB "
          f"({100 * (1 - total_jxl / max(total_webp, 1)):.0f}% smaller)")
    if missing:
        print(f"\nMISSING from the source pack: {', '.join(missing)}", file=sys.stderr)
    print(f"\nwrote {len(index)} textures x {len(SIZES)} sizes to {args.out}")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
