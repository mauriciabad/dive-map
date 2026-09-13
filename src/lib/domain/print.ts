import { type ScaleDenominator, scale } from './units.ts';

/**
 * A sheet is specified either on paper or in pixels, and those are two different
 * kinds of thing. Paper has a size you can measure with a ruler and a print
 * density that turns it into dots. A pixel raster has neither, so it has no
 * scale ratio, no page size, and its scale bar prints a length in metres with no
 * "1:N" beside it. Nothing here invents a paper size for a raster.
 *
 * The framing is specified either by scale or by zoom, and both resolve to one
 * number: ground metres per OUTPUT pixel. Everything downstream reads that, so
 * the scale bar is measured from what the renderer actually drew rather than
 * from what was asked for.
 */

export interface Millimetres {
	readonly widthMm: number;
	readonly heightMm: number;
}

export interface Pixels {
	readonly width: number;
	readonly height: number;
}

export type Orientation = 'portrait' | 'landscape';

/** Portrait sizes. Orientation swaps them. */
export const STOCK = {
	A2: { widthMm: 420, heightMm: 594 },
	A3: { widthMm: 297, heightMm: 420 },
	A4: { widthMm: 210, heightMm: 297 },
	A5: { widthMm: 148, heightMm: 210 },
	letter: { widthMm: 215.9, heightMm: 279.4 },
	legal: { widthMm: 215.9, heightMm: 355.6 }
} as const satisfies Record<string, Millimetres>;

export type StockId = keyof typeof STOCK;

/** Biggest first, so the list reads down from a sheet you plan on to one you pocket. */
export const STOCK_IDS = [
	'A2',
	'A3',
	'A4',
	'A5',
	'letter',
	'legal'
] as const satisfies readonly StockId[];

/**
 * How far the map runs past the line the sheet is cut on, on every side.
 *
 * A guillotine drifts a millimetre either way, and a cut that lands a hair outside
 * the artwork leaves a white hairline down one edge of the card. The fix is older
 * than the printing press: paint past the cut and throw the excess away. Three
 * millimetres is what a print shop asks for.
 *
 * Zero is the default, because the sheet this exists for is run on an office A3
 * laser and laminated whole. That machine cannot reach its own paper edge and
 * nobody trims afterwards, so bleed there is paper thrown away for nothing.
 */
export const BLEED_CHOICES = [0, 3, 5] as const;

/** A named size off the shelf. "A2 landscape" is a real thing to ask a printer for. */
export interface StockSheet {
	readonly kind: 'stock';
	readonly stock: StockId;
	readonly orientation: Orientation;
	readonly dpi: number;
	readonly bleedMm: number;
}

/** A size measured out by hand. The two numbers are the orientation. */
export interface MillimetreSheet {
	readonly kind: 'millimetres';
	readonly widthMm: number;
	readonly heightMm: number;
	readonly dpi: number;
	readonly bleedMm: number;
}

/** An image. No physical size, so no density and no scale ratio. */
export interface PixelSheet {
	readonly kind: 'pixels';
	readonly widthPx: number;
	readonly heightPx: number;
}

export type Sheet = StockSheet | MillimetreSheet | PixelSheet;

export const DEFAULT_SHEET: Sheet = {
	kind: 'stock',
	stock: 'A3',
	orientation: 'portrait',
	dpi: 200,
	bleedMm: 0
};

export const DPI_CHOICES = [100, 150, 200, 300] as const;

const MM_PER_INCH = 25.4;

const paperSizeMm = (sheet: StockSheet | MillimetreSheet): Millimetres => {
	if (sheet.kind === 'millimetres') return { widthMm: sheet.widthMm, heightMm: sheet.heightMm };
	const { widthMm, heightMm } = STOCK[sheet.stock];
	return sheet.orientation === 'portrait'
		? { widthMm, heightMm }
		: { widthMm: heightMm, heightMm: widthMm };
};

/** What the sheet is once it is cut, in millimetres. A raster is never cut. */
export const trimSizeMm = (sheet: Sheet): Millimetres | undefined =>
	sheet.kind === 'pixels' ? undefined : paperSizeMm(sheet);

