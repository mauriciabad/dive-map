import {
	diveNumbers,
	keepDiveTags,
	parseDiveFeature,
	type OsmElementType,
	type OsmTags
} from './osm.ts';

/**
 * The browser's own copy of the build-time OSM reduction.
 *
 * `pipeline/scripts/fetch-osm.sh` and `osm_to_geojson.py` do exactly this once, at
 * build time, and ship the answer as `static/data/osm.geojson`. That file is the
 * offline floor and it goes stale the moment anybody edits a buoy. This module is
 * the same query and the same reduction, run in the browser, so the ten kinds the
 * map draws are whatever OSM says today.
 *
 * The two paths have to agree on the property names, because `style.ts` filters on
 * them and the feature card reads them back through `parseDiveFeature`. So the
 * output here is the same shape: `t`, `id`, `kind`, then the tags on
 * `DIVE_TAG_KEYS`.
 */

/** Longitude then latitude, the order GeoJSON uses. */
export type Position = [number, number];

export type DiveGeometry =
	| { type: 'Point'; coordinates: Position }
	| { type: 'LineString'; coordinates: Position[] }
	| { type: 'MultiLineString'; coordinates: Position[][] }
	| { type: 'Polygon'; coordinates: Position[][] }
	| { type: 'MultiPolygon'; coordinates: Position[][][] };

export interface DiveProperties extends Record<string, string | number> {
	t: OsmElementType;
	id: number;
	kind: string;
}

export interface DiveGeoFeature {
	type: 'Feature';
	geometry: DiveGeometry;
	properties: DiveProperties;
}

export interface DiveCollection {
	type: 'FeatureCollection';
	features: DiveGeoFeature[];
}

/** South, west, north, east. Kept level with `OSM_BBOX` in `pipeline/scripts/fetch-osm.sh`, which `overpass.spec.ts` checks. */
export const DIVE_BBOX: readonly [number, number, number, number] = [40.5, 0.15, 42.5, 3.35];

/**
 * Only terms that can yield a feature from `parseDiveFeature` earn a query, which
 * is the same rule `fetch-osm.sh` states at greater length. The build splits these
 * across three requests because a 600 second Overpass timeout over all of Catalonia
 * needs the room; one combined request answers this bbox in about twenty seconds,
 * and one request is the polite number to send from a phone.
 */
const SELECTORS: readonly string[] = [
	'["sport"="scuba_diving"]',
	'["scuba_diving:divespot"]',
	'["amenity"="dive_centre"]',
	'["shop"="scuba_diving"]',
	'["seamark:type"]',
	'["natural"="rock"]["location"="underwater"]',
	'["waterway"="slipway"]',
	'["highway"="ladder"]'
];

export function overpassQuery(
	bbox: readonly [number, number, number, number],
	timeoutSeconds: number
): string {
	const area = bbox.join(',');
	const body = SELECTORS.map((selector) => `nwr${selector}(${area});`).join('\n');
	return `[out:json][timeout:${timeoutSeconds}];\n(\n${body}\n);\nout geom qt;`;
}

interface OverpassPoint {
	readonly lat?: unknown;
	readonly lon?: unknown;
}

interface OverpassMember {
	readonly type?: unknown;
	readonly role?: unknown;
	readonly geometry?: unknown;
}

export interface OverpassElement {
	readonly type?: unknown;
	readonly id?: unknown;
	readonly lat?: unknown;
	readonly lon?: unknown;
	readonly tags?: unknown;
	readonly geometry?: unknown;
	readonly members?: unknown;
}

export interface OverpassAnswer {
	readonly elements: readonly OverpassElement[];
	/** The replication timestamp of the database that answered, or the empty string. */
	readonly base: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const stringTags = (value: unknown): OsmTags => {
	if (!isRecord(value)) return {};
	const tags: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw === 'string') tags[key] = raw;
	}
	return tags;
};

