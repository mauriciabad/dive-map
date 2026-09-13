import { describe, expect, it } from 'vitest';
import live from './fixtures/live-codes.json' with { type: 'json' };
import {
	HABITATS,
	SEABED_TEXTURES,
	SUBSTRATES,
	type SeabedClass,
	type SeabedKey,
	byProminence,
	habitatByCode,
	isSeabedTexture,
	legendFor,
	seabedClassByCode,
	seabedKey,
	sharersOf,
	substrateByCode,
	textureOf
} from './habitat.ts';

const liveCodes: Record<string, Record<string, number>> = live;

const mustResolve = (code: string, where: ReadonlyMap<string, SeabedClass>): SeabedClass => {
	const seabed = where.get(code);
	if (seabed === undefined) throw new Error(`${code} is not in the catalogue`);
	return seabed;
};

const byKey = (key: SeabedKey): SeabedClass => {
	const seabed = [...HABITATS, ...SUBSTRATES].find((c) => seabedKey(c) === key);
	if (seabed === undefined) throw new Error(`${key} is not in the catalogue`);
	return seabed;
};

describe('seabed catalogue', () => {
	it('carries both published catalogues in full', () => {
		expect(HABITATS).toHaveLength(33);
		expect(SUBSTRATES).toHaveLength(20);
	});

	it.each(['habitats', 'substrate'])('resolves every %s code the live WFS returns', (layer) => {
		const codes = Object.keys(liveCodes[layer] ?? {});
		expect(codes.length).toBeGreaterThan(0);
		const unresolved = codes.filter((c) => seabedClassByCode(c) === undefined);
		expect(unresolved).toEqual([]);
	});

	it('gives every class a texture', () => {
		const missing = [...HABITATS, ...SUBSTRATES].filter((c) => c.texture.length === 0);
		expect(missing).toEqual([]);
	});

	// The style and the legend can only key by code, so a class without one is
	// painted by the `ch_sand` fallback, never named, and unreachable from the
	// texture picker. Raster 30 was that class.
	it('gives every class a code', () => {
		const codeless = [...HABITATS, ...SUBSTRATES]
			.filter((c) => c.code === undefined)
			.map((c) => seabedKey(c));
		expect(codeless).toEqual([]);
	});

	it('files the anti-erosion groynes under the 70108 the survey publishes them as', () => {
		const groynes = HABITATS.find((h) => h.raster === 30);
		expect(groynes?.code).toBe('70108');
		expect(groynes?.texture).toBe('ch_bluestones');
	});

	it('finds seagrass codes that only the habitat catalogue defines', () => {
		for (const code of ['30509', '30512', '30513']) {
			expect(seabedClassByCode(code)).toBe(habitatByCode.get(code));
		}
	});

	it('puts Posidonia in the legend ahead of bare sand', () => {
		const legend = legendFor(new Set(['30402', '30512', '30403']), 10);
		expect(legend[0]?.code).toBe('30512');
	});

	it('caps the legend so an A3 sheet stays readable', () => {
		const every = new Set(HABITATS.flatMap((h) => (h.code === undefined ? [] : [h.code])));
		expect(legendFor(every, 8)).toHaveLength(8);
	});

	it('sorts a wreck ahead of sand on the substrate layer too', () => {
		const order = [...SUBSTRATES].sort(byProminence).map((s) => s.raster);
		expect(order.indexOf(13)).toBeLessThan(order.indexOf(6));
	});

	it('maps Posidonia to the seagrass texture', () => {
		expect(textureOf(mustResolve('30512', habitatByCode), {})).toBe('ch_grass');
	});
});

describe('texture choices', () => {
	it('names every class once across both catalogues', () => {
		const keys = [...HABITATS, ...SUBSTRATES].map(seabedKey);
		expect(new Set(keys).size).toBe(keys.length);
	});

	// Habitat 30202 is circalittoral rock and substrate 30202 is a biogenic reef.
	// Keying on the published code instead would silently repaint both.
	it('keeps two classes that share a published code apart', () => {
		expect(seabedKey(mustResolve('30202', habitatByCode))).not.toBe(
			seabedKey(mustResolve('30202', substrateByCode))
		);
	});

	it('paints a chosen texture and leaves every other class alone', () => {
		const chosen = { 'habitats-20': 'ch_shipwood' } as const;
		expect(textureOf(mustResolve('30512', habitatByCode), chosen)).toBe('ch_shipwood');
		expect(textureOf(mustResolve('30402', habitatByCode), chosen)).toBe('ch_sand');
	});

	// One code is one pattern on the map, so two classes published under the same
	// one cannot be painted apart. Both catalogue defaults agreeing is what makes
	// that bearable; a row added under an existing code with a different texture
	// would put the legend and the pixels back into disagreement.
	it('agrees on a texture wherever two classes share a code', () => {
		const disagreeing = [...HABITATS, ...SUBSTRATES].filter((seabed) =>
			sharersOf(seabed).some((key) => byKey(key).texture !== seabed.texture)
		);
		expect(disagreeing).toEqual([]);
	});

	it('carries a texture chosen for either groyne class to both', () => {
		const breakwaters = byKey('habitats-29');
		const groynes = byKey('habitats-30');
		expect(breakwaters.code).toBe(groynes.code);
		for (const key of ['habitats-29', 'habitats-30'] as const) {
			const chosen = { [key]: 'ch_shipwood' };
			expect(textureOf(breakwaters, chosen)).toBe('ch_shipwood');
			expect(textureOf(groynes, chosen)).toBe('ch_shipwood');
		}
	});

	it('lists the groynes on a card framed over one', () => {
		expect(legendFor(new Set(['70108']), 10).map(seabedKey)).toContain('habitats-30');
	});

	it('offers exactly the textures the catalogues already paint with', () => {
		expect(SEABED_TEXTURES).toHaveLength(21);
		const catalogued = new Set([...HABITATS, ...SUBSTRATES].map((c) => c.texture));
		expect([...catalogued].filter((name) => !isSeabedTexture(name))).toEqual([]);
		expect(isSeabedTexture('unsurveyed')).toBe(false);
	});
});
