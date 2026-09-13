#!/usr/bin/env python3
"""Finds the places on the seabed worth writing a depth on, out of the ICGC DEM.

Issue #48. Concentric isobaths do not say whether a ring is a bump or a dip, and
the fix cartography has used since the first topographic sheets is a spot height:
one number, off the contour, at the place the contour is drawn around. The
hydrographic half of the same practice is the sounding, and both standards put
the number at a local extreme, on a saddle, or in the middle of a plain.

What earns a number here, and the name each kind carries in the output:

    shoal   a summit. Shallower than everything around it, so a rock or a
            pinnacle, and the thing a diver is usually being briefed on.
    pit     a closed hollow. Deeper than everything around it.
    crest   a high point along a ridge. A ridge has no summit of its own, so a
            shoal never lands on one, and the owner asked for the crests.
    canyon  a low point along a valley floor, the same case upside down.
    flat    the middle of a plain, where there is no relief to read at all and
            the only thing a diver wants is the number.

Relevance is prominence, which is also what the owner reasoned their way to
independently: the drop from a summit to the lowest col you have to cross to
reach higher ground. A rock standing 12 m off the bottom has a prominence of 12
whether it tops out at 8 m or at 60, and a bulge on a slope has almost none. It
is the standard quantity for choosing which peaks survive a scale, and it is what
sets both the zoom a feature appears at and which of two colliding labels wins.

Ridges and valleys carry no prominence, because nothing about them closes. They
are found by topographic position instead: the height of a cell against the mean
of the disc around it, the Weiss classification. How far a cell sits off that
mean is how much it protrudes or dents, which is the same question prominence
answers for a summit, so the two ranks are both in metres and comparable.

Flats are the one kind with no relief to rank by, so they rank by how much sea
they cover. Finding them is the one measurement here that had to be rewritten:
level ground and featureless ground are not the same thing, and on a shelf that
falls a metre every hundred it is the second one a diver wants a number on.

Only the ICGC survey goes in. `shelf-dem.tif`, which `build_shelf_depths.sh`
interpolates from contours kilometres apart and then low-passes to 153 m, has no
extremes in it that the survey measured, and every summit this would find out
there would be an artefact of the interpolation.

This half only finds and scores. Which of them a zoom has room for is
`choose_spot_depths.py`, so the selection can be retuned without reading four
billion DEM cells again.

    find_spot_depths.py --dem data/build/dem-3857.tif --out candidates.geojsonseq
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys
import time

import numpy as np
import rasterio
from rasterio.windows import Window
from scipy import ndimage

R = 6378137.0
EIGHT = np.ones((3, 3), bool)

# Higher than any seabed, so a cell holding it reads as terrain a summit is not
# the top of. Land and the survey's own holes both take it: both are places the
# flood has to stop, and neither is water a summit can own.
WALL = 1e6

KINDS = ("shoal", "pit", "crest", "canyon", "flat")


def merc(lon: float, lat: float) -> tuple[float, float]:
    return math.radians(lon) * R, R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def lonlat(x: float, y: float) -> tuple[float, float]:
    return math.degrees(x / R), math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)


def prominence(field: np.ndarray, sea: np.ndarray, rim: np.ndarray, step: float, cap: float):
    """Every local maximum of `field` over the sea, with the drop to its key col.

    The flood is the textbook one. Take a level, take the connected components of
    everything above it, and a summit is settled the moment its component holds
    something higher than itself: the level it was settled at is its key col, and
    the drop to it is the prominence. Sorting the summits once means the highest
    in a component can be scattered in rather than reduced per label, which is the
    difference between a pass that takes half a second and one that takes thirty.

    `rim` is the one cell of land or hole around the water, carrying WALL. It is
    what stops a rock welded to the shore reading as a summit: its component
    reaches the beach immediately and settles with nothing to show. Without it the
    shoreline is the highest ground in the water and every cell along it comes out
    as the most prominent feature on the coast.

    A summit still unsettled `cap` metres down is as prominent as this map has any
    use for, so the sweep stops there rather than walking to the seabed for a
    number no zoom rule reads differently.
    """
    inner = np.where(sea, field, -WALL).astype(np.float32)
    top = ndimage.maximum_filter(inner, size=3, mode="constant", cval=-WALL)
    lab, count = ndimage.label(sea & (inner >= top), structure=EIGHT)
    if count == 0:
        return np.zeros((0, 2), int), np.zeros(0, np.float32), np.zeros(0, np.float32)
    pos = np.array(ndimage.maximum_position(inner, lab, np.arange(1, count + 1)), int)
    vals = inner[pos[:, 0], pos[:, 1]]
    order = np.argsort(-vals)
    pos, vals = pos[order], vals[order]

    flooded = np.where(sea, field, -WALL).astype(np.float32)
    flooded[rim] = WALL
    prom = np.full(vals.shape, np.nan, np.float32)
    floor = float(np.min(field[sea])) if sea.any() else 0.0
    level = math.floor(float(vals.max()) / step) * step
    while level > floor - step:
        left = np.isnan(prom)
        if not left.any() or float((vals[left] - level).min()) >= cap:
            break
        lab, count = ndimage.label(flooded >= level, structure=EIGHT)
        if count:
            comp = lab[pos[:, 0], pos[:, 1]]
            # Summits run highest first, so scattering them in reverse leaves each
            # component holding its own highest. One pass, no per-label reduction.
            best = np.full(count + 1, -WALL, np.float32)
            best[comp[::-1]] = vals[::-1]
            best[lab[rim]] = WALL
            settled = left & (comp > 0) & (best[comp] > vals + 1e-3)
            prom[settled] = vals[settled] - level
        level -= step

    prom[np.isnan(prom)] = cap
    return pos, vals, np.minimum(prom, cap)


def spaced_extrema(field: np.ndarray, where: np.ndarray, span: int) -> np.ndarray:
    """The highest cell of `field` in every `span`-wide neighbourhood of `where`.

    A ridge and a valley floor are paths, so one label on each is either a lie
    about where the feature is or a single number for a kilometre of seabed. This
    walks the path instead and keeps a local high every `span` cells, which is how
    a chart runs soundings along a channel.
    """
    inner = np.where(where, field, -WALL).astype(np.float32)
    top = ndimage.maximum_filter(inner, size=span, mode="constant", cval=-WALL)
    lab, count = ndimage.label(where & (inner >= top), structure=EIGHT)
    if count == 0:
        return np.zeros((0, 2), int)
    return np.array(ndimage.maximum_position(inner, lab, np.arange(1, count + 1)), int)


def boxcar(values: np.ndarray, sea: np.ndarray, span: int) -> np.ndarray:
    """Mean depth over a square window, counting only the cells the survey reached."""
    ones = sea.astype(np.float32)
    total = ndimage.uniform_filter(np.where(sea, values, 0).astype(np.float32), span, mode="nearest")
    count = ndimage.uniform_filter(ones, span, mode="nearest")
    return np.divide(total, count, out=np.full_like(total, np.nan), where=count > 0.25)


def features_in(elev, transform, cell, core, args):
    """Every spot depth in one window, as (row, col, depth_m, kind, rank_m)."""
    sea = elev < -0.01
    if not sea.any():
        return []
    rim = ndimage.binary_dilation(sea, EIGHT) & ~sea
    height = np.where(sea, elev, 0).astype(np.float32)
    found: list[tuple[int, int, float, str, float]] = []

    for kind, field, sign in (("shoal", height, 1.0), ("pit", -height, -1.0)):
        pos, vals, prom = prominence(field, sea, rim, args.step, args.cap)
        keep = prom >= args.min_prominence
        for (r, c), value, rank in zip(pos[keep], vals[keep], prom[keep]):
            found.append((int(r), int(c), float(-sign * value), kind, float(rank)))

    span = max(3, int(round(2 * args.position_radius_m / cell)) | 1)
    stride = max(3, int(round(args.spacing_m / cell)) | 1)
    # Where a summit already stands, so a ridge high point does not write a second
    # number on the same rock. A summit is the better reading of the two: it knows
    # how far the ground falls away, and a ridge point only knows the local mean.
    taken = np.zeros(sea.shape, bool)
    for r, c, _, _, _ in found:
        taken[r, c] = True
    taken = ndimage.maximum_filter(taken, size=stride, mode="constant", cval=False)

    position = np.where(sea, height - boxcar(height, sea, span), np.nan)
    reliable = sea & np.isfinite(position)
    for kind, sign in (("crest", 1.0), ("canyon", -1.0)):
        on_path = reliable & ~taken & (sign * position >= args.min_position)
        for r, c in spaced_extrema(sign * height, on_path, stride):
            found.append((int(r), int(c), float(-height[r, c]), kind, float(abs(position[r, c]))))

    # A plain is ground with nothing to read on it, which is not the same as ground
    # that is level. This shelf falls about a metre every hundred, so any window
    # wide enough to be worth one label spans more relief than a flatness threshold
    # would ever allow, and the first version of this rule found plains in the four
    # or five places the seabed happens to sit level and nowhere else. Two tests
    # instead. Distance from the local mean survives the slope, because a smooth
    # ramp sits on its own mean the whole way down it. And relief over a short span
    # is what rejects rough ground, because a rock field also averages out.
    rough = max(3, int(round(2 * args.flat_rough_m / cell)) | 1)
    relief = ndimage.maximum_filter(np.where(sea, height, -WALL), rough) - ndimage.minimum_filter(
        np.where(sea, height, WALL), rough
    )
    plain = (
        sea & reliable & ~taken & (np.abs(position) < args.flat_position) & (relief < args.flat_relief)
    )
    lab, count = ndimage.label(plain, structure=EIGHT)
    if count:
        area = np.bincount(lab.ravel(), minlength=count + 1)[1:] * cell * cell
        wide = np.zeros(count + 1, bool)
        wide[1:] = area >= args.flat_area_m2
        room = ndimage.distance_transform_edt(wide[lab]) * cell
        for r, c in spaced_extrema(room, wide[lab], stride):
            found.append((int(r), int(c), float(-height[r, c]), "flat", float(area[lab[r, c] - 1])))

    # Water this shallow is the beach. A cell at 0.4 m is where the survey met the
    # shore, not a rock worth briefing, and "0 m" written along the whole coastline
    # is the noisiest thing this could put on the map.
    found = [row for row in found if row[2] >= args.min_depth]

    top, left, rows, cols = core
    out = []
    for r, c, depth, kind, rank in found:
        if not (top <= r < top + rows and left <= c < left + cols):
            continue
        x, y = transform * (c + 0.5, r + 0.5)
        out.append((lonlat(x, y), round(depth), kind, rank))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem", required=True)
    ap.add_argument("--out", required=True, help="candidates, one GeoJSON feature per line")
    ap.add_argument("--core", type=int, default=4096, help="tile side in DEM cells")
    ap.add_argument("--halo", type=int, default=1024, help="cells of context around each tile")
    ap.add_argument("--step", type=float, default=0.5, help="metres per flood level")
    ap.add_argument("--cap", type=float, default=30.0, help="prominence past which nothing ranks higher")
    ap.add_argument("--min-prominence", type=float, default=1.0)
    ap.add_argument("--min-depth", type=float, default=2.0, help="metres, below which it is beach")
    ap.add_argument("--position-radius-m", type=float, default=120.0)
    ap.add_argument("--min-position", type=float, default=1.0, help="metres off the local mean")
    ap.add_argument("--spacing-m", type=float, default=150.0, help="between labels along a path")
    ap.add_argument("--flat-relief", type=float, default=1.0, help="metres over --flat-rough-m")
    ap.add_argument("--flat-rough-m", type=float, default=60.0, help="radius the roughness is read over")
    ap.add_argument("--flat-position", type=float, default=0.5, help="metres off the local mean")
    ap.add_argument("--flat-area-m2", type=float, default=20000.0)
    ap.add_argument("--bbox", help="lon,lat,lon,lat to limit the pass to, for a probe")
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    if out.exists():
        print(f"have {out}")
        return 0

    started = time.time()
    counts = {kind: 0 for kind in KINDS}
    part = out.with_suffix(out.suffix + ".part")
    with rasterio.open(args.dem) as src, part.open("w", encoding="utf-8") as sink:
        cell = abs(src.transform.a)
        limit = None
        if args.bbox:
            w, s, e, n = (float(v) for v in args.bbox.split(","))
            (x0, y0), (x1, y1) = merc(w, s), merc(e, n)
            limit = (x0, y0, x1, y1)
        tiles = [
            (top, left)
            for top in range(0, src.height, args.core)
            for left in range(0, src.width, args.core)
        ]
        done = 0
        for top, left in tiles:
            rows = min(args.core, src.height - top)
            cols = min(args.core, src.width - left)
            if limit is not None:
                x0, y0 = src.transform * (left, top + rows)
                x1, y1 = src.transform * (left + cols, top)
                if x1 < limit[0] or x0 > limit[2] or y1 < limit[1] or y0 > limit[3]:
                    continue
            probe = src.read(
                1, window=Window(left, top, cols, rows), out_shape=(1, 64, 64), boundless=False
            )
            if not (probe < -0.01).any():
                continue
            wtop = max(0, top - args.halo)
            wleft = max(0, left - args.halo)
            wrows = min(src.height, top + rows + args.halo) - wtop
            wcols = min(src.width, left + cols + args.halo) - wleft
            window = Window(wleft, wtop, wcols, wrows)
            elev = src.read(1, window=window).astype(np.float32)
            found = features_in(
                elev,
                src.window_transform(window),
                cell,
                (top - wtop, left - wleft, rows, cols),
                args,
            )
            for (lon, lat), depth, kind, rank in found:
                counts[kind] += 1
                sink.write(
                    json.dumps(
                        {
                            "type": "Feature",
                            "properties": {"d": depth, "k": kind, "r": round(rank, 2)},
                            "geometry": {
                                "type": "Point",
                                "coordinates": [round(lon, 6), round(lat, 6)],
                            },
                        },
                        separators=(",", ":"),
                    )
                    + "\n"
                )
            done += 1
            print(
                f"  tile {done} at {left},{top}: {len(found)} "
                f"({time.time() - started:.0f}s)",
                file=sys.stderr,
                flush=True,
            )

    part.rename(out)
    total = sum(counts.values())
    print(f"wrote {out}: {total} candidates in {time.time() - started:.0f}s")
    for kind in KINDS:
        print(f"  {kind:7} {counts[kind]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
