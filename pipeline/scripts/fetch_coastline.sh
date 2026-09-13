#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW="$ROOT/data/raw/coastline"
OUT="$ROOT/static/tiles/coastline.pmtiles"
ISOBATHS="$ROOT/data/raw/isobaths-shelf.fgb"

# `linia-costa` is downloaded to be a ruler and is no longer drawn. The shoreline
# on this map is the 0 m isobath, because that is the line the habitat and
# substrate polygons were cut against, and a land fill built from anything else
# paints over surveyed seabed. The two products agree to a median 1.9 m and
# disagree by more than 100 m over 11% of the coast, which is where the owner was
# seeing land on top of habitat. What `linia-costa` still provides is order: one
# open chain, French border to Valencian border, against the 0 m isobath's 219
# blockwise fragments. See pipeline/scripts/build_shoreline.py.
ZIP_URL="https://datacloud.icgc.cat/datacloud/batimetria/gpkg/batimetria-v2r1-linia-costa-2021-2024.zip"
ZIP_SHA256="aba5d2722eeba6a4617fa88835956635a7a776340b2db0810ef430092d1cfa03"

ZIP="$RAW/linia-costa.zip"
GPKG="$RAW/batimetria-v2r1-linia-costa-2021-2024.gpkg"
ISO0="$RAW/iso0.fgb"
LAND="$RAW/land-0m-25831.fgb"
LAND_WGS="$RAW/land-4326.fgb"
COAST="$RAW/coast-0m-25831.fgb"
COAST_0M_WGS="$RAW/coast-0m-4326.fgb"
COAST_WGS="$RAW/coastline-4326.fgb"
SHORELINE="$ROOT/pipeline/scripts/build_shoreline.py"

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

if [ -f "$LAND" ] && [ -f "$COAST" ]; then
  echo "skip land build: $LAND"
else
  # Homebrew GDAL leaks an Anaconda site-packages onto PYTHONPATH here, which shadows
  # the isolated interpreter's numpy and breaks the pyogrio import.
  tmp="$(partial "$LAND")"
  tmpcoast="$(partial "$COAST")"
  env -u PYTHONPATH -u PYTHONHOME uv run --quiet --isolated --no-project -p 3.12 \
    --with 'shapely>=2.1' --with pyogrio --with geopandas \
    "$SHORELINE" --isobath "$ISO0" --ruler "$GPKG" --out "$tmp" --coast-out "$tmpcoast"
  mv "$tmp" "$LAND"
  mv "$tmpcoast" "$COAST"
fi

if [ -f "$COAST_0M_WGS" ]; then
  echo "skip reproject coast: $COAST_0M_WGS"
else
  tmp="$(partial "$COAST_0M_WGS")"
  ogr2ogr -f FlatGeobuf "$tmp" "$COAST" -t_srs EPSG:4326 -nln coast
  mv "$tmp" "$COAST_0M_WGS"
fi

if [ -f "$LAND_WGS" ]; then
  echo "skip reproject land: $LAND_WGS"
else
  tmp="$(partial "$LAND_WGS")"
  ogr2ogr -f FlatGeobuf "$tmp" "$LAND" -t_srs EPSG:4326 -nln land
  mv "$tmp" "$LAND_WGS"
fi

# Not tiled any more, and still built: build_land_tiles.sh grows the 3, 8 and 30 km
# clip strips from this line. A clip mask wants the cheap line, not the exact one.
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
    --description="Catalan land polygons, closed from the 0 m isobath of ICGC batimetria v2r1 2021-2025" \
    --attribution="Institut Cartogràfic i Geològic de Catalunya, CC BY 4.0" \
    -L land:"$LAND_WGS"
  mv "$tmp" "$OUT"
fi

ls -la "$ZIP" "$GPKG" "$ISO0" "$LAND" "$LAND_WGS" "$COAST_WGS" "$OUT"
