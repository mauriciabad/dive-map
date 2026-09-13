#!/usr/bin/env bash
# Builds the deep-water depth layers from MAPA's Cartografiado Marino survey,
# which carries on past the offshore limit of the ICGC bathymetry.
#
# Two outputs. `isobaths-deep.pmtiles` is the national contours, clipped to the
# water the ICGC survey never reached, so the two sets never draw on top of each
# other. `shelf-dem.tif` is a depth surface interpolated from those same contours,
# which is what lets the hillshade carry on past the ICGC edge instead of stopping
# at it. There is no usable raster download: the WMS host does not answer, WCS
# returns 403, and the OGC API Coverages endpoint ignores every scaling parameter
# and only ever serves the native 5 m grid, about 67 MB per 0.2 degree square at
# three minutes a request. Interpolating the contours we already have costs one
# local pass and covers exactly the water the contours cover, which is the pair of
# things issue #41 asks for.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW="$ROOT/data/raw"
BUILD="$ROOT/data/build"
OUT="$ROOT/static/tiles"

# The national survey reaches this coast off the Costa Brava and stops: probed at
# Barcelona and at the Ebro delta it returns nothing, so the whole Spanish shelf
# is not on the table even if we wanted it. North of 41.2 and east of 2.7 keeps
# the Catalan margin and drops the Balearic sheets, which sit outside the camera
# guard and would be weight nobody on this coast can pan to.
SPAT=(2.70 41.20 4.05 42.65)
BBOX="0.2,40.0,4.3,42.9"

# Matches the ICGC DEM's own z14 grid so the two mosaic without either resampling.
MAXZ=14
RES="$(python3 -c "import math; print(2 * math.pi * 6378137 / (2 ** $MAXZ * 512))")"
# The contours are 5 m apart on the shelf and 50 m down the slope, so a cell far
# finer than the contour spacing buys nothing but pixels. Four times the DEM cell
# is about 38 m, which still leaves three cells between the closest pair.
FILL_RES="$(python3 -c "print(4 * $RES)")"
TE_3857="$(python3 -c "
import math
w, s, e, n = ${SPAT[0]}, ${SPAT[1]}, ${SPAT[2]}, ${SPAT[3]}
R = 6378137.0
x = lambda d: math.radians(d) * R
y = lambda d: R * math.log(math.tan(math.pi / 4 + math.radians(d) / 2))
print(x(w), y(s), x(e), y(n))
")"

ICGC_WARP="$BUILD/dem-3857.tif"
ICGC_EDGE="$BUILD/icgc-dem-edge.geojson"
BEYOND="$BUILD/icgc-beyond.geojson"
LINES="$BUILD/shelf-isobaths.gpkg"
BURN="$BUILD/shelf-burn.tif"
FILLED="$BUILD/shelf-filled.tif"
DEM="$BUILD/shelf-dem.tif"
TILES="$OUT/isobaths-deep.pmtiles"

for tool in ogr2ogr tippecanoe gdal_rasterize gdal_fillnodata.py gdalwarp python3; do
  command -v "$tool" >/dev/null || { printf 'missing %s on PATH\n' "$tool" >&2; exit 1; }
done

stage() {
  local out=$1; shift
  [ -e "$out" ] && { printf 'have %s\n' "$out"; return 0; }
  local part="${out%.*}.part.${out##*.}"
  rm -f "$part"
  "$@" "$part"
  mv "$part" "$out"
}

mkdir -p "$BUILD" "$RAW" "$OUT"

python3 "$ROOT/pipeline/scripts/fetch_ogcapi.py" pesca:ccmm_batimetria_plataforma \
  "$RAW/national-isobaths-shelf.geojson" --bbox "$BBOX"
python3 "$ROOT/pipeline/scripts/fetch_ogcapi.py" pesca:ccmm_batimetria_talud \
  "$RAW/national-isobaths-slope.geojson" --bbox "$BBOX"

# The clip boundary is the ICGC footprint, traced here from the ICGC warp itself
# rather than read out of `static/data/dem-edge.geojson`. That file is rebuilt from
# the merged DEM once this has run, so reading it would make the second run clip
# the national contours against a footprint that already contains them and throw
# the lot away. Tracing the ICGC raster gives the same answer every time.
[ -e "$ICGC_WARP" ] || { printf 'run build_dem.sh first: %s is missing\n' "$ICGC_WARP" >&2; exit 1; }
[ -e "$ICGC_EDGE" ] || env -u PYTHONPATH -u PYTHONHOME uv run --quiet --isolated --no-project -p 3.12 \
  --with 'shapely>=2.1' --with pyogrio --with geopandas --with rasterio --with numpy \
  "$ROOT/pipeline/scripts/build_dem_edge.py" --dem "$ICGC_WARP" --out "$ICGC_EDGE"

