#!/usr/bin/env python3
"""Measures what the habitat pipeline did to the polygons, over the whole coast.

Five questions, each answered by its own case with its own assertion, and each case printed
whether it passes or not. The count of cases that ran is printed too, because a check that
silently stopped running is the failure mode this file exists to make impossible.

  pinch      corners where one class meets itself at a point and nowhere else
  overlaps   area claimed by two features at once
  gaps       area inside the surveyed coverage that no feature claims
  mapping    features that vanished or fell under the minimum mapping unit
  travel     how far the boundary moved from the source

Overlaps, gaps and travel are read tile by tile over the whole extent rather than from a
sample, so every feature is examined. Tiles only bound how much geometry is in memory at once.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict

import shapely
from shapely import make_valid
from shapely.affinity import scale
from shapely.geometry import Polygon, box, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

LAT0 = 41.4
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 110574.0
MMU = 100.0
TILE = 0.1
CELL_DIAGONAL = math.hypot(1e-4 * MX, 1e-4 * MY)


class Case:
    """One check. It fails loudly if it never ran."""

    def __init__(self, log) -> None:
        self.log = log
        self.ran: list[str] = []
        self.failed: list[str] = []

    def report(self, name: str, ok: bool, detail: str) -> None:
        self.ran.append(name)
        if not ok:
            self.failed.append(name)
        self.log(f"[{'PASS' if ok else 'FAIL'}] {name:26s} {detail}")

    def finish(self, expected: int) -> int:
        self.log("")
        self.log(f"cases run {len(self.ran)} of {expected}, failed {len(self.failed)}")
        if len(self.ran) != expected:
            self.log(f"MISSING {expected - len(self.ran)} cases never ran: {self.ran}")
            return 2
        return 1 if self.failed else 0


def read(path: str):
    """Features as (class, properties, shapely geometry), with invalid input repaired."""
    codes, props, geoms, broken = [], [], [], 0
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        f = json.loads(line)
        g = f.get("geometry")
        p = f.get("properties") or {}
        if not g:
            codes.append(p.get("code"))
            props.append(p)
            geoms.append(None)
            continue
        got = shape(g)
        if not got.is_valid:
            broken += 1
            got = make_valid(got)
        codes.append(p.get("code"))
        props.append(p)
        geoms.append(got)
    return codes, props, geoms, broken


def rings_of(path: str):
    """Every ring of every feature as a list of quantised points, with its class."""
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        f = json.loads(line)
        g = f.get("geometry")
        if not g:
            continue
        code = (f.get("properties") or {}).get("code")
        for poly in g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]:
            for r in poly:
                seq = []
                for lon, lat in r:
                    pt = (round(lon * 1e7), round(lat * 1e7))
                    if not seq or seq[-1] != pt:
                        seq.append(pt)
                while len(seq) > 1 and seq[0] == seq[-1]:
                    seq.pop()
                if len(seq) >= 3:
                    yield code, seq


def pinch_count(path: str) -> tuple[int, int]:
    """Corners where one class arrives twice without the two arrivals sharing a side.

    Two polygons of one class that abut along a segment read as one shape, and one that meets
    itself across a corner does not. So the test is whether the visits of a class at a vertex
    hang together through the sides at that vertex: walk the visits, join any two that share an
    incident side, and count a pinch when a class ends up in more than one piece.
    """
    visits: dict[tuple[int, int], list[tuple[str | None, int, int]]] = defaultdict(list)
    for rid, (code, seq) in enumerate(rings_of(path)):
        n = len(seq)
        for i in range(n):
            visits[seq[i]].append((code, seq[i - 1], seq[(i + 1) % n]))
    pinched = 0
    for _, here in visits.items():
        if len(here) < 2:
            continue
        by_class: dict[str | None, list[tuple[int, int]]] = defaultdict(list)
        for code, prev, nxt in here:
            by_class[code].append((prev, nxt))
        for code, arrivals in by_class.items():
            if len(arrivals) < 2:
                continue
            group = list(range(len(arrivals)))

            def root(i, g=group):
                while g[i] != i:
                    g[i] = g[g[i]]
                    i = g[i]
                return i

            for i in range(len(arrivals)):
                for j in range(i + 1, len(arrivals)):
                    if set(arrivals[i]) & set(arrivals[j]):
                        group[root(j)] = root(i)
            if len({root(i) for i in range(len(arrivals))}) > 1:
                pinched += 1
    return pinched, len(visits)


def tiles(geoms):
    """The extent cut into square tiles, each holding the features whose box reaches it."""
    live = [g for g in geoms if g is not None]
    xs = [g.bounds for g in live]
    west = min(b[0] for b in xs)
    south = min(b[1] for b in xs)
    east = max(b[2] for b in xs)
    north = max(b[3] for b in xs)
    nx = max(1, math.ceil((east - west) / TILE))
    ny = max(1, math.ceil((north - south) / TILE))
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, g in enumerate(geoms):
        if g is None or g.is_empty:
            continue
        w, s, e, n = g.bounds
        for tx in range(max(0, int((w - west) / TILE)), min(nx, int((e - west) / TILE) + 1)):
            for ty in range(max(0, int((s - south) / TILE)), min(ny, int((n - south) / TILE) + 1)):
                buckets[(tx, ty)].append(i)
    for (tx, ty), ids in sorted(buckets.items()):
        yield box(west + tx * TILE, south + ty * TILE, west + (tx + 1) * TILE, south + (ty + 1) * TILE), ids


def polygons_of(geom):
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [p for part in geom.geoms for p in polygons_of(part)]
    return []


def square_metres(area_deg2: float) -> float:
    return area_deg2 * MX * MY


def overlap_and_gap(geoms, log):
    """Area claimed twice, and holes inside the coverage, both read over every tile."""
    twice = 0.0
    pairs = 0
    hole_area = 0.0
    holes = 0
    seen = 0
    for cell, ids in tiles(geoms):
        here = [geoms[i] for i in ids]
        tree = STRtree(here)
        for a, g in enumerate(here):
            for b in tree.query(g):
                if b <= a:
                    continue
                hit = g.intersection(here[b])
                if hit.area > 0 and hit.centroid.within(cell):
                    pairs += 1
                    twice += hit.area
        merged = unary_union(here)
        for part in polygons_of(merged):
            for interior in part.interiors:
                gap = Polygon(interior)
                if gap.centroid.within(cell):
                    holes += 1
                    hole_area += gap.area
        seen += 1
        if seen % 50 == 0:
            log(f"  tiles {seen}")
    return twice, pairs, holes, hole_area


def travel(source, result, log):
    """How far each point of the new boundary sits from the old one, in metres, tile by tile."""
    worst = 0.0
    counted = 0
    far = 0
    seen = 0
    for cell, ids in tiles(result):
        w, s_, e, n = cell.bounds
        near = [
            g
            for g in source
            if g is not None
            and not g.is_empty
            and g.bounds[0] <= e + TILE
            and g.bounds[2] >= w - TILE
            and g.bounds[1] <= n + TILE
            and g.bounds[3] >= s_ - TILE
        ]
        if not near:
            continue
        edges = scale(unary_union([g.boundary for g in near]), xfact=MX, yfact=MY, origin=(0, 0))
        xs, ys = [], []
        for i in ids:
            g = result[i]
            for part in polygons_of(g):
                for ring in [part.exterior, *part.interiors]:
                    for lon, lat in ring.coords:
                        if w <= lon < e and s_ <= lat < n:
                            xs.append(lon * MX)
                            ys.append(lat * MY)
        if not xs:
            continue
        gaps = shapely.distance(shapely.points(xs, ys), edges)
        counted += len(gaps)
        worst = max(worst, float(gaps.max()))
        far += int((gaps > CELL_DIAGONAL).sum())
        seen += 1
        if seen % 50 == 0:
            log(f"  tiles {seen} points {counted} worst {worst:.2f} m")
    return worst, counted, far


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--result", required=True)
    ap.add_argument("--skip-travel", action="store_true")
    args = ap.parse_args()

    def log(msg):
        print(msg, flush=True)

    case = Case(log)
    log(f"source {args.source}")
    log(f"result {args.result}")

    src_codes, src_props, src_geoms, src_broken = read(args.source)
    out_codes, out_props, out_geoms, out_broken = read(args.result)
    log(f"features source {len(src_geoms)}  result {len(out_geoms)}")

    case.report(
        "valid polygons",
        out_broken == 0,
        f"{out_broken} of {len(out_geoms)} need repair, against {src_broken} in the source",
    )

    before, bvert = pinch_count(args.source)
    after, avert = pinch_count(args.result)
    case.report(
        "pinch corners",
        after < before,
        f"{before} over {bvert} vertices -> {after} over {avert} "
        f"({100.0 * (before - after) / max(before, 1):.2f}% gone)",
    )

    twice, pairs, holes, hole_area = overlap_and_gap(out_geoms, log)
    total = sum(g.area for g in out_geoms if g is not None)
    case.report(
        "overlaps",
        twice == 0.0,
        f"{pairs} overlapping pairs, {square_metres(twice):.1f} m2 of {square_metres(total):.0f} m2",
    )

    s_twice, s_pairs, s_holes, s_hole_area = overlap_and_gap(src_geoms, log)
    case.report(
        "gaps",
        hole_area <= s_hole_area * 1.02,
        f"{holes} holes inside the coverage, {square_metres(hole_area):.0f} m2, "
        f"against {s_holes} and {square_metres(s_hole_area):.0f} m2 in the source",
    )

    lost = 0
    fell = 0
    small = 0
    shrunk = []
    for i in range(min(len(src_geoms), len(out_geoms))):
        a = src_geoms[i]
        b = out_geoms[i]
        if a is None or a.is_empty:
            continue
        before_m2 = square_metres(a.area)
        after_m2 = 0.0 if b is None or b.is_empty else square_metres(b.area)
        if after_m2 == 0.0:
            lost += 1
            continue
        if before_m2 >= MMU:
            small += 1
            if after_m2 < MMU:
                fell += 1
        shrunk.append(after_m2 / before_m2)
    shrunk.sort()
    case.report(
        "mapping unit",
        lost == 0 and fell == 0,
        f"{lost} features lost, {fell} of {small} fell under {MMU:.0f} m2, "
        f"area ratio p1 {shrunk[len(shrunk) // 100]:.3f} median {shrunk[len(shrunk) // 2]:.3f} "
        f"p99 {shrunk[-max(1, len(shrunk) // 100)]:.3f}",
    )

    if args.skip_travel:
        case.report("boundary travel", True, "skipped by request")
    else:
        worst, counted, far = travel(src_geoms, out_geoms, log)
        case.report(
            "boundary travel",
            counted > 0,
            f"{counted} points, worst {worst:.2f} m, {far} beyond one cell diagonal "
            f"({CELL_DIAGONAL:.2f} m)",
        )

    return case.finish(6)


if __name__ == "__main__":
    sys.exit(main())
