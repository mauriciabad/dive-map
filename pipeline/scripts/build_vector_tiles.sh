#!/usr/bin/env bash
# Builds the isobath, habitat and substrate vector tilesets that static/tiles serves.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW="$ROOT/data/raw"
BUILD="$ROOT/data/build/tiles"
# Overridable so a rebuild can be staged elsewhere and copied over the archives, rather
# than deleting them first to get past the have-it checks below.
OUT="${VECTOR_OUT:-$ROOT/static/tiles}"
LAYERS=(isobaths habitats substrate habitats-raw substrate-raw coverage)
MAX_BYTES=104857600
SMOOTH="$ROOT/pipeline/scripts/smooth_polygons.py"
PARTITION="$ROOT/pipeline/scripts/repartition_polygons.py"
CLIP="$ROOT/pipeline/scripts/clip_to_sea.py"
LAND_0M="$RAW/coastline/land-4326.fgb"
LAND_GRID="$BUILD/land-grid.wkb"

for tool in ogr2ogr tippecanoe python3; do
  command -v "$tool" >/dev/null || { printf 'missing %s on PATH\n' "$tool" >&2; exit 1; }
done

size_bytes() {
  wc -c < "$1" | tr -d '[:space:]'
}

check_size() {
  local bytes
  bytes="$(size_bytes "$1")"
  if [ "$bytes" -ge "$MAX_BYTES" ]; then
    printf '%s is %s bytes, at or over the %s byte GitHub file limit\n' "$1" "$bytes" "$MAX_BYTES" >&2
    exit 1
  fi
}

report() {
  local layer
  for layer in "${LAYERS[@]}"; do
    check_size "$OUT/$layer.pmtiles"
    printf 'have %s (%s bytes)\n' "$OUT/$layer.pmtiles" "$(size_bytes "$OUT/$layer.pmtiles")"
  done
}

stage() {
  local out=$1; shift
  [ -e "$out" ] && { printf 'have %s\n' "$out"; return 0; }
  local part="${out%.*}.part.${out##*.}"
  rm -f "$part"
  "$@" "$part"
  mv "$part" "$out"
}

extract_isobaths() {
  ogr2ogr -f GeoJSONSeq /vsistdout/ "$1" \
    -sql "SELECT -1 * COTA AS depth FROM isobaths" \
    -lco COORDINATE_PRECISION=6 -lco RS=NO \
  | python3 -c '
import re,sys
pat=re.compile(r"\"depth\":(\d+)")
w=sys.stdout.write
for l in sys.stdin:
    w(l if int(pat.search(l,0,80).group(1))%10==0 else "{\"tippecanoe\":{\"minzoom\":12},"+l[1:])
' > "$2"
}

tile_isobaths() {
  tippecanoe -o "$2" -f -l isobaths -n "ICGC isobaths, 1 m interval" \
    -Z8 -z16 -P --coalesce-densest-as-needed --drop-densest-as-needed \
    "$1"
}

extract_habitats() {
  # These are the only CODI_LPRE4 values src/lib/domain/habitat.ts carries. Everything else (the source also emits 3051203) has to fall back to CODI_LPRE3 or the app cannot style it.
  ogr2ogr -f GeoJSONSeq "$2" "$1" \
    -dialect SQLITE \
    -sql "SELECT geometry, CASE WHEN CODI_LPRE4 IN ('3020104','3020225','3040506') THEN CODI_LPRE4 ELSE CODI_LPRE3 END AS code, MAX(0, -1*FONDMIN) AS dmin, MAX(0, -1*FONDMAX) AS dmax FROM habitats" \
    -lco RS=NO -lco COORDINATE_PRECISION=6
}

tile_habitats() {
  tippecanoe -o "$2" -f -l habitats -n "ICGC marine habitats" \
    -Z8 -z15 -P --no-simplification-of-shared-nodes --tiny-polygon-size=0 \
    --coalesce-densest-as-needed --drop-densest-as-needed \
    "$1"
}

extract_substrate() {
  ogr2ogr -f GeoJSONSeq "$2" "$1" \
    -dialect SQLITE -sql "SELECT geometry, CODI_FONS AS code FROM substrate" \
    -lco RS=NO -lco COORDINATE_PRECISION=6
}

tile_substrate() {
  tippecanoe -o "$2" -f -l substrate -n "ICGC seabed substrate" \
    -Z8 -z15 -P --no-simplification-of-shared-nodes --tiny-polygon-size=0 \
    --coalesce-densest-as-needed --drop-densest-as-needed \
    "$1"
}

# The surveyed area is the union of the habitat polygons, so the fill is those polygons with
# their classes stripped and coalesced. A walked dissolve was tried and abandoned: 578 vertices
# of the source arrangement have unequal in and out degree, which shatters any boundary walk.
# Coalescing assumes nothing about the topology, and the fill edge matches the habitat edge
# because it is the same edge.
tile_coverage() {
  tippecanoe -o "$1" -f -n "ICGC habitat survey coverage" \
    -Z5 -z15 -P --no-simplification-of-shared-nodes --tiny-polygon-size=0 \
    --coalesce --coalesce-densest-as-needed --drop-densest-as-needed \
    -x code -x dmin -x dmax \
    -L "coverage:$BUILD/habitats-smooth-sea.geojsonseq" -L "limit:$BUILD/limit.geojsonseq"
}

extract_coastline() {
  ogr2ogr -f GeoJSONSeq "$2" "$1" -lco RS=NO -lco COORDINATE_PRECISION=6
}

