#!/usr/bin/env bash
# Builds static/tiles/land.pmtiles: the OSM detail drawn inside the coastline.
#
# The land exists to frame the sea, so this ships the least data that makes a
# shore readable and nothing else. Each output layer reaches as far inland as the
# zoom it first appears at can actually see, which is what keeps a coastal strip
# from ever showing its own inner edge: see pipeline/scripts/osm_land.py.
#
# Those strips are also the size control. Measured per layer on the first build,
# a 51 MB archive was 21.8 MB of road and 12.9 MB of woodland; moving residential
# streets and footpaths from the 8 km strip at z13 to the 3 km strip at z14, and
# irrigation canals from 30 km to 8 km, is most of the difference between that and
# what ships. Rerun the per-layer measurement before widening any of them again.
#
# Nothing here ships a layer the style does not draw. `building`, `landmark` and
# `place` did: 196,913 buildings, 7,702 landmarks and 13,524 place names, 6.0 MB
# of a 22.4 MB archive, every one of them decoded by the phone and drawn by
# nothing. Removing them took it to 16.2 MB with all four drawn layers at exactly
# the feature counts they had before.
#
# The landmarks are the loss worth knowing about. Lighthouses, castles, windmills
# and the headland towers a boat crew points at, which issue #13 wants drawn with
# authored icons rather than borrowed art. Bringing them back is one extract, one
# normalise and one -L below, and then the icons, which is the actual work.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW="$ROOT/data/raw/osm-land"
BUILD="$ROOT/data/build/land"
OUT="$ROOT/static/tiles/land.pmtiles"
NORMALISE="$ROOT/pipeline/scripts/osm_land.py"
COASTLINE="$ROOT/data/raw/coastline/coastline-4326.fgb"
MAX_BYTES=104857600

PBF="$RAW/cataluna-latest.osm.pbf"
PBF_URL="${OSM_LAND_PBF_URL:-https://download.geofabrik.de/europe/spain/cataluna-latest.osm.pbf}"

for tool in ogr2ogr tippecanoe python3 curl uv; do
  command -v "$tool" >/dev/null || { printf 'missing %s on PATH\n' "$tool" >&2; exit 1; }
done

mkdir -p "$RAW" "$BUILD" "$(dirname "$OUT")"

if [ -f "$OUT" ]; then
  printf 'have %s (%s bytes)\n' "$OUT" "$(wc -c < "$OUT" | tr -d '[:space:]')"
  exit 0
fi

# Geofabrik republishes daily and has no stable checksum for -latest, so the
# extract is pinned by being on disk rather than by a hash. Delete it to refresh.
if [ -f "$PBF" ]; then
  printf 'skip download: %s\n' "$PBF"
else
  printf 'download: %s\n' "$PBF_URL"
  curl -fsSL -o "$PBF.part" "$PBF_URL"
  mv "$PBF.part" "$PBF"
fi

# How far inland each tier reaches. Three buffers of the drawn coastline rather
# than a bounding box: Catalonia runs 150 km inland and none of it is in frame.
if [ -f "$BUILD/coast-30km.fgb" ]; then
  printf 'skip coastal buffers\n'
else
  [ -f "$COASTLINE" ] || { printf 'missing %s, run fetch_coastline.sh first\n' "$COASTLINE" >&2; exit 1; }
  env -u PYTHONPATH -u PYTHONHOME uv run --quiet --isolated --no-project -p 3.12 \
    --with 'shapely>=2.1' --with pyogrio --with geopandas - "$COASTLINE" "$BUILD" <<'PY'
import sys

import geopandas as gpd
from shapely.ops import unary_union

