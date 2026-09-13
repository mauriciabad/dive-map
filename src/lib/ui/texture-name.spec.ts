import { describe, expect, it } from 'vitest';
import { SEABED_TEXTURES } from '$lib/domain/habitat';
import { textureName } from './texture-name.ts';

describe('naming a texture on a button', () => {
	it('drops the pack prefix and the underscores', () => {
		expect(textureName('ch_grass_2_lines')).toBe('Grass 2 lines');
		expect(textureName('ch_rock')).toBe('Rock');
	});

	it('leaves a texture with no prefix alone', () => {
		expect(textureName('metal')).toBe('Metal');
	});

	// Four greys sit next to each other in the grid and the bands are genuinely
	// alike. A name that collided would leave no way to tell which was pressed.
	it('gives every texture on offer a name of its own', () => {
		const names = SEABED_TEXTURES.map(textureName);
		expect(new Set(names).size).toBe(names.length);
		expect(names.filter((name) => name.length === 0)).toEqual([]);
	});
});