const dotsAcross = (millimetres: number, dpi: number): number =>
	Math.round((millimetres / MM_PER_INCH) * dpi);

/** What comes off the press, trim plus the bleed on all four sides. */
export const pageSizeMm = (sheet: Sheet): Millimetres | undefined => {
	if (sheet.kind === 'pixels') return undefined;
	const { widthMm, heightMm } = paperSizeMm(sheet);
	return {
		widthMm: widthMm + 2 * sheet.bleedMm,
		heightMm: heightMm + 2 * sheet.bleedMm
	};
};

/** The finished card in output pixels. The furniture is laid out inside this. */
export const trimPixels = (sheet: Sheet): Pixels => {
	switch (sheet.kind) {
		case 'pixels':
			return { width: sheet.widthPx, height: sheet.heightPx };
		case 'stock':
		case 'millimetres': {
			const { widthMm, heightMm } = paperSizeMm(sheet);
			return { width: dotsAcross(widthMm, sheet.dpi), height: dotsAcross(heightMm, sheet.dpi) };
		}
	}
};

/** Bleed in output pixels, so the trim is a whole number of pixels in from the edge. */
export const bleedPixels = (sheet: Sheet): number =>
	sheet.kind === 'pixels' ? 0 : dotsAcross(sheet.bleedMm, sheet.dpi);

/** The raster to render: the trim with the bleed added on every side. */
export const sheetPixels = (sheet: Sheet): Pixels => {
	const trim = trimPixels(sheet);
	const bleed = bleedPixels(sheet);
	return { width: trim.width + 2 * bleed, height: trim.height + 2 * bleed };
};

/**
 * A3 at 200dpi: the sheet the furniture was drawn against, and the yardstick a
 * raster is measured by. It says how big the type looks on the page, not how big
 * the page is.
 */
const REFERENCE_SHORT_MM = STOCK.A3.widthMm;
const REFERENCE_SHORT_PX = Math.round((REFERENCE_SHORT_MM / MM_PER_INCH) * 200);

/**
 * One furniture unit in output pixels. A unit is a millimetre on A3, and the
 * geometric mean pulls the extremes in: type set to read at arm's length on A3
 * is absurd on A5 and lost on A2 if it simply scales.
 */
export const unitPixels = (sheet: Sheet): number => {
	// The trim, not the raster. Asking for bleed must not resize the type: the card
	// in the diver's hand is the same card whether or not it was cut out of a
	// larger sheet.
	const { width, height } = trimPixels(sheet);
	const short = Math.min(width, height);
	const reference =
		sheet.kind === 'pixels' ? REFERENCE_SHORT_PX : (REFERENCE_SHORT_MM / MM_PER_INCH) * sheet.dpi;
	return Math.sqrt(short * reference) / REFERENCE_SHORT_MM;
};

/**
 * Keep-out inside the trim, in units. The map runs past the paper edge now, so
 * this exists only to hold the furniture off the cut: a guillotine and a
 * laminating pouch each eat a few millimetres, and an attribution inside the weld
 * is an attribution nobody can read.
 */
const SAFE_UNITS = 9;

export type Framing =
	| { readonly by: 'scale'; readonly scale: ScaleDenominator }
	| { readonly by: 'zoom'; readonly zoom: number };

/** Scales that put a Costa Brava dive site on one sheet. */
export const CARD_SCALES: readonly ScaleDenominator[] = [
	500, 1000, 2000, 2500, 5000, 10_000, 25_000
].map(scale);

export const DEFAULT_FRAMING: Framing = { by: 'scale', scale: scale(2000) };

/**
 * Ground metres per CSS pixel at zoom 0 on the equator.
 *
 * MapLibre's world is 512 CSS pixels across at zoom 0, not the 256 of the old
 * slippy-map constant. Measured against `map.unproject` on the live map: at
 * 41.91N, zoom 17 is 0.444418 m per CSS pixel, which is this number, and half
 * of 156543.033928041.
 */
const EQUATOR_RESOLUTION = 78_271.516_964_020_4;

const mercatorResolution = (latitudeDeg: number): number =>
	EQUATOR_RESOLUTION * Math.cos((latitudeDeg * Math.PI) / 180);

