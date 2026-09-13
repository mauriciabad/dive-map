import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DANGER_TAG_PREFIX, DIVE_NUMBER_KEYS, DIVE_TAG_KEYS, keepDiveTags } from './osm.ts';
import {
	DIVE_BBOX,
	OverpassError,
	overpassQuery,
	parseOverpassAnswer,
	toDiveCollection,
	type OverpassElement
} from './overpass.ts';

const ANSWER: unknown = JSON.parse(
	readFileSync(new URL('./fixtures/overpass.json', import.meta.url), 'utf8')
);

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('the tag whitelist', () => {
	it('covers every tag parseDiveFeature reads by name', () => {
		const source = read('./osm.ts');
		const literals = [...source.matchAll(/tags\['([^']+)'\]/g)].map((m) => m[1] ?? '');
		expect(literals.length).toBeGreaterThan(10);
		const kept: readonly string[] = DIVE_TAG_KEYS;
		expect([...new Set(literals)].filter((key) => !kept.includes(key))).toEqual([]);
	});

	it('keeps the dangers, which are one tag per danger and cannot be listed', () => {
		expect(
			keepDiveTags({
				name: 'Cova',
				[`${DANGER_TAG_PREFIX}current`]: 'yes',
				source: 'survey',
				'tiger:cfcc': 'A41'
			})
		).toEqual({ name: 'Cova', [`${DANGER_TAG_PREFIX}current`]: 'yes' });
	});
});

describe('the query', () => {
	it('asks the same bbox the build-time fetch defaults to', () => {
		const shell = read('../../../pipeline/scripts/fetch-osm.sh');
		const found = /OSM_BBOX:-([0-9.,-]+)}/.exec(shell)?.[1];
		expect(found).toBe(DIVE_BBOX.join(','));
	});

	it('names every selector inside one union with the bbox on each', () => {
		const query = overpassQuery([1, 2, 3, 4], 90);
		expect(query).toContain('[out:json][timeout:90]');
		expect(query).toContain('nwr["seamark:type"](1,2,3,4);');
		expect(query).toContain('nwr["natural"="rock"]["location"="underwater"](1,2,3,4);');
		expect(query.trimEnd().endsWith('out geom qt;')).toBe(true);
	});
});

describe('reading an answer', () => {
	it('refuses a partial answer, which Overpass returns with HTTP 200', () => {
		expect(() =>
			parseOverpassAnswer({ elements: [], remark: 'runtime error: Query timed out' })
		).toThrow(OverpassError);
	});

	it('refuses an answer with no elements array at all', () => {
		expect(() => parseOverpassAnswer({ version: 0.6 })).toThrow(OverpassError);
	});

	it('carries the replication timestamp through', () => {
		expect(parseOverpassAnswer(ANSWER).base).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});

describe('the reduction', () => {
	const elements = parseOverpassAnswer(ANSWER).elements;
	const features = toDiveCollection(elements).features;

	it('keeps only what the app can draw', () => {
		expect(features.length).toBeGreaterThan(0);
		expect(features.length).toBeLessThan(elements.length);
		expect(new Set(features.map((f) => f.properties.kind))).toEqual(
			new Set([
				'harbour',
				'mooring',
				'buoy',
				'light',
				'swimming-area',
				'wreck',
				'dive-site',
				'dive-centre',
				'ladder'
			])
		);
	});

	it('writes the properties style.ts filters on', () => {
		for (const feature of features) {
			expect(typeof feature.properties.id).toBe('number');
			expect(['node', 'way', 'relation']).toContain(feature.properties.t);
		}
	});

	it('strips the tags nothing reads', () => {
		const derived: readonly string[] = ['t', 'id', 'kind', ...DIVE_NUMBER_KEYS];
		const keys = new Set(features.flatMap((f) => Object.keys(f.properties)));
		for (const key of keys) {
			if (derived.includes(key) || key.startsWith(DANGER_TAG_PREFIX)) continue;
			expect(DIVE_TAG_KEYS as readonly string[]).toContain(key);
		}
	});

	it('parses the max depth out of a tag a mapper can put units in', () => {
		const site = (maxdepth: string): unknown =>
			toDiveCollection([
				{
					type: 'node',
					id: 1,
					lat: 41.917,
					lon: 3.208,
					tags: { 'scuba_diving:divespot': 'yes', 'scuba_diving:maxdepth': maxdepth }
				}
			]).features[0]?.properties['maxDepth'];
		expect(site('40')).toBe(40);
		expect(site('40 m')).toBe(40);
		expect(site('deep')).toBeUndefined();
	});

	it('agrees with the baked file the live answer replaces', () => {
		const baked: unknown = JSON.parse(read('../../../static/data/osm.geojson'));
		if (typeof baked !== 'object' || baked === null || !('features' in baked)) {
			throw new Error('static/data/osm.geojson is not a FeatureCollection');
		}
		const depths = (collection: readonly { properties: Record<string, unknown> }[]) =>
			collection
				.filter((f) => 'maxDepth' in f.properties)
				.map((f) => [f.properties['scuba_diving:maxdepth'], f.properties['maxDepth']]);
		const bakedDepths = depths(baked.features as { properties: Record<string, unknown> }[]);
		expect(bakedDepths.length).toBeGreaterThan(0);
		for (const [raw, parsed] of bakedDepths) {
			expect(typeof parsed).toBe('number');
			expect(parsed).toBe(Number.parseFloat(String(raw)));
		}
	});

	it('closes a multipolygon relation into rings', () => {
		const polygons = features.filter(
			(f) => f.properties.t === 'relation' && f.geometry.type === 'Polygon'
		);
		expect(polygons.length).toBeGreaterThan(0);
		for (const polygon of polygons) {
			if (polygon.geometry.type !== 'Polygon') throw new Error('narrowed above');
			for (const ring of polygon.geometry.coordinates) {
				expect(ring.length).toBeGreaterThanOrEqual(4);
				expect(ring[0]).toEqual(ring[ring.length - 1]);
			}
		}
	});

	it('draws a closed ladder as a line, because a ladder is not an area', () => {
		const ring: { lat: number; lon: number }[] = [
			{ lat: 0, lon: 0 },
			{ lat: 0, lon: 1 },
			{ lat: 1, lon: 1 },
			{ lat: 0, lon: 0 }
		];
		const element: OverpassElement = {
			type: 'way',
			id: 1,
			tags: { highway: 'ladder' },
			geometry: ring
		};
		expect(toDiveCollection([element]).features[0]?.geometry.type).toBe('LineString');
	});

	it('drops an element Overpass returned without geometry', () => {
		expect(
			toDiveCollection([{ type: 'node', id: 1, tags: { 'seamark:type': 'mooring' } }]).features
		).toEqual([]);
	});
});
