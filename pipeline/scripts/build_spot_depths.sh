#!/usr/bin/env bash
# Builds the spot depth archive: one number per place on the seabed worth naming
# a depth at. Issue #48.
#
# Three steps, and they are split where the cost is. `find_spot_depths.py` reads
# four billion DEM cells and writes every candidate with a score;
# `choose_spot_depths.py` gives each the first zoom the map has room for it at,
# which takes seconds and is the knob worth turning; tippecanoe only packs the
# result. `-r1` turns off tippecanoe's own point thinning, because a feature that
# reached here has already been chosen by a rule that knows how wide its label is,
# and dropping it again would undo that with one that does not.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD="$ROOT/data/build"
OUT="${SPOT_OUT:-$ROOT/static/tiles}"
DEM="$BUILD/dem-3857.tif"
CANDIDATES="$BUILD/spot-candidates.geojsonseq"
POINTS="$BUILD/spot-depths.geojsonseq"
TILES="$OUT/spot-depths.pmtiles"
MAX_BYTES=104857600

for tool in tippecanoe uv; do
  command -v "$tool" >/dev/null || { printf 'missing %s on PATH\n' "$tool" >&2; exit 1; }
done

[ -e "$DEM" ] || { printf 'run build_dem.sh first: %s is missing\n' "$DEM" >&2; exit 1; }

mkdir -p "$BUILD" "$OUT"

if [ ! -e "$CANDIDATES" ]; then
  env -u PYTHONPATH -u PYTHONHOME uv run --quiet --isolated --no-project -p 3.12 \
    --with rasterio --with numpy --with scipy \
    "$ROOT/pipeline/scripts/find_spot_depths.py" --dem "$DEM" --out "$CANDIDATES"
else
  printf 'have %s\n' "$CANDIDATES"
fi

# Always rerun: it is seconds, and it is the step whose numbers get retuned, so a
# have-it check here is the one that would quietly serve yesterday's selection.
rm -f "$POINTS"
env -u PYTHONPATH -u PYTHONHOME uv run --quiet --isolated --no-project -p 3.12 \
  "$ROOT/pipeline/scripts/choose_spot_depths.py" --candidates "$CANDIDATES" --out "$POINTS"

if [ -e "$TILES" ] && [ "$TILES" -nt "$POINTS" ]; then
  printf 'have %s (%s bytes)\n' "$TILES" "$(wc -c < "$TILES" | tr -d '[:space:]')"
  exit 0
fi

part="${TILES%.pmtiles}.part.pmtiles"
rm -f "$part"
tippecanoe -o "$part" -f -l spots -n "Spot depths from the ICGC bathymetry" \
  -Z10 -z17 -P -r1 "$POINTS"
mv "$part" "$TILES"

bytes="$(wc -c < "$TILES" | tr -d '[:space:]')"
if [ "$bytes" -ge "$MAX_BYTES" ]; then
  printf '%s is %s bytes, at or over the %s byte GitHub file limit\n' "$TILES" "$bytes" "$MAX_BYTES" >&2
  exit 1
fi
printf 'wrote %s (%s bytes)\n' "$TILES" "$bytes"
