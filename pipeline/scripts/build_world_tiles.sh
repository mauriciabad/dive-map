#!/usr/bin/env bash
# Builds static/tiles/world.pmtiles: the land outside the survey, so the map does
# not end in a straight line.
#
# Fully zoomed out, Catalonia was a grey rectangle with three ruler-straight
# edges. Two of them are the cuts at the French and Valencian borders and the
# third is the synthetic inland closure fetch_coastline.sh draws at x=250000 to
# shut the mainland polygon. None of them is a coast and all three read as one.
#
# The fix is not a basemap under the map. It is the same painted land, continued:
# the world land is OSM's land polygons with the ICGC land subtracted, so the two
# meet along the ICGC boundary exactly, by construction, the way the coverage
# layer meets the habitat edge. Painted in the same fill and the same rock at the
# same opacity, the join cannot be seen because there is nothing there to see.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW="$ROOT/data/raw/world"
BUILD="$ROOT/data/build/world"
# Overridable so a rebuild can be staged somewhere else and copied over the archive,
# rather than deleting the archive first to get past the have-it check below.
OUT="${WORLD_OUT:-$ROOT/static/tiles/world.pmtiles}"
LAND="$ROOT/data/raw/coastline/land-4326.fgb"
COAST="$ROOT/data/raw/coastline/coast-0m-4326.fgb"
MAX_BYTES=104857600

ZIP="$RAW/land-polygons-split-4326.zip"
ZIP_URL="${WORLD_LAND_URL:-https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip}"
SHP="$RAW/land-polygons-split-4326/land_polygons.shp"

# The western Mediterranean, which is everything the camera guard can reach. At
# the minimum zoom the whole survey is on screen, which is z7.9 on a laptop and
# z6.4 on a phone, and from a centre anywhere on the survey that reaches about
# four degrees out. This is that with room to spare, and it picks up the
# Balearics, Roussillon and the Valencian coast, which are the land anyone
# actually sees at the edges.
BBOX="${WORLD_BBOX:--3 36 7 46}"

for tool in ogr2ogr tippecanoe curl uv unzip; do
  command -v "$tool" >/dev/null || { printf 'missing %s on PATH\n' "$tool" >&2; exit 1; }
done

mkdir -p "$RAW" "$BUILD" "$(dirname "$OUT")"

if [ -f "$OUT" ]; then
  printf 'have %s (%s bytes)\n' "$OUT" "$(wc -c < "$OUT" | tr -d '[:space:]')"
  exit 0
fi

if [ -f "$SHP" ]; then
  printf 'skip download: %s\n' "$SHP"
else
  if [ -f "$ZIP" ]; then
    printf 'skip download: %s\n' "$ZIP"
  else
    printf 'download: %s\n' "$ZIP_URL"
    curl -fsSL -o "$ZIP.part" "$ZIP_URL"
    mv "$ZIP.part" "$ZIP"
  fi
  unzip -o -q "$ZIP" -d "$RAW"
  [ -f "$SHP" ] || { printf 'zip did not contain land_polygons.shp\n' >&2; exit 1; }
fi

# The shapefile is the whole world, split on a grid and spatially indexed, so a
# bbox read touches the tiles that matter rather than all 700 MB of it.
if [ -f "$BUILD/clipped.fgb" ]; then
  printf 'skip clip\n'
else
  # shellcheck disable=SC2086
  ogr2ogr -f FlatGeobuf "$BUILD/clipped.part.fgb" "$SHP" -spat $BBOX -nln land
  mv "$BUILD/clipped.part.fgb" "$BUILD/clipped.fgb"
fi

if [ -f "$BUILD/world-coast.geojsonseq" ]; then
  printf 'skip difference\n'
else
  [ -f "$LAND" ] || { printf 'missing %s, run fetch_coastline.sh first\n' "$LAND" >&2; exit 1; }
  [ -f "$COAST" ] || { printf 'missing %s, run fetch_coastline.sh first\n' "$COAST" >&2; exit 1; }
  # shellcheck disable=SC2086
  env -u PYTHONPATH -u PYTHONHOME uv run --quiet --isolated --no-project -p 3.12 \
    --with 'shapely>=2.1' --with pyogrio --with geopandas - \
    "$BUILD/clipped.fgb" "$LAND" "$COAST" "$BUILD" $BBOX <<'PY'
import sys

import geopandas as gpd
from shapely.geometry import box
from shapely.ops import unary_union

clipped, icgc, drawn_coast, outdir = sys.argv[1:5]
west, south, east, north = (float(v) for v in sys.argv[5:9])
frame = box(west, south, east, north)

world = unary_union(list(gpd.read_file(clipped, engine="pyogrio").geometry.values)).intersection(frame)
# Buffer(0) after the union because OSM's split polygons meet along their grid
# lines and the seams leave slivers that break every later boolean.
own = unary_union(list(gpd.read_file(icgc, engine="pyogrio").to_crs("EPSG:4326").geometry.values)).buffer(0)

