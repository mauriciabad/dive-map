#!/usr/bin/env python3
"""Scores a land polygon set against the marine habitat polygons it has to meet.

The habitats are the survey; the land is drawn on top of them. Two numbers say
whether the two agree. Overlap is habitat area the land paints over, which reads
as habitat on the wrong side of the shore. Gap is the unsurveyed water between
the land and the nearest habitat, sampled along the shore, which reads as a hole.
"""

from __future__ import annotations

import argparse
import json
import sys

import geopandas as gpd
import numpy as np
from shapely import STRtree, make_valid
from shapely.geometry import shape
from shapely.ops import unary_union


def read_land(path: str):
    g = gpd.read_file(path, engine="pyogrio")
    if g.crs is not None and g.crs.to_epsg() != 25831:
        g = g.to_crs(25831)
    keep = [i for i, x in enumerate(g.geometry.values) if x is not None and not x.is_empty]
    src = g["src"].tolist() if "src" in g.columns else ["?"] * len(g)
    return [g.geometry.values[i] for i in keep], [src[i] for i in keep]


def read_habitats(path: str, limit: int):
    out = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        geom = json.loads(line).get("geometry")
        if geom:
            out.append(shape(geom))
        if limit and len(out) >= limit:
            break
    return gpd.GeoSeries(out, crs=4326).to_crs(25831).values


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--land", required=True)
    ap.add_argument("--habitats", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--samples", type=int, default=20000)
    ap.add_argument("--coast-window-m", type=float, default=3000.0)
    args = ap.parse_args()

    land, land_src = read_land(args.land)
    hab = read_habitats(args.habitats, args.limit)
    print(f"land polygons      {len(land)}")
    print(f"habitat polygons   {len(hab)}")

    tree = STRtree(land)
    overlap = 0.0
    hab_area = 0.0
    skipped = 0
    per_land = [0.0] * len(land)
    for h in hab:
        hab_area += h.area
        hit = tree.query(h, predicate="intersects")
        if not len(hit):
            continue
        for i in hit:
            try:
                a = land[i].intersection(h).area
            except Exception:
                try:
                    a = make_valid(land[i]).intersection(make_valid(h)).area
                except Exception:
                    skipped += 1
                    continue
            per_land[i] += a
            overlap += a
    if skipped:
        print(f"polygons skipped   {skipped}")
    print(f"habitat area       {hab_area / 1e6:12.1f} km2")
    print(f"painted over       {overlap / 1e6:12.3f} km2 ({100 * overlap / hab_area:.3f}%)")
    by_src: dict[str, float] = {}
    for src, a in zip(land_src, per_land):
        by_src[src] = by_src.get(src, 0.0) + a
    for src, a in sorted(by_src.items(), key=lambda kv: -kv[1]):
        print(f"  by {src:16s} {a / 1e6:10.3f} km2")
    worst = sorted(range(len(land)), key=lambda i: -per_land[i])[:8]
    for i in worst:
        c = land[i].centroid
        print(f"  worst {land_src[i]:14s} {per_land[i] / 1e6:8.3f} km2  own area {land[i].area / 1e4:9.1f} ha  at {c.x:.0f},{c.y:.0f}")

    shore = unary_union(land).boundary
    rng = np.random.default_rng(7)
    lengths = np.array([g.length for g in shore.geoms]) if shore.geom_type == "MultiLineString" else np.array([shore.length])
    geoms = list(shore.geoms) if shore.geom_type == "MultiLineString" else [shore]
    pick = rng.choice(len(geoms), size=args.samples, p=lengths / lengths.sum())
    pts = [geoms[i].interpolate(rng.random(), normalized=True) for i in pick]
    htree = STRtree(hab)
    d = np.array([hab[htree.nearest(p)].distance(p) for p in pts])
    # The land polygon is closed with a rectangle far inland, and those samples sit
    # hundreds of kilometres from any habitat. Only the real coast is being scored.
    coast = d[d <= args.coast_window_m]
    print(f"shore to habitat   n={len(coast)} of {len(d)} within {args.coast_window_m:.0f} m")
    for q in (50, 75, 90, 95, 99):
        print(f"  p{q:<3d} {np.percentile(coast, q):9.1f} m")
    print(f"  over 50 m  {100 * (coast > 50).mean():.1f}%   over 200 m  {100 * (coast > 200).mean():.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
