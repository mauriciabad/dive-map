#!/usr/bin/env python3
"""Close the 0 m isobath into the land polygons the map fills.

The shoreline on this map is the 0 m isobath and nothing else. The habitat and
substrate polygons were cut against it, so it is the one line the painted ground
is guaranteed to meet. ICGC's `linia-costa` product is a separate survey that
disagrees: a 1.9 m median over the whole coast, but more than 100 m over 11% of
it, and those are the stretches where a land fill built from `linia-costa` paints
over surveyed seabed.

The reason this is not a one-line swap is topology. `linia-costa` hands over a
single open chain that a rectangle drawn inland closes into a mainland. The 0 m
isobath hands over 219 open chains and 11,892 rings, because the survey was
flown in blocks and each block's contour stops at the block edge.

Nearest-endpoint stitching does not close those 219, because nothing in a local
distance tells a gap across a harbour mouth from a gap across a bay. The order is
the missing information, and `linia-costa` has it: one chain, French border to
Valencian border, wrong by metres but right about what follows what. So it is
used as a ruler. Every 0 m chain is projected onto it to get a position along the
coast, the chains are walked in that order, and each gap is filled with the
ruler's own course between the two ends. 61 chains carry the walk, 158 are
breakwaters and river channels inside stretches it has already passed, and what
joins them is 2.5 km of straight line against 928 km of drawn coast.

Scored against the habitat polygons by check_coast_fit.py, the result paints over
6.841 km2 of surveyed seabed where the `linia-costa` land painted over 6.881 km2.

Rings are then classified by where they fall. Outside the mainland is an island,
inside it is a coastal lagoon, and a ring inside a lagoon is an island again.
That is the same odd-depth rule the `linia-costa` build used, applied to a set
large enough to need an index.
"""

from __future__ import annotations

import argparse
import sys

import geopandas as gpd
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import linemerge, substring, unary_union

CRS = "EPSG:25831"

# Where the closure is drawn. Far enough inland that the rectangle joining the
# two open ends cannot recross the coast anywhere in Catalonia.
INLAND_EDGE_X = 250000.0

# Below this a ring is a contour artefact rather than a rock anyone dives. 100 m2 was
# the first answer and it was too coarse by a factor of ten. Every rock in the Medes
# between 11 and 87 m2 got its 0 m contour drawn by the shoreline layer and no polygon
# to fill, so les Ferranelles and the Tascons read as outlined holes with seabed inside.
# At the deepest zoom the map supports, 18.5, a 10 m2 rock is about 8 px across, which
# is the smallest thing worth filling. The cut admits 4,598 rings against 1,305.
MIN_RING_M2 = 10.0


def chains(path: str, **kwargs: object) -> list[LineString]:
    parts: list[LineString] = []
    for geom in gpd.read_file(path, engine="pyogrio", **kwargs).geometry.values:
        if geom is None or geom.is_empty:
            continue
        parts.extend(list(geom.geoms) if geom.geom_type == "MultiLineString" else [geom])
    merged = linemerge(unary_union(parts))
    return list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]


def ruler(gpkg: str) -> LineString:
    """The `linia-costa` mainland chain, oriented north to south."""
    coast = chains(gpkg, layer="linia-costa")
    open_chains = [c for c in coast if not c.is_ring]
    if len(open_chains) != 1:
        sys.exit(f"expected 1 open linia-costa chain to order against, got {len(open_chains)}")
    coords = list(open_chains[0].coords)
    if coords[0][1] < coords[-1][1]:
        coords.reverse()
    return LineString(coords)


def walk(open_chains: list[LineString], guide: LineString) -> tuple[LineString, list[float]]:
    """One chain along the whole coast, in the order the ruler puts the pieces.

    A gap is filled with the ruler's own course between the two ends rather than
    with the straight line across it. The difference is bays: a 1 km chord across
    a bay mouth turns the water behind it into land, and 60 of those cost 2.2 km2
    of surveyed habitat painted over, measured by check_coast_fit.py. Where the
    survey has no 0 m contour, `linia-costa` is the best line anyone has.
    """
    spans: list[tuple[float, float, LineString]] = []
    for chain in open_chains:
        start = guide.project(Point(chain.coords[0]))
        end = guide.project(Point(chain.coords[-1]))
        if start > end:
            chain = LineString(list(chain.coords)[::-1])
            start, end = end, start
        spans.append((start, end, chain))
    spans.sort(key=lambda s: (s[0], s[1]))

    kept: list[tuple[float, float, LineString]] = []
    cursor = float("-inf")
    for span in spans:
        # A chain whose whole span is already behind the cursor is a breakwater or
        # a river channel inside a stretch the walk has passed. It is real 0 m
        # contour and it is drawn, but it is not the outline of the mainland.
        if span[1] <= cursor:
            continue
        kept.append(span)
        cursor = max(cursor, span[1])

    coords: list[tuple[float, float]] = []
    bridges: list[float] = []
    previous_end = 0.0
    for start, end, chain in kept:
        if coords:
            fill = substring(guide, previous_end, start) if start > previous_end else None
            if fill is not None and fill.geom_type == "LineString" and fill.length > 0:
                coords.extend(fill.coords)
            bridges.append(LineString([coords[-1], chain.coords[0]]).length)
        coords.extend(chain.coords)
        previous_end = end
    return LineString(coords), bridges


