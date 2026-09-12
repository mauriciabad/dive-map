#!/usr/bin/env bash
# Builds the isobath, habitat and substrate vector tilesets that static/tiles serves.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW="$ROOT/data/raw"
BUILD="$ROOT/data/build/tiles"
OUT="$ROOT/static/tiles"
LAYERS=(isobaths habitats substrate)
MAX_BYTES=104857600

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

run_layer() {
  local name=$1 src=$2 extract=$3 tile=$4
  local inter="$BUILD/$name.geojsonseq" out="$OUT/$name.pmtiles"

  [ -e "$out" ] && { printf 'have %s\n' "$out"; return 0; }
  [ -e "$src" ] || { printf 'missing %s\n' "$src" >&2; exit 1; }

  printf 'building %s\n' "$name"
  stage "$inter" "$extract" "$src"
  stage "$out" "$tile" "$inter"
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

run_layer isobaths  "$RAW/isobaths-shelf.fgb" extract_isobaths  tile_isobaths
run_layer habitats  "$RAW/habitats.geojson"   extract_habitats  tile_habitats
run_layer substrate "$RAW/substrate.geojson"  extract_substrate tile_substrate

report
