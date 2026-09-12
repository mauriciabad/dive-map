import { describe, expect, it } from 'vitest';
import { scale } from './units.ts';
import {
	DEFAULT_SHEET,
	groundCoverageMetres,
	groundMetresPerPixel,
	mapAreaMm,
	pixelSize,
	zoomForScale
} from './print.ts';

describe('print geometry', () => {
	it('trims the margin off both edges', () => {
		expect(mapAreaMm(DEFAULT_SHEET)).toEqual({ widthMm: 281, heightMm: 404 });
	});

	it('sizes an A3 sheet at 200dpi within Safari canvas limits', () => {
		const { width, height } = pixelSize(DEFAULT_SHEET);
		expect(width).toBe(2213);
		expect(height).toBe(3181);
		expect(width * height).toBeLessThan(16_777_216);
	});

	it('puts one printed millimetre at the scale denominator on the ground', () => {
		// 1:2000 means 1mm of paper is 2m of seabed, so 200 dots per inch of paper
		// each cover 2000/200*25.4/1000 metres.
		expect(groundMetresPerPixel(scale(2000), 200)).toBeCloseTo(0.254, 6);
	});

	it('covers 562 by 808 metres on A3 at 1:2000', () => {
		const { width, height } = groundCoverageMetres(DEFAULT_SHEET, scale(2000));
		expect(width).toBeCloseTo(562, 0);
		expect(height).toBeCloseTo(808, 0);
	});

	it('needs more zoom at 42N than at the equator for the same scale', () => {
		const here = zoomForScale(scale(2000), 41.95, 200);
		const equator = zoomForScale(scale(2000), 0, 200);
		expect(here).toBeLessThan(equator);
		expect(here).toBeCloseTo(18.83, 1);
	});
});