def close(line: LineString) -> Polygon:
    """The mainland, shut with a rectangle drawn inland from the two open ends."""
    coords = list(line.coords)
    closure = [(INLAND_EDGE_X, coords[-1][1]), (INLAND_EDGE_X, coords[0][1])]
    # A walk that doubles back on itself at a harbour mouth crosses itself, which
    # buffer(0) resolves into the polygons on either side of the crossing. The
    # mainland is the large one; the loops it sheds are square metres.
    resolved = Polygon(coords + closure).buffer(0)
    faces = list(resolved.geoms) if resolved.geom_type == "MultiPolygon" else [resolved]
    return max(faces, key=lambda f: f.area)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--isobath", required=True, help="0 m isobath, EPSG:25831")
    ap.add_argument("--ruler", required=True, help="linia-costa gpkg, used only for ordering")
    ap.add_argument("--out", required=True)
    ap.add_argument("--coast-out", required=True, help="the drawn coast, without the closure")
    args = ap.parse_args()

    pieces = chains(args.isobath)
    rings = [Polygon(c) for c in pieces if c.is_ring and Polygon(c).area >= MIN_RING_M2]
    open_chains = [c for c in pieces if not c.is_ring]
    print(f"0 m isobath        {len(open_chains)} open chains, {len(rings)} rings over {MIN_RING_M2:.0f} m2")

    shore, bridges = walk(open_chains, ruler(args.ruler))
    print(
        f"stitched           {len(bridges) + 1} chains, {len(bridges)} bridges, "
        f"{sum(bridges) / 1000:.2f} km of bridge over {shore.length / 1000:.1f} km of contour, "
        f"longest {max(bridges) if bridges else 0:.0f} m"
    )

    mainland = close(shore)
    faces = [mainland, *rings]
    tree = STRtree(faces)
    depth = []
    for i, face in enumerate(faces):
        point = face.representative_point()
        depth.append(
            sum(1 for j in tree.query(point) if int(j) != i and faces[int(j)].contains(point))
        )
    land = unary_union([f for f, d in zip(faces, depth) if d % 2 == 0]).difference(
        unary_union([f for f, d in zip(faces, depth) if d % 2 == 1])
    )
    polygons = list(land.geoms) if land.geom_type == "MultiPolygon" else [land]
    lagoons = sum(1 for d in depth[1:] if d % 2 == 1)
    print(f"classified         {len(rings) - lagoons} islands, {lagoons} lagoons cut out as holes")

    biggest = max(polygons, key=lambda p: p.area)
    rows = [
        {
            "geometry": p,
            "src": "isobata-0m" if p is biggest else "isobata-0m-island",
            "area_m2": round(p.area),
        }
        for p in polygons
    ]
    gpd.GeoDataFrame(rows, crs=CRS).to_file(
        args.out, driver="FlatGeobuf", layer="land", engine="pyogrio"
    )

    # Every part of the land boundary that has water on the other side, and nothing
    # else. The world build needs this to know where the OSM land it carries is
    # standing in the sea. It cannot read that off the mainland polygon, because three
    # sides of that boundary are the two border cuts and the inland closure, and a
    # build that mistakes those for shore erases OSM land 250 km into Aragon.
    coast = [shore, *(p.exterior for p in polygons if p is not biggest)]
    gpd.GeoDataFrame({"kind": ["coast"] * len(coast)}, geometry=coast, crs=CRS).to_file(
        args.coast_out, driver="FlatGeobuf", layer="coast", engine="pyogrio"
    )
    print(f"coast              {len(coast)} lines, {sum(c.length for c in coast) / 1000:.0f} km")

    print(
        f"land               {len(polygons)} polygons, mainland {biggest.area / 1e6:.0f} km2, "
        f"islands {sum(p.area for p in polygons if p is not biggest) / 1e4:.1f} ha"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
