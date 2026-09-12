import { describe, expect, it } from 'vitest';
import {
	type Annotation,
	KINDS,
	fingerprint,
	parseAnnotation,
	parseCollection,
	toCollection,
	toFeature
} from './annotation.ts';

const feature = (over: Record<string, unknown> = {}): unknown => ({
	type: 'Feature',
	id: 'one',
	properties: { kind: 'hazard', label: 'Xarxa' },
	geometry: { type: 'Point', coordinates: [3.2, 41.9] },
	...over
});

describe('parseAnnotation', () => {
	it('reads a well-formed feature', () => {
		expect(parseAnnotation(feature())).toEqual({
			id: 'one',
			kind: 'hazard',
			label: 'Xarxa',
			geometry: { type: 'Point', coordinates: [3.2, 41.9] }
		});
	});

	it('falls back to `feature` for a kind it does not know', () => {
		expect(parseAnnotation(feature({ properties: { kind: 'sea-monster' } }))?.kind).toBe('feature');
	});

	it('trims a label and treats blank as absent', () => {
		expect(parseAnnotation(feature({ properties: { label: '  Cova  ' } }))?.label).toBe('Cova');
		expect(parseAnnotation(feature({ properties: { label: '   ' } }))?.label).toBeUndefined();
	});

	it('takes the id from properties when the feature has none at the top level', () => {
		const withoutId = { ...(feature() as Record<string, unknown>), id: undefined };
		expect(parseAnnotation({ ...withoutId, properties: { id: 'from-props' } })?.id).toBe('from-props');
	});

	it('drops altitude so two writings of one point compare equal', () => {
		const flat = parseAnnotation(feature({ geometry: { type: 'Point', coordinates: [3.2, 41.9] } }));
		const deep = parseAnnotation(feature({ geometry: { type: 'Point', coordinates: [3.2, 41.9, -12] } }));
		expect(deep?.geometry.coordinates).toEqual([3.2, 41.9]);
		expect(flat).toEqual(deep);
	});

	it('refuses anything that is not a usable annotation', () => {
		expect(parseAnnotation(null)).toBeUndefined();
		expect(parseAnnotation({ type: 'NotAFeature' })).toBeUndefined();
		expect(parseAnnotation(feature({ id: undefined, properties: {} }))).toBeUndefined();
		expect(parseAnnotation(feature({ geometry: { type: 'Point', coordinates: ['x', 1] } }))).toBeUndefined();
		expect(parseAnnotation(feature({ geometry: { type: 'LineString', coordinates: [[3, 41]] } }))).toBeUndefined();
		expect(parseAnnotation(feature({ geometry: { type: 'MultiPolygon', coordinates: [] } }))).toBeUndefined();
	});

	it('rejects a polygon ring that cannot close', () => {
		const ring = [[3, 41], [3.1, 41], [3, 41]];
		expect(parseAnnotation(feature({ geometry: { type: 'Polygon', coordinates: [ring] } }))).toBeUndefined();
	});
});

describe('parseCollection', () => {
	it('keeps what parses, drops what does not, and ignores a repeated id', () => {
		const parsed = parseCollection({
			type: 'FeatureCollection',
			features: [feature(), feature({ properties: { kind: 'route' } }), { type: 'Feature' }, 'rubbish']
		});
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.kind).toBe('hazard');
	});

	it('returns nothing for a collection that is not one', () => {
		expect(parseCollection(undefined)).toEqual([]);
		expect(parseCollection({ type: 'FeatureCollection' })).toEqual([]);
	});
});

describe('toFeature', () => {
	const point: Annotation = {
		id: 'x',
		kind: 'route',
		label: undefined,
		geometry: { type: 'Point', coordinates: [3, 41] }
	};

	it('always writes the id, the kind and the kind colour', () => {
		expect(toFeature(point).properties).toEqual({ id: 'x', kind: 'route', colour: KINDS.route.colour });
	});

	it('omits label entirely rather than writing an empty one', () => {
		expect('label' in toFeature(point).properties).toBe(false);
		expect(toFeature({ ...point, label: 'Sortida' }).properties['label']).toBe('Sortida');
	});
});

describe('toCollection', () => {
	const made: readonly Annotation[] = [
		{ id: 'b', kind: 'hazard', label: undefined, geometry: { type: 'Point', coordinates: [3, 41] } },
		{ id: 'a', kind: 'entry', label: 'Boia', geometry: { type: 'Point', coordinates: [4, 42] } }
	];

	it('orders by kind so the committed file has a stable diff', () => {
		expect(toCollection(made).features.map((f) => f.id)).toEqual(['a', 'b']);
	});

	it('round-trips through the parser', () => {
		expect(parseCollection(toCollection(made))).toHaveLength(2);
		expect(parseCollection(toCollection(made)).map((a) => a.id).sort()).toEqual(['a', 'b']);
	});
});

describe('fingerprint', () => {
	const base: Annotation = {
		id: 'x',
		kind: 'route',
		label: 'A',
		geometry: { type: 'Point', coordinates: [3, 41] }
	};

	it('ignores the id and notices everything else', () => {
		expect(fingerprint({ ...base, id: 'other' })).toBe(fingerprint(base));
		expect(fingerprint({ ...base, label: 'B' })).not.toBe(fingerprint(base));
		expect(fingerprint({ ...base, kind: 'hazard' })).not.toBe(fingerprint(base));
		expect(fingerprint({ ...base, geometry: { type: 'Point', coordinates: [3.5, 41] } })).not.toBe(
			fingerprint(base)
		);
	});
});
