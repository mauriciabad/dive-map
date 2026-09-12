#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BBOX="${OSM_BBOX:-40.5,0.15,42.5,3.35}"
OUT="${1:-$ROOT/data/raw/osm-catalunya.json}"
CHUNK_DIR="$(dirname "$OUT")/osm-chunks"
TIMEOUT="${OSM_TIMEOUT:-600}"
CURL_MAX=$((TIMEOUT + 60))
MAX_SPLIT="${OSM_MAX_SPLIT:-2}"
MAX_AGE_DAYS="${OSM_MAX_AGE_DAYS:-14}"
UA="dive-map/0.0.1 (https://divemap.mauri.app)"

MIRRORS=(
  https://overpass-api.de/api/interpreter
  https://overpass.kumi.systems/api/interpreter
  https://overpass.private.coffee/api/interpreter
)

if command -v shasum >/dev/null 2>&1; then HASHER=(shasum -a 256); else HASHER=(sha256sum); fi

mkdir -p "$CHUNK_DIR"

# Only terms that can yield a feature from src/lib/domain/osm.ts earn a query.
# place=islet, leisure=swimming_area and historic=archaeological_site were dropped
# because parseDiveFeature returns undefined for each of those tags on its own, so
# they spent Overpass budget on elements the reduction then discarded: place=islet
# alone was 1,034 of the 1,617 elements in the old Costa Brava extract. Swimming
# areas still arrive when they carry seamark:type, which in Catalonia is all of
# them. Islet outlines come from the ICGC coastline, not from OSM.
chunk_body() {
  case "$1" in
    scuba)
      printf '%s\n' \
        'nwr["sport"="scuba_diving"](@B@);' \
        'nwr["scuba_diving:divespot"](@B@);' \
        'nwr["amenity"="dive_centre"](@B@);' \
        'nwr["shop"="scuba_diving"](@B@);'
      ;;
    seamark)
      printf '%s\n' 'nwr["seamark:type"](@B@);'
      ;;
    shore)
      printf '%s\n' \
        'nwr["natural"="rock"]["location"="underwater"](@B@);' \
        'nwr["waterway"="slipway"](@B@);' \
        'nwr["highway"="ladder"](@B@);'
      ;;
    *) return 1 ;;
  esac
}

build_query() {
  printf '[out:json][timeout:%s];\n(\n%s);\nout geom qt;\n' \
    "$TIMEOUT" "$(chunk_body "$1" | sed "s/@B@/$2/g")"
}

valid_chunk() {
  [ -s "$1" ] || return 1
  python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(1)
if not isinstance(d.get("elements"), list):
    sys.exit(1)
r = str(d.get("remark", "")).lower()
sys.exit(1 if any(w in r for w in ("error", "timed out", "memory")) else 0)
' "$1" 2>/dev/null
}

# Mirrors replicate at wildly different rates and a lagging one answers a valid
# query with a valid-looking short result. One mirror served this bbox from a
# database four months behind, losing 11 of 111 dive elements with no remark and
# no error, so the replication timestamp decides which answer is usable.
chunk_timestamp() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("osm3s",{}).get("timestamp_osm_base",""))' "$1" 2>/dev/null
}

is_fresh() {
  python3 -c '
import sys
from datetime import datetime, timedelta, timezone
stamp, limit = sys.argv[1], int(sys.argv[2])
if not stamp:
    sys.exit(1)
try:
    base = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
except ValueError:
    sys.exit(1)
sys.exit(0 if datetime.now(timezone.utc) - base <= timedelta(days=limit) else 1)
' "$1" "$MAX_AGE_DAYS" 2>/dev/null
}

count_elements() {
  python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1],encoding="utf-8"))["elements"]))' "$1"
}

fetch_region() {
  local name="$1" bbox="$2" depth="$3"
  local q key file attempt mirror

  q="$(build_query "$name" "$bbox")"
  # The query text is in the cache key so editing chunk_body invalidates the
  # cache instead of silently serving a chunk built from the previous query.
  key="${name}-$(printf '%s' "$bbox" | tr ',.' '--')-$(printf '%s' "$q" | "${HASHER[@]}" | cut -c1-8)"
  file="$CHUNK_DIR/$key.json"

  if valid_chunk "$file"; then
    printf 'cached   %-44s %7d elements  osm base %s\n' \
      "$key" "$(count_elements "$file")" "$(chunk_timestamp "$file")" >&2
    return 0
  fi

  local best_ts="" stamp
  for attempt in 1 2 3; do
    for mirror in "${MIRRORS[@]}"; do
      if curl -sS --fail-with-body --max-time "$CURL_MAX" -A "$UA" -X POST "$mirror" \
           --data-urlencode "data=$q" -o "$file.part" && valid_chunk "$file.part"; then
        stamp="$(chunk_timestamp "$file.part")"
        if is_fresh "$stamp"; then
          mv "$file.part" "$file"
          printf 'fetched  %-44s %7d elements  osm base %s\n' \
            "$key" "$(count_elements "$file")" "$stamp" >&2
          sleep 3
          return 0
        fi
        echo "  $mirror is stale for $key (osm base $stamp), trying another" >&2
        if [[ -z "$best_ts" || "$stamp" > "$best_ts" ]]; then
          best_ts="$stamp"
          mv "$file.part" "$file.cand"
        fi
      else
        echo "  $mirror failed for $key" >&2
      fi
      rm -f "$file.part"
    done
    sleep $((attempt * 15))
  done

  if [ -n "$best_ts" ]; then
    mv "$file.cand" "$file"
    printf 'STALE    %-44s %7d elements  osm base %s (no mirror within %s days)\n' \
      "$key" "$(count_elements "$file")" "$best_ts" "$MAX_AGE_DAYS" >&2
    return 0
  fi

  rm -f "$file.cand"
  if [ "$depth" -lt "$MAX_SPLIT" ]; then
    local s w n e mid
    IFS=, read -r s w n e <<<"$bbox"
    mid="$(awk -v a="$s" -v b="$n" 'BEGIN{printf "%.4f", (a+b)/2}')"
    echo "  splitting $name at lat $mid" >&2
    fetch_region "$name" "$s,$w,$mid,$e" $((depth + 1))
    fetch_region "$name" "$mid,$w,$n,$e" $((depth + 1))
    return 0
  fi

  echo "all Overpass mirrors failed for $key" >&2
  return 1
}

for name in scuba seamark shore; do
  fetch_region "$name" "$BBOX" 0
done

python3 -c '
import glob, json, os, sys

chunk_dir, out, bbox = sys.argv[1], sys.argv[2], sys.argv[3]
south, west, north, east = (float(v) for v in bbox.split(","))

merged = {}
for path in sorted(glob.glob(os.path.join(chunk_dir, "*.json"))):
    for el in json.load(open(path, encoding="utf-8"))["elements"]:
        merged[(el["type"], el["id"])] = el

elements = [merged[k] for k in sorted(merged)]
tmp = out + ".part"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(
        {"bbox": [south, west, north, east], "elements": elements},
        fh, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
    )
os.replace(tmp, out)

kinds = {}
for el in elements:
    kinds[el["type"]] = kinds.get(el["type"], 0) + 1
print(
    f"wrote {out} ({os.path.getsize(out)} bytes, {len(elements)} elements: "
    + ", ".join(f"{v} {k}" for k, v in sorted(kinds.items()))
    + ")"
)
' "$CHUNK_DIR" "$OUT" "$BBOX"
