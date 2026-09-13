#!/usr/bin/env python3
"""Rebuilds the ICGC habitat and substrate polygons as one partition of the plane, and opens
the corners where a class touches itself at a single point.

The source is not a partition. Measured over the whole habitat file: every one of its
1,243,451 vertices sits exactly on the 1e-4 degree grid it was rasterised from, but 68,770 of
its 93,078 rings carry a zero-width spur, 81% of rings visit some vertex twice, and whole cells
are claimed by two classes at once. A face fan that tiles the circle round a vertex exists at
653 of 96,918 candidate vertices. There is no shared-edge topology here to preserve; there is
one to build.

Because every source vertex is on the 1e-4 degree grid, reading the polygons back onto that
grid invents nothing: it is the survey's own quantum, not a finer one. It does drop the diagonal
half-cells the vectoriser cut, which are the right triangles the map shows. Cells claimed twice
go to the smallest feature claiming them, which is the rule that keeps small features whole, and
a feature covering no cell centre is given the cell under its own centroid so nothing disappears.

From the grid the arrangement follows. A cell side is a boundary exactly when the two cells
differ, and each side belongs to the region on its left. Two neighbours therefore walk one side
over one pair of endpoints, so neither a gap nor an overlap is representable.

The pinch is a grid corner where one class holds two opposite quadrants and neither of the other
two. Only one of the two diagonals can pass through a corner. The winner's walk turns towards
its other quadrant; the loser's two quadrants pull their corner back to a point a short way
inside themselves, and every cell side bounding a losing quadrant ends on that same point. The
join is then a neck of real width instead of a touch, and both sides of it are one coordinate.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from array import array
from collections import Counter, defaultdict

import numpy as np

GRID = 10_000_000
CELL = 1_000
OUT = -1
LAT0 = 41.4
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 110574.0
CELL_X = CELL / GRID * MX
CELL_Y = CELL / GRID * MY
DIAG = math.hypot(CELL_X, CELL_Y)
CELL_AREA = CELL_X * CELL_Y
YSPAN = 1 << 16

EAST, NORTH, WEST, SOUTH = 0, 1, 2, 3
STEP = ((1, 0), (0, 1), (-1, 0), (0, -1))

# Which way a corner's losing quadrant lies, per side leaving that corner. A side pointing east
# bounds the south-east and north-east quadrants and exactly one of them loses, so the side has
# one place to go. The first row is for the south-west to north-east diagonal winning.
SIDE_OFFSET = (
    ((1, -1), (-1, 1), (-1, 1), (1, -1)),
    ((1, 1), (1, 1), (-1, -1), (-1, -1)),
)


def node_id(x: int, y: int) -> int:
    return x * YSPAN + y


class Source:
    """Every feature's rings in cell units, with what the overlap rule needs to order them."""

    def __init__(self) -> None:
        self.props: list[dict] = []
        self.rings: list[list[tuple[array, array]]] = []
        self.area: list[float] = []
        self.lo_y: list[int] = []
        self.hi_y: list[int] = []
        self.seed: list[tuple[int, int] | None] = []

    def add(self, props: dict, geom: dict | None) -> None:
        rings: list[tuple[array, array]] = []
        twice = sx = sy = 0.0
        lo, hi = 0, -1
        if geom and geom.get("coordinates"):
            coords = geom["coordinates"]
            for poly in coords if geom.get("type") == "MultiPolygon" else [coords]:
                for r in poly:
                    xs, ys = array("i"), array("i")
                    for lon, lat in r:
                        x = int(round(lon * GRID)) // CELL
                        y = int(round(lat * GRID)) // CELL
                        if xs and xs[-1] == x and ys[-1] == y:
                            continue
                        xs.append(x)
                        ys.append(y)
                    while len(xs) > 1 and xs[0] == xs[-1] and ys[0] == ys[-1]:
                        xs.pop()
                        ys.pop()
                    if len(xs) < 3:
                        continue
                    for i in range(len(xs)):
                        j = (i + 1) % len(xs)
                        cross = xs[i] * ys[j] - xs[j] * ys[i]
                        twice += cross
                        sx += (xs[i] + xs[j]) * cross
                        sy += (ys[i] + ys[j]) * cross
                    lo, hi = (min(ys), max(ys)) if hi < lo else (min(lo, min(ys)), max(hi, max(ys)))
                    rings.append((xs, ys))
        self.props.append(props)
        self.rings.append(rings)
        self.area.append(abs(twice) / 2.0)
        self.lo_y.append(lo)
        self.hi_y.append(hi)
        if twice:
            seed = (int(math.floor(sx / (3.0 * twice))), int(math.floor(sy / (3.0 * twice))))
        elif rings:
            seed = (rings[0][0][0], rings[0][1][0])
        else:
            seed = None
        self.seed.append(seed)

    def __len__(self) -> int:
        return len(self.props)


