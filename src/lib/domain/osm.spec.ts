import { describe, expect, it } from 'vitest';
import { type OsmTags, parseDiveFeature } from './osm.ts';

const NODE = { type: 'node', id: 1 } as const;
const AREA = { type: 'relation', id: 2 } as const;

const kindOf = (ref: typeof NODE | typeof AREA, tags: OsmTags): string | undefined =>
	parseDiveFeature(ref, tags)?.kind;

/**
 * What a `seamark:type=restricted_area` element actually is.
 *
 * Three different things on this coast carry that one tag, and reading it alone
 * drew all three as a bathing zone. The marks strung around a zone carry the
 * zone's tags as well as their own, and a marine reserve is tagged as a swimming
 * area by mappers who had nothing better to reach for.
 */
describe('a restricted area', () => {
	it('is a buoy when it carries a buoy category', () => {
		expect(
			kindOf(NODE, {
				'seamark:type': 'restricted_area',
				'seamark:restricted_area:category': 'recreation_zone',
				'seamark:buoy_special_purpose:category': 'recreation_zone'
			})
		).toBe('buoy');
	});

	it('is a marine reserve when it carries a protection order', () => {
		expect(
			kindOf(AREA, {
				'seamark:type': 'restricted_area',
				'seamark:restricted_area:category': 'swimming',
				boundary: 'protected_area',
				leisure: 'nature_reserve'
			})
		).toBe('marine-reserve');
	});

	it('is a reserve even with no seamark tag at all', () => {
		expect(kindOf(AREA, { leisure: 'nature_reserve' })).toBe('marine-reserve');
	});

	it('is still a bathing zone when it is only a bathing zone', () => {
		expect(
			kindOf(AREA, {
				'seamark:type': 'restricted_area',
				'seamark:restricted_area:category': 'swimming'
			})
		).toBe('swimming-area');
	});
});
