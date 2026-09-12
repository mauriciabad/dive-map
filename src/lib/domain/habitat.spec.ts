import { describe, expect, it } from 'vitest';
import live from './fixtures/live-codes.json' with { type: 'json' };
import {
	HABITATS,
	SUBSTRATES,
	habitatByCode,
	legendFor,
	seabedClassByCode,
	textureForCode
} from './habitat.ts';

const liveCodes: Record<string, Record<string, number>> = live;

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

	it('maps Posidonia to the seagrass texture', () => {
		expect(textureForCode('30512')).toBe('ch_grass');
	});
});
