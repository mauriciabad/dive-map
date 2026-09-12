import { describe, expect, it } from 'vitest';
import { scale } from './units.ts';
import {
	CANVAS_PIXEL_CAP,
	DEFAULT_SHEET,
	type Sheet,
	asZoomFraming,
	exceedsCanvasCap,
	groundMetresPerPixel,
	planSheet,
	renderZoom,
	scaleForResolution,
	sheetPixels,
	sheetSizeMm,
	unitPixels,
	zoomForScale,
	zoomResolution
} from './print.ts';

const A3: Sheet = { kind: 'stock', stock: 'A3', orientation: 'portrait', dpi: 200 };
const A4_LANDSCAPE: Sheet = { kind: 'stock', stock: 'A4', orientation: 'landscape', dpi: 200 };
const CUSTOM_MM: Sheet = { kind: 'millimetres', widthMm: 500, heightMm: 250, dpi: 150 };
const CUSTOM_PX: Sheet = { kind: 'pixels', widthPx: 1920, heightPx: 1080 };
const HERE = 41.95;

describe('sheet sizes', () => {
	it('runs the map to the paper edge, so the sheet is the map area', () => {
		expect(sheetSizeMm(A3)).toEqual({ widthMm: 297, heightMm: 420 });
	});

	it('swaps the stock size for landscape', () => {
		expect(sheetSizeMm(A4_LANDSCAPE)).toEqual({ widthMm: 297, heightMm: 210 });
	});

	it('takes a custom size in millimetres as given', () => {
		expect(sheetSizeMm(CUSTOM_MM)).toEqual({ widthMm: 500, heightMm: 250 });
	});

	it('gives a raster no page size rather than inventing one', () => {
		expect(sheetSizeMm(CUSTOM_PX)).toBeUndefined();
		expect(sheetPixels(CUSTOM_PX)).toEqual({ width: 1920, height: 1080 });
	});

	it('sizes A3 at 200dpi inside the canvas ceiling', () => {
		const { width, height } = sheetPixels(A3);
		expect(width).toBe(2339);
		expect(height).toBe(3307);
		expect(exceedsCanvasCap(A3)).toBe(false);
		expect(exceedsCanvasCap(DEFAULT_SHEET)).toBe(false);
	});

	it('catches a sheet the canvas will refuse before anything tries to draw it', () => {
		const a2At300: Sheet = { kind: 'stock', stock: 'A2', orientation: 'portrait', dpi: 300 };
		expect(sheetPixels(a2At300).width * sheetPixels(a2At300).height).toBeGreaterThan(
			CANVAS_PIXEL_CAP
		);
		expect(exceedsCanvasCap(a2At300)).toBe(true);
	});

	it('holds the furniture at one physical size as the density changes', () => {
		const at300: Sheet = { kind: 'stock', stock: 'A3', orientation: 'portrait', dpi: 300 };
		expect(unitPixels(A3)).toBeCloseTo(7.87, 2);
		// 300dpi is 1.5x the dots, so a unit is 1.5x the dots and the same millimetre.
		expect(unitPixels(at300) / unitPixels(A3)).toBeCloseTo(1.5, 2);
	});

	it('pulls furniture size in at the extremes instead of scaling it flat', () => {
		const a5: Sheet = { kind: 'stock', stock: 'A5', orientation: 'portrait', dpi: 200 };
		const ratio = unitPixels(a5) / unitPixels(A3);
		expect(ratio).toBeGreaterThan(148 / 297);
		expect(ratio).toBeLessThan(1);
	});
});

describe('scale and zoom are two names for one resolution', () => {
	it('measures MapLibre zoom against a 512 pixel world', () => {
		// Measured on the live map with unproject at 41.9083N: zoom 17 is 0.444418 m
		// per CSS pixel. The 256 pixel constant says 0.888837 and is what made the
		// printed sheet come out four times too fine.
		expect(zoomResolution(17, 41.9083)).toBeCloseTo(0.444418, 6);
		expect(zoomResolution(14, 41.9083)).toBeCloseTo(3.555348, 6);
	});

	it('puts one printed millimetre at the scale denominator on the ground', () => {
		expect(groundMetresPerPixel(scale(2000), 200)).toBeCloseTo(0.254, 6);
	});

	it('needs more zoom at 42N than at the equator for the same scale', () => {
		expect(zoomForScale(scale(2000), HERE, 200)).toBeLessThan(zoomForScale(scale(2000), 0, 200));
		expect(zoomForScale(scale(2000), HERE, 200)).toBeCloseTo(17.81, 2);
	});

	it('drops a zoom for every doubling of the render pixel ratio', () => {
		const plan = planSheet(A3, { by: 'scale', scale: scale(2000) }, HERE);
		expect(renderZoom(plan, 2)).toBeCloseTo(plan.zoom - 1, 9);
		expect(renderZoom(plan, 1)).toBeCloseTo(plan.zoom, 9);
	});

	it('round-trips a scale through a zoom and back', () => {
		const plan = planSheet(A3, { by: 'scale', scale: scale(2000) }, HERE);
		expect(plan.paper?.scale).toBeCloseTo(2000, 6);
		// 2339 dots across 297 mm is 200.04 dpi, not the 200 that was asked for, and
		// the resolution follows the paper rather than the request.
		expect(plan.groundMetresPerPixel).toBeCloseTo(0.25395, 5);
	});

	it('reports the scale a zoom actually produces rather than a round number', () => {
		const plan = planSheet(A3, { by: 'zoom', zoom: 17 }, HERE);
		expect(plan.zoom).toBe(17);
		expect(plan.paper?.scale).toBeCloseTo(
			scaleForResolution(plan.groundMetresPerPixel, plan.paper?.printedDpi ?? 0),
			6
		);
		expect(plan.paper?.scale).not.toBeCloseTo(2000, 0);
	});

	it('gives a raster no scale ratio, because it has no size to be a ratio of', () => {
		const plan = planSheet(CUSTOM_PX, { by: 'zoom', zoom: 17 }, HERE);
		expect(plan.paper).toBeUndefined();
		expect(plan.widthPx).toBe(1920);
		expect(plan.groundWidthM).toBeCloseTo(1920 * zoomResolution(17, HERE), 6);
	});

	it('converts a scale framing to the equivalent zoom when the sheet stops being paper', () => {
		const scaled = { by: 'scale', scale: scale(2000) } as const;
		const framing = asZoomFraming(scaled, A3, HERE);
		expect(framing.by).toBe('zoom');
		expect(planSheet(A3, framing, HERE).groundMetresPerPixel).toBeCloseTo(
			planSheet(A3, scaled, HERE).groundMetresPerPixel,
			9
		);
	});

	it('covers 594 by 840 metres on A3 at 1:2000, which is 297mm of paper at 2000x', () => {
		const plan = planSheet(A3, { by: 'scale', scale: scale(2000) }, HERE);
		expect(plan.groundWidthM).toBeCloseTo(594, 0);
		expect(plan.groundHeightM).toBeCloseTo(840, 0);
		expect(plan.groundWidthM / ((plan.paper?.pageMm.widthMm ?? 0) / 1000)).toBeCloseTo(2000, 0);
	});
});
