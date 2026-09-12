#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW="$ROOT/data/raw/coastline"
OUT="$ROOT/static/tiles/coastline.pmtiles"
ISOBATHS="$ROOT/data/raw/isobaths-shelf.fgb"

# The bathymetry-coherent coastline, not linia-costa v1r0. Measured against the 0 m
# isobath of isobaths-shelf.fgb it sits a median 2.13 m away over the whole coast
# (v1r0: 4.12 m) and 4.8 m in the Ebre delta (v1r0: 34.4 m, p95 470 m).
ZIP_URL="https://datacloud.icgc.cat/datacloud/batimetria/gpkg/batimetria-v2r1-linia-costa-2021-2024.zip"
ZIP_SHA256="aba5d2722eeba6a4617fa88835956635a7a776340b2db0810ef430092d1cfa03"

ZIP="$RAW/linia-costa.zip"
GPKG="$RAW/batimetria-v2r1-linia-costa-2021-2024.gpkg"
ISO0="$RAW/iso0.fgb"
LAND="$RAW/land-25831.fgb"
LAND_WGS="$RAW/land-4326.fgb"
COAST_WGS="$RAW/coastline-4326.fgb"

MIN_ISLAND_M2=100
INLAND_EDGE_X=250000

mkdir -p "$RAW" "$(dirname "$OUT")"

# GDAL and tippecanoe both pick their output format from the extension, so a half-written
# file has to keep it. Appending .part would silently produce a directory or an mbtiles.
partial() { echo "${1%.*}.part.${1##*.}"; }

if [ -f "$ZIP" ] && [ "$(shasum -a 256 "$ZIP" | cut -d' ' -f1)" = "$ZIP_SHA256" ]; then
  echo "skip download: $ZIP"
else
  echo "download: $ZIP_URL"
  curl -fsSL -o "$ZIP.part" "$ZIP_URL"
  actual="$(shasum -a 256 "$ZIP.part" | cut -d' ' -f1)"
  if [ "$actual" != "$ZIP_SHA256" ]; then
    rm -f "$ZIP.part"
    echo "checksum mismatch: got $actual, want $ZIP_SHA256" >&2
    exit 1
  fi
  mv "$ZIP.part" "$ZIP"
fi

if [ -f "$GPKG" ]; then
  echo "skip unzip: $GPKG"
else
  unzip -o -q -j "$ZIP" '*.gpkg' -d "$RAW"
  [ -f "$GPKG" ] || { echo "zip did not contain $(basename "$GPKG")" >&2; exit 1; }
fi

if [ -f "$ISO0" ]; then
  echo "skip 0 m isobath: $ISO0"
else
  [ -f "$ISOBATHS" ] || { echo "missing $ISOBATHS" >&2; exit 1; }
  tmp="$(partial "$ISO0")"
  ogr2ogr -f FlatGeobuf "$tmp" "$ISOBATHS" -nln iso0 -t_srs EPSG:25831 \
    -sql "SELECT COTA FROM isobaths WHERE COTA = 0"
  mv "$tmp" "$ISO0"
fi

if [ -f "$LAND" ]; then
  echo "skip land build: $LAND"
else
  # Homebrew GDAL leaks an Anaconda site-packages onto PYTHONPATH here, which shadows
  # the isolated interpreter's numpy and breaks the pyogrio import.
  tmp="$(partial "$LAND")"
  env -u PYTHONPATH -u PYTHONHOME uv run --quiet --isolated --no-project -p 3.12 \
    --with 'shapely>=2.1' --with pyogrio --with geopandas - \
    "$GPKG" "$ISO0" "$tmp" "$MIN_ISLAND_M2" "$INLAND_EDGE_X" <<'PY'
import sys

import geopandas as gpd
from shapely.geometry import Polygon
from shapely.ops import linemerge, unary_union
from shapely.prepared import prep

gpkg, iso0, out, min_island_m2, inland_edge_x = sys.argv[1:6]
min_island_m2 = float(min_island_m2)
inland_edge_x = float(inland_edge_x)


def chains(path, **kw):
    parts = []
    for g in gpd.read_file(path, engine="pyogrio", **kw).geometry.values:
        if g is None or g.is_empty:
            continue
        parts.extend(list(g.geoms) if g.geom_type == "MultiLineString" else [g])
    merged = linemerge(unary_union(parts))
    return list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]