def read_source(path: str) -> Source:
    src = Source()
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            f = json.loads(line)
            src.add(f.get("properties") or {}, f.get("geometry"))
    return src


def fill(rings, y_lo: int, y_hi: int):
    """Row by row, the x ranges the rings cover, read at cell centres by non-zero winding.

    No vertex can sit on a scanline, because vertices are whole cells and the scanlines are half
    cells, so there are no ties to break. A crossing landing exactly on a cell centre is a
    diagonal the vectoriser cut, and the half-open rule below sends that cell one way every time.
    """
    edges = []
    for xs, ys in rings:
        n = len(xs)
        for i in range(n):
            j = (i + 1) % n
            if ys[i] != ys[j]:
                edges.append((min(ys[i], ys[j]), max(ys[i], ys[j]), xs[i], ys[i], xs[j], ys[j]))
    edges.sort()
    active: list = []
    at = 0
    for y in range(y_lo, y_hi):
        while at < len(edges) and edges[at][0] <= y:
            active.append(edges[at])
            at += 1
        active = [e for e in active if e[1] > y]
        if not active:
            continue
        hits = sorted(
            (xa + (xb - xa) * (2 * (y - ya) + 1) / (2 * (yb - ya)), 1 if yb > ya else -1)
            for _, _, xa, ya, xb, yb in active
        )
        wind = 0
        start = 0.0
        spans = []
        for x, turn in hits:
            if wind == 0:
                start = x
            wind += turn
            if wind == 0:
                a, b = math.ceil(start - 0.5), math.ceil(x - 0.5)
                if b > a:
                    spans.append((a, b))
        if spans:
            yield y, spans


def covered(src: Source, f: int) -> bool:
    return any(True for _ in fill(src.rings[f], src.lo_y[f], src.hi_y[f]))


