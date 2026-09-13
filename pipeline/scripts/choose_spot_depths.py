#!/usr/bin/env python3
"""Decides which spot depth appears at which zoom, out of the candidates.

Issue #48, and the half of it the owner framed as "this is for the zoom when it
has to decide what to show".

`find_spot_depths.py` finds every place worth a number and scores it. Nothing
there knows about scale. This gives each one the first zoom the map has room for
it at, which is one greedy pass in order of how much the ground moves:

    best candidate first, and for each, the shallowest zoom at which it clears
    every label already placed that is drawn at that zoom.

Two properties fall out, and both are the reason it is a pass rather than a table
of thresholds. Labels are never closer than one label width at any zoom, because
the clearance shrinks with the scale and the test is run against it. And a label
never disappears as a diver zooms in, because a zoom only ever adds.

The clearance is the width of the drawn number, not an abstract distance. That is
the label-based refinement of the shoal-biased selection IHO S-4 describes for
charted soundings: the old rule suppressed neighbours within so many millimetres
of paper, and measuring the symbol instead is what stops the pattern thinning out
where the numbers are narrow and over-plotting where they are wide.

The hand-written ladder this replaces gave each kind a table of prominence
thresholds per zoom. It was six arbitrary numbers per kind and it starved the
middle zooms: over the Medes it put two labels on screen at z13 where there was
room for a dozen, because the thresholds and the spacing rule were two separate
opinions about density and the stricter one always won.

    choose_spot_depths.py --candidates cands.geojsonseq --out spots.geojsonseq
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import pathlib
import sys

R = 6378137.0

KINDS = ("shoal", "pit", "crest", "canyon", "flat")

# The tie-break when two candidates move the ground by the same amount. A summit
# or a hollow is what the issue asks for first, a ridge or a valley floor is the
# same reading spread along a path, and a plain is the one a diver can do without.
KIND_ORDER = {"shoal": 0, "pit": 0, "crest": 1, "canyon": 1, "flat": 2}

# Web mercator metres per pixel at zoom 0, which is the whole of the scale
# arithmetic. Mercator inflates distance by the same factor a tile does, so a
# clearance worked out here needs no latitude in it.
GROUND_AT_Z0 = 2 * math.pi * R / 256


def merc(lon: float, lat: float) -> tuple[float, float]:
    return math.radians(lon) * R, R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def score_of(kind: str, rank: float, flat_scale: float) -> float:
    """How much the ground moves here, in metres, comparable across the kinds.

    Prominence for a summit or a hollow and topographic position for a ridge or a
    valley are both already metres of relief. A plain has none by definition, so
    it is scored on how wide it is instead: `flat_scale` is how many metres across
    a plain has to be to rank with one metre of relief. That trade is a judgement
    rather than a measurement, and it is the only one in this file.
    """
    if kind == "flat":
        return math.sqrt(max(rank, 0.0)) / flat_scale
    return rank


def choose(candidates, clearance, lowest, highest):
    """The zoom each candidate first appears at, or None for the ones with no room.

    Placed labels are kept in one bucket per zoom, on a grid whose cell is that
    zoom's own clearance. A candidate testing zoom z only has to look at the nine
    cells around it in each bucket for zoom z and shallower, because the radius it
    is testing is never larger than the cell of any bucket it looks in.
    """
    # Plain dicts, not defaultdicts. A miss on a defaultdict writes an empty list
    # back, and this asks about nine cells per zoom per candidate, so the grids
    # would fill with millions of empty entries for cells nothing is ever placed in.
    buckets: dict[int, dict[tuple[int, int], list[tuple[float, float]]]] = {
        zoom: {} for zoom in range(lowest, highest + 1)
    }
    given: list[int | None] = []
    for x, y, _ in candidates:
        placed_at = None
        for zoom in range(lowest, highest + 1):
            reach = clearance[zoom]
            if all(
                (x - px) ** 2 + (y - py) ** 2 >= reach * reach
                for shallower in range(lowest, zoom + 1)
                for cell in near(x, y, clearance[shallower])
                for px, py in buckets[shallower].get(cell, ())
            ):
                placed_at = zoom
                break
        given.append(placed_at)
        if placed_at is not None:
            side = clearance[placed_at]
            buckets[placed_at].setdefault((int(x // side), int(y // side)), []).append((x, y))
    return given


def near(x: float, y: float, side: float):
    i, j = int(x // side), int(y // side)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            yield (i + di, j + dj)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--lowest-zoom", type=int, default=10)
    ap.add_argument("--highest-zoom", type=int, default=17)
    ap.add_argument(
        "--label-px",
        type=float,
        default=56.0,
        help="how wide a drawn spot depth reads, mark and number and the air around them",
    )
    ap.add_argument(
        "--flat-scale",
        type=float,
        default=150.0,
        help="metres across a plain has to be to rank with a metre of relief",
    )
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    clearance = {
        zoom: args.label_px * GROUND_AT_Z0 / 2**zoom
        for zoom in range(args.lowest_zoom, args.highest_zoom + 1)
    }

    rows = []
    with open(args.candidates, encoding="utf-8") as source:
        for line in source:
            feature = json.loads(line)
            lon, lat = feature["geometry"]["coordinates"]
            props = feature["properties"]
            x, y = merc(lon, lat)
            rows.append((x, y, (lon, lat, props["d"], props["k"], props["r"])))

    rows.sort(key=lambda row: (-score_of(row[2][3], row[2][4], args.flat_scale), KIND_ORDER[row[2][3]]))
    given = choose(rows, clearance, args.lowest_zoom, args.highest_zoom)

    # Lower is placed first, which is how MapLibre reads a symbol sort key, and the
    # order this pass already ran in is the order. So the key is simply the position
    # in it, unclamped: a byte was the first thing written here and it made every
    # feature past the 255th tie with every other, which is most of the archive and
    # all of the zooms where two of them are close enough to argue.
    part = out.with_suffix(out.suffix + ".part")
    kept = collections.Counter()
    by_zoom = collections.Counter()
    with part.open("w", encoding="utf-8") as sink:
        rank = 0
        for (_, _, (lon, lat, depth, kind, _)), zoom in zip(rows, given):
            if zoom is None:
                continue
            kept[kind] += 1
            by_zoom[zoom] += 1
            sink.write(
                json.dumps(
                    {
                        "type": "Feature",
                        "tippecanoe": {"minzoom": zoom},
                        "properties": {"d": depth, "k": kind, "s": rank},
                        "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )
            rank += 1
    part.rename(out)

    total = sum(kept.values())
    print(f"wrote {out}: {total} of {len(rows)} candidates kept", file=sys.stderr)
    for kind in KINDS:
        print(f"  {kind:7} {kept[kind]}", file=sys.stderr)
    running = 0
    for zoom in range(args.lowest_zoom, args.highest_zoom + 1):
        running += by_zoom[zoom]
        print(f"  z{zoom}: +{by_zoom[zoom]} ({running} drawn)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
