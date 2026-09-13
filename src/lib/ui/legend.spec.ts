import { describe, expect, it } from 'vitest';
import { DEFAULT_ISOBATHS, DEFAULT_LAYERS } from '$lib/domain/card';
import { HABITATS, NO_TEXTURE_CHOICES, SUBSTRATES, catalogueOf } from '$lib/domain/habitat';
import { buildStyle } from '$lib/map/style';
import { type Legend, type LegendEntry, buildLegend, codesOf } from './legend.ts';

/**
 * The legend answers the one question the map cannot: what is that pattern under
 * the boat. It is built from the catalogues rather than from the tiles, so a
 * class that falls out of it goes missing silently, and a texture listed twice
 * tells a diver two patterns exist where there is one. Both are counted here.
 */

const entriesOf = (legend: Legend): readonly LegendEntry[] =>
	[...legend.inFrame, ...legend.elsewhere].flatMap((row) => [...row.inFrame, ...row.elsewhere]);

const HABITAT_CODES = new Set(HABITATS.flatMap((h) => (h.code === undefined ? [] : [h.code])));

describe('the legend of a ground layer', () => {
	it.each(['habitats', 'substrate'] as const)(
		'names every %s class once, so none is left unexplained',
		(ground) => {
			const entries = entriesOf(
				buildLegend(ground, new Set(['30402', '30512']), NO_TEXTURE_CHOICES)
			);
			const own = entries.filter((entry) => entry.key.startsWith(`${ground}-`));
			expect(own).toHaveLength(catalogueOf(ground).length);
			expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
		}
	);

	it('draws each texture once, never in both sections', () => {
		const legend = buildLegend('habitats', new Set(['30512', '70104']), NO_TEXTURE_CHOICES);
		const textures = [...legend.inFrame, ...legend.elsewhere].map((row) => row.texture);
		expect(new Set(textures).size).toBe(textures.length);
	});

	it('gathers the six habitat classes painted with metal under one band', () => {
		const legend = buildLegend('habitats', new Set(), NO_TEXTURE_CHOICES);
		const metal = legend.elsewhere.filter((row) => row.texture === 'metal');
		expect(metal).toHaveLength(1);
		expect(metal[0]?.elsewhere).toHaveLength(6);
	});

	it('puts Posidonia above bare sand, not in catalogue order', () => {
		const legend = buildLegend('habitats', new Set(['30402', '30512']), NO_TEXTURE_CHOICES);
		expect(legend.inFrame.map((row) => row.inFrame[0]?.seabed.code)).toEqual(['30512', '30402']);
	});

	it('explains the seagrass the substrate layer returns but never defines', () => {
		const legend = buildLegend('substrate', new Set(['30512']), NO_TEXTURE_CHOICES);
		const row = legend.inFrame.find((entry) => entry.texture === 'ch_grass');
		expect(row?.inFrame.map((entry) => entry.seabed.code)).toEqual(['30512']);
		expect(entriesOf(legend)).toHaveLength(SUBSTRATES.length + 1);
	});

	it('regroups a class the diver repainted into the row it now belongs to', () => {
		const chosen = { 'habitats-20': 'ch_shipwood' } as const;
		const legend = buildLegend('habitats', new Set(['30402', '30512']), chosen);
		const grass = [...legend.inFrame, ...legend.elsewhere].find(
			(row) => row.texture === 'ch_grass'
		);
		const wood = legend.inFrame.find((row) => row.texture === 'ch_shipwood');
		expect(grass).toBeUndefined();
		expect(wood?.inFrame.map((entry) => entry.seabed.code)).toEqual(['30512']);
		expect(wood?.inFrame.map((entry) => entry.chosen)).toEqual([true]);
	});

	it('marks only the classes the diver chose for', () => {
		const legend = buildLegend('habitats', new Set(['30512']), { 'habitats-20': 'ch_stone' });
		const marked = entriesOf(legend).filter((entry) => entry.chosen);
		expect(marked.map((entry) => entry.key)).toEqual(['habitats-20']);
	});

	it('never claims the groyne class is in the frame, since it carries no code', () => {
		const legend = buildLegend('habitats', HABITAT_CODES, NO_TEXTURE_CHOICES);
		const stones = [...legend.inFrame, ...legend.elsewhere].find(
			(row) => row.texture === 'ch_bluestones'
		);
		expect(stones?.inFrame.map((entry) => entry.seabed.raster)).toEqual([29]);
		expect(stones?.elsewhere.map((entry) => entry.seabed.raster)).toEqual([30]);
	});
});

describe('reading the codes off what the map rendered', () => {
	it('keeps the strings and drops a code that is not one', () => {
		const codes = codesOf([
			{ properties: { code: '30512' } },
			{ properties: { code: 30512 } },
			{ properties: { name: 'no code here' } }
		]);
		expect([...codes]).toEqual(['30512']);
	});
});

describe('the hatch the panel explains by name', () => {
	// A renamed layer in style.ts would leave the panel describing a pattern the
	// map no longer paints, and nothing on screen would say so.
	it.each(['habitats', 'substrate'] as const)('is in the %s style', (groundLayer) => {
		const style = buildStyle({
			locale: 'ca',
			smoothed: true,
			isobaths: DEFAULT_ISOBATHS,
			visible: [...DEFAULT_LAYERS],
			groundLayer
		});
		expect(style.layers.map((layer) => layer.id)).toContain('seabed-unmapped');
	});
});
