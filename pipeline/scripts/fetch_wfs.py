"""Page a GeoServer WFS layer into one GeoJSON file.

The gencat server has no feature cap but drops long transfers, so this pages and
retries. Skips the fetch entirely when the output already has the expected count,
so a rerun after a partial pipeline costs nothing.
"""

import argparse, json, pathlib, sys, time, urllib.parse, urllib.request
from xml.etree import ElementTree

BASE = "https://sig.gencat.cat/ows/HABITATS/wfs"
PAGE = 2000
# The server 403s urllib's default User-Agent.
UA = "dive-map/0.1 (+https://divemap.mauri.app)"


def _get(params: dict[str, str], timeout: int = 240) -> bytes:
    url = f"{BASE}?{urllib.parse.urlencode(params)}"
    last: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001 - any transport failure is retryable
            last = exc
            print(f"  attempt {attempt + 1} failed ({exc}), retrying", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"WFS failed after 4 attempts: {last}")


def hits(type_name: str) -> int:
    body = _get(
        {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": type_name,
            "resultType": "hits",
        },
        timeout=120,
    )
    return int(ElementTree.fromstring(body).attrib["numberMatched"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("type_name")
    ap.add_argument("out", type=pathlib.Path)
    args = ap.parse_args()

    total = hits(args.type_name)
    print(f"{args.type_name}: {total} features")

    if args.out.exists():
        existing = json.loads(args.out.read_text())
        if len(existing.get("features", [])) == total:
            print(f"  {args.out} already complete, skipping")
            return 0

    features: list[dict[str, object]] = []
    while len(features) < total:
        body = _get(
            {
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeNames": args.type_name,
                "srsName": "EPSG:4326",
                "outputFormat": "application/json",
                "count": str(PAGE),
                "startIndex": str(len(features)),
            }
        )
        page = json.loads(body)["features"]
        if not page:
            print("  server returned an empty page early, stopping", file=sys.stderr)
            break
        features.extend(page)
        print(f"  {len(features)}/{total}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB, {len(features)} features)")
    return 0 if len(features) == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
