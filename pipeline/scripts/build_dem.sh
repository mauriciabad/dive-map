#!/usr/bin/env bash
# Builds the Terrain-RGB bathymetry PMTiles for the Catalan coast from ICGC's
# remote COG. /vsicurl reads only the blocks gdalwarp asks for, so the 3.3 GB
# source is never downloaded whole.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="https://datacloud.icgc.cat/datacloud/batimetria/tif_unzip/batimetria-v2r1-elevacions-2021-2025.tif"
BUILD="$ROOT/data/build"
WARP="$BUILD/dem-3857.tif"
TILES="$BUILD/dem.mbtiles"
SHIM="$BUILD/dem-shim"
OUT="$ROOT/static/tiles/seabed-dem.pmtiles"

# Without EMPTY_DIR, /vsicurl probes sibling paths on every open.
export GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR
export CPL_VSIL_CURL_ALLOWED_EXTENSIONS=.tif
export VSI_CACHE=TRUE VSI_CACHE_SIZE=200000000
export GDAL_NUM_THREADS=ALL_CPUS

MINZ=8
MAXZ=14
BASE=-10000
INTERVAL=0.1
RES="$(python3 -c "import math; print(2 * math.pi * 6378137 / (2 ** $MAXZ * 512))")"

if [ -x /opt/homebrew/bin/pmtiles ]; then PMTILES=/opt/homebrew/bin/pmtiles; else PMTILES=pmtiles; fi

if [ -e "$OUT" ]; then
  printf 'have %s\n' "$OUT"
  exit 0
fi

mkdir -p "$BUILD" "$(dirname "$OUT")"

# The temp name keeps the real extension (dem.part.mbtiles, not dem.mbtiles.part)
# because rio-rgbify and pmtiles both switch behaviour on the output extension.
stage() {
  local out=$1; shift
  [ -e "$out" ] && { printf 'have %s\n' "$out"; return 0; }
  local part="${out%.*}.part.${out##*.}"
  rm -f "$part"
  "$@" "$part"
  mv "$part" "$out"
}

encode() {
  local dst=$1
  local xmin xmax ymin ymax w s e n clon clat

  mkdir -p "$SHIM"
  # rio-rgbify 0.4.0 asks transform_bounds for densify_pts=0 and GDAL >= 3.4
  # rejects that for a geographic target. The shim rides PYTHONPATH for this one
  # command; the other python3 calls here have no rasterio and would fail on import.
  cat >"$SHIM/sitecustomize.py" <<'PY'
import rasterio.warp as _w
_orig = _w.transform_bounds
def transform_bounds(*a, **k):
    if k.get("densify_pts", 21) < 2:
        k["densify_pts"] = 2
    return _orig(*a, **k)
_w.transform_bounds = transform_bounds
import rio_rgbify.mbtiler as _m
_m.transform_bounds = transform_bounds
PY

  PYTHONNOUSERSITE=1 PYTHONPATH="$SHIM" uv run --quiet --python 3.12 \
    --with rio-rgbify==0.4.0 --with 'rasterio<1.4' \
    rio rgbify -b "$BASE" -i "$INTERVAL" --min-z "$MINZ" --max-z "$MAXZ" \
    --format webp -j 8 "$WARP" "$dst"

  # rgbify emits every tile in the source's bounding rectangle. Our data is a
  # diagonal strip, so ~95% of the tiles are a constant nodata plane sharing one
  # byte-identical blob. Left in, MapLibre hillshades a flat 0 m sea over inland
  # Catalonia and the open Mediterranean.
  sqlite3 "$dst" "
    DELETE FROM tiles WHERE tile_data = (
      SELECT tile_data FROM (
        SELECT tile_data, count(*) AS n FROM tiles GROUP BY tile_data
        ORDER BY n DESC LIMIT 1
      ) WHERE length(tile_data) < 2000
    );
    SELECT 'pruned ' || changes() || ' empty tiles, ' ||
           (SELECT count(*) FROM tiles) || ' remain';"

  # rgbify writes no bounds, so pmtiles would stamp the whole world into the
  # header and MapLibre would ask for dem tiles everywhere. The tiles that
  # survived the prune give the true footprint, not the bounding rectangle.
  read -r xmin xmax ymin ymax < <(sqlite3 "$dst" \
    "SELECT min(tile_column), max(tile_column), min(tile_row), max(tile_row)
     FROM tiles WHERE zoom_level = $MAXZ;" | tr '|' ' ')
  read -r w s e n clon clat < <(python3 -c "
import math
z, xmin, xmax, ytmin, ytmax = $MAXZ, $xmin, $xmax, $ymin, $ymax
t = 1 << z
lon = lambda x: x / t * 360.0 - 180.0
lat = lambda y: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / t))))
w, s, e, n = lon(xmin), lat(t - ytmin), lon(xmax + 1), lat(t - 1 - ytmax)
print(w, s, e, n, (w + e) / 2, (s + n) / 2)
")
  sqlite3 "$dst" "
    DELETE FROM metadata WHERE name IN
      ('name', 'description', 'bounds', 'center', 'minzoom', 'maxzoom');
    INSERT INTO metadata (name, value) VALUES
      ('name', 'seabed-dem'),
      ('description', 'Bathymetry DEM from ICGC batimetria v2r1 2021-2025, CC BY 4.0'),
      ('bounds', '$w,$s,$e,$n'),
      ('center', '$clon,$clat,$MINZ'),
      ('minzoom', '$MINZ'),
      ('maxzoom', '$MAXZ');"
  printf 'bounds %s,%s,%s,%s\n' "$w" "$s" "$e" "$n"
}

printf 'source %s\n' "$SRC"
gdalinfo "/vsicurl/$SRC" | grep -E 'Size is|Pixel Size|Block=|NoData|Overviews'

# No -te: gdalwarp takes the extent from the source and -tap snaps it to the
# resolution grid, which at this RES lands on the z14 web-mercator tile grid.
# -r average rather than bilinear because this is a 4.8x downsample of a 1 m
# grid, and -srcnodata keeps the nodata cells out of each average.
stage "$WARP" gdalwarp -t_srs EPSG:3857 -tr "$RES" "$RES" -tap -r average \
  -srcnodata -9999 -dstnodata 0 -ot Float32 \
  -multi -wo NUM_THREADS=ALL_CPUS -wm 2048 \
  -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 \
  -co COMPRESS=DEFLATE -co PREDICTOR=3 -co NUM_THREADS=ALL_CPUS -co BIGTIFF=YES \
  "/vsicurl/$SRC"

stage "$TILES" encode
stage "$OUT" "$PMTILES" convert "$TILES"

"$PMTILES" show "$OUT"
printf 'wrote %s (%s)\n' "$OUT" "$(ls -lh "$OUT" | awk '{print $5}')"
