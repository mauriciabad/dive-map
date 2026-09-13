import { describe, expect, it } from 'vitest';
import { SDF_CUTOFF, SDF_RADIUS, distanceField } from './sdf';

const alphaAt = (data: Uint8ClampedArray, width: number, x: number, y: number): number =>
	data[(y * width + x) * 4 + 3] ?? -1;

/** What MapLibre's shader treats as the glyph edge: `(256 - 64) / 256` of full alpha. */
const EDGE_ALPHA = Math.round(255 * (1 - SDF_CUTOFF));

const disc = (size: number, radius: number): Float64Array => {
	const coverage = new Float64Array(size * size);
	const c = (size - 1) / 2;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			coverage[y * size + x] = Math.hypot(x - c, y - c) <= radius ? 1 : 0;
		}
	}
	return coverage;
};

describe('distanceField', () => {
	it('puts the shape edge at the alpha MapLibre reads as distance zero', () => {
		const size = 48;
		const field = distanceField(disc(size, 12), size, size);
		// One pixel either side of the boundary straddles the shader's edge value.
		expect(alphaAt(field, size, 23 - 11, 23)).toBeGreaterThan(EDGE_ALPHA);
		expect(alphaAt(field, size, 23 - 14, 23)).toBeLessThan(EDGE_ALPHA);
	});

	it('falls one alpha step per pixel away from the edge, which is what sizes the halo', () => {
		const size = 48;
		const field = distanceField(disc(size, 12), size, size);
		const step = 255 / SDF_RADIUS;
		const centre = 23;
		// Three pixels out from the boundary is three steps down from the edge value.
		const outside = alphaAt(field, size, centre - 12 - 3, centre);
		expect(outside).toBeGreaterThan(EDGE_ALPHA - step * 4);
		expect(outside).toBeLessThan(EDGE_ALPHA - step * 2);
	});

	it('saturates well inside and bottoms out well outside', () => {
		const size = 48;
		const field = distanceField(disc(size, 12), size, size);
		expect(alphaAt(field, size, 23, 23)).toBe(255);
		expect(alphaAt(field, size, 0, 0)).toBe(0);
	});

	it('reads the same along both axes, so nothing is transposed', () => {
		const size = 32;
		const field = distanceField(disc(size, 8), size, size);
		for (let offset = 1; offset <= 12; offset++) {
			expect(alphaAt(field, size, 15 + offset, 15)).toBe(alphaAt(field, size, 15, 15 + offset));
		}
	});

	it('carries sub-pixel coverage rather than snapping to whole pixels', () => {
		const size = 16;
		const half = new Float64Array(size * size);
		const quarter = new Float64Array(size * size);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const inside = x < 8 ? 1 : 0;
				half[y * size + x] = x === 8 ? 0.5 : inside;
				quarter[y * size + x] = x === 8 ? 0.1 : inside;
			}
		}
		const a = distanceField(half, size, size);
		const b = distanceField(quarter, size, size);
		expect(alphaAt(a, size, 8, 8)).toBeGreaterThan(alphaAt(b, size, 8, 8));
	});
});