# The ICGC polygons are not a partition: spurs, rings that visit a vertex twice and cells
# claimed by two classes. Reading them back onto the 1e-4 degree grid they were rasterised from
# rebuilds them as one, and opens the corners where a class meets itself at a point.
partition() {
  python3 "$PARTITION" --in "$BUILD/$1.geojsonseq" --out "$2"
}

# The limit lines need the drawn coastline to tell the shore from the offshore edge where
# the survey simply stops.
smooth_habitats() {
  ensure_extract coastline "$RAW/coastline/coastline-4326.fgb" extract_coastline
  stage "$BUILD/habitats-clean.geojsonseq" partition habitats
  python3 "$SMOOTH" --in "$BUILD/habitats-clean.geojsonseq" \
    --out "$1" --limit-out "$BUILD/limit.geojsonseq" \
    --coastline "$BUILD/coastline.geojsonseq"
}

smooth_substrate() {
  stage "$BUILD/substrate-clean.geojsonseq" partition substrate
  python3 "$SMOOTH" --in "$BUILD/substrate-clean.geojsonseq" --out "$1"
}

# The survey carries the port structures it mapped and, at the Ebre delta, sand and mud a
# long way under ground the 0 m isobath closes over, so its polygons paint past the line
# this map calls the shore. Issue #49. The cut runs here, after the smoothing, because
# repartition_polygons.py would round a fresh coastal edge straight back off the contour
# onto the survey's own 1e-4 degree grid. Homebrew GDAL leaks an Anaconda site-packages
# onto PYTHONPATH, which shadows the isolated interpreter's numpy and breaks pyogrio.
clip_to_sea() {
  [ -f "$LAND_0M" ] || { printf 'missing %s, run fetch_coastline.sh first\n' "$LAND_0M" >&2; exit 1; }
  env -u PYTHONPATH -u PYTHONHOME uv run --quiet --isolated --no-project -p 3.12 \
    --with 'shapely>=2.1' --with pyogrio --with geopandas \
    "$CLIP" --in "$1" --land "$LAND_0M" --grid "$LAND_GRID" --out "$2"
}

ensure_extract() {
  local name=$1 src=$2 extract=$3
  [ -e "$BUILD/$name.geojsonseq" ] && return 0
  [ -e "$src" ] || { printf 'missing %s\n' "$src" >&2; exit 1; }
  stage "$BUILD/$name.geojsonseq" "$extract" "$src"
}

# The contours carry no clip: a depth line is drawn, not painted ground, and the 0 m one is
# the very line the ground is cut against.
run_layer() {
  local name=$1 inter=$2 src=$3 extract=$4 tile=$5 clip=${6:-}
  local out="$OUT/$name.pmtiles"
  local input="$BUILD/$inter.geojsonseq"

  [ -e "$out" ] && { printf 'have %s\n' "$out"; return 0; }
  printf 'building %s\n' "$name"
  ensure_extract "$inter" "$src" "$extract"
  if [ -n "$clip" ]; then
    input="$BUILD/$inter-sea.geojsonseq"
    stage "$input" "$clip" "$BUILD/$inter.geojsonseq"
  fi
  stage "$out" "$tile" "$input"
}

# The staircased originals keep the same layer name as the smoothed archives, so the app
# swaps one url for the other without touching the style layers.
run_smoothed() {
  local name=$1 src=$2 extract=$3 smooth=$4 tile=$5
  local out="$OUT/$name.pmtiles"

  [ -e "$out" ] && { printf 'have %s\n' "$out"; return 0; }
  printf 'smoothing %s\n' "$name"
  ensure_extract "$name" "$src" "$extract"
  stage "$BUILD/$name-smooth.geojsonseq" "$smooth"
  stage "$BUILD/$name-smooth-sea.geojsonseq" clip_to_sea "$BUILD/$name-smooth.geojsonseq"
  stage "$out" "$tile" "$BUILD/$name-smooth-sea.geojsonseq"
}

missing=0
for layer in "${LAYERS[@]}"; do
  [ -e "$OUT/$layer.pmtiles" ] || missing=$((missing + 1))
done
if [ "$missing" -eq 0 ]; then
  report
  exit 0
fi

mkdir -p "$BUILD" "$OUT"

run_layer isobaths      isobaths  "$RAW/isobaths-shelf.fgb" extract_isobaths  tile_isobaths
run_layer habitats-raw  habitats  "$RAW/habitats.geojson"   extract_habitats  tile_habitats  clip_to_sea
run_layer substrate-raw substrate "$RAW/substrate.geojson"  extract_substrate tile_substrate clip_to_sea

run_smoothed habitats  "$RAW/habitats.geojson"  extract_habitats  smooth_habitats  tile_habitats
run_smoothed substrate "$RAW/substrate.geojson" extract_substrate smooth_substrate tile_substrate

if [ ! -e "$OUT/coverage.pmtiles" ]; then
  printf 'building coverage\n'
  ensure_extract habitats "$RAW/habitats.geojson" extract_habitats
  [ -e "$BUILD/limit.geojsonseq" ] || smooth_habitats "$BUILD/habitats-smooth.geojsonseq"
  stage "$BUILD/habitats-smooth-sea.geojsonseq" clip_to_sea "$BUILD/habitats-smooth.geojsonseq"
  stage "$OUT/coverage.pmtiles" tile_coverage
fi

report
