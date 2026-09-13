#!/usr/bin/env python3
"""Turn a GDAL OSM layer into the land tileset's own vocabulary.

Reads GeoJSONSeq on stdin as `ogr2ogr` emits it from a `.osm.pbf`, writes
GeoJSONSeq on stdout with one `kind` per feature and a tippecanoe minzoom hint.
Everything the style needs to decide how to draw a feature is decided here, so
`style.ts` reads a short enumeration instead of OSM's tag soup.

How far inland a layer reaches is set by the zoom it first appears at, not by
taste. The camera guard pins the view centre to the bathymetry footprint, which
follows the coast, so the deepest a viewport ever reaches inland is half its own
width. On a 1440 px screen at 42 degrees north that is 2.6 km at z14, 5.1 km at
z13 and 20 km at z11, which is where the three clip strips of 3, 8 and 30 km
come from: each is wider than the view that first shows what it holds, so no
strip can be panned to until its own inner edge is off screen.

The rule binds a continuous field, not a scatter. A road network stopping in an
arc across the interior is obvious; beaches are sparse enough that nobody can see
where they stop, so those take the strip that is cheap rather than the one the
arithmetic demands.

Two rounds of deletion got this down. Woodland and scrub were the wash meant to
give the interior some shape, and cost 12.9 MB of a 51 MB archive to do a job the
roads do better. Buildings, place names and landmarks went next: the tiles carried
all three and the style drew none of them, which is 6.0 MB of a 22.4 MB archive
spent on nothing. The landmarks are the ones worth bringing back, with the
authored icons issue #13 asks for rather than borrowed art.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Iterator

# OSM highway value -> the class the map draws, and the zoom it starts at.
# `service` is deliberately absent: parking aisles and driveways are most of its
# count and none of its value on a map whose subject is the water.
ROAD_CLASSES: dict[str, str] = {
    "motorway": "major",
    "motorway_link": "major",
    "trunk": "major",
    "trunk_link": "major",
    "primary": "major",
    "primary_link": "major",
    "secondary": "road",
    "secondary_link": "road",
    "tertiary": "road",
    "tertiary_link": "road",
    "unclassified": "street",
    "residential": "street",
    "living_street": "street",
    "pedestrian": "street",
    "track": "track",
    "path": "path",
    "footway": "path",
    "bridleway": "path",
    "cycleway": "path",
    "steps": "steps",
}

ROAD_MINZOOM: dict[str, int] = {
    "major": 11,
    "road": 11,
    "street": 14,
    "track": 14,
    "path": 14,
    "steps": 15,
}

WATERWAY_MINZOOM: dict[str, int] = {"river": 11, "canal": 13, "stream": 13}

SAND_KINDS: dict[str, str] = {
    "beach": "beach",
    "sand": "sand",
    "shingle": "shingle",
    "dune": "dune",
}

NAME_LOCALES = ("ca", "es", "en")


def parse_hstore(raw: str | None) -> dict[str, str]:
    """GDAL's `other_tags`, which is hstore with backslash escapes inside quotes."""
    if not raw:
        return {}
    tags: dict[str, str] = {}
    parts: list[str] = []
    buf: list[str] = []
    quoted = False
    escaped = False
    for ch in raw:
        if escaped:
            buf.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == '"':
            quoted = not quoted
        elif ch == "," and not quoted:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    for part in parts:
        key, sep, value = part.partition("=>")
        if sep:
            tags[key.strip()] = value.strip()
    return tags


def names(props: dict[str, object], tags: dict[str, str]) -> dict[str, str]:
    """`name`, plus a translation only where a mapper actually wrote one.

    Falling back in the style rather than here keeps Cap de Begur as Cap de Begur
    in every language, which is what the boat crew says.
    """
    out: dict[str, str] = {}
    base = props.get("name")
    if isinstance(base, str) and base:
        out["name"] = base
    for locale in NAME_LOCALES:
        value = tags.get(f"name:{locale}")
        if value and value != out.get("name"):
            out[f"name:{locale}"] = value
    return out


def ring_area_m2(ring: list[list[float]]) -> float:
    """Signed-area of a lon/lat ring, scaled to metres at its own latitude.

    Good to a few percent over a lake, which is all that picking a minzoom from
    size needs. Reprojecting every polygon to do better would cost a GEOS pass
    over the whole extract for nothing.
    """
    if len(ring) < 4:
        return 0.0
    lat = sum(p[1] for p in ring) / len(ring)
    mx = 111_320.0 * math.cos(math.radians(lat))
    my = 110_540.0
    total = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        total += (x1 * mx) * (y2 * my) - (x2 * mx) * (y1 * my)
    return abs(total) / 2


def area_m2(geometry: dict[str, object]) -> float:
    kind = geometry.get("type")
    coords = geometry.get("coordinates")
    if kind == "Polygon" and isinstance(coords, list) and coords:
        return ring_area_m2(coords[0])
    if kind == "MultiPolygon" and isinstance(coords, list):
        return sum(ring_area_m2(p[0]) for p in coords if p)
    return 0.0


def emit(
    geometry: dict[str, object],
    props: dict[str, object],
    minzoom: int,
) -> str:
    feature = {
        "type": "Feature",
        "tippecanoe": {"minzoom": minzoom},
        "properties": props,
        "geometry": geometry,
    }
    return json.dumps(feature, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def convert(layer: str, lines: Iterator[str]) -> Iterator[str]:
    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        feature = json.loads(raw)
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or not geometry.get("coordinates"):
            continue
        source = feature.get("properties") or {}
        tags = parse_hstore(source.get("other_tags") if isinstance(source.get("other_tags"), str) else None)

        def tag(key: str) -> str:
            value = source.get(key)
            if isinstance(value, str) and value:
                return value
            return tags.get(key, "")

        if layer == "road":
            road = ROAD_CLASSES.get(tag("highway"))
            if road is None:
                continue
            props: dict[str, object] = {"kind": road, **names(source, tags)}
            if tags.get("tunnel") in ("yes", "building_passage"):
                continue
            yield emit(geometry, props, ROAD_MINZOOM[road])

        elif layer == "waterway":
            way = tag("waterway")
            minzoom = WATERWAY_MINZOOM.get(way)
            if minzoom is None:
                continue
            yield emit(geometry, {"kind": way, **names(source, tags)}, minzoom)

        elif layer == "water":
            natural, landuse = tag("natural"), tag("landuse")
            if natural == "wetland":
                kind = "wetland"
            elif landuse in ("reservoir", "basin") or tag("water") in ("reservoir", "basin"):
                kind = "reservoir"
            elif natural == "water" or landuse == "reservoir":
                kind = "water"
            else:
                continue
            size = area_m2(geometry)
            # A farm pond drawn at z11 is a speck of ink over a whole bay; the
            # Ter estuary found only at z13 is a feature nobody finds at all.
            # Size decides which of the two a polygon is.
            minzoom = 11 if size > 1e5 else 13
            yield emit(geometry, {"kind": kind, **names(source, tags)}, minzoom)

        elif layer == "sand":
            kind = SAND_KINDS.get(tag("natural"))
            if kind is None:
                continue
            yield emit(geometry, {"kind": kind, **names(source, tags)}, 12)

        else:
            raise SystemExit(f"unknown layer {layer}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("layer")
    args = parser.parse_args()
    write = sys.stdout.write
    for line in convert(args.layer, sys.stdin):
        write(line)
        write("\n")


if __name__ == "__main__":
    main()