coast = chains(gpkg, layer="linia-costa")
open_chains = [c for c in coast if not c.is_ring]
if len(open_chains) != 1:
    sys.exit(f"expected 1 open coastline chain, got {len(open_chains)}")

mainland = open_chains[0]
ends = [mainland.coords[0], mainland.coords[-1]]
north, south = max(ends, key=lambda e: e[1]), min(ends, key=lambda e: e[1])
coords = list(mainland.coords)
if coords[0] != north:
    coords.reverse()
# The chain is open only where Catalonia meets France and Valencia, and those two ends
# are the dataset's northernmost and southernmost vertices, so a rectangle drawn inland
# from them closes the mainland without recrossing the coast.
closure = [(inland_edge_x, south[1]), (inland_edge_x, north[1])]
faces = [Polygon(coords + closure)] + [Polygon(c) for c in coast if c.is_ring]
if not all(f.is_valid for f in faces):
    sys.exit("coastline produced a self-intersecting face")

# A ring nested inside another ring is water enclosed by land, so odd depth is a hole.
depth = [sum(1 for o in faces if o is not f and o.contains(f.representative_point())) for f in faces]
land = unary_union([f for f, d in zip(faces, depth) if d % 2 == 0]).difference(
    unary_union([f for f, d in zip(faces, depth) if d % 2 == 1])
)
land_polys = list(land.geoms) if land.geom_type == "MultiPolygon" else [land]

shell = prep(unary_union([Polygon(p.exterior) for p in land_polys]))
solid = prep(land)
islands = []
for c in chains(iso0):
    if not c.is_ring:
        continue
    p = Polygon(c)
    if p.area < min_island_m2 or shell.contains(p.representative_point()) or solid.intersects(p):
        continue
    islands.append(p)

rows = [{"geometry": p, "src": "linia-costa", "area_m2": round(p.area)} for p in land_polys]
rows += [{"geometry": p, "src": "isobata-0m", "area_m2": round(p.area)} for p in islands]
gdf = gpd.GeoDataFrame(rows, crs="EPSG:25831")
gdf.to_file(out, driver="FlatGeobuf", layer="land", engine="pyogrio")

print(
    f"land: {len(land_polys)} from linia-costa ({land.area / 1e6:.0f} km2), "
    f"{len(islands)} islands from the 0 m isobath ({sum(p.area for p in islands) / 1e4:.1f} ha)"
)
PY
  mv "$tmp" "$LAND"
fi

if [ -f "$LAND_WGS" ]; then
  echo "skip reproject land: $LAND_WGS"
else
  tmp="$(partial "$LAND_WGS")"
  ogr2ogr -f FlatGeobuf "$tmp" "$LAND" -t_srs EPSG:4326 -nln land
  mv "$tmp" "$LAND_WGS"
fi

if [ -f "$COAST_WGS" ]; then
  echo "skip reproject coastline: $COAST_WGS"
else
  tmp="$(partial "$COAST_WGS")"
  ogr2ogr -f FlatGeobuf "$tmp" "$GPKG" -t_srs EPSG:4326 -nln coastline \
    -sql "SELECT geom, TIPOLOGIA AS tipologia, SUBTRAM_TIPUS AS subtram FROM \"linia-costa\""
  mv "$tmp" "$COAST_WGS"
fi

if [ -f "$OUT" ]; then
  echo "skip tiling: $OUT"
else
  # -pk rather than the default 500K cap: over its budget tippecanoe drops features, and
  # a dropped feature here is a hole in the land/sea boundary.
  tmp="$(partial "$OUT")"
  tippecanoe -o "$tmp" -f -q -Z4 -z16 -pk \
    --no-simplification-of-shared-nodes \
    --no-tiny-polygon-reduction \
    --name=coastline \
    --description="Catalan land polygons and shoreline, ICGC linia de costa v2r1 2021-2024" \
    --attribution="Institut Cartogràfic i Geològic de Catalunya, CC BY 4.0" \
    -L land:"$LAND_WGS" \
    -L coastline:"$COAST_WGS"
  mv "$tmp" "$OUT"
fi

ls -la "$ZIP" "$GPKG" "$ISO0" "$LAND" "$LAND_WGS" "$COAST_WGS" "$OUT"
