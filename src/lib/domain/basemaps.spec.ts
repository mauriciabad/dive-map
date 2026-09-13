import { describe, expect, it } from 'vitest';
import {
	BASE_MAPS,
	BASE_MAP_KINDS,
	DEFAULT_BASE_MAP,
	NO_BASE_MAP,
	TILE_SERVICES,
	DEFAULT_QUICK_PAIR,
	type BaseMapId,
	type QuickPair,
	isBaseMapId,
	isQuickPair,
	quickNext,
	serviceDraws,
	servicesOf,
	withQuickChoice
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

describe('the pair the quick toggle flicks between', () => {
	/**
	 * The push is two deep and that is the whole rule. Every one of the 45 pairs
	 * of ten is reachable, no choice can put the same map in both slots, and no
	 * choice can empty one, so the button always has somewhere to go.
	 */
	it('reaches every pair of the ten in two choices', () => {
		const ids: readonly BaseMapId[] = [NO_BASE_MAP, ...BASE_MAPS.map((map) => map.id)];
		for (const first of ids) {
			for (const second of ids) {
				if (first === second) continue;
				const pair = withQuickChoice(withQuickChoice(DEFAULT_QUICK_PAIR, second), first);
				expect(pair, `${first} over ${second}`).toEqual([first, second]);
			}
		}
	});

	it('pushes the resting map across rather than dropping it', () => {
		expect(withQuickChoice(DEFAULT_QUICK_PAIR, 'classic-icgc')).toEqual([
			'classic-icgc',
			NO_BASE_MAP
		]);
	});

	it('changes nothing when the resting map is chosen again', () => {
		const pair: QuickPair = ['standard-osm', 'classic-ign'];
		expect(withQuickChoice(pair, 'standard-osm')).toEqual(pair);
	});

	it('never holds one map twice, whatever it is handed', () => {
		let pair = DEFAULT_QUICK_PAIR;
		const handed: readonly BaseMapId[] = [
			...BASE_MAPS.map((map) => map.id),
			NO_BASE_MAP,
			NO_BASE_MAP
		];
		for (const id of handed) {
			pair = withQuickChoice(pair, id);
			expect(isQuickPair(pair), id).toBe(true);
		}
	});

	/** From the resting map the button brings the other; from anywhere else it brings the resting one. */
	it('goes to the other half from the resting map and home from anywhere else', () => {
		const pair = DEFAULT_QUICK_PAIR;
		expect(quickNext(pair, NO_BASE_MAP)).toBe('satellite-costa');
		expect(quickNext(pair, 'satellite-costa')).toBe(NO_BASE_MAP);
		expect(quickNext(pair, 'classic-ign')).toBe('none');
	});

	it('refuses a stored pair this version cannot draw', () => {
		expect(isQuickPair(['none', 'satellite-costa'])).toBe(true);
		expect(isQuickPair(['none', 'none'])).toBe(false);
		expect(isQuickPair(['none'])).toBe(false);
		expect(isQuickPair(['none', 'bg-satelite-esri'])).toBe(false);
		expect(isQuickPair(undefined)).toBe(false);
	});
});
