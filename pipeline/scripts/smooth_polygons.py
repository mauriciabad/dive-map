#!/usr/bin/env python3
"""Rounds the raster staircase off the ICGC habitat and substrate polygons.

These polygons tile a continuous surface, so smoothing them one at a time would tear
every shared boundary. Instead this smooths the arrangement they form.

Every output point is a pure function of a local vertex triple, evaluated with an
expression that is symmetric under reversal. Two polygons sharing a boundary walk that
boundary in opposite directions over the same vertices, so they compute bit-identical
coordinates for it. Gaps and overlaps are impossible rather than merely small, and no
matching tolerance is involved anywhere.

A vertex with other than two distinct neighbours is a junction where three or more
polygons meet, or the tip of a spike. Those stay pinned: a sharp point there is the
correct answer, and rounding one would pull each polygon away in a different direction.

The corner cut is capped per vertex by the size of the smallest polygon touching it, so
the 100 m2 minimum mapping unit survives. Since the cap is a property of the vertex, both
sides of every boundary read the same value.

The dissolved survey coverage falls out of the same structure: its outline is exactly the
directed edges no second polygon claims.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict

GRID = 10_000_000
LAT0 = 41.4
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 110574.0


def metres(pt: tuple[int, int]) -> tuple[float, float]:
    return (pt[0] / GRID * MX, pt[1] / GRID * MY)


def ring_metrics(ring: list[tuple[float, float]]) -> tuple[float, float]:
    n = len(ring)
    twice = 0.0
    perim = 0.0
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        twice += x0 * y1 - x1 * y0
        perim += math.hypot(x1 - x0, y1 - y0)
    return twice / 2.0, perim


class Arrangement:
    def __init__(self) -> None:
        self.pt_id: dict[tuple[int, int], int] = {}
        self.pts: list[tuple[int, int]] = []
        self.rings: list[list[int]] = []
        self.ring_owner: list[int] = []
        self.ring_area: list[float] = []
        self.ring_cap: list[float] = []

    def point(self, lon: float, lat: float) -> int:
        key = (int(round(lon * GRID)), int(round(lat * GRID)))
        got = self.pt_id.get(key)
        if got is None:
            got = len(self.pts)
            self.pt_id[key] = got
            self.pts.append(key)
        return got

    def add_ring(self, coords, owner: int, size_ratio: float, max_offset: float) -> int | None:
        seq: list[int] = []
        for lon, lat in coords:
            i = self.point(lon, lat)
            if not seq or seq[-1] != i:
                seq.append(i)
        while len(seq) > 1 and seq[0] == seq[-1]:
            seq.pop()
        if len(seq) < 3:
            return None
        area, perim = ring_metrics([metres(self.pts[i]) for i in seq])
        size = 4.0 * abs(area) / perim if perim > 0 else 0.0
        self.rings.append(seq)
        self.ring_owner.append(owner)
        self.ring_area.append(area)
        self.ring_cap.append(min(max_offset, size_ratio * size))
        return len(self.rings) - 1


def analyse(arr: Arrangement):
    """Pins, per-vertex caps and the directed-edge partner map, all read from the rings."""
    adjacency: dict[int, set[int]] = defaultdict(set)
    partner: dict[tuple[int, int], int] = {}
    cap: dict[int, float] = {}
    repeats: set[int] = set()
    for rid, seq in enumerate(arr.rings):
        n = len(seq)
        rcap = arr.ring_cap[rid]
        seen: set[int] = set()
        for i in range(n):
            a, b = seq[i], seq[(i + 1) % n]
            partner.setdefault((a, b), rid)
            adjacency[a].add(b)
            adjacency[b].add(a)
            if a in seen:
                repeats.add(a)
            seen.add(a)
            if rcap < cap.get(a, math.inf):
                cap[a] = rcap
    pinned = {v for v, adj in adjacency.items() if len(adj) != 2} | repeats
    return pinned, cap, partner, adjacency


def chaikin_round(ring, cut: float):
    """One capped corner-cutting pass over (x, y, pin, cap, tag) points."""
    n = len(ring)
    out = []
    for i in range(n):
        ax, ay, apin, acap, atag = ring[i]
        bx, by, bpin, bcap, btag = ring[(i + 1) % n]
        if apin:
            out.append(ring[i])
        dx, dy = bx - ax, by - ay
        span = math.hypot(dx, dy)
        if span == 0.0:
            continue
        lim = acap if acap < bcap else bcap
        t = cut if cut * span <= lim else lim / span
        out.append((ax + t * dx, ay + t * dy, False, acap, atag))
        out.append((bx - t * dx, by - t * dy, False, bcap, atag))
    return out


def douglas_peucker(run, tol: float):
    if len(run) < 3:
        return run
    keep = [False] * len(run)
    keep[0] = keep[-1] = True
    stack = [(0, len(run) - 1)]
    tol2 = tol * tol
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        ax, ay = run[lo][0], run[lo][1]
        dx, dy = run[hi][0] - ax, run[hi][1] - ay
        span = dx * dx + dy * dy
        worst, at = -1.0, -1
        for i in range(lo + 1, hi):
            px, py = run[i][0], run[i][1]
            if span == 0.0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                u = ((px - ax) * dx + (py - ay) * dy) / span
                u = 0.0 if u < 0.0 else (1.0 if u > 1.0 else u)
                d2 = (px - ax - u * dx) ** 2 + (py - ay - u * dy) ** 2
            if d2 > worst:
                worst, at = d2, i
        if worst > tol2:
            keep[at] = True
            stack.append((lo, at))
            stack.append((at, hi))
    return [p for p, k in zip(run, keep) if k]


def simplify_run(run, tol: float):
    """Orientation is canonicalised first so both sides of a shared edge run the identical floats."""
    if len(run) < 3 or tol <= 0:
        return run
    head = (run[0][0], run[0][1])
    tail = (run[-1][0], run[-1][1])
    if tail < head:
        return list(reversed(douglas_peucker(list(reversed(run)), tol)))
    return douglas_peucker(run, tol)


def simplify_ring(ring, tol: float):
    """Splits at the pinned junctions and simplifies each run, so pinned points always survive."""
    if tol <= 0 or len(ring) < 4:
        return ring
    anchors = [i for i, p in enumerate(ring) if p[2]]
    if not anchors:
        start = min(range(len(ring)), key=lambda i: (ring[i][0], ring[i][1]))
        rotated = ring[start:] + ring[:start]
        if rotated[1][:2] > rotated[-1][:2]:
            rotated = [rotated[0]] + list(reversed(rotated[1:]))
            return list(reversed(simplify_run(rotated + [rotated[0]], tol)[:-1]))
        return simplify_run(rotated + [rotated[0]], tol)[:-1]
    out = []
    for k, start in enumerate(anchors):
        stop = anchors[(k + 1) % len(anchors)]
        run = [ring[start]]
        i = start
        while i != stop:
            i = (i + 1) % len(ring)
            run.append(ring[i])
        out.extend(simplify_run(run, tol)[:-1])
    return out


def smooth_ring(seq, arr, pinned, cap, tags, cut, rounds, tol):
    plain = []
    for idx, v in enumerate(seq):
        x, y = metres(arr.pts[v])
        plain.append((x, y, v in pinned, cap.get(v, 0.0), tags[idx] if tags else 0))
    ring = plain
    for _ in range(rounds):
        ring = chaikin_round(ring, cut)
    thinned = simplify_ring(ring, tol)
    if len({(p[0], p[1]) for p in thinned}) >= 3:
        return thinned
    return ring if len({(p[0], p[1]) for p in ring}) >= 3 else plain


def to_lonlat(ring, precision: int):
    q = 10.0**precision
    out = []
    last = None
    for x, y, _pin, _cap, tag in ring:
        c = (round(x / MX * q) / q, round(y / MY * q) / q)
        if c != last:
            out.append((c, tag))
        last = c
    return out


def closed_coords(ring, precision: int):
    pts = to_lonlat(ring, precision)
    coords = [[c[0], c[1]] for c, _ in pts]
    while len(coords) > 1 and coords[0] == coords[-1]:
        coords.pop()
    if len(coords) < 3:
        return None
    coords.append(list(coords[0]))
    return coords


def shoelace(coords) -> float:
    s = 0.0
    for i in range(len(coords) - 1):
        s += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1]
    return s / 2.0


def interior_probe(ring):
    """A vertex is useless as a probe when a hole touches its shell there, so take a point inside."""
    n = len(ring) - 1
    for i in range(n):
        a, b, c = ring[i], ring[(i + 1) % n], ring[(i + 2) % n]
        mid = ((a[0] + b[0] + c[0]) / 3.0, (a[1] + b[1] + c[1]) / 3.0)
        if point_in_ring(mid, ring):
            return mid
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
        if point_in_ring(mid, ring):
            return mid
    return ring[0]


def point_in_ring(pt, ring) -> bool:
    x, y = pt
    inside = False
    for i in range(len(ring) - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        if (y0 > y) != (y1 > y):
            if x0 + (y - y0) / (y1 - y0) * (x1 - x0) > x:
                inside = not inside
    return inside


def boundary_loops(arr: Arrangement, partner):
    """Traces the directed edges no second polygon claims, which is the coverage outline.

    Source rings wind counter-clockwise, so the surveyed side is on the left of every such
    edge. Where several boundary edges meet, taking the smallest counter-clockwise turn keeps
    the walk on the same side; picking greedily instead strands edges and shatters the outline.
    """
    uses: Counter[tuple[int, int]] = Counter()
    for seq in arr.rings:
        n = len(seq)
        for i in range(n):
            uses[(seq[i], seq[(i + 1) % n])] += 1

    outgoing: dict[int, set[int]] = defaultdict(set)
    remaining: Counter[tuple[int, int]] = Counter()
    for (a, b), count in uses.items():
        if not uses[(b, a)]:
            outgoing[a].add(b)
            remaining[(a, b)] = count

    def bearing(a: int, b: int) -> float:
        ax, ay = metres(arr.pts[a])
        bx, by = metres(arr.pts[b])
        return math.atan2(by - ay, bx - ax)

    two_pi = 2.0 * math.pi
    loops: list[list[int]] = []
    broken = 0
    while remaining:
        start = min(k for k, v in remaining.items() if v > 0)
        loop = [start[0]]
        cur = start
        while True:
            remaining[cur] -= 1
            if remaining[cur] <= 0:
                del remaining[cur]
            loop.append(cur[1])
            u, v = cur
            incoming = bearing(u, v)
            best = None
            best_turn = 0.0
            for w in outgoing.get(v, ()):
                if remaining.get((v, w), 0) <= 0:
                    continue
                turn = (bearing(v, w) - incoming) % two_pi
                if best is None or turn < best_turn:
                    best, best_turn = w, turn
            if best is None:
                if loop[0] != loop[-1]:
                    broken += 1
                break
            cur = (v, best)
        while len(loop) > 1 and loop[0] == loop[-1]:
            loop.pop()
        if len(loop) >= 3:
            loops.append(loop)
    if broken:
        print(f"boundary walks that did not close  {broken}")
    return loops


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst")
    ap.add_argument("--coverage-out")
    ap.add_argument("--limit-out")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--cut", type=float, default=0.25)
    ap.add_argument("--max-offset", type=float, default=3.5)
    ap.add_argument("--size-ratio", type=float, default=0.10)
    ap.add_argument("--tol", type=float, default=0.2)
    ap.add_argument("--shore-depth", type=float, default=0.0)
    ap.add_argument("--precision", type=int, default=6)
    args = ap.parse_args()

    arr = Arrangement()
    features = []
    for line in open(args.src, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        f = json.loads(line)
        g = f.get("geometry") or {}
        coords = g.get("coordinates")
        fid = len(features)
        shape: list[list[int]] = []
        if coords:
            polys = coords if g.get("type") == "MultiPolygon" else [coords]
            for poly in polys:
                built = [arr.add_ring(r, fid, args.size_ratio, args.max_offset) for r in poly]
                shape.append([r for r in built if r is not None])
        features.append((f.get("properties") or {}, shape))

    pinned, cap, partner, adjacency = analyse(arr)

    in_verts = sum(len(r) for r in arr.rings)
    out_verts = 0
    dropped = 0
    if args.dst:
        with open(args.dst, "w", encoding="utf-8") as fh:
            for props, shape in features:
                polys = []
                for poly in shape:
                    built = []
                    for rid in poly:
                        ring = smooth_ring(
                            arr.rings[rid], arr, pinned, cap, None, args.cut, args.rounds, args.tol
                        )
                        coords = closed_coords(ring, args.precision)
                        if coords is None:
                            continue
                        built.append(coords)
                        out_verts += len(coords) - 1
                    if built:
                        polys.append(built)
                if not polys:
                    dropped += 1
                    geom = None
                elif len(polys) == 1:
                    geom = {"type": "Polygon", "coordinates": polys[0]}
                else:
                    geom = {"type": "MultiPolygon", "coordinates": polys}
                fh.write(
                    json.dumps(
                        {"type": "Feature", "properties": props, "geometry": geom},
                        separators=(",", ":"),
                    )
                )
                fh.write("\n")

    degrees = Counter(len(a) for a in adjacency.values())
    caps = sorted(cap.values())
    print(f"features            {len(features)}")
    print(f"rings               {len(arr.rings)}")
    print(f"distinct vertices   {len(arr.pts)}")
    print(f"pinned junctions    {len(pinned)} ({100 * len(pinned) / max(len(arr.pts), 1):.1f}%)")
    print(f"degree histogram    {dict(sorted(degrees.items())[:6])}")
    print(f"vertex cap m        min {caps[0]:.2f} median {caps[len(caps) // 2]:.2f} max {caps[-1]:.2f}")
    if args.dst:
        print(f"vertices in/out     {in_verts} -> {out_verts} ({out_verts / max(in_verts, 1):.2f}x)")
        print(f"features left with no geometry  {dropped}")

    if args.coverage_out or args.limit_out:
        depth = {}
        for rid, owner in enumerate(arr.ring_owner):
            depth[rid] = (features[owner][0] or {}).get("dmin")
        loops = boundary_loops(arr, partner)
        shells, holes, lines = [], [], []
        for loop in loops:
            tags = []
            for i in range(len(loop)):
                rid = partner.get((loop[i], loop[(i + 1) % len(loop)]))
                d = depth.get(rid) if rid is not None else None
                tags.append(1 if (d is not None and d <= args.shore_depth) else 0)
            ring = smooth_ring(loop, arr, pinned, cap, tags, args.cut, args.rounds, args.tol)
            coords = closed_coords(ring, args.precision)
            if coords is None:
                continue
            (shells if shoelace(coords) > 0 else holes).append(coords)
            run = []
            cur = None
            for c, tag in to_lonlat(ring, args.precision):
                if cur is None or tag == cur:
                    run.append([c[0], c[1]])
                else:
                    if len(run) > 1:
                        lines.append((cur, run))
                    run = [run[-1], [c[0], c[1]]]
                cur = tag
            if len(run) > 1:
                lines.append((cur if cur is not None else 0, run))

        shells.sort(key=lambda r: abs(shoelace(r)))
        boxes = [
            (min(p[0] for p in s), min(p[1] for p in s), max(p[0] for p in s), max(p[1] for p in s))
            for s in shells
        ]
        assembled = [[s] for s in shells]
        orphan = 0
        for hole in holes:
            probe = interior_probe(hole)
            for si, shell in enumerate(shells):
                bx = boxes[si]
                if not (bx[0] <= probe[0] <= bx[2] and bx[1] <= probe[1] <= bx[3]):
                    continue
                if point_in_ring(probe, shell):
                    assembled[si].append(hole)
                    break
            else:
                orphan += 1
        if args.coverage_out:
            with open(args.coverage_out, "w", encoding="utf-8") as fh:
                fh.write(
                    json.dumps(
                        {
                            "type": "Feature",
                            "properties": {"kind": "habitat-survey"},
                            "geometry": {"type": "MultiPolygon", "coordinates": assembled},
                        },
                        separators=(",", ":"),
                    )
                )
                fh.write("\n")
        if args.limit_out:
            counts = Counter()
            with open(args.limit_out, "w", encoding="utf-8") as fh:
                for tag, run in lines:
                    edge = "shore" if tag == 1 else "survey"
                    counts[edge] += 1
                    fh.write(
                        json.dumps(
                            {
                                "type": "Feature",
                                "properties": {"edge": edge},
                                "geometry": {"type": "LineString", "coordinates": run},
                            },
                            separators=(",", ":"),
                        )
                    )
                    fh.write("\n")
            print(f"limit lines         {dict(counts)}")
        print(f"coverage shells     {len(shells)} holes {len(holes)} unplaced holes {orphan}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
