#!/usr/bin/env bash
# Pull dive-relevant OSM features for a bbox into one raw JSON file.
set -euo pipefail
BBOX="${1:?usage: fetch-osm.sh <south,west,north,east> <out.json>}"
OUT="${2:?usage: fetch-osm.sh <south,west,north,east> <out.json>}"

read -r -d '' Q <<EOF || true
[out:json][timeout:180];
(
  nwr["sport"="scuba_diving"](${BBOX});
  nwr["scuba_diving:divespot"](${BBOX});
  nwr["seamark:type"](${BBOX});
  nwr["historic"="archaeological_site"]["location"="underwater"](${BBOX});
  nwr["natural"="rock"]["location"="underwater"](${BBOX});
  nwr["place"="islet"](${BBOX});
  nwr["leisure"="swimming_area"](${BBOX});
  nwr["waterway"="slipway"](${BBOX});
  nwr["amenity"="dive_centre"](${BBOX});
  nwr["shop"="scuba_diving"](${BBOX});
);
out geom qt;
EOF

MIRRORS=(
  https://overpass-api.de/api/interpreter
  https://overpass.kumi.systems/api/interpreter
  https://overpass.private.coffee/api/interpreter
)
for attempt in 1 2 3; do
  for M in "${MIRRORS[@]}"; do
    if curl -sS --fail-with-body --max-time 200 -X POST "$M" \
         --data-urlencode "data=${Q}" -o "$OUT"; then
      break 2
    fi
    echo "  $M failed, next" >&2
  done
  sleep $((attempt * 10))
done
[ -s "$OUT" ] || { echo "all Overpass mirrors failed" >&2; exit 1; }
echo "wrote $OUT ($(wc -c <"$OUT") bytes, $(grep -o '"type"' "$OUT" | wc -l | tr -d ' ') elements)"
