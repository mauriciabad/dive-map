import { type ScaleDenominator, scale } from './units.ts';
import {
	DEFAULT_SHEET,
	type Sheet,
	groundCoverageMetres,
	groundMetresPerPixel,
	mapAreaMm,
	pixelSize,
	zoomForScale
} from './print.ts';

/**
 * A card is a saved, reproducible sheet, not an export of whatever the screen
 * happened to show. A dive centre prints a season's book and reprints it when
 * the data or the annotations move, so everything needed to redraw the same
 * sheet lives here.
 */

export interface LngLat {
	readonly lng: number;
	readonly lat: number;
}

export type LayerId =
	| 'hillshade'
	| 'depth-tint'
	| 'isobaths'
	| 'habitats'
	| 'substrate'
	| 'coastline'
	| 'osm'
	| 'annotations';

export interface IsobathStyle {
	/** Draw a line every this many metres. The tiles carry 1 m, the style filters. */
	readonly intervalM: number;
	/** Depths drawn heavier. These are the ones a recreational dive plan turns on. */
	readonly emphasised: readonly number[];
	/** Stop drawing below this. Nobody on this boat is going deeper. */
	readonly maxDepthM: number;
	readonly labels: boolean;
}

export const DEFAULT_ISOBATHS: IsobathStyle = {
	intervalM: 5,
	emphasised: [5, 18, 30, 40, 50],
	maxDepthM: 80,
	labels: true
};

export interface DiveCard {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string | undefined;
	/** The OSM element this card is about, when it is about one. A card may frame open water. */
	readonly osmRef: string | undefined;
	readonly centre: LngLat;
	readonly scale: ScaleDenominator;
	/** Degrees clockwise from north. Rotating the sheet to the reef often beats north-up. */
	readonly bearing: number;
	readonly sheet: Sheet;
	readonly layers: readonly LayerId[];
	readonly isobaths: IsobathStyle;
	readonly annotationIds: readonly string[];
}

export const DEFAULT_LAYERS: readonly LayerId[] = [
	'hillshade',
	'depth-tint',
	'isobaths',
	'habitats',
	'coastline',
	'osm',
	'annotations'
];

export const newCard = (centre: LngLat, title: string): DiveCard => ({
	id: crypto.randomUUID(),
	title,
	subtitle: undefined,
	osmRef: undefined,
	centre,
	scale: scale(2000),
	bearing: 0,
	sheet: DEFAULT_SHEET,
	layers: DEFAULT_LAYERS,
	isobaths: DEFAULT_ISOBATHS,
	annotationIds: []
});

/** Web Mercator ground resolution at zoom 0 on the equator, metres per pixel. */
const EQUATOR_RESOLUTION = 156_543.033_928_041;

/** Ground metres per CSS pixel of the live map at this zoom and latitude. */
export const screenMetresPerPixel = (zoom: number, latitudeDeg: number): number =>
	(EQUATOR_RESOLUTION * Math.cos((latitudeDeg * Math.PI) / 180)) / 2 ** zoom;

export interface CropFrame {
	/** Size of the crop rectangle in CSS pixels of the live map. */
	readonly widthPx: number;
	readonly heightPx: number;
	/** Pixel size of the exported image. */
	readonly exportWidthPx: number;
	readonly exportHeightPx: number;
	/** Ground extent the sheet covers. */
	readonly groundWidthM: number;
	readonly groundHeightM: number;
	/** True when the crop is larger than the viewport, so the framing cannot be seen whole. */
	readonly overflowsViewport: boolean;
}

/**
 * Where the printed sheet lands on the live map, so the overlay can show it.
 *
 * The overlay is axis-aligned on screen and the map rotates under it, which is
 * what dragging to frame a site actually feels like.
 */
export const cropFrame = (
	card: DiveCard,
	viewportZoom: number,
	viewport: { readonly width: number; readonly height: number }
): CropFrame => {
	const mpp = screenMetresPerPixel(viewportZoom, card.centre.lat);
	const ground = groundCoverageMetres(card.sheet, card.scale);
	const widthPx = ground.width / mpp;
	const heightPx = ground.height / mpp;
	const exported = pixelSize(card.sheet);
	return {
		widthPx,
		heightPx,
		exportWidthPx: exported.width,
		exportHeightPx: exported.height,
		groundWidthM: ground.width,
		groundHeightM: ground.height,
		overflowsViewport: widthPx > viewport.width || heightPx > viewport.height
	};
};

/**
 * The zoom that makes the crop rectangle fill a given fraction of the viewport,
 * so opening the print panel can frame the sheet sensibly instead of dumping the
 * user at an arbitrary scale.
 */
export const zoomToFitCrop = (
	card: DiveCard,
	viewport: { readonly width: number; readonly height: number },
	fill = 0.8
): number => {
	const ground = groundCoverageMetres(card.sheet, card.scale);
	const mppNeeded = Math.max(
		ground.width / (viewport.width * fill),
		ground.height / (viewport.height * fill)
	);
	const atLatitude = EQUATOR_RESOLUTION * Math.cos((card.centre.lat * Math.PI) / 180);
	return Math.log2(atLatitude / mppNeeded);
};

/**
 * Scale bar length for the printed sheet: the longest round number of metres
 * that fits in a quarter of the map area. A bar of 137 m is useless on a boat.
 */
const ROUND_METRES: readonly number[] = [
	5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000
];

export const scaleBar = (
	card: DiveCard
): { readonly metres: number; readonly lengthMm: number } => {
	const budgetMm = mapAreaMm(card.sheet).widthMm / 4;
	const mmPerMetre = 1000 / card.scale;
	const metres = ROUND_METRES.reduce(
		(best, m) => (m * mmPerMetre <= budgetMm ? m : best),
		ROUND_METRES[0] ?? 5
	);
	return { metres, lengthMm: metres * mmPerMetre };
};

/** Whether the sheet resolves detail a diver can use, in metres of seabed per printed dot. */
export const groundResolution = (card: DiveCard): number =>
	groundMetresPerPixel(card.scale, card.sheet.dpi);

/** The zoom the export renders at, so the sheet comes out at the scale it claims. */
export const zoomForCard = (card: DiveCard): number =>
	zoomForScale(card.scale, card.centre.lat, card.sheet.dpi);