/** Ground metres covered by one printed dot at this scale and print density. */
export const groundMetresPerPixel = (denominator: ScaleDenominator, dpi: number): number =>
	(MM_PER_INCH / dpi / 1000) * denominator;

/** Ground metres per CSS pixel at a MapLibre zoom. */
export const zoomResolution = (zoom: number, latitudeDeg: number): number =>
	mercatorResolution(latitudeDeg) / 2 ** zoom;

export const zoomForResolution = (metresPerPixel: number, latitudeDeg: number): number =>
	Math.log2(mercatorResolution(latitudeDeg) / metresPerPixel);

export const zoomForScale = (
	denominator: ScaleDenominator,
	latitudeDeg: number,
	dpi: number
): number => zoomForResolution(groundMetresPerPixel(denominator, dpi), latitudeDeg);

/** The ratio a sheet comes out at, worked back from the resolution it was drawn at. */
export const scaleForResolution = (metresPerPixel: number, dpi: number): ScaleDenominator =>
	scale((metresPerPixel * 1000) / (MM_PER_INCH / dpi));

export type FurnitureId = 'title' | 'depth' | 'legend' | 'scaleBar' | 'northArrow' | 'attribution';

export const FURNITURE_IDS = [
	'title',
	'depth',
	'legend',
	'scaleBar',
	'northArrow',
	'attribution'
] as const satisfies readonly FurnitureId[];

/**
 * The ICGC licence asks for the attribution, so a sheet without that line is a
 * sheet a dive centre should think twice about handing out. It defaults on and
 * the panel says so.
 */
export const LEGAL_FURNITURE: readonly FurnitureId[] = ['attribution'];

export const DEFAULT_FURNITURE: readonly FurnitureId[] = FURNITURE_IDS;

/** What the panel will accept from a person, and so what it will accept from storage. */
export const MM_BOUNDS = { low: 20, high: 2000 } as const;
export const PX_BOUNDS = { low: 200, high: 20_000 } as const;
export const ZOOM_BOUNDS = { low: 6, high: 22 } as const;
const DPI_BOUNDS = { low: 50, high: 1200 } as const;
const BLEED_BOUNDS = { low: 0, high: 20 } as const;

/**
 * A sheet setup as plain data, for storing and reading back.
 *
 * Only what should survive a reload: the size, the framing, and which elements
 * are on. The title and the subtitle stay out. They are what one sheet is called,
 * not how sheets are set up, and somebody reloading a saved setup wants their
 * paper and their framing back rather than last week's card title. The format
 * stays out too, because a raster can only be a PNG and the sheet already says so.
 */
export interface PrintSettings {
	readonly sheet: Sheet;
	readonly framing: Framing;
	readonly furniture: readonly FurnitureId[];
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
	sheet: DEFAULT_SHEET,
	framing: DEFAULT_FRAMING,
	furniture: DEFAULT_FURNITURE
};

