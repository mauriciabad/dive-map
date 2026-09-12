#!/usr/bin/env python3
"""Rounds the 10 m raster staircase off the ICGC habitat and substrate polygons.

The polygons tile a continuous surface, so smoothing them one at a time would tear
every shared boundary. This builds the shared-edge topology first: rings are cut into
arcs wherever the neighbouring ring changes, each arc is stored once, smoothed once,
and handed back to both of its users. Neighbours therefore receive the identical point
sequence and no gap or overlap can exist by construction.

Reads and writes line-delimited GeoJSON in EPSG:4326, preserving feature order and
properties so the output can be diffed against the input feature by feature.
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


def to_metres(pt: tuple[int, int]) -> tuple[float, float]:
    return (pt[0] / GRID * MX, pt[1] / GRID * MY)


def ring_metrics(ring_m: list[tuple[float, float]]) -> tuple[float, float]:
    n = len(ring_m)
    twice_area = 0.0
    perimeter = 0.0
    for i in range(n):
        x0, y0 = ring_m[i]
        x1, y1 = ring_m[(i + 1) % n]
        twice_area += x0 * y1 - x1 * y0
        perimeter += math.hypot(x1 - x0, y1 - y0)
    return twice_area / 2.0, perimeter


def chaikin(pts: list[tuple[float, float]], closed: bool, cut: float, cap: float, rounds: int):
    for _ in range(rounds):
        n = len(pts)
        if n < 3:
            return pts
        out = []
        if not closed:
            out.append(pts[0])
        limit = n if closed else n - 1
        for i in range(limit):
            ax, ay = pts[i]
            bx, by = pts[(i + 1) % n]
            dx, dy = bx - ax, by - ay
            d = math.hypot(dx, dy)
            if d == 0.0:
                continue
            t = cut if cut * d <= cap else cap / d
            out.append((ax + t * dx, ay + t * dy))
            out.append((bx - t * dx, by - t * dy))
        if not closed:
            out.append(pts[-1])
        pts = out
    return pts


def simplify(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    if len(pts) < 3 or tol <= 0:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    tol2 = tol * tol
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        ax, ay = pts[lo]
        bx, by = pts[hi]
        dx, dy = bx - ax, by - ay
        span = dx * dx + dy * dy
        worst = -1.0
        at = -1
        for i in range(lo + 1, hi):
            px, py = pts[i]
            if span == 0.0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / span
                t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
                d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d2 > worst:
                worst, at = d2, i
        if worst > tol2:
            keep[at] = True
            stack.append((lo, at))
            stack.append((at, hi))
    return [p for p, k in zip(pts, keep) if k]


class Topology:
    """Rings as sequences of shared arcs. The arc table is the whole design."""

    def __init__(self) -> None:
        self.pt_id: dict[tuple[int, int], int] = {}
        self.pts: list[tuple[int, int]] = []
        self.rings: list[list[int]] = []
        self.ring_owner: list[int] = []
        self.ring_size: list[float] = []
        self.ring_area: list[float] = []

    def point(self, lon: float, lat: float) -> int:
        key = (int(round(lon * GRID)), int(round(lat * GRID)))
        got = self.pt_id.get(key)
        if got is None:
            got = len(self.pts)
            self.pt_id[key] = got
            self.pts.append(key)
        return got

    def add_ring(self, coords, owner: int) -> int | None:
        seq: list[int] = []
        for lon, lat in coords:
            i = self.point(lon, lat)
            if not seq or seq[-1] != i:
                seq.append(i)
        while len(seq) > 1 and seq[0] == seq[-1]:
            seq.pop()
        if len(seq) < 3:
            return None
        rid = len(self.rings)
        self.rings.append(seq)
        self.ring_owner.append(owner)
        ring_m = [to_metres(self.pts[i]) for i in seq]
        area, perim = ring_metrics(ring_m)
        self.ring_area.append(area)
        self.ring_size.append(4.0 * abs(area) / perim if perim > 0 else 0.0)
        return rid


def build_arcs(topo: Topology, size_ratio: float, max_offset: float):
    """Cuts every ring at the vertices where its neighbour changes or the arrangement branches."""
    partner: dict[tuple[int, int], int] = {}
    degree: dict[int, set[int]] = defaultdict(set)
    for rid, seq in enumerate(topo.rings):
        n = len(seq)
        for i in range(n):
            a, b = seq[i], seq[(i + 1) % n]
            partner.setdefault((a, b), rid)
            degree[a].add(b)
            degree[b].add(a)

    def neighbour(a: int, b: int) -> int:
        return partner.get((b, a), -1)

    nodes: set[int] = {v for v, adj in degree.items() if len(adj) != 2}
    for seq in topo.rings:
        n = len(seq)
        prev = neighbour(seq[-1], seq[0])
        for i in range(n):
            cur = neighbour(seq[i], seq[(i + 1) % n])
            if cur != prev:
                nodes.add(seq[i])
            prev = cur

    arc_id: dict[tuple[int, ...], int] = {}
    arc_pts: list[list[int]] = []
    arc_cap: list[float] = []
    arc_open: list[bool] = []
    arc_boundary: list[bool] = []
    arc_rings: list[int] = []
    ring_arcs: list[list[tuple[int, bool]]] = []

    def intern(chain: list[int], is_open: bool, rid: int) -> tuple[int, bool]:
        key = tuple(chain)
        rev = tuple(reversed(chain))
        flipped = rev < key
        canon = rev if flipped else key
        got = arc_id.get(canon)
        if got is None:
            got = len(arc_pts)
            arc_id[canon] = got
            arc_pts.append(list(canon))
            arc_cap.append(math.inf)
            arc_open.append(is_open)
            arc_boundary.append(neighbour(chain[0], chain[1]) == -1)
            arc_rings.append(rid)
        size = topo.ring_size[rid]
        cap = min(max_offset, size_ratio * size) if size > 0 else 0.0
        if cap < arc_cap[got]:
            arc_cap[got] = cap
        return got, flipped

    for rid, seq in enumerate(topo.rings):
        n = len(seq)
        cuts = [i for i in range(n) if seq[i] in nodes]
        used: list[tuple[int, bool]] = []
        if not cuts:
            used.append(intern(seq + [seq[0]], False, rid))
        else:
            for k in range(len(cuts)):
                start = cuts[k]
                stop = cuts[(k + 1) % len(cuts)]
                chain = [seq[start]]
                i = start
                while True:
                    i = (i + 1) % n
                    chain.append(seq[i])
                    if i == stop:
                        break
                used.append(intern(chain, True, rid))
        ring_arcs.append(used)

    return arc_pts, arc_cap, arc_open, arc_boundary, arc_rings, ring_arcs


def max_deviation(original: list[tuple[float, float]], curve: list[tuple[float, float]]) -> float:
    worst = 0.0
    for px, py in curve:
        best = math.inf
        for i in range(len(original) - 1):
            ax, ay = original[i]
            bx, by = original[i + 1]
            dx, dy = bx - ax, by - ay
            span = dx * dx + dy * dy
            if span == 0.0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / span
                t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
                d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d2 < best:
                best = d2
        if best > worst:
            worst = best
    return math.sqrt(worst)


def smooth_arcs(topo, arc_pts, arc_cap, arc_open, cut, rounds, tol, sample_every):
    out = []
    deviations = []
    for idx, chain in enumerate(arc_pts):
        pts = [to_metres(topo.pts[i]) for i in chain]
        closed = not arc_open[idx]
        if closed:
            pts = pts[:-1]
        cap = arc_cap[idx]
        if cap <= 0.0 or len(pts) < 3:
            smoothed = pts
        else:
            smoothed = chaikin(pts, closed, cut, cap, rounds)
            if closed:
                smoothed = simplify(smoothed + [smoothed[0]], tol)[:-1]
            else:
                smoothed = simplify(smoothed, tol)
        if closed:
            smoothed = smoothed + [smoothed[0]]
            pts = pts + [pts[0]]
        if idx % sample_every == 0 and len(pts) > 1 and len(smoothed) > 1:
            deviations.append(max_deviation(pts, smoothed))
        out.append([(x / MX * GRID, y / MY * GRID) for x, y in smoothed])
    return out, deviations


BREAKS = Counter()


def ring_coords(arcs_used, smoothed, precision):
    pts: list[tuple[float, float]] = []
    for aid, flipped in arcs_used:
        seg = smoothed[aid]
        if flipped:
            seg = list(reversed(seg))
        if pts:
            if pts[-1] == seg[0]:
                pts.extend(seg[1:])
            else:
                BREAKS["arc join"] += 1
                pts.extend(seg)
        else:
            pts.extend(seg)
    if not pts or pts[0] != pts[-1]:
        pts.append(pts[0])
    q = 10.0**precision
    ring = []
    last = None
    for x, y in pts:
        c = [round(x / GRID * q) / q, round(y / GRID * q) / q]
        if c != last:
            ring.append(c)
        last = c
    while len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    if len(ring) < 3:
        return None
    ring.append(ring[0])
    return ring


def chain_boundary(arc_pts, arc_boundary, arc_open, smoothed, arc_rings, depth_of, precision):
    """The dissolved coverage is exactly the arcs no second ring claims."""
    starts: dict[int, list[int]] = defaultdict(list)
    for aid, is_bnd in enumerate(arc_boundary):
        if not is_bnd:
            continue
        if arc_open[aid]:
            starts[arc_pts[aid][0]].append(aid)
    unused = {aid for aid, b in enumerate(arc_boundary) if b and arc_open[aid]}
    loops: list[list[int]] = []
    loop_arcs: list[list[int]] = []
    while unused:
        seed = min(unused)
        chain = [seed]
        unused.discard(seed)
        cursor = arc_pts[seed][-1]
        while True:
            nxt = None
            for cand in starts.get(cursor, ()):
                if cand in unused:
                    nxt = cand
                    break
            if nxt is None:
                break
            chain.append(nxt)
            unused.discard(nxt)
            cursor = arc_pts[nxt][-1]
            if cursor == arc_pts[seed][0]:
                break
        loops.append(chain)
        loop_arcs.append(chain)
    for aid, b in enumerate(arc_boundary):
        if b and not arc_open[aid]:
            loops.append([aid])
            loop_arcs.append([aid])

    rings = []
    for chain in loops:
        ring = ring_coords([(aid, False) for aid in chain], smoothed, precision)
        if ring is not None:
            rings.append((ring, chain))
    return rings


def shoelace(ring) -> float:
    s = 0.0
    for i in range(len(ring) - 1):
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return s / 2.0


def point_in_ring(pt, ring) -> bool:
    x, y = pt
    inside = False
    for i in range(len(ring) - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) / (y1 - y0) * (x1 - x0)
            if xi > x:
                inside = not inside
    return inside


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    ap.add_argument("--coverage-out")
    ap.add_argument("--limit-out")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--cut", type=float, default=0.25)
    ap.add_argument("--max-offset", type=float, default=2.0)
    ap.add_argument("--size-ratio", type=float, default=0.10)
    ap.add_argument("--simplify", type=float, default=0.2)
    ap.add_argument("--shore-depth", type=float, default=0.0)
    ap.add_argument("--precision", type=int, default=6)
    ap.add_argument("--sample-every", type=int, default=37)
    args = ap.parse_args()

    topo = Topology()
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
                built = [topo.add_ring(r, fid) for r in poly]
                shape.append([r for r in built if r is not None])
        features.append((f.get("properties") or {}, shape))

    arc_pts, arc_cap, arc_open, arc_bnd, arc_rings, ring_arcs = build_arcs(
        topo, args.size_ratio, args.max_offset
    )
    smoothed, deviations = smooth_arcs(
        topo, arc_pts, arc_cap, arc_open, args.cut, args.rounds, args.simplify, args.sample_every
    )

    in_verts = sum(len(r) for r in topo.rings)
    out_verts = 0
    dropped = 0
    with open(args.dst, "w", encoding="utf-8") as fh:
        for props, shape in features:
            polys = []
            for poly in shape:
                built = []
                for rid in poly:
                    ring = ring_coords(ring_arcs[rid], smoothed, args.precision)
                    if ring is None:
                        continue
                    built.append(ring)
                    out_verts += len(ring) - 1
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

    caps = sorted(c for c in arc_cap if c != math.inf)
    deviations.sort()
    print(f"features            {len(features)}")
    print(f"rings               {len(topo.rings)}")
    print(f"distinct vertices   {len(topo.pts)}")
    print(f"arcs                {len(arc_pts)}  boundary {sum(arc_bnd)}")
    print(f"vertices in/out     {in_verts} -> {out_verts}  ({out_verts / max(in_verts,1):.2f}x)")
    print(f"cut cap m           min {caps[0]:.2f} median {caps[len(caps)//2]:.2f} max {caps[-1]:.2f}")
    print(
        f"arc deviation m     median {deviations[len(deviations)//2]:.2f} "
        f"p99 {deviations[int(len(deviations)*0.99)]:.2f} max {deviations[-1]:.2f} "
        f"(sampled {len(deviations)} arcs)"
    )
    print(f"features with no output geometry  {dropped}")
    print(f"arc joins that did not meet       {BREAKS['arc join']}")

    if args.coverage_out or args.limit_out:
        depth_of = {}
        for fid, (props, shape) in enumerate(features):
            depth_of[fid] = props.get("dmin")
        rings = chain_boundary(
            arc_pts, arc_bnd, arc_open, smoothed, arc_rings, depth_of, args.precision
        )
        shells = [(r, c) for r, c in rings if shoelace(r) > 0]
        holes = [(r, c) for r, c in rings if shoelace(r) <= 0]
        shells.sort(key=lambda rc: -abs(shoelace(rc[0])))
        assigned: list[list] = [[r] for r, _ in shells]
        for hole, _ in holes:
            probe = hole[0]
            for si, (shell, _) in enumerate(shells):
                if point_in_ring(probe, shell):
                    assigned[si].append(hole)
                    break
        if args.coverage_out:
            with open(args.coverage_out, "w", encoding="utf-8") as fh:
                fh.write(
                    json.dumps(
                        {
                            "type": "Feature",
                            "properties": {"kind": "habitat-survey"},
                            "geometry": {"type": "MultiPolygon", "coordinates": assigned},
                        },
                        separators=(",", ":"),
                    )
                )
                fh.write("\n")
        if args.limit_out:
            kinds = Counter()
            with open(args.limit_out, "w", encoding="utf-8") as fh:
                for _, chain in rings:
                    for aid in chain:
                        seg = [
                            [round(x / GRID, args.precision), round(y / GRID, args.precision)]
                            for x, y in smoothed[aid]
                        ]
                        if len(seg) < 2:
                            continue
                        d = depth_of.get(arc_rings_owner(topo, arc_rings, aid))
                        edge = "shore" if d is not None and d <= args.shore_depth else "survey"
                        kinds[edge] += 1
                        fh.write(
                            json.dumps(
                                {
                                    "type": "Feature",
                                    "properties": {
                                        "edge": edge,
                                        "depth": d if d is not None else -1,
                                    },
                                    "geometry": {"type": "LineString", "coordinates": seg},
                                },
                                separators=(",", ":"),
                            )
                        )
                        fh.write("\n")
            print(f"coverage shells     {len(shells)}  holes {len(holes)}")
            print(f"limit arcs          {dict(kinds)}")
    return 0


def arc_rings_owner(topo: Topology, arc_rings, aid: int) -> int:
    return topo.ring_owner[arc_rings[aid]]


if __name__ == "__main__":
    sys.exit(main())