src, outdir = sys.argv[1], sys.argv[2]
line = unary_union(list(gpd.read_file(src, engine="pyogrio").to_crs("EPSG:25831").geometry.values))
# Each strip is grown from the one inside it rather than from the coastline.
# Buffering 700 km of shore by 30 km directly means unioning two thousand
# overlapping blobs and does not finish; buffering one polygon by the remaining
# distance is seconds. The input is thinned first because this is a clip mask and
# a wobble a fiftieth of the strip's own width is not visible in the result.
grown = line
previous = 0.0
for km in (3, 8, 30):
    metres = km * 1000
    grown = grown.simplify(metres / 50).buffer(metres - previous, quad_segs=4)
    previous = metres
    frame = gpd.GeoDataFrame(
        {"km": [km]}, geometry=[grown.simplify(metres / 50)], crs="EPSG:25831"
    ).to_crs("EPSG:4326")
    frame.to_file(f"{outdir}/coast-{km:g}km.fgb", driver="FlatGeobuf", layer="coast", engine="pyogrio")
    print(f"coast-{km:g}km.fgb bounds {[round(v, 3) for v in frame.total_bounds]}")
PY
fi

# One GDAL pass per (source layer, tier). Each is cached, because a pass over a
# 270 MB extract is minutes and the tag rules downstream get edited far more often
# than the extraction does.
extract() {
  local name=$1 layer=$2 km=$3 where=$4
  local out="$BUILD/raw-$name.geojsonseq"
  [ -e "$out" ] && { printf 'have raw-%s\n' "$name"; return 0; }
  printf 'extracting %s (%s, %s km)\n' "$name" "$layer" "$km"
  ogr2ogr -f GeoJSONSeq "$out.part" "$PBF" "$layer" \
    -clipsrc "$BUILD/coast-${km}km.fgb" \
    -where "$where" \
    -lco RS=NO -lco COORDINATE_PRECISION=6
  mv "$out.part" "$out"
  printf '  %s features\n' "$(wc -l < "$out" | tr -d '[:space:]')"
}

normalise() {
  local out=$1; shift
  local target="$BUILD/$out.geojsonseq"
  [ -e "$target" ] && { printf 'have %s\n' "$out"; return 0; }
  local source
  : > "$target.part"
  for source in "$@"; do
    python3 "$NORMALISE" "$out" < "$BUILD/raw-$source.geojsonseq" >> "$target.part"
  done
  mv "$target.part" "$target"
  printf 'normalised %-10s %s features\n' "$out" "$(wc -l < "$target" | tr -d '[:space:]')"
}

MAJOR="'motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link'"
MINOR="'unclassified','residential','living_street','pedestrian','track','path','footway','bridleway','cycleway','steps'"
WET="natural IN ('water','wetland') OR landuse IN ('reservoir','basin')"

extract lines-wide  lines         30  "highway IN ($MAJOR) OR waterway = 'river'"
extract lines-mid   lines         8   "waterway IN ('canal','stream')"
extract lines-near  lines         3   "highway IN ($MINOR)"
extract water-wide  multipolygons 30  "$WET"
extract shore-near  multipolygons 8   "natural IN ('beach','sand','shingle','dune')"

normalise road      lines-wide lines-near
normalise waterway  lines-wide lines-mid
normalise water     water-wide
normalise sand      shore-near

# tippecanoe picks its output format from the extension, so the half-written file
# has to keep it. Appending .part silently produced an mbtiles archive that the app
# fetched, accepted and rendered as nothing at all.
PART="${OUT%.*}.part.${OUT##*.}"

# -pk because a dropped feature here is a hole in a road, not a thinner map, and
# the whole point of the minzoom hints upstream is that nothing needs dropping.
tippecanoe -o "$PART" -f -q -Z9 -z15 -pk \
  --simplification=3 \
  --drop-densest-as-needed \
  --name=land \
  --description="OSM land detail inside the Catalan coastline" \
  --attribution="OpenStreetMap contributors, ODbL" \
  -L "water:$BUILD/water.geojsonseq" \
  -L "waterway:$BUILD/waterway.geojsonseq" \
  -L "sand:$BUILD/sand.geojsonseq" \
  -L "road:$BUILD/road.geojsonseq"
mv "$PART" "$OUT"

bytes="$(wc -c < "$OUT" | tr -d '[:space:]')"
if [ "$bytes" -ge "$MAX_BYTES" ]; then
  printf '%s is %s bytes, at or over the %s byte GitHub file limit\n' "$OUT" "$bytes" "$MAX_BYTES" >&2
  exit 1
fi
printf 'have %s (%s bytes)\n' "$OUT" "$bytes"