/**
 * Overpass answers a query it could not finish with HTTP 200 and a `remark`, so the
 * status code alone cannot tell a complete answer from half of one. Half an answer
 * must never reach the cache: it would replace a good copy with a thinner one and
 * the markers would quietly disappear.
 */
export class OverpassError extends Error {}

export function parseOverpassAnswer(raw: unknown): OverpassAnswer {
	if (!isRecord(raw)) throw new OverpassError('Overpass answer is not an object');
	const remark = typeof raw['remark'] === 'string' ? raw['remark'].toLowerCase() : '';
	if (['error', 'timed out', 'memory'].some((word) => remark.includes(word))) {
		throw new OverpassError(`Overpass remarked: ${remark.slice(0, 120)}`);
	}
	const elements = raw['elements'];
	if (!Array.isArray(elements)) throw new OverpassError('Overpass answer carries no elements');
	const osm3s = raw['osm3s'];
	const base = isRecord(osm3s) ? osm3s['timestamp_osm_base'] : undefined;
	return {
		elements: elements.filter(isRecord),
		base: typeof base === 'string' ? base : ''
	};
}

const PRECISION = 1e6;

const round = (n: number): number => Math.round(n * PRECISION) / PRECISION;

const positions = (raw: unknown): Position[] => {
	const out: Position[] = [];
	for (const point of asArray(raw)) {
		if (!isRecord(point)) continue;
		const { lat, lon } = point as OverpassPoint;
		if (typeof lat === 'number' && typeof lon === 'number') out.push([round(lon), round(lat)]);
	}
	return out;
};

const same = (a: Position, b: Position): boolean => a[0] === b[0] && a[1] === b[1];

/** A slipway or a ladder drawn as a closed loop is still a line, not an area. */
const isLinear = (tags: OsmTags): boolean =>
	tags['waterway'] === 'slipway' || tags['highway'] === 'ladder';

