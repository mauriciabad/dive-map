"""Page an OGC API Features collection into one GeoJSON file.

MAPA's sig-api serves the national shelf isobaths. It caps a page at 1000 features
and its `startIndex` paging is only stable under an explicit sort, so this asks for
`objectid` order and walks the whole bbox.
"""

import argparse
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://wmts.mapama.gob.es/sig-api/ogc/features/v1/collections"
PAGE = 1000
UA = "dive-map/0.1 (+https://divemap.mauri.app)"


def _get(url: str, timeout: int = 180) -> bytes:
    last: Exception | None = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001 - any transport failure is retryable
            last = exc
            print(f"  attempt {attempt + 1} failed ({exc}), retrying", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"OGC API failed after 5 attempts: {last}")


def page(collection: str, bbox: str, start: int) -> dict:
    q = urllib.parse.urlencode(
        {
            "f": "json",
            "limit": str(PAGE),
            "startIndex": str(start),
            "bbox": bbox,
            "sortby": "objectid",
        }
    )
    return json.loads(_get(f"{BASE}/{urllib.parse.quote(collection)}/items?{q}"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("collection")
    ap.add_argument("out", type=pathlib.Path)
    ap.add_argument("--bbox", required=True)
    ap.add_argument("--property", default="contour")
    args = ap.parse_args()

    first = page(args.collection, args.bbox, 0)
    total = int(first["numberMatched"])
    print(f"{args.collection}: {total} features in {args.bbox}")

    if args.out.exists():
        existing = json.loads(args.out.read_text())
        if len(existing.get("features", [])) == total:
            print(f"  {args.out} already complete, skipping")
            return 0

    out = []
    batch = first
    start = 0
    while True:
        got = batch.get("features", [])
        for f in got:
            # The contour values are negative metres below the surface; the rest of
            # this pipeline carries depth as a positive number.
            depth = f["properties"].get(args.property)
            if depth is None:
                continue
            out.append(
                {
                    "type": "Feature",
                    "properties": {"depth": abs(int(depth))},
                    "geometry": f["geometry"],
                }
            )
        start += len(got)
        print(f"  {start}/{total}")
        if len(got) < PAGE or start >= total:
            break
        batch = page(args.collection, args.bbox, start)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"type": "FeatureCollection", "features": out}, separators=(",", ":"))
    )
    print(f"wrote {args.out} ({len(out)} features)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
