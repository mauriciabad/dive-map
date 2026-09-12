"""Convert an Overpass raw JSON extract into the reduced osm.geojson the app ships.

Reads Overpass `out geom` output, builds GeoJSON geometry for every element, keeps
only what the app's own TypeScript parser recognises, strips every tag that parser
never reads, and writes a compact FeatureCollection small enough to fetch over a
boat's mobile signal.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import NamedTuple

REPO = Path(__file__).resolve().parents[2]
PARSER_SOURCE = REPO / "src" / "lib" / "domain" / "osm.ts"
DEFAULT_INPUT = REPO / "data" / "raw" / "osm-catalunya.json"
OUTPUT = REPO / "static" / "data" / "osm.geojson"

PRECISION = 6
LINEAR_TAGS = (("waterway", "slipway"), ("highway", "ladder"))

TAG_LITERAL = re.compile(r"tags\['([^']+)'\]")
DANGER_PREFIX = "scuba_diving:dangers:"
LOCALISED_NAMES = ("name:ca", "name:es", "name:en")
REQUIRED_LITERALS = frozenset({"seamark:type", "scuba_diving:divespot", "name", "alt_name"})

DRIVER = """import { readFileSync, writeFileSync } from 'node:fs';
import { parseDiveFeature } from %s;

const [inputPath, outputPath] = process.argv.slice(2);
const elements = JSON.parse(readFileSync(inputPath, 'utf8'));
const results = elements.map((el) => {
	const feature = parseDiveFeature({ type: el.type, id: el.id }, el.tags ?? {});
	return { keep: feature !== undefined, kind: feature === undefined ? null : feature.kind };
});
writeFileSync(outputPath, JSON.stringify(results));
"""

PARSER_DROP = "parser returned nothing"
GEOMETRY_DROP = "no usable geometry"


class Converted(NamedTuple):
    t: str
    id: int
    tags: dict
    geometry: dict | None


def positions(raw) -> list[list[float]]:
    return [
        [round(p["lon"], PRECISION), round(p["lat"], PRECISION)]
        for p in raw or []
        if isinstance(p, dict) and "lat" in p and "lon" in p
    ]


def is_linear(tags: dict) -> bool:
    return any(tags.get(key) == value for key, value in LINEAR_TAGS)


def point_in_ring(point: list[float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    previous = len(ring) - 1
    for current in range(len(ring)):
        xi, yi = ring[current]
        xj, yj = ring[previous]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        previous = current
    return inside


# A multipolygon's outer ring is usually split across several member ways, which
# Overpass returns in arbitrary order and arbitrary winding. So a ring is only
# recoverable by matching each fragment's endpoints against the running chain and
# reversing the fragment when it joined on its own last coordinate.
def stitch_rings(fragments: list[list[list[float]]]) -> list[list[list[float]]]:
    remaining = [f for f in fragments if len(f) >= 2]
    rings = []
    while remaining:
        chain = remaining.pop(0)
        while chain[0] != chain[-1]:
            joined = False
            for index, fragment in enumerate(remaining):
                if fragment[0] == chain[-1]:
                    chain = chain + fragment[1:]
                elif fragment[-1] == chain[-1]:
                    chain = chain + fragment[-2::-1]
                else:
                    continue
                remaining.pop(index)
                joined = True
                break
            if not joined:
                break
        if chain[0] == chain[-1] and len(chain) >= 4:
            rings.append(chain)
    return rings


def assign_holes(
    outers: list[list[list[float]]], inners: list[list[list[float]]]
) -> list[list[list[list[float]]]]:
    polygons = [[outer] for outer in outers]
    for hole in inners:
        for polygon in polygons:
            if point_in_ring(hole[0], polygon[0]):
                polygon.append(hole)
                break
    return polygons


def member_fragments(members: list, role: str) -> list[list[list[float]]]:
    fragments = []
    for member in members:
        if member.get("type") != "way" or member.get("role") != role:
            continue
        line = positions(member.get("geometry"))
        if len(line) >= 2:
            fragments.append(line)
    return fragments


def node_geometry(element: dict) -> dict | None:
    lat, lon = element.get("lat"), element.get("lon")
    if lat is None or lon is None:
        return None
    return {"type": "Point", "coordinates": [round(lon, PRECISION), round(lat, PRECISION)]}


def way_geometry(element: dict) -> dict | None:
    line = positions(element.get("geometry"))
    if len(line) < 2:
        return None
    closed = line[0] == line[-1] and len(line) > 3
    if closed and not is_linear(element.get("tags") or {}):
        return {"type": "Polygon", "coordinates": [line]}
    return {"type": "LineString", "coordinates": line}


def multipolygon_geometry(members: list) -> dict | None:
    outers = stitch_rings(member_fragments(members, "outer"))
    if not outers:
        return None
    polygons = assign_holes(outers, stitch_rings(member_fragments(members, "inner")))
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def multilinestring_geometry(members: list) -> dict | None:
    lines = [
        line
        for line in (
            positions(m.get("geometry")) for m in members if m.get("type") == "way"
        )
        if len(line) >= 2
    ]
    if not lines:
        return None
    return {"type": "MultiLineString", "coordinates": lines}


def relation_geometry(element: dict) -> dict | None:
    members = element.get("members") or []
    if (element.get("tags") or {}).get("type") == "multipolygon":
        return multipolygon_geometry(members)
    return multilinestring_geometry(members)


GEOMETRY_BUILDERS = {
    "node": node_geometry,
    "way": way_geometry,
    "relation": relation_geometry,
}


def convert(element: dict) -> Converted:
    builder = GEOMETRY_BUILDERS.get(element.get("type"))
    tags = element.get("tags") or {}
    return Converted(
        t=element["type"],
        id=element["id"],
        tags=tags,
        geometry=None if builder is None else builder(element),
    )


def load_elements(path: Path) -> list[dict]:
    document = json.loads(path.read_bytes())
    return document.get("elements") or []


# Derived from the parser source rather than hand-listed so that a future edit to
# which tags parseDiveFeature reads fails this build loudly instead of silently
# shipping a file with the tags the app needs already stripped out.
def whitelist(source: Path, elements: list[dict]) -> frozenset[str]:
    literals = frozenset(TAG_LITERAL.findall(source.read_text(encoding="utf-8")))
    missing = sorted(REQUIRED_LITERALS - literals)
    if not literals or missing:
        raise RuntimeError(
            f"Tag whitelist derivation failed against {source}. "
            f"Found {len(literals)} tags['<key>'] literals, missing {missing or 'nothing'}. "
            "parseDiveFeature no longer reads tags as tags['<key>'] literals, so this script "
            "can no longer tell which tags the app needs. Update TAG_LITERAL in "
            f"{Path(__file__).resolve()} to match how the parser now reads tags."
        )
    dangers = {
        key
        for element in elements
        for key in (element.get("tags") or {})
        if key.startswith(DANGER_PREFIX)
    }
    return frozenset(literals | dangers | set(LOCALISED_NAMES))


def parse_with_app(converted: list[Converted]) -> list[dict]:
    payload = [{"type": c.t, "id": c.id, "tags": c.tags} for c in converted]
    with tempfile.TemporaryDirectory() as directory:
        workspace = Path(directory)
        driver = workspace / "driver.mjs"
        elements_file = workspace / "elements.json"
        results_file = workspace / "results.json"
        driver.write_text(DRIVER % json.dumps(str(PARSER_SOURCE)), encoding="utf-8")
        elements_file.write_text(json.dumps(payload), encoding="utf-8")
        run = subprocess.run(
            ["node", str(driver), str(elements_file), str(results_file)],
            capture_output=True,
            text=True,
        )
        if run.returncode != 0:
            raise RuntimeError(
                f"node exited {run.returncode} while running {PARSER_SOURCE} over "
                f"{len(payload)} elements.\nstderr:\n{run.stderr}"
            )
        results = json.loads(results_file.read_text(encoding="utf-8"))
    if len(results) != len(payload):
        raise RuntimeError(
            f"parseDiveFeature bridge returned {len(results)} results for "
            f"{len(payload)} elements, so results can no longer be matched to elements."
        )
    return results


def feature(converted: Converted, properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": converted.geometry,
        "properties": properties,
    }


def feature_collection(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def encode(document: dict) -> bytes:
    return json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def reduce_features(
    converted: list[Converted], results: list[dict], keys: frozenset[str]
) -> tuple[list[dict], Counter]:
    features, drops = [], Counter({PARSER_DROP: 0, GEOMETRY_DROP: 0})
    for element, result in zip(converted, results):
        if not result["keep"]:
            drops[PARSER_DROP] += 1
            continue
        if element.geometry is None:
            drops[GEOMETRY_DROP] += 1
            continue
        properties = {"t": element.t, "id": element.id, "kind": result["kind"]}
        properties.update({k: v for k, v in element.tags.items() if k in keys})
        features.append(feature(element, properties))
    features.sort(key=lambda f: (f["properties"]["t"], f["properties"]["id"]))
    return features, drops


def report(
    input_path: Path, input_size: int, unreduced_size: int, output_size: int,
    features: list[dict], drops: Counter,
) -> None:
    kinds = Counter(f["properties"]["kind"] for f in features)
    print(f"input       {input_path}")
    print(f"            {input_size:,} bytes")
    print(f"unreduced   {unreduced_size:,} bytes")
    print(f"output      {OUTPUT}")
    print(f"            {output_size:,} bytes")
    ratio = output_size / unreduced_size if unreduced_size else 0.0
    print(f"reduction   {ratio:.4%} of unreduced ({unreduced_size / max(output_size, 1):.1f}x smaller)")
    print(f"features    {len(features):,}")
    for kind, count in sorted(kinds.items()):
        print(f"  {kind:<16}{count:,}")
    print(f"dropped     {sum(drops.values()):,}")
    for reason in (PARSER_DROP, GEOMETRY_DROP):
        print(f"  {reason:<24}{drops[reason]:,}")


def main(argv: list[str]) -> int:
    input_path = Path(argv[1]).resolve() if len(argv) > 1 else DEFAULT_INPUT
    input_size = input_path.stat().st_size
    elements = load_elements(input_path)
    converted = [convert(element) for element in elements]

    unreduced_size = len(
        encode(
            feature_collection(
                [
                    feature(c, {"t": c.t, "id": c.id, **c.tags})
                    for c in converted
                    if c.geometry is not None
                ]
            )
        )
    )

    keys = whitelist(PARSER_SOURCE, elements)
    results = parse_with_app(converted)
    features, drops = reduce_features(converted, results, keys)

    payload = encode(feature_collection(features))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(payload)

    report(input_path, input_size, unreduced_size, len(payload), features, drops)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