/**
 * These two are also in `$lib/state/configuration.ts`. A domain module reaching
 * into a state module to share four lines is the worse trade.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const numberWithin = (value: unknown, low: number, high: number): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
		? value
		: undefined;

const isStockId = (value: unknown): value is StockId => STOCK_IDS.some((id) => id === value);

const parseSheet = (value: unknown): Sheet | undefined => {
	if (!isRecord(value)) return undefined;
	const kind = value['kind'];
	if (kind === 'pixels') {
		const widthPx = numberWithin(value['widthPx'], PX_BOUNDS.low, PX_BOUNDS.high);
		const heightPx = numberWithin(value['heightPx'], PX_BOUNDS.low, PX_BOUNDS.high);
		if (widthPx === undefined || heightPx === undefined) return undefined;
		return { kind: 'pixels', widthPx: Math.round(widthPx), heightPx: Math.round(heightPx) };
	}
	const dpi = numberWithin(value['dpi'], DPI_BOUNDS.low, DPI_BOUNDS.high) ?? DEFAULT_SHEET.dpi;
	// Missing from anything written before bleed existed, which is no reason to
	// throw away the paper size somebody chose on purpose.
	const bleedMm = numberWithin(value['bleedMm'], BLEED_BOUNDS.low, BLEED_BOUNDS.high) ?? 0;
	if (kind === 'stock') {
		const stock = value['stock'];
		if (!isStockId(stock)) return undefined;
		const orientation = value['orientation'] === 'landscape' ? 'landscape' : 'portrait';
		return { kind: 'stock', stock, orientation, dpi, bleedMm };
	}
	if (kind === 'millimetres') {
		const widthMm = numberWithin(value['widthMm'], MM_BOUNDS.low, MM_BOUNDS.high);
		const heightMm = numberWithin(value['heightMm'], MM_BOUNDS.low, MM_BOUNDS.high);
		if (widthMm === undefined || heightMm === undefined) return undefined;
		return { kind: 'millimetres', widthMm, heightMm, dpi, bleedMm };
	}
	return undefined;
};

const parseFraming = (value: unknown): Framing | undefined => {
	if (!isRecord(value)) return undefined;
	if (value['by'] === 'zoom') {
		const zoom = numberWithin(value['zoom'], ZOOM_BOUNDS.low, ZOOM_BOUNDS.high);
		return zoom === undefined ? undefined : { by: 'zoom', zoom };
	}
	if (value['by'] === 'scale') {
		const denominator = numberWithin(value['scale'], 1, 10_000_000);
		return denominator === undefined ? undefined : { by: 'scale', scale: scale(denominator) };
	}
	return undefined;
};

/**
 * Untrusted JSON, possibly written by an older build or edited by hand.
 *
 * The size is the one field worth refusing over, because a sheet is what the
 * whole setup is about and there is no sensible stand-in for one that will not
 * parse. Everything else falls back, the way `parseConfiguration` does next door:
 * somebody who saved a setup and gets the paper and the elements back is better
 * served than somebody told the lot is broken because a zoom was out of range.
 *
 * An empty furniture list is kept as empty. Switching every element off is a
 * thing the panel lets you do on purpose, so it has to round-trip.
 */
export const parsePrintSettings = (value: unknown): PrintSettings | undefined => {
	if (!isRecord(value)) return undefined;
	const sheet = parseSheet(value['sheet']);
	if (sheet === undefined) return undefined;
	const stored = value['furniture'];
	const kept = new Set<unknown>(Array.isArray(stored) ? stored : []);
	return {
		sheet,
		framing: parseFraming(value['framing']) ?? DEFAULT_FRAMING,
		furniture: Array.isArray(stored)
			? FURNITURE_IDS.filter((id) => kept.has(id))
			: DEFAULT_FURNITURE
	};
};

/** What the sheet is on paper. Absent for a raster, which is none of these things. */
export interface PaperPlan {
	/** The whole page, trim plus bleed on every side. The PDF's MediaBox. */
	readonly pageMm: Millimetres;
	/** The card once it is cut out. The PDF's TrimBox, and equal to pageMm at no bleed. */
	readonly trimMm: Millimetres;
	readonly bleedMm: number;
	readonly scale: ScaleDenominator;
	/**
	 * Dots per inch the raster actually lands at once it is stretched over the
	 * page, which is the requested density carrying the rounding of a whole
	 * number of pixels. A3 at 200dpi is 2339 dots across 297 mm, so 200.04.
	 * Measured across the trim, because that is the sheet the ratio is a ratio of.
	 */
	readonly printedDpi: number;
}

/**
 * Everything the export needs, resolved once. The renderer, both composers and
 * the crop overlay read this rather than each deriving pixels and resolution
 * again and disagreeing by a rounding.
 *
 * Geometry is in output pixels throughout, because that is the one unit both a
 * sheet of paper and a raster have.
 */
export interface SheetPlan {
	/** The raster, bleed included. What the renderer draws and the file holds. */
	readonly widthPx: number;
	readonly heightPx: number;
	/** How far in from each edge the sheet is cut. Zero on a raster and at no bleed. */
	readonly bleedPx: number;
	/** Keep-out inside the trim, so furniture clears both the cut and the laminate weld. */
	readonly safePx: number;
	readonly unitPx: number;
	/**
	 * Zoom in the live map's terms: one output pixel of the sheet covers the
	 * ground of one CSS pixel on screen at this zoom. The renderer offsets it by
	 * its own pixel ratio; see `renderZoom`.
	 */
	readonly zoom: number;
	readonly groundMetresPerPixel: number;
	readonly groundWidthM: number;
	readonly groundHeightM: number;
	readonly paper: PaperPlan | undefined;
	/** Past the canvas ceiling, so the export would come back clamped and stretched. */
	readonly oversized: boolean;
}

