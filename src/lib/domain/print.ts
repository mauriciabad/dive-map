import { type ScaleDenominator, scale } from './units.ts';

/**
 * A card is specified at a map scale, not a zoom level. A diver reading a
 * laminated sheet on a moving boat trusts the scale bar, so the scale is the
 * thing an instructor sets and the zoom is derived from it.
 */

export const PAPER = {
	A3: { widthMm: 297, heightMm: 420 },
	A4: { widthMm: 210, heightMm: 297 }
} as const satisfies Record<string, { widthMm: number; heightMm: number }>;

export type PaperSize = keyof typeof PAPER;
export type Orientation = 'portrait' | 'landscape';

export interface Sheet {
	readonly paper: PaperSize;
	readonly orientation: Orientation;
	/** Trim on every edge. Laminating pouches eat a few millimetres. */
	readonly marginMm: number;
	readonly dpi: number;
}

export const DEFAULT_SHEET: Sheet = {
	paper: 'A3',
	orientation: 'portrait',
	marginMm: 8,
	dpi: 200
};

/** Scales that put a Costa Brava dive site on one A3 sheet. */
export const CARD_SCALES: readonly ScaleDenominator[] = [
	1000, 2000, 2500, 5000, 10_000, 25_000
].map(scale);

export interface Millimetres {
	readonly widthMm: number;
	readonly heightMm: number;
}

export const sheetSizeMm = (sheet: Sheet): Millimetres => {
	const { widthMm, heightMm } = PAPER[sheet.paper];
	const [w, h] = sheet.orientation === 'portrait' ? [widthMm, heightMm] : [heightMm, widthMm];
	return { widthMm: w, heightMm: h };
};

/** Drawable area once the trim margin is taken off all four edges. */
export const mapAreaMm = (sheet: Sheet): Millimetres => {
	const { widthMm, heightMm } = sheetSizeMm(sheet);
	return {
		widthMm: widthMm - 2 * sheet.marginMm,
		heightMm: heightMm - 2 * sheet.marginMm
	};
};

const MM_PER_INCH = 25.4;

export const pixelSize = (sheet: Sheet): { readonly width: number; readonly height: number } => {
	const { widthMm, heightMm } = mapAreaMm(sheet);
	return {
		width: Math.round((widthMm / MM_PER_INCH) * sheet.dpi),
		height: Math.round((heightMm / MM_PER_INCH) * sheet.dpi)
	};
};

/** Web Mercator ground resolution at zoom 0 on the equator, metres per pixel. */
const EQUATOR_RESOLUTION = 156_543.033_928_041;

/** Ground metres covered by one output pixel at this scale and print density. */
export const groundMetresPerPixel = (denominator: ScaleDenominator, dpi: number): number =>
	(MM_PER_INCH / dpi / 1000) * denominator;

/**
 * MapLibre's zoom for a given printed scale. Mercator resolution varies with
 * latitude, so a card at 42N needs a different zoom from the same scale at the
 * equator.
 */
export const zoomForScale = (
	denominator: ScaleDenominator,
	latitudeDeg: number,
	dpi: number
): number => {
	const target = groundMetresPerPixel(denominator, dpi);
	const atLatitude = EQUATOR_RESOLUTION * Math.cos((latitudeDeg * Math.PI) / 180);
	return Math.log2(atLatitude / target);
};

/** Ground width and height the sheet will cover, for choosing a scale that fits a site. */
export const groundCoverageMetres = (
	sheet: Sheet,
	denominator: ScaleDenominator
): { readonly width: number; readonly height: number } => {
	const { widthMm, heightMm } = mapAreaMm(sheet);
	return {
		width: (widthMm / 1000) * denominator,
		height: (heightMm / 1000) * denominator
	};
};
