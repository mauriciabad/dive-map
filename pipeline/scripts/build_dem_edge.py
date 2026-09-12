#!/usr/bin/env python3
"""Traces the bathymetry DEM footprint so the style can stop drawing an edge there.

The hillshade and the depth veil both read the DEM, and the survey ends offshore
at a median -52 m, so everything past that boundary loses its shading and its
water column in one step: habitat that carries on out there suddenly paints bare
and bright against veiled deep water. Neither layer takes a per-pixel mask.

Three features come out of here. `covered` is the footprint itself, which the
style paints with the unsurveyed hatch under the habitat layers, so water the
survey classified nothing in still reads as seabed. `beyond` is everything outside the footprint,
which the style washes in the deep-water colour so open sea reads as open sea
whatever the survey did. `edge` is the footprint boundary, which the style draws
as a wide blurred line offset inwards so the wash meets the veil over a few
hundred metres instead of on one pixel. Rings are wound with the covered side on
the left, which is what lets one signed offset push the band inwards on every
ring, holes included.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import geopandas as gpd
import numpy as np
import rasterio
from rasterio import features
from rasterio.enums import Resampling
from rasterio.warp import transform_geom
from shapely.geometry import Point, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import transform, unary_union


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--decimate", type=int, default=8)
    ap.add_argument("--min-ring-m", type=float, default=2000.0)
    ap.add_argument("--simplify-m", type=float, default=60.0)
    ap.add_argument("--beyond-bbox", default="-1.5,38.8,5.2,44.2")
    ap.add_argument("--extent-out")
    ap.add_argument("--anchor-spacing-m", type=float, default=4000.0)
    args = ap.parse_args()

    with rasterio.open(args.dem) as ds:
        h, w = ds.height // args.decimate, ds.width // args.decimate
        a = ds.read(1, out_shape=(h, w), resampling=Resampling.average)
        transform = ds.transform * ds.transform.scale(ds.width / w, ds.height / h)
        crs = ds.crs

    # gdalwarp wrote nodata as 0, which is also sea level, so a decimated cell is
    # covered when any of its source pixels carried a reading. Averaging cannot
    # produce exactly 0 from real readings except by cancellation, which needs a
    # cell straddling the waterline; those sit inland of the offshore edge anyway.
    covered = (a != 0).astype(np.uint8)
    print(f"grid {w} x {h}, covered {100 * covered.mean():.1f}%")

    polys = [
        shape(geom)
        for geom, value in features.shapes(covered, mask=covered.astype(bool), transform=transform)
        if value == 1
    ]
    region = unary_union(polys)
    print(f"shapes {len(polys)} -> {region.geom_type}")

    rings = []
    for poly in region.geoms if region.geom_type == "MultiPolygon" else [region]:
        p = orient(poly, sign=1.0).simplify(args.simplify_m)
        for ring in [p.exterior, *p.interiors]:
            if ring.length >= args.min_ring_m:
                rings.append(ring)
    rings.sort(key=lambda r: -r.length)
    print(f"rings kept {len(rings)}, vertices {sum(len(r.coords) for r in rings)}")

    def to_wgs84(geom):
        return transform_geom(crs, "EPSG:4326", mapping(geom), precision=5)

    kept = unary_union([orient(p, sign=1.0).simplify(args.simplify_m) for p in (region.geoms if region.geom_type == "MultiPolygon" else [region])])
    west, south, east, north = (float(v) for v in args.beyond_bbox.split(","))
    frame = gpd.GeoSeries([box(west, south, east, north)], crs=4326).to_crs(crs).iloc[0]
    beyond = frame.difference(kept)
    print(f"beyond {beyond.area / 1e6:.0f} km2, covered {kept.area / 1e6:.0f} km2")

    features_out = [
        {"type": "Feature", "properties": {"kind": "covered"}, "geometry": to_wgs84(kept)},
        {"type": "Feature", "properties": {"kind": "beyond"}, "geometry": to_wgs84(beyond)},
    ]
    features_out += [
        {"type": "Feature", "properties": {"kind": "edge"}, "geometry": to_wgs84(ring)} for ring in rings
    ]
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features_out}, fh, separators=(",", ":"))
    print(f"wrote {args.out}")

    if args.extent_out:
        write_anchors(kept, crs, args.anchor_spacing_m, args.extent_out)
    return 0


def write_anchors(covered, crs, spacing: float, path: str) -> None:
    """A grid of points inside the data, for the camera to keep some of on screen.

    The camera guard has to answer "is any data in frame" on every move event, and
    the footprint is 2800 vertices. A grid of points it can take the minimum
    distance to answers the same question in a few hundred subtractions, and errs
    on the side of stopping the drag early by half a cell.
    """
    west, south, east, north = covered.bounds
    xs = np.arange(west, east + spacing, spacing)
    ys = np.arange(south, north + spacing, spacing)
    grid = gpd.GeoSeries(
        [Point(float(x), float(y)) for y in ys for x in xs], crs=crs
    )
    inside = grid[grid.within(covered)].to_crs(4326)
    pts = [(round(g.x, 4), round(g.y, 4)) for g in inside]
    print(f"anchors {len(pts)} at {spacing:.0f} m over {len(xs)}x{len(ys)} candidates")

    body = ",\n\t".join(f"[{x}, {y}]" for x, y in pts)
    pathlib.Path(path).write_text(
        "// Generated by pipeline/scripts/build_dem_edge.py. Do not edit.\n"
        "\n"
        "/**\n"
        " * A %.0f m grid of points inside the bathymetry footprint, which is the\n"
        " * outer extent of everything this map draws. The camera guard keeps the\n"
        " * nearest of these within half a screen of the centre, so the view can never\n"
        " * be dragged somewhere with nothing on it.\n"
        " */\n"
        "export const DATA_ANCHORS: readonly (readonly [number, number])[] = [\n"
        "\t%s\n"
        "];\n"
        "\n"
        "/** Spacing of the grid above, in metres. The guard allows for half a cell. */\n"
        "export const ANCHOR_SPACING_M = %.0f;\n" % (spacing, body, spacing)
    )
    print(f"wrote {path}")


if __name__ == "__main__":
    sys.exit(main())
