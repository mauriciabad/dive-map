import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYERS, markerLayerId } from '$lib/domain/card';
import { DIVE_FEATURE_KINDS } from '$lib/domain/osm';
import { KIND_LABEL } from '$lib/ui/feature-card';
import { ICONS } from '$lib/ui/icons';
import {
	DISC_KINDS,
	KEY_KINDS,
	LABEL_ONLY_KINDS,
	MARKERS,
	MARKER_IMAGES,
	MINOR_KINDS,
	markerFrom,
	markerImageId
} from './markers';

describe('the marker table', () => {
	it('lists every kind the parser can produce, so no kind is undrawable', () => {
		expect([...DIVE_FEATURE_KINDS].sort()).toEqual(Object.keys(MARKERS).sort());
	});

	it('splits every drawn kind into exactly one of the two collision groups', () => {
		const drawn = DIVE_FEATURE_KINDS.filter((kind) => MARKERS[kind].icon !== undefined);
		expect([...KEY_KINDS, ...MINOR_KINDS].sort()).toEqual([...drawn].sort());
		expect(KEY_KINDS.filter((kind) => MINOR_KINDS.includes(kind))).toEqual([]);
	});

	it('names a real icon for every kind it draws, and none for the ones it does not', () => {
		for (const kind of DIVE_FEATURE_KINDS) {
			const { icon } = MARKERS[kind];
			if (icon === undefined) expect(LABEL_ONLY_KINDS).toContain(kind);
			else expect(ICONS[icon]).toBeDefined();
		}
	});

	it('registers one image per drawn kind plus the plate', () => {
		const ids = MARKER_IMAGES.map((image) => image.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const kind of [...KEY_KINDS, ...MINOR_KINDS]) {
			expect(ids).toContain(markerImageId(kind));
		}
		expect(ids.length).toBe(KEY_KINDS.length + MINOR_KINDS.length + 1);
	});

	it('gives every kind a switch that is on out of the box', () => {
		for (const kind of DIVE_FEATURE_KINDS) {
			expect(DEFAULT_LAYERS).toContain(markerLayerId(kind));
		}
	});

	it('can name every kind in the legend', () => {
		for (const kind of DIVE_FEATURE_KINDS) expect(KIND_LABEL[kind]).toBeDefined();
	});

	it('keeps the plate for the dive site alone, which is what makes it findable', () => {
		expect(DISC_KINDS).toEqual(['dive-site']);
	});

	it('draws the dive at the opening view and holds the furniture back', () => {
		// The opening view is the whole coast at about z7.5. What answers a question
		// from out there is where the diving is; what does not is 384 mooring piles.
		for (const kind of KEY_KINDS) expect(MARKERS[kind].from).toBe(0);
		for (const kind of MINOR_KINDS) expect(MARKERS[kind].from).toBeGreaterThanOrEqual(11);
	});

	it('states every start zoom as a whole number, which is all a filter reads', () => {
		// MapLibre evaluates a zoom expression inside a filter at integer zooms only,
		// so a kind starting at 11.5 would start at 11 or 12 and the table would be
		// lying about which.
		for (const kind of DIVE_FEATURE_KINDS) {
			expect(Number.isInteger(MARKERS[kind].from)).toBe(true);
		}
	});

	it('looks up only the kinds it was handed, so a group switched off is empty', () => {
		expect(markerFrom(['mooring', 'dive-site'])).toEqual({ mooring: 12, 'dive-site': 0 });
		expect(markerFrom([])).toEqual({});
	});
});