# Subtracting the ICGC land exactly makes the two polygons abut, and an abutting
# pair is not seamless: the old inland closure came straight back as a dotted
# hairline along the same rectangle. Two things make the gap. Each fill antialiases
# against the background rather than against the other, and tippecanoe simplifies
# the shared edge independently in each tile, which at the zoom the map opens at is
# a tolerance of about 2.8 km on the ground, so the two boundaries wander in and out
# of each other by kilometres and the gap appears and closes: hence dotted.
#
# So overlap rather than abut, by more than that tolerance. Eroding the ICGC land
# before subtracting it leaves the world land running 4 km in underneath it all the
# way round, which the ICGC fill covers completely. That much is true of the inland
# seam and it was wrongly written here as true of the whole boundary. It is not: the
# erosion never touched the seaward side, which is what the two cuts below are for.
OVERLAP = 0.04

# Eroding the ICGC land is only half the cut, and shipping half of it is what put two
# land fills on the same water. The erosion moves the inland seam 4 km under the ICGC
# fill, where it cannot show. It does nothing to the seaward side, so the OSM polygon
# kept its own coastline for the whole length of Catalonia, painting the 0 m isobath's
# water wherever the two disagree. Measured over the Costa Brava that was 34.1 ha of
# surveyed sea under OSM land, the groynes at Palamos among it.
#
# So cut the sea away too. The band follows the drawn coast, which build_shoreline.py
# emits precisely because the mainland polygon cannot be asked: three sides of that
# boundary are the border cuts and the inland closure, and banding those would erase
# OSM land 250 km into Aragon. Flat caps, so the band stops at the border rather than
# reaching round the end of the line. 2 km is many times the widest disagreement.
SEAWARD = 0.02
#
# Cutting the sea away exactly is still not enough, because this archive stops at z11
# and the map goes to z18.5. Tippecanoe simplifies at z11 and the overzoom magnifies
# what it did: measured off Begur the world polygon draws its edge in 22.7 m segments,
# 120 m at the 90th percentile, where the z16 coastline polygon turns every 1.3 m. A
# cut made on the true coast comes back over the water in straight runs, which is what
# the hard-cornered wedges on the shoreline were.
#
# So end the world land inland of the coast rather than on it, by more than any
# simplification can move it back. 300 m is fifteen times the deviation seen, and the
# ICGC fill covers that strip anyway. The cost is the same 300 m missing at the two
# borders, which is 5 px at z11 and less below, the only zooms this archive is for.
INSET = 0.003
coast = unary_union(list(gpd.read_file(drawn_coast, engine="pyogrio").geometry.values))

# Simplified before buffering, which is the difference between a build that takes half
# an hour and one that takes minutes. The drawn coast carries about 835,000 vertices at
# 1.3 m spacing, and buffering that twice is most of the cost. The bands are 2 km and
# 300 m wide, so 20 m on their centreline is nothing: it moves the inset to somewhere
# between 280 and 320 m, still twenty times the simplification it exists to outrun.
edge = coast.simplify(0.0002)
sea = edge.buffer(SEAWARD, cap_style=2).difference(own).union(edge.buffer(INSET, cap_style=2))
outside = world.difference(own.buffer(-OVERLAP)).difference(sea)
gpd.GeoDataFrame({"kind": ["land"]}, geometry=[outside], crs="EPSG:4326").to_file(
    f"{outdir}/world-land.geojsonseq", driver="GeoJSONSeq", engine="pyogrio"
)

# The coast is taken from the OSM land's own boundary rather than from the
# difference above, which now runs 4 km inland of it. Stroking either polygon whole
# would draw a shoreline straight down the middle of the Pyrenees, so what is
# removed is the length of it lying against the ICGC land, which has its own
# drawn coastline, and the length lying along the edge of the frame.
SEAM = 0.0008  # about 80 m, wider than the two datasets disagree along the same shore
coast = world.boundary.difference(own.buffer(SEAM)).difference(frame.boundary.buffer(SEAM))
gpd.GeoDataFrame({"kind": ["coast"]}, geometry=[coast], crs="EPSG:4326").to_file(
    f"{outdir}/world-coast.geojsonseq", driver="GeoJSONSeq", engine="pyogrio"
)

print(f"world land {outside.area:.2f} sq deg, coast {coast.length:.1f} deg")
PY
fi

# tippecanoe picks its format from the extension, so the half-written file keeps it.
PART="${OUT%.*}.part.${OUT##*.}"

# -z11 and no further. Above it the survey covers the screen and the ICGC
# coastline is the one being read; this only has to hold up where it does not.
tippecanoe -o "$PART" -f -q -Z0 -z11 -pk \
  --no-tiny-polygon-reduction \
  --simplification=4 \
  --name=world \
  --description="OSM land outside the ICGC survey, western Mediterranean" \
  --attribution="OpenStreetMap contributors, ODbL" \
  -L "land:$BUILD/world-land.geojsonseq" \
  -L "coast:$BUILD/world-coast.geojsonseq"
mv "$PART" "$OUT"

bytes="$(wc -c < "$OUT" | tr -d '[:space:]')"
if [ "$bytes" -ge "$MAX_BYTES" ]; then
  printf '%s is %s bytes, at or over the %s byte GitHub file limit\n' "$OUT" "$bytes" "$MAX_BYTES" >&2
  exit 1
fi
printf 'have %s (%s bytes)\n' "$OUT" "$bytes"