const pointInRing = (point: Position, ring: readonly Position[]): boolean => {
	const [x, y] = point;
	let inside = false;
	for (let current = 0, previous = ring.length - 1; current < ring.length; current++) {
		const a = ring[current];
		const b = ring[previous];
		previous = current;
		if (a === undefined || b === undefined) continue;
		const [xi, yi] = a;
		const [xj, yj] = b;
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
};

/**
 * A multipolygon's outer ring is usually split across several member ways, which
 * Overpass returns in arbitrary order and arbitrary winding. So a ring is only
 * recoverable by matching each fragment's endpoints against the running chain and
 * reversing the fragment when it joined on its own last coordinate. This is the
 * same walk `osm_to_geojson.py` does.
 */
const stitchRings = (fragments: readonly Position[][]): Position[][] => {
	const remaining = fragments.filter((f) => f.length >= 2);
	const rings: Position[][] = [];
	while (remaining.length > 0) {
		let chain = remaining.shift() ?? [];
		for (;;) {
			const head = chain[0];
			const tail = chain[chain.length - 1];
			if (head === undefined || tail === undefined || same(head, tail)) break;
			const index = remaining.findIndex((f) => {
				const first = f[0];
				const last = f[f.length - 1];
				return (
					(first !== undefined && same(first, tail)) || (last !== undefined && same(last, tail))
				);
			});
			const fragment = index === -1 ? undefined : remaining.splice(index, 1)[0];
			if (fragment === undefined) break;
			const first = fragment[0];
			chain =
				first !== undefined && same(first, tail)
					? [...chain, ...fragment.slice(1)]
					: [...chain, ...fragment.slice(0, -1).reverse()];
		}
		const head = chain[0];
		const tail = chain[chain.length - 1];
		if (head !== undefined && tail !== undefined && same(head, tail) && chain.length >= 4) {
			rings.push(chain);
		}
	}
	return rings;
};

const assignHoles = (outers: Position[][], inners: Position[][]): Position[][][] => {
	const polygons = outers.map((outer) => [outer]);
	for (const hole of inners) {
		const start = hole[0];
		if (start === undefined) continue;
		const owner = polygons.find((polygon) => {
			const outer = polygon[0];
			return outer !== undefined && pointInRing(start, outer);
		});
		owner?.push(hole);
	}
	return polygons;
};

const memberFragments = (members: readonly unknown[], role: string): Position[][] =>
	members
		.filter(isRecord)
		.filter((m) => (m as OverpassMember).type === 'way' && (m as OverpassMember).role === role)
		.map((m) => positions((m as OverpassMember).geometry))
		.filter((line) => line.length >= 2);

const nodeGeometry = (element: OverpassElement): DiveGeometry | undefined => {
	const { lat, lon } = element;
	if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;
	return { type: 'Point', coordinates: [round(lon), round(lat)] };
};

const wayGeometry = (element: OverpassElement, tags: OsmTags): DiveGeometry | undefined => {
	const line = positions(element.geometry);
	if (line.length < 2) return undefined;
	const head = line[0];
	const tail = line[line.length - 1];
	const closed = head !== undefined && tail !== undefined && same(head, tail) && line.length > 3;
	if (closed && !isLinear(tags)) return { type: 'Polygon', coordinates: [line] };
	return { type: 'LineString', coordinates: line };
};

const relationGeometry = (element: OverpassElement, tags: OsmTags): DiveGeometry | undefined => {
	const members = asArray(element.members);
	if (tags['type'] === 'multipolygon') {
		const outers = stitchRings(memberFragments(members, 'outer'));
		if (outers.length === 0) return undefined;
		const polygons = assignHoles(outers, stitchRings(memberFragments(members, 'inner')));
		const only = polygons[0];
		if (polygons.length === 1 && only !== undefined) return { type: 'Polygon', coordinates: only };
		return { type: 'MultiPolygon', coordinates: polygons };
	}
	const lines = members
		.filter(isRecord)
		.filter((m) => (m as OverpassMember).type === 'way')
		.map((m) => positions((m as OverpassMember).geometry))
		.filter((line) => line.length >= 2);
	if (lines.length === 0) return undefined;
	return { type: 'MultiLineString', coordinates: lines };
};

const ELEMENT_TYPES: ReadonlySet<string> = new Set<OsmElementType>(['node', 'way', 'relation']);

const geometryOf = (
	type: OsmElementType,
	element: OverpassElement,
	tags: OsmTags
): DiveGeometry | undefined => {
	switch (type) {
		case 'node':
			return nodeGeometry(element);
		case 'way':
			return wayGeometry(element, tags);
		case 'relation':
			return relationGeometry(element, tags);
	}
};

/**
 * Overpass elements to the collection the `osm` source takes. Elements the parser
 * has no use for, and elements Overpass returned without usable geometry, are
 * dropped here rather than shipped for the style to filter out.
 */
export function toDiveCollection(elements: readonly OverpassElement[]): DiveCollection {
	const features: DiveGeoFeature[] = [];
	for (const element of elements) {
		const { type, id } = element;
		if (typeof type !== 'string' || !ELEMENT_TYPES.has(type) || typeof id !== 'number') continue;
		const elementType = type as OsmElementType;
		const tags = stringTags(element.tags);
		const parsed = parseDiveFeature({ type: elementType, id }, tags);
		if (parsed === undefined) continue;
		const geometry = geometryOf(elementType, element, tags);
		if (geometry === undefined) continue;
		features.push({
			type: 'Feature',
			geometry,
			properties: {
				t: elementType,
				id,
				kind: parsed.kind,
				...keepDiveTags(tags),
				...diveNumbers(parsed)
			}
		});
	}
	features.sort((a, b) =>
		a.properties.t === b.properties.t
			? a.properties.id - b.properties.id
			: a.properties.t < b.properties.t
				? -1
				: 1
	);
	return { type: 'FeatureCollection', features };
}