def rasterise(src: Source, x0: int, y0: int, width: int, height: int, strip: int, rescued, log):
    """The label grid, a strip of rows at a time, smallest feature last so it wins any contest.

    Only the cell sides survive a strip, so the whole grid is never held at once.
    """
    order = sorted(range(len(src)), key=lambda f: (-src.area[f], f))
    buckets: dict[int, list[int]] = defaultdict(list)
    for f in order:
        if src.rings[f]:
            for s in range((src.lo_y[f] - y0) // strip, (src.hi_y[f] - y0) // strip + 1):
                buckets[s].append(f)
    seeds: dict[int, list[int]] = defaultdict(list)
    for f in rescued:
        seeds[(src.seed[f][1] - y0) // strip].append(f)

    below = np.full(width, OUT, dtype=np.int32)
    horizontal, vertical = [], []
    count = (height + strip - 1) // strip
    for s in range(count):
        lo = s * strip
        rows = min(strip, height - lo)
        grid = np.full((rows, width), OUT, dtype=np.int32)
        for f in buckets.get(s, ()):
            top = y0 + lo
            for y, ranges in fill(src.rings[f], max(src.lo_y[f], top), min(src.hi_y[f], top + rows)):
                row = grid[y - top]
                for a, b in ranges:
                    row[max(0, a - x0) : max(0, b - x0)] = f
        for f in seeds.get(s, ()):
            sx, sy = src.seed[f]
            row, col = sy - y0 - lo, sx - x0
            if 0 <= row < rows and 0 <= col < width:
                grid[row, col] = f
        stack = np.vstack((below.reshape(1, -1), grid))
        ys, xs = np.nonzero(stack[:-1] != stack[1:])
        horizontal.append(np.stack((xs, ys + lo, stack[:-1][ys, xs], stack[1:][ys, xs]), axis=1))
        ys, xs = np.nonzero(grid[:, :-1] != grid[:, 1:])
        vertical.append(np.stack((xs + 1, ys + lo, grid[:, :-1][ys, xs], grid[:, 1:][ys, xs]), axis=1))
        below = grid[-1].copy()
        log(f"  strip {s + 1}/{count} sides {len(horizontal[-1])}h {len(vertical[-1])}v")
    (xs,) = np.nonzero(below != OUT)
    horizontal.append(np.stack((xs, np.full(len(xs), height), below[xs], np.full(len(xs), OUT)), axis=1))
    return np.vstack(horizontal), np.vstack(vertical)


def corner_labels(horizontal: np.ndarray, vertical: np.ndarray):
    """The four cells round every grid corner that a cell side touches."""
    quad: dict[int, list[int]] = defaultdict(lambda: [OUT, OUT, OUT, OUT])
    for x, y, south, north in horizontal.tolist():
        quad[node_id(x + 1, y)][0] = south
        quad[node_id(x, y)][1] = south
        quad[node_id(x + 1, y)][2] = north
        quad[node_id(x, y)][3] = north
    for x, y, west, east in vertical.tolist():
        quad[node_id(x, y + 1)][0] = west
        quad[node_id(x, y)][2] = west
        quad[node_id(x, y + 1)][1] = east
        quad[node_id(x, y)][3] = east
    return quad


def decide(quad, code, size, ratio: float, delta: float):
    """Which diagonal passes through each corner, and how far the loser's corner pulls back.

    A corner offers a diagonal when one feature holds two opposite quadrants and neither of the
    other two; it is a pinch to the eye when the class does. Both diagonals can be pinched at
    once and only one can pass, so a class pinch goes ahead of a mere feature one and a tie goes
    to the smaller polygon: the hanging triangle grows and its larger neighbour gives up the
    corner. The rule reads nothing but the corner, so both sides of every boundary agree on it.
    """
    joined: dict[int, tuple[int, int, float, float]] = {}
    tally: Counter[str] = Counter()

    def cls(q):
        return code[q] if q != OUT else None

    for nid, (sw, se, nw, ne) in quad.items():
        fa = sw == ne and sw != OUT and sw != se and sw != nw
        fb = se == nw and se != OUT and se != sw and se != ne
        ca = cls(sw) is not None and cls(sw) == cls(ne) and cls(sw) != cls(se) and cls(sw) != cls(nw)
        cb = cls(se) is not None and cls(se) == cls(nw) and cls(se) != cls(sw) and cls(se) != cls(ne)
        if not (fa or fb or ca or cb):
            continue
        if ca or cb:
            tally["corners pinched"] += 1
            if ca and cb:
                tally["both classes pinched there"] += 1
        if ca != cb:
            pick_a = ca
        elif fa != fb:
            pick_a = fa
        else:
            pick_a = (size[sw] if sw != OUT else 0.0, sw) <= (size[se] if se != OUT else 0.0, se)
        live = [q for q in (sw, se, nw, ne) if q != OUT]
        step = min(delta, ratio * min(size[q] for q in live)) if live else 0.0
        if step <= 0.0:
            tally["corners left pinched, no travel budget"] += 1
            continue
        joined[nid] = (sw if pick_a else se, 0 if pick_a else 1, step * CELL_X / DIAG, step * CELL_Y / DIAG)
        if ca or cb:
            tally["corners opened"] += 1
        else:
            tally["corners squared off with no class pinched"] += 1
    return joined, tally


def directed_sides(horizontal: np.ndarray, vertical: np.ndarray):
    """Every cell side as the feature on its left leaves one corner for the next."""
    rows: list[tuple[int, int, int]] = []
    for x, y, south, north in horizontal.tolist():
        if north != OUT:
            rows.append((north, node_id(x, y), EAST))
        if south != OUT:
            rows.append((south, node_id(x + 1, y), WEST))
    for x, y, west, east in vertical.tolist():
        if west != OUT:
            rows.append((west, node_id(x, y), NORTH))
        if east != OUT:
            rows.append((east, node_id(x, y + 1), SOUTH))
    n = len(rows)
    feat = np.fromiter((r[0] for r in rows), dtype=np.int64, count=n)
    node = np.fromiter((r[1] for r in rows), dtype=np.int64, count=n)
    side = np.fromiter((r[2] for r in rows), dtype=np.int64, count=n)
    order = np.lexsort((side, node, feat))
    feat, node, side = feat[order], node[order], side[order]
    key = feat * (1 << 32) + node
    dx = np.array([STEP[d][0] for d in range(4)], dtype=np.int64)[side]
    dy = np.array([STEP[d][1] for d in range(4)], dtype=np.int64)[side]
    ahead = feat * (1 << 32) + node + dx * YSPAN + dy
    return key, node, side, np.searchsorted(key, ahead, "left"), np.searchsorted(key, ahead, "right")


def node_degree(horizontal: np.ndarray, vertical: np.ndarray):
    ends = np.concatenate(
        (
            horizontal[:, 0] * YSPAN + horizontal[:, 1],
            (horizontal[:, 0] + 1) * YSPAN + horizontal[:, 1],
            vertical[:, 0] * YSPAN + vertical[:, 1],
            vertical[:, 0] * YSPAN + vertical[:, 1] + 1,
        )
    )
    ids, counts = np.unique(ends, return_counts=True)
    return set(ids[counts == 2].tolist())


def walk_rings(key, node, side, lo, hi, joined, plain, origin, log):
    """Every feature's boundary walked into rings, with the pinched corners already opened.

    A feature leaves a corner once for each quadrant it holds there, so the only corner offering
    a choice is one where it holds two opposite quadrants. The winner turns clockwise, into its
    other quadrant; everyone else turns the other way. The point a walk writes for a corner is
    the corner itself, unless the side it arrived on, or the one it leaves by, bounds a quadrant
    that pulled back; then it is that quadrant's new point, which every ring reading that side
    writes too.
    """
    used = np.zeros(len(key), dtype=bool)
    rings: list[list[tuple[float, float]]] = []
    owner: list[int] = []

    def anchor(nid: int, out: int) -> tuple[float, float]:
        cx, cy = divmod(nid, YSPAN)
        x, y = cx + origin[0], cy + origin[1]
        got = joined.get(nid)
        if got is None:
            return (x * CELL_X, y * CELL_Y)
        _, diagonal, sx, sy = got
        dx, dy = SIDE_OFFSET[diagonal][out]
        return (x * CELL_X + dx * sx, y * CELL_Y + dy * sy)

    for seed in range(len(key)):
        if used[seed]:
            continue
        f = int(key[seed] >> 32)
        walk: list[tuple[int, int]] = []
        cur = seed
        while True:
            used[cur] = True
            walk.append((int(node[cur]), int(side[cur])))
            group = range(int(lo[cur]), int(hi[cur]))
            if len(group) == 1:
                step = group[0]
            elif not group:
                break
            else:
                ahead = int(node[group[0]])
                turn = (walk[-1][1] - 1) % 4 if joined.get(ahead, (None,))[0] == f else (walk[-1][1] + 1) % 4
                match = [i for i in group if int(side[i]) == turn]
                if not match:
                    break
                step = match[0]
            if used[step]:
                break
            cur = step
        if len(walk) < 3:
            continue
        ring: list[tuple[float, float]] = []
        for n, (here, out) in enumerate(walk):
            came = (walk[n - 1][1] + 2) % 4
            a = anchor(here, came)
            b = anchor(here, out)
            if a == b and came == (out + 2) % 4 and here in plain:
                continue
            if not ring or ring[-1] != a:
                ring.append(a)
            if b != a:
                ring.append(b)
        while len(ring) > 1 and ring[0] == ring[-1]:
            ring.pop()
        if len(ring) >= 3:
            rings.append(ring)
            owner.append(f)
            if len(rings) % 25000 == 0:
                log(f"  rings {len(rings)}")
    return rings, owner


def signed_area(ring) -> float:
    twice = 0.0
    for i in range(len(ring)):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % len(ring)]
        twice += x0 * y1 - x1 * y0
    return twice / 2.0


def inside(ring, pt) -> bool:
    x, y = pt
    hit = False
    for i in range(len(ring)):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % len(ring)]
        if (y0 > y) != (y1 > y) and x < x0 + (x1 - x0) * (y - y0) / (y1 - y0):
            hit = not hit
    return hit