# `beyond` is the complement of that footprint, which is also what the style washes
# as open sea, so the stitch lands exactly where the ICGC contours stop. It comes
# out of a raster trace with a few degenerate rings in it, which ogr2ogr refuses to
# load as a clip source, so it goes through -makevalid on the way.
python3 - "$ICGC_EDGE" "$BUILD/icgc-beyond-raw.geojson" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding="utf-8"))
keep = [f for f in d["features"] if f["properties"]["kind"] == "beyond"]
json.dump({"type": "FeatureCollection", "features": keep}, open(dst, "w"), separators=(",", ":"))
print(f"wrote {dst} ({len(keep)} features)")
PY
rm -f "$BEYOND"
ogr2ogr -f GeoJSON "$BEYOND" "$BUILD/icgc-beyond-raw.geojson" -makevalid -nlt MULTIPOLYGON

# Held in web mercator because the rasterize below has no reprojection of its own,
# and a grid in degrees would be a third taller than it is wide on the ground,
# which the fill distance would then read as two different distances.
merge_lines() {
  local dst=$1 mode=() src
  for src in "$RAW/national-isobaths-shelf.geojson" "$RAW/national-isobaths-slope.geojson"; do
    ogr2ogr -f GPKG "${mode[@]}" "$dst" "$src" -t_srs EPSG:3857 \
      -spat "${SPAT[@]}" -spat_srs EPSG:4326 -clipsrc "$BEYOND" \
      -nlt MULTILINESTRING -nln deep
    mode=(-append)
  done
  ogrinfo -so -al "$dst" | grep -E 'Feature Count|Extent'
}

# Ten metre steps carry the whole zoom range; the five metre ones in between are
# detail nobody reads at a coast-wide zoom and they double the archive.
tile_lines() {
  ogr2ogr -f GeoJSONSeq /vsistdout/ "$LINES" -t_srs EPSG:4326 \
    -select depth -lco RS=NO -lco COORDINATE_PRECISION=6 \
  | python3 -c '
import re, sys
pat = re.compile(r"\"depth\":(\d+)")
w = sys.stdout.write
for line in sys.stdin:
    m = pat.search(line, 0, 200)
    if m is None:
        continue
    w(line if int(m.group(1)) % 10 == 0 else "{\"tippecanoe\":{\"minzoom\":13}," + line[1:])
' \
  | tippecanoe -o "$1" -f -l isobaths -n "MAPA Cartografiado Marino isobaths, CC BY 4.0" \
      -Z8 -z15 -P --coalesce-densest-as-needed --drop-densest-as-needed /dev/stdin
}

# Burn the contours as elevation, then let gdal_fillnodata spread them into the
# gaps. The contours are the only control there is, so the surface between any two
# of them is an interpolation and nothing more; at 5 m contour spacing that is
# within a couple of metres, which is well inside what a hillshade can show. The
# smoothing iterations matter more than the search distance: without them the fill
# terraces on the contour lines and the relief comes out as a flight of steps.
burn() {
  gdal_rasterize -sql "SELECT -1 * depth AS elev, geom FROM deep" -a elev \
    -a_nodata -9999 -ot Float32 -init -9999 \
    -tr "$FILL_RES" "$FILL_RES" -te $TE_3857 -a_srs EPSG:3857 \
    -co TILED=YES -co COMPRESS=DEFLATE "$LINES" "$1"
}

# Eighty cells is about three kilometres, which bridges the widest gap between two
# contours on the flat of the shelf. It also runs that far past the outermost
# contour, and that skirt ends on nodata; the style covers the drop the same way it
# already covers the ICGC one, off `dem-edge.geojson`, which is rebuilt from the
# mosaic so the wash meets the new boundary rather than the old one.
fill() {
  gdal_fillnodata.py -md 80 -si 3 -b 1 -of GTiff \
    -co TILED=YES -co COMPRESS=DEFLATE -co PREDICTOR=3 \
    "$BURN" "$1"
}

# Nodata lands on 0 to match `build_dem.sh`, which is what the mosaic and the
# footprint trace both read as "no reading".
to_elevation() {
  gdalwarp -t_srs EPSG:3857 -tr "$RES" "$RES" -tap -r cubicspline \
    -srcnodata -9999 -dstnodata 0 -ot Float32 \
    -multi -wo NUM_THREADS=ALL_CPUS \
    -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 \
    -co COMPRESS=DEFLATE -co PREDICTOR=3 -co NUM_THREADS=ALL_CPUS -co BIGTIFF=YES \
    "$FILLED" "$1"
}

stage "$LINES" merge_lines
stage "$TILES" tile_lines
printf 'wrote %s (%s)\n' "$TILES" "$(ls -lh "$TILES" | awk '{print $5}')"

stage "$BURN" burn
stage "$FILLED" fill
stage "$DEM" to_elevation
printf 'wrote %s (%s)\n' "$DEM" "$(ls -lh "$DEM" | awk '{print $5}')"
