import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '$lib/i18n/locale';
import { HABITAT_POINTS, HABITAT_POINT_SORT, habitatPointByCode } from './habitat-points.ts';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const raw: unknown = JSON.parse(
	readFileSync(new URL('../../../static/data/habitat-points.geojson', import.meta.url), 'utf8')
);

const shipped = (): readonly Readonly<Record<string, unknown>>[] => {
	if (!isRecord(raw)) throw new Error('habitat-points.geojson is not an object');
	const features = raw['features'];
	if (!Array.isArray(features)) throw new Error('habitat-points.geojson carries no feature array');
	return features.map((entry: unknown) => {
		if (!isRecord(entry)) throw new Error('a shipped record is not an object');
		const props = entry['properties'];
		if (!isRecord(props)) throw new Error('a shipped record carries no properties');
		return props;
	});
};

const RECORDS = shipped();

describe('the point catalogue against the file the map ships', () => {
	// A tap resolves a mark through its code alone. A record the table cannot name
	// would draw a glyph and then open a card with nothing on it.
	it('names every record in the shipped file', () => {
		const orphans = new Set(
			RECORDS.map((props) => props['code']).filter(
				(code) => typeof code !== 'string' || habitatPointByCode(code) === undefined
			)
		);
		expect([...orphans]).toEqual([]);
	});

	it('carries a depth in metres on every record, which is what the card prints', () => {
		const wrong = RECORDS.filter((props) => {
			const depth = props['depth'];
			return typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0 || depth > 200;
		});
		expect(wrong).toEqual([]);
	});

	it('answers nothing for a code out of the polygon catalogue', () => {
		expect(habitatPointByCode('30202')).toBeUndefined();
	});
});

describe('what one class says about itself', () => {
	// The card sets the binomials apart from the class name so a diver can take one
	// to a book. They are the same fact written twice, so they have to stay in step:
	// a renamed class with a stale species list would have the card contradict itself.
	it.each(HABITAT_POINTS)('says $code in every language, species and all', (point) => {
		expect(point.species.length).toBeGreaterThan(0);
		for (const locale of LOCALES) {
			for (const species of point.species) expect(point[locale]).toContain(species);
		}
	});

	it('places the rarest class first, so its mark survives a crowd', () => {
		const order = HABITAT_POINTS.map((point) => HABITAT_POINT_SORT[point.code]);
		expect(order).toEqual([4, 3, 2, 1]);
	});
});