def assemble(rings, owner):
    """Groups each feature's rings into polygons, giving every hole the smallest shell over it."""
    by_feature: dict[int, list[int]] = defaultdict(list)
    for i, f in enumerate(owner):
        by_feature[f].append(i)
    shapes: dict[int, list[list[list[tuple[float, float]]]]] = {}
    for f, ids in by_feature.items():
        shells = [i for i in ids if signed_area(rings[i]) > 0]
        holes = [i for i in ids if signed_area(rings[i]) <= 0]
        built = [[rings[i]] for i in shells]
        for h in holes:
            fits = [
                k for k, i in enumerate(shells) if inside(rings[i], rings[h][0])
            ]
            if fits:
                pick = min(fits, key=lambda k: abs(signed_area(rings[shells[k]])))
                built[pick].append(rings[h])
        shapes[f] = built
    return shapes


def to_json(polys, precision: int):
    out = []
    for poly in polys:
        built = []
        for ring in poly:
            coords = [
                [round(x / MX, precision), round(y / MY, precision)] for x, y in ring
            ]
            trimmed = [coords[0]]
            for c in coords[1:]:
                if c != trimmed[-1]:
                    trimmed.append(c)
            while len(trimmed) > 1 and trimmed[0] == trimmed[-1]:
                trimmed.pop()
            if len(trimmed) < 3:
                continue
            trimmed.append(list(trimmed[0]))
            built.append(trimmed)
        if built:
            out.append(built)
    if not out:
        return None
    if len(out) == 1:
        return {"type": "Polygon", "coordinates": out[0]}
    return {"type": "MultiPolygon", "coordinates": out}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst")
    ap.add_argument("--delta", type=float, default=2.0)
    ap.add_argument("--size-ratio", type=float, default=0.18)
    ap.add_argument("--strip", type=int, default=2048)
    ap.add_argument("--precision", type=int, default=7)
    args = ap.parse_args()

    def log(msg):
        print(msg, flush=True)

    src = read_source(args.src)
    live = [f for f in range(len(src)) if src.rings[f]]
    x0 = min(min(xs) for f in live for xs, _ in src.rings[f])
    x1 = max(max(xs) for f in live for xs, _ in src.rings[f])
    y0 = min(src.lo_y[f] for f in live)
    y1 = max(src.hi_y[f] for f in live)
    x0, x1, y0, y1 = x0 - 1, x1 + 1, y0 - 1, y1 + 1
    log(f"features            {len(src)} ({len(live)} with geometry)")
    log(f"grid                {x1 - x0} x {y1 - y0} cells of {CELL_X:.2f} x {CELL_Y:.2f} m, one cell of outside all round")
    if (x1 - x0 + 2) * YSPAN >= 1 << 32 or y1 - y0 + 2 >= YSPAN:
        raise SystemExit("extent too large for the corner packing")

    rescued = [f for f in live if src.seed[f] and not covered(src, f)]
    log(f"under one cell      {len(rescued)} features given the cell under their centroid")

    horizontal, vertical = rasterise(src, x0, y0, x1 - x0, y1 - y0, args.strip, rescued, log)
    log(f"cell sides          {len(horizontal)} horizontal, {len(vertical)} vertical")

    quad = corner_labels(horizontal, vertical)
    log(f"grid corners        {len(quad)}")

    perim = Counter()
    for _, _, a, b in horizontal.tolist():
        perim[a] += CELL_X
        perim[b] += CELL_X
    for _, _, a, b in vertical.tolist():
        perim[a] += CELL_Y
        perim[b] += CELL_Y
    area = Counter()
    for f in live:
        area[f] = src.area[f] * CELL_AREA
    size = {f: (4.0 * area[f] / perim[f] if perim[f] else 0.0) for f in live}
    size[OUT] = 0.0

    code = [p.get("code") for p in src.props]
    joined, tally = decide(quad, code, size, args.size_ratio, args.delta)
    log(f"corner decisions    {dict(tally)}")

    key, node, side, lo, hi = directed_sides(horizontal, vertical)
    plain = node_degree(horizontal, vertical)
    log(f"directed sides      {len(key)}   corners of degree two {len(plain)}")

    rings, owner = walk_rings(key, node, side, lo, hi, joined, plain, (x0, y0), log)
    log(f"rings               {len(rings)}")

    if args.dst:
        shapes = assemble(rings, owner)
        gone = 0
        with open(args.dst, "w", encoding="utf-8") as fh:
            for f in range(len(src)):
                geom = to_json(shapes.get(f, []), args.precision)
                if geom is None and src.rings[f]:
                    gone += 1
                fh.write(
                    json.dumps(
                        {"type": "Feature", "properties": src.props[f], "geometry": geom},
                        separators=(",", ":"),
                    )
                )
                fh.write("\n")
        log(f"features with no geometry  {gone}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
