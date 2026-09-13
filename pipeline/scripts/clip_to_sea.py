#!/usr/bin/env python3
"""Cuts the ICGC seabed polygons back to the 0 m land the rest of the map is cut against.

The survey does not stop at the contour this map calls the shore. It carries the port
structures it mapped (breakwaters, groynes, harbour mud) and, at the Ebre delta, sand and
mud that run a long way under ground the 0 m isobath closes over. Measured against
`land-4326.fgb`, 1,682 of the 50,416 smoothed habitat polygons hold 681.3 ha inside the
land, 422 m inland at the delta's worst point. The land fill hides most of it, so what it
costs is a tap on dry ground answering with a seabed class, and the whole of it showing
through wherever the land fill is faded under a photo base map.

Two properties this relies on.

The cut is the same curve for every polygon, so the arrangement stays a partition. Two
neighbours meeting at the coast are cut by one land boundary and both get its vertices, and
away from the coast neither is touched at all: a feature whose bounding box misses the land
is written through as the bytes it arrived as.

It has to run after `repartition_polygons.py`, never before. That script reads the polygons
back onto the 1e-4 degree grid the survey rasterised them from, which would round a fresh
coastal edge straight back off the contour by up to 11 m.

The land is a single polygon of 37,410 km2 plus its islands, so it is cut into a 0.05 degree
grid once and kept in `--grid`. Differencing against the few pieces a polygon actually
reaches is the difference between minutes and hours over the raw archives.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import geopandas as gpd
import shapely
from shapely.geometry import box
from shapely.ops import unary_union

GRID_STEP = 0.05

# Degrees squared is not an area anyone reads, so scale it at the latitude it came from.
# Good to a few percent, which is all a build log needs.
HA_PER_SQDEG = (111_320.0 * 110_540.0 * 0.7443) / 1e4
M_PER_DEG = 111_320.0 * math.cos(math.radians(41.4))


def land_grid(landpath: Path, cachepath: Path) -> list:
    if cachepath.exists():
        return [shapely.from_wkb(bytes.fromhex(h)) for h in cachepath.read_text().split()]
    land = unary_union(
        [g.buffer(0) for g in gpd.read_file(landpath, engine="pyogrio").geometry.values]
    )
    minx, miny, maxx, maxy = land.bounds
    pieces = []
    y = miny
    while y < maxy:
        x = minx
        while x < maxx:
            piece = land.intersection(box(x, y, x + GRID_STEP, y + GRID_STEP))
            if not piece.is_empty and piece.area > 0:
                pieces.append(piece)
            x += GRID_STEP
        y += GRID_STEP
    cachepath.write_text("\n".join(shapely.to_wkb(p).hex() for p in pieces))
    return pieces


def solid(geom):
    """Only the polygonal part. A polygon that merely touches the land yields a line or a
    point from the difference, and tippecanoe would carry it as one."""
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    parts = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(parts) if parts else None


def round6(obj):
    """The source is written at COORDINATE_PRECISION=6 and the land is not. Rounding the cut
    edge to the same 0.11 m keeps the archives the size they were, and both sides of a shared
    boundary round the same coordinate the same way."""
    if isinstance(obj, (list, tuple)):
        return [round6(v) for v in obj]
    if isinstance(obj, float):
        return round(obj, 6)
    return obj


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--land", required=True)
    ap.add_argument("--grid", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    pieces = land_grid(Path(args.land), Path(args.grid))
    tree = shapely.STRtree(pieces)

    kept = dropped = touched = 0
    cut_area = 0.0
    deepest = 0.0
    deepest_at = None
    unions: dict[tuple, object] = {}

    with open(args.src) as fh, open(args.out, "w") as wh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            feature = json.loads(line)
            geometry = feature.get("geometry")
            hits = () if geometry is None else tuple(sorted(tree.query(shapely.from_geojson(json.dumps(geometry)))))
            if not hits:
                wh.write(line + "\n")
                kept += 1
                continue

            if hits not in unions:
                unions[hits] = unary_union([pieces[i] for i in hits])
            land = unions[hits]
            whole = shapely.make_valid(shapely.from_geojson(json.dumps(geometry)))
            inland = whole.intersection(land)
            if inland.is_empty or inland.area <= 0:
                wh.write(line + "\n")
                kept += 1
                continue

            touched += 1
            cut_area += inland.area
            coords = shapely.get_coordinates(inland)
            if len(coords):
                reach = shapely.distance(shapely.points(coords), shapely.boundary(land)) * M_PER_DEG
                k = int(reach.argmax())
                if reach[k] > deepest:
                    deepest = reach[k]
                    deepest_at = coords[k]

            sea = solid(whole.difference(land))
            if sea is None or sea.is_empty:
                dropped += 1
                continue
            feature["geometry"] = round6(shapely.geometry.mapping(sea))
            wh.write(
                json.dumps(feature, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
            )
            kept += 1

    name = Path(args.src).name
    where = f" at {deepest_at[0]:.5f},{deepest_at[1]:.5f}" if deepest_at is not None else ""
    print(
        f"{name}: {kept} kept, {touched} cut at the coast, {dropped} entirely inland, "
        f"{cut_area * HA_PER_SQDEG:.1f} ha of land taken off, {deepest:.0f} m at the deepest{where}"
    )


if __name__ == "__main__":
    main()
