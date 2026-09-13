import { describe, expect, it } from 'vitest';
import { scale } from './units.ts';
import { type Sheet, planSheet } from './print.ts';
import {
	type DiveCard,
	cropFrame,
	newCard,
	planFor,
	scaleBar,
	shows,
	zoomToFitCrop
} from './card.ts';

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 780 };
const HERE = { lng: 3.2165, lat: 41.9275 };

const A3: Sheet = { kind: 'stock', stock: 'A3', orientation: 'portrait', dpi: 200, bleedMm: 0 };
const RASTER: Sheet = { kind: 'pixels', widthPx: 1600, heightPx: 1200 };

const at = (denominator: number): DiveCard => ({
	...newCard(HERE, 'Illa Roja'),
	framing: { by: 'scale', scale: scale(denominator) }
});

describe('framing a sheet on the live map', () => {
	it('draws the crop at the ratio between the sheet zoom and the screen zoom', () => {
		const plan = planFor(at(2000));
		const frame = cropFrame(plan, plan.zoom - 1, LAPTOP);
		expect(frame.widthPx).toBeCloseTo(plan.widthPx / 2, 6);
		expect(frame.exportWidthPx).toBe(plan.widthPx);
	});

	it('grows the crop as the map zooms in, because the sheet holds less ground', () => {
		const plan = planFor(at(2000));
		expect(cropFrame(plan, 17, LAPTOP).widthPx).toBeGreaterThan(
			cropFrame(plan, 14, LAPTOP).widthPx
		);
	});

	it('warns when the sheet is bigger than the screen showing it', () => {
		const plan = planFor(at(2000));
		expect(cropFrame(plan, 17, PHONE).overflowsViewport).toBe(true);
		expect(cropFrame(plan, 12, PHONE).overflowsViewport).toBe(false);
	});

	it('fits the crop to the viewport at the zoom it hands back', () => {
		for (const viewport of [LAPTOP, PHONE]) {
			const plan = planFor(at(2000));
			const frame = cropFrame(plan, zoomToFitCrop(plan, viewport), viewport);
			expect(frame.overflowsViewport).toBe(false);
			expect(
				Math.max(frame.widthPx / viewport.width, frame.heightPx / viewport.height)
			).toBeCloseTo(0.8, 6);
		}
	});
});

describe('the scale bar measures what was drawn', () => {
	it('picks a round number of metres that fits a quarter of the sheet', () => {
		expect(scaleBar(planFor(at(2000))).metres).toBe(100);
		expect(scaleBar(planFor(at(10_000))).metres).toBe(500);
		expect(scaleBar(planFor(at(1000))).metres).toBe(50);
	});

	it('never runs the bar past a quarter of the sheet', () => {
		for (const denominator of [1000, 2000, 2500, 5000, 10_000, 25_000]) {
			const plan = planFor(at(denominator));
			expect(scaleBar(plan).lengthPx).toBeLessThanOrEqual(plan.widthPx / 4);
		}
	});

	it('agrees with the ratio printed beside it, whether the card was framed by scale or by zoom', () => {
		for (const framing of [
			{ by: 'scale', scale: scale(2000) } as const,
			{ by: 'zoom', zoom: 16.4 } as const,
			{ by: 'zoom', zoom: 18.2 } as const
		]) {
			const plan = planSheet(A3, framing, HERE.lat);
			const bar = scaleBar(plan);
			const ratio = plan.paper?.scale ?? 0;
			const printedMm = bar.printedMm ?? 0;
			// The bar says "this many metres"; the ratio says a millimetre of paper is
			// this much ground. They have to be the same claim.
			expect((printedMm / 1000) * ratio).toBeCloseTo(bar.metres, 6);
		}
	});

	it('picks a shorter round number when the plate is narrow, rather than stretching the bar', () => {
		const plan = planFor(at(2000));
		const wide = scaleBar(plan);
		const narrow = scaleBar(plan, wide.lengthPx / 2);
		expect(narrow.metres).toBeLessThan(wide.metres);
		expect(narrow.lengthPx).toBeLessThanOrEqual(wide.lengthPx / 2);
		expect(narrow.lengthPx).toBeCloseTo(narrow.metres / plan.groundMetresPerPixel, 6);
	});

	it('gives a raster a bar in metres and no ruler measurement', () => {
		const plan = planSheet(RASTER, { by: 'zoom', zoom: 17 }, HERE.lat);
		const bar = scaleBar(plan);
		expect(bar.printedMm).toBeUndefined();
		expect(bar.lengthPx).toBeCloseTo(bar.metres / plan.groundMetresPerPixel, 6);
	});
});

describe('furniture', () => {
	it('starts with everything on, the attribution the licence asks for included', () => {
		const card = newCard(HERE, 'Illa Roja');
		expect(shows(card, 'attribution')).toBe(true);
		expect(shows(card, 'northArrow')).toBe(true);
	});

	it('hides what has been taken out of the list', () => {
		const card: DiveCard = { ...newCard(HERE, 'Illa Roja'), furniture: ['title'] };
		expect(shows(card, 'title')).toBe(true);
		expect(shows(card, 'legend')).toBe(false);
	});
});
