"""Turn the Crosshead 2048px terrain PNGs into the habitat pattern set.

Emits every texture at three sizes so the app can trade grain for memory: 256 for
the picker grid, 512 for the map and the printed sheet, 1024 above 2x.

Two formats. Only Safari decodes JPEG XL without a flag today, so WebP ships
alongside it and the app picks at runtime. The two quality scales are not
comparable: measured against the source at 512px, JXL q82 lands on the same PSNR
as WebP q88 and runs 15 to 20 percent smaller on the smooth textures, about even
on the noisy ones.

Textures whose opposite edges do not match get an edge blend first. A seam that
is invisible on a phone is obvious on a laminated A3 sheet.

Which of the pack's six folders can be a seabed is decided by TILEABLE_DIRS and by
one measurement, `square`. A fill-pattern repeats forever in both directions, so a
source that is not square repeats as a stretched smear. That leaves out 88 path
strips (1024x12 up to 2048x214), 60 wall runs and their 8px end caps, 22 door and
window sprites, and 1376 props. None of them is ground.
"""

import argparse, json, math, pathlib, re, sys
import numpy as np
import pillow_jxl  # noqa: F401 - registers the JXL encoder with Pillow
from PIL import Image

SIZES = (1024, 512, 256)

# The two folders holding whole square tiles meant to be laid as ground. Anything
# the habitat registry names is built from wherever it sits, which is what keeps
# `metal` (a wall run the catalogue already paints with) in the set.
TILEABLE_DIRS = ("terrain", "patterns")

# Why the other four are out. Squareness is the measurement; this is the reason
# behind it, and for objects it is the reason on its own.
NOT_GROUND = {
    "objects": "single props drawn on alpha, and the square ones are a barrel and a rug",
    "paths": "strips laid along a line, 1024x12 up to 2048x214",
    "portals": "door and window sprites cut to the opening",
    "walls": "wall runs and their 8px end caps",
}
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


def square(path: pathlib.Path) -> bool:
    with Image.open(path) as im:
        return im.size[0] == im.size[1]


def source_of(src: pathlib.Path, root: pathlib.Path) -> str:
    """Where in the pack it came from. Two stems appear twice, so the folder is the answer."""
    try:
        return str(src.relative_to(root))
    except ValueError:
        return src.name


def tileable(src: pathlib.Path) -> tuple[dict[str, pathlib.Path], list[str]]:
    """Every pack file that can be laid as ground, and a line per folder left out.

    A stem that appears in two folders keeps the bare name in the first one listed
    and takes its folder as a suffix in the rest. `ch_stone` is a dark grey gravel
    in terrain and a pale flagstone in patterns; one id could only ever be one of
    them, and the catalogue already paints with the terrain one.
    """
    ground: dict[str, pathlib.Path] = {}
    rejected: list[str] = []
    for folder in TILEABLE_DIRS:
        skipped = 0
        for path in sorted((src / folder).rglob("*.png")):
            if not square(path):
                skipped += 1
                continue
            name = path.stem if path.stem not in ground else f"{path.stem}_{folder.rstrip('s')}"
            ground[name] = path
        if skipped:
            rejected.append(f"{skipped} of {folder}, not square")
    for folder, reason in NOT_GROUND.items():
        count = len(list((src / folder).rglob("*.png")))
        rejected.append(f"all {count} of {folder}: {reason}")
    return ground, rejected


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

    catalogued = set(re.findall(r"texture: '([\w.]+)'", args.registry.read_text()))
    ground, rejected = tileable(args.src)
    for name in sorted(catalogued - set(ground)):
        hits = list(args.src.rglob(f"{name}.png"))
        if hits:
            ground[name] = hits[0]
    wanted = sorted(set(ground) | catalogued | set(SYNTHETIC))
    print(f"{len(catalogued)} textures the habitat registry names, "
          f"{len(ground)} the pack can tile as ground, {len(wanted)} to build")
    for line in rejected:
        print(f"  rejected {line}")

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
            found = ground.get(name)
            if found is None:
                missing.append(name)
                continue
            src = found
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
            "source": source_of(src, args.src),
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