/** WebKit refuses a canvas past this many pixels, and A3 at 300dpi is 4% over it. */
export const CANVAS_PIXEL_CAP = 16_777_216;

export const exceedsCanvasCap = (sheet: Sheet): boolean => {
	const { width, height } = sheetPixels(sheet);
	return width * height > CANVAS_PIXEL_CAP;
};

/**
 * Mercator scale varies across a sheet, so the ratio is exact only at the centre
 * latitude this is given. At 42N on A3 at 1:2000 the variation is 0.05 mm across
 * 840 m of paper, a fraction of what a laser printer's own registration drifts,
 * so it is measured at the centre and not modelled.
 */
export const planSheet = (sheet: Sheet, framing: Framing, latitudeDeg: number): SheetPlan => {
	const { width, height } = sheetPixels(sheet);
	const trim = trimPixels(sheet);
	const trimMm = trimSizeMm(sheet);
	const page = pageSizeMm(sheet);
	// The requested density, corrected for the raster being a whole number of
	// pixels. Measure the ratio against what lands on the card, not what was asked
	// for, or a 1:2000 sheet prints at 1:1999.6 and the bar beside it disagrees.
	const printedDpi = trimMm === undefined ? 200 : trim.width / (trimMm.widthMm / MM_PER_INCH);
	const metresPerPixel =
		framing.by === 'zoom'
			? zoomResolution(framing.zoom, latitudeDeg)
			: groundMetresPerPixel(framing.scale, printedDpi);
	const unit = unitPixels(sheet);
	return {
		widthPx: width,
		heightPx: height,
		bleedPx: bleedPixels(sheet),
		safePx: SAFE_UNITS * unit,
		unitPx: unit,
		zoom: zoomForResolution(metresPerPixel, latitudeDeg),
		groundMetresPerPixel: metresPerPixel,
		groundWidthM: width * metresPerPixel,
		groundHeightM: height * metresPerPixel,
		paper:
			trimMm === undefined || page === undefined
				? undefined
				: {
						pageMm: page,
						trimMm,
						bleedMm: sheet.kind === 'pixels' ? 0 : sheet.bleedMm,
						scale: scaleForResolution(metresPerPixel, printedDpi),
						printedDpi
					},
		oversized: width * height > CANVAS_PIXEL_CAP
	};
};

/** The finished card in output pixels, measured in from the raster's edges. */
export const trimWidthPx = (plan: SheetPlan): number => plan.widthPx - 2 * plan.bleedPx;
export const trimHeightPx = (plan: SheetPlan): number => plan.heightPx - 2 * plan.bleedPx;

/**
 * The MapLibre zoom to set on the print map.
 *
 * MapLibre's zoom is metres per CSS pixel and `pixelRatio` multiplies the
 * drawing buffer under it, so a sheet rendered at ratio 2 needs a zoom one lower
 * to put the ground where the plan says. Printing at ratio 2 is deliberate: it
 * is what makes map labels and line weights land thick enough to read on
 * laminate, at the cost of styling the sheet as if it were one zoom wider.
 */
export const renderZoom = (plan: SheetPlan, pixelRatio: number): number =>
	plan.zoom - Math.log2(pixelRatio);

/**
 * The same framing expressed as a zoom, for the moment a sheet stops being
 * paper. A scale is a ratio between paper and ground, so it means nothing on a
 * raster; the conversion runs through the outgoing sheet, whose density is still
 * known, rather than leaving behind a ratio nothing can honour.
 */
export const asZoomFraming = (framing: Framing, sheet: Sheet, latitudeDeg: number): Framing =>
	framing.by === 'zoom'
		? framing
		: { by: 'zoom', zoom: planSheet(sheet, framing, latitudeDeg).zoom };
