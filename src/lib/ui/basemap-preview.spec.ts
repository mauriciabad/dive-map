import { describe, expect, it } from 'vitest';
import built from '../../../static/basemaps/index.json' with { type: 'json' };
import { BASE_MAPS } from '$lib/domain/basemaps';

const manifest: { readonly ids: readonly string[]; readonly zoom: number } = built;

/**
 * The previews are extracted by a build script and the catalogue is TypeScript,
 * so the two can drift. `basemap-preview.ts` catches a missing file at compile
 * time because its record is keyed by the id union; this catches the other
 * direction, a preview that was never rebuilt after the catalogue changed.
 */
describe('base map previews', () => {
	it('holds one extracted tile per base map, in catalogue order', () => {
		expect(manifest.ids).toEqual(BASE_MAPS.map((map) => map.id));
	});

	it('samples a zoom where a coast has both halves in frame', () => {
		expect(manifest.zoom).toBe(14);
	});
});
