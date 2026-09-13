import { describe, expect, it } from 'vitest';
import { type LayerFacts, type MapFacts, isArchive, viewDrawsFrom } from './tile-errors.ts';

const layer = (over: Partial<LayerFacts> & Pick<LayerFacts, 'source'>): LayerFacts => ({
	visibility: 'visible',
	...over
});

const mapOf = (
	zoom: number,
	layers: Record<string, LayerFacts>,
	sources: Record<string, object> = {}
): MapFacts => ({
	getZoom: () => zoom,
	getLayersOrder: () => Object.keys(layers),
	getLayer: (id) => layers[id],
	getSource: (id) => sources[id]
});

describe('viewDrawsFrom', () => {
	it('sees a visible layer drawing from the source', () => {
		expect(viewDrawsFrom(mapOf(13, { ground: layer({ source: 'habitats' }) }), 'habitats')).toBe(
			true
		);
	});

	// The shape MapLibre really hands back for a layer the style gave no bounds:
	// both numbers absent, not 0 and 24. Compared as numbers they answer false at
	// every zoom, which is silence exactly where the archive matters most.
	it('sees a layer the style set no zoom bounds on', () => {
		const map = mapOf(6.5, { ground: layer({ source: 'habitats' }) });
		expect(viewDrawsFrom(map, 'habitats')).toBe(true);
	});

	it('does not see a layer the diver has switched off', () => {
		const map = mapOf(13, { ground: layer({ source: 'habitats', visibility: 'none' }) });
		expect(viewDrawsFrom(map, 'habitats')).toBe(false);
	});

	it('does not see a layer that starts drawing further in', () => {
		const map = mapOf(9, { detail: layer({ source: 'land', minzoom: 11 }) });
		expect(viewDrawsFrom(map, 'land')).toBe(false);
	});

	it('does not see a layer that has stopped drawing by this zoom', () => {
		const map = mapOf(13, { world: layer({ source: 'world', maxzoom: 11 }) });
		expect(viewDrawsFrom(map, 'world')).toBe(false);
	});

	it('says nothing about a source no layer names', () => {
		expect(viewDrawsFrom(mapOf(13, { ground: layer({ source: 'habitats' }) }), 'substrate')).toBe(
			false
		);
	});
});

describe('isArchive', () => {
	it('knows a pmtiles file this map ships', () => {
		const map = mapOf(13, {}, { habitats: { url: 'pmtiles:///tiles/habitats.pmtiles' } });
		expect(isArchive(map, 'habitats')).toBe(true);
	});

	it('leaves a tile server that is not ours out of it', () => {
		const map = mapOf(13, {}, { satellite: { tiles: ['https://example.test/{z}/{x}/{y}.jpg'] } });
		expect(isArchive(map, 'satellite')).toBe(false);
	});

	it('leaves a source the style no longer has out of it', () => {
		expect(isArchive(mapOf(13, {}), 'habitats')).toBe(false);
	});
});
