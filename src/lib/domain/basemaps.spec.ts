import { describe, expect, it } from 'vitest';
import {
	BASE_MAPS,
	BASE_MAP_KINDS,
	DEFAULT_BASE_MAP,
	NO_BASE_MAP,
	TILE_SERVICES,
	isBaseMapId,
	serviceDraws,
	servicesOf
} from './basemaps.ts';

describe('the base map catalogue', () => {
	it('offers the nine the owner asked for, plus none', () => {
		expect(BASE_MAPS).toHaveLength(9);
		expect(DEFAULT_BASE_MAP).toBe(NO_BASE_MAP);
	});

	it('stars one map in each kind', () => {
		for (const kind of BASE_MAP_KINDS) {
			const starred = BASE_MAPS.filter((map) => map.kind === kind && map.recommended);
			expect(starred.map((map) => map.id)).toHaveLength(1);
		}
	});

	it('puts the coarse photograph under the fine one', () => {
		expect(servicesOf('satellite-costa').map((s) => s.id)).toEqual([
			'satellite',
			'satellite-icgc-bathymetry'
		]);
	});

	it('is the only base map that stacks', () => {
		const stacked = BASE_MAPS.filter((map) => map.services.length > 1);
		expect(stacked.map((map) => map.id)).toEqual(['satellite-costa']);
	});

	/*
	 * Costa and IGN are the same PNOA. Declared twice it would be two sources, two
	 * sets of tiles and two credits for one photograph.
	 */
	it('declares a shared service once', () => {
		const ids = TILE_SERVICES.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toContain('satellite');
		expect(servicesOf('satellite-ign').map((s) => s.id)).toEqual(['satellite']);
	});

	it('carries a credit for every service', () => {
		for (const service of TILE_SERVICES) {
			expect(service.attribution.length).toBeGreaterThan(0);
			expect(service.tiles).toMatch(/^https:\/\//);
		}
	});

	/*
	 * MapLibre has no `{s}`, so a Leaflet template copied across would ask a host
	 * called `{s}.tile.openstreetmap.org` for every tile.
	 */
	it('asks for tiles in a shape MapLibre can fill in', () => {
		for (const service of TILE_SERVICES) {
			expect(service.tiles).not.toContain('{s}');
			const filled =
				service.tiles.includes('{bbox-epsg-3857}') ||
				(service.tiles.includes('{z}') &&
					service.tiles.includes('{x}') &&
					service.tiles.includes('{y}'));
			expect(filled, service.id).toBe(true);
		}
	});

	it('draws nothing at all for none', () => {
		expect(servicesOf(NO_BASE_MAP)).toEqual([]);
		expect(serviceDraws(NO_BASE_MAP, 'satellite')).toBe(false);
	});

	it('knows which service draws under a choice', () => {
		expect(serviceDraws('satellite-costa', 'satellite-icgc-bathymetry')).toBe(true);
		expect(serviceDraws('satellite-costa', 'satellite-icgc-territorial')).toBe(false);
		expect(serviceDraws('classic-ign', 'classic-ign')).toBe(true);
	});

	it('refuses an id it does not have', () => {
		expect(isBaseMapId('none')).toBe(true);
		expect(isBaseMapId('satellite-costa')).toBe(true);
		expect(isBaseMapId('satellite')).toBe(false);
		expect(isBaseMapId('bg-satelite-esri')).toBe(false);
		expect(isBaseMapId(undefined)).toBe(false);
		expect(isBaseMapId(3)).toBe(false);
	});
});
