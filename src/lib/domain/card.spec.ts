import { describe, expect, it } from 'vitest';
import { scale } from './units.ts';
import { DEFAULT_ISOBATHS, cropFrame, groundResolution, newCard, scaleBar, zoomToFitCrop } from './card.ts';

const TAMARIU = { lng: 3.213, lat: 41.918 };
const PHONE = { width: 390, height: 720 };
const LAPTOP = { width: 1440, height: 900 };

const at = (denominator: number) => ({ ...newCard(TAMARIU, 'Canons de Tamariu'), scale: scale(denominator) });

describe('print framing', () => {
	it('emphasises the depths a recreational dive plan turns on', () => {
		expect(DEFAULT_ISOBATHS.emphasised).toEqual([5, 18, 30, 40, 50]);
	});

	it('keeps 1m isobaths in the tiles and filters the interval in the style', () => {
		expect(DEFAULT_ISOBATHS.intervalM).toBe(5);
	});

	it('covers 562 by 808 metres of seabed on A3 at 1:2000', () => {
		const frame = cropFrame(at(2000), 16, LAPTOP);
		expect(frame.groundWidthM).toBeCloseTo(562, 0);
		expect(frame.groundHeightM).toBeCloseTo(808, 0);
	});

	it('shrinks the crop rectangle as the map zooms out', () => {
		const near = cropFrame(at(2000), 17, LAPTOP);
		const far = cropFrame(at(2000), 14, LAPTOP);
		expect(far.widthPx).toBeLessThan(near.widthPx);
		expect(far.widthPx * 8).toBeCloseTo(near.widthPx, 5);
	});

	it('flags a crop that cannot be seen whole on a phone', () => {
		expect(cropFrame(at(2000), 17, PHONE).overflowsViewport).toBe(true);
		expect(cropFrame(at(2000), 14, PHONE).overflowsViewport).toBe(false);
	});

	it('fits the crop into the viewport at the zoom it suggests', () => {
		for (const viewport of [PHONE, LAPTOP]) {
			const card = at(2000);
			const frame = cropFrame(card, zoomToFitCrop(card, viewport), viewport);
			expect(frame.overflowsViewport).toBe(false);
			const filled = Math.max(frame.widthPx / viewport.width, frame.heightPx / viewport.height);
			expect(filled).toBeCloseTo(0.8, 2);
		}
	});

	it('picks a scale bar a person can count', () => {
		expect(scaleBar(at(2000)).metres).toBe(100);
		expect(scaleBar(at(10_000)).metres).toBe(500);
		expect(scaleBar(at(1000)).metres).toBe(50);
	});

	it('keeps the scale bar inside a quarter of the sheet', () => {
		for (const d of [1000, 2000, 5000, 25_000]) {
			const card = at(d);
			expect(scaleBar(card).lengthMm).toBeLessThanOrEqual(281 / 4);
		}
	});

	it('resolves a quarter metre of seabed per dot at 1:2000', () => {
		expect(groundResolution(at(2000))).toBeCloseTo(0.254, 3);
	});

	it('exports an A3 sheet that clears the WebKit canvas cap', () => {
		const frame = cropFrame(at(2000), 16, LAPTOP);
		expect(frame.exportWidthPx * frame.exportHeightPx).toBeLessThan(16_777_216);
	});
});
