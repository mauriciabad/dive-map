#!/usr/bin/env python3
"""Build the habitat point records the map draws over the painted seabed.

The ICGC marine habitats delivery publishes two geometries, not one.
`HABITATS_HABITATS_MARINS` is the polygon layer this map has always painted the
seabed with. `HABITATS_MARINS_COM` carries the same attribute schema over
MultiPoint, and it is the half nothing here ever drew: 1,392 single-point records
of standing life too small to be a polygon at the survey's own scale.

Four classes, and every one of them is something a diver is looking for:

    302022501  1259  Coral·ligen amb Paramuricea clavata
    302022301   129  Fons circalitorals rocosos no concrecionats,
                     Leptogorgia sarmentosa / Eunicella verrucosa
    305130202     2  Herbeis de Caulerpa cylindracea
    301041407     2  Fons infralitorals rocosos amb Eunicella singularis

They are EUNIS level 5, two digits finer than the polygons: `CODI_LPRE3` is "-"
on every one of them, so the join key is `CODI_LPRE4`, which `src/lib/domain/
habitat-points.ts` lists.

Output is a plain GeoJSON file rather than a tileset. 1,392 points is 90 kB,
which is a fifth of the OSM features the map already ships as one file, and a
tileset would cost a source, a build step and a range-cache policy to save
nothing. Every geometry in the layer is a MultiPoint of exactly one point, so
they are flattened to Point.

Depth is the survey's own `FONDMIT`, negative down, carried as positive metres.
Every record has one, from 2 m to 54 m.

    python3 pipeline/scripts/build_habitat_points.py
"""

import argparse
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent

TYPE_NAME = "HABITATS:HABITATS_MARINS_COM"

# Six decimals is a tenth of a metre at this latitude, well past what a survey
# that records a whole habitat as one point can mean.
PRECISION = 6


def fetch(raw: pathlib.Path) -> None:
    subprocess.run([sys.executable, str(HERE / "fetch_wfs.py"), TYPE_NAME, str(raw)], check=True)


def trim(raw: pathlib.Path, out: pathlib.Path) -> int:
    source = json.loads(raw.read_text())
    features = []
    for feature in source["features"]:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "MultiPoint":
            raise SystemExit(f"expected MultiPoint, got {geometry.get('type')}")
        properties = feature["properties"]
        code = properties.get("CODI_LPRE4")
        depth = properties.get("FONDMIT")
        for lng, lat in geometry["coordinates"]:
            features.append(
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(lng, PRECISION), round(lat, PRECISION)],
                    },
                    "properties": {
                        "code": code,
                        "depth": None if depth is None else round(abs(depth)),
                    },
                }
            )

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    return len(features)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=pathlib.Path, default=ROOT / "data/raw/habitat-points.geojson")
    ap.add_argument("--out", type=pathlib.Path, default=ROOT / "static/data/habitat-points.geojson")
    args = ap.parse_args()

    fetch(args.raw)
    count = trim(args.raw, args.out)

    tally: dict[str, int] = {}
    for feature in json.loads(args.out.read_text())["features"]:
        code = feature["properties"]["code"]
        tally[code] = tally.get(code, 0) + 1
    for code, n in sorted(tally.items(), key=lambda pair: -pair[1]):
        print(f"  {code}  {n}")
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e3:.0f} kB, {count} points)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
