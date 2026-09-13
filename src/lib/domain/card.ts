import { DIVE_FEATURE_KINDS, type DiveFeatureKind } from './osm.ts';
import {
	DEFAULT_FRAMING,
	DEFAULT_FURNITURE,
	DEFAULT_SHEET,
	type Framing,
	type FurnitureId,
	type Pixels,
	type Sheet,
	type SheetPlan,
	planSheet,
	trimHeightPx,
	trimWidthPx
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

/**
 * One switch per kind of OSM feature, so a diver can drop the marina's four
 * hundred mooring piles without losing the dive sites. Derived from the kinds
 * rather than typed out, because a kind with no switch would be undroppable and
 * a switch with no kind would be dead.
 */
export type MarkerLayerId = `marker-${DiveFeatureKind}`;

export const markerLayerId = (kind: DiveFeatureKind): MarkerLayerId => `marker-${kind}`;

export type LayerId =
	| 'zero-isobath'
	| 'hillshade'
	| 'depth-tint'
	| 'isobaths'
	| 'habitats'
	| 'substrate'
	| 'satellite'
	| 'flourishes'
	| 'coastline'
	| 'osm'
	| 'annotations'
	| MarkerLayerId;

/**
 * How much of the map's own paint is left on top of the photograph, one level per
 * side of the shore.
 *
 * The photograph itself is never dimmed. It is the bottom of the stack, so the
 * only thing that decides whether a diver can see it is how much paint is left
 * over it, and that is the control the owner asked for: one for the seabed
 * textures, one for the land. 1 is the painted map with the photograph hidden
 * under it, 0 is the photograph on its own.
 *
 * Five steps, and 0 is one of them, because without it there is no way to ask for
 * the photograph and nothing else. A union rather than a number because it makes
 * the panel and the stored blob agree for free: every value the style can be
 * handed is one the panel can show as chosen, and a hand-edited 0.63 is refused
 * at the boundary instead of arriving as a setting no control can display.
 */
export const PAINT_LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;

export type PaintLevel = (typeof PAINT_LEVELS)[number];

/**
 * Where a diver lands when they turn the photograph on.
 *
 * The seabed keeps all of its paint and the land gives all of it up, because
 * those are the two halves of what the switch is for. The survey is the subject
 * of this map and stays authoritative over the water, which is the "marine
 * habitats overlapping the IGN map" the owner asked for. The shore is the half a
 * photograph actually says something about, and a photograph of 30 m of water
 * says nothing. Either is one tap from anything else.
 */
export const DEFAULT_SEABED_PAINT: PaintLevel = 1;
export const DEFAULT_LAND_PAINT: PaintLevel = 0;

export const isPaintLevel = (value: unknown): value is PaintLevel =>
	PAINT_LEVELS.some((step) => step === value);

export interface IsobathStyle {
	/** Draw a line every this many metres. The tiles carry 1 m, the style filters. */
	readonly intervalM: number;
	/**
	 * Let the zoom pick the interval. Every metre at a dive site, coarser when the
	 * whole coast is on screen, where 1 m would be a solid mat of ink. Setting an
	 * interval by hand turns this off.
	 */
	readonly autoInterval: boolean;
	/** Depths drawn heavier. These are the ones a recreational dive plan turns on. */
	readonly emphasised: readonly number[];
	/** Stop drawing below this. Nobody on this boat is going deeper. */
	readonly maxDepthM: number;
	readonly labels: boolean;
}

export const DEFAULT_ISOBATHS: IsobathStyle = {
	intervalM: 5,
	autoInterval: true,
	emphasised: [5, 18, 30, 40, 50],
	maxDepthM: 80,
	labels: true
};

export interface DiveCard {
	readonly id: string;
	/** The name on the sheet. Whatever the person printing it wants it called. */
	readonly title: string;
	readonly subtitle: string | undefined;
	/** The OSM element this card is about, when it is about one. A card may frame open water. */
	readonly osmRef: string | undefined;
	readonly centre: LngLat;
	/** Scale or zoom. Both resolve to one ground resolution; see print.ts. */
	readonly framing: Framing;
	/** Degrees clockwise from north. Rotating the sheet to the reef often beats north-up. */
	readonly bearing: number;
	readonly sheet: Sheet;
	readonly layers: readonly LayerId[];
	readonly furniture: readonly FurnitureId[];
	readonly isobaths: IsobathStyle;
	readonly annotationIds: readonly string[];
}

export const DEFAULT_LAYERS: readonly LayerId[] = [
	'zero-isobath',
	'hillshade',
	'depth-tint',
	'isobaths',
	'habitats',
	'flourishes',
	'coastline',
	'osm',
	'annotations',
	...DIVE_FEATURE_KINDS.map(markerLayerId)
];

export const newCard = (centre: LngLat, title: string): DiveCard => ({
	id: crypto.randomUUID(),
	title,
	subtitle: undefined,
	osmRef: undefined,
	centre,
	framing: DEFAULT_FRAMING,
	bearing: 0,
	sheet: DEFAULT_SHEET,
	layers: DEFAULT_LAYERS,
	furniture: DEFAULT_FURNITURE,
	isobaths: DEFAULT_ISOBATHS,
	annotationIds: []
});

/** Pixels, page size, render zoom and the resolution everything is measured against. */
export const planFor = (card: DiveCard): SheetPlan =>
	planSheet(card.sheet, card.framing, card.centre.lat);

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
 * The sheet and the screen look at the same ground from the same latitude, so
 * the crop is the output raster scaled by the difference between the two zooms.
 * The overlay is axis-aligned on screen and the map rotates under it, which is
 * what dragging to frame a site actually feels like.
 */
export const cropFrame = (plan: SheetPlan, viewportZoom: number, viewport: Pixels): CropFrame => {
	const ratio = 2 ** (viewportZoom - plan.zoom);
	// The trim, not the raster. The box on screen is a promise about the card that
	// comes off the guillotine, and the bleed around it is ground nobody keeps.
	const trimWidth = trimWidthPx(plan);
	const trimHeight = trimHeightPx(plan);
	const widthPx = trimWidth * ratio;
	const heightPx = trimHeight * ratio;
	return {
		widthPx,
		heightPx,
		exportWidthPx: plan.widthPx,
		exportHeightPx: plan.heightPx,
		groundWidthM: trimWidth * plan.groundMetresPerPixel,
		groundHeightM: trimHeight * plan.groundMetresPerPixel,
		overflowsViewport: widthPx > viewport.width || heightPx > viewport.height
	};
};

/**
 * The zoom that makes the crop rectangle fill a given fraction of the viewport,
 * so opening the print panel can frame the sheet sensibly instead of dumping the
 * user at an arbitrary scale.
 */
export const zoomToFitCrop = (plan: SheetPlan, viewport: Pixels, fill = 0.8): number => {
	const ratio = Math.min(
		(viewport.width * fill) / plan.widthPx,
		(viewport.height * fill) / plan.heightPx
	);
	return plan.zoom + Math.log2(ratio);
};

/**
 * Scale bar for the printed sheet: the longest round number of metres that fits
 * in a quarter of the sheet. A bar of 137 m is useless on a boat.
 *
 * Measured in output pixels, which is the one unit a sheet of paper and a raster
 * both have. `printedMm` is what a ruler should read across the bar, and it is
 * there to catch the commonest real-world lie: a printer set to fit-to-page
 * shrinks the sheet by a few percent and says nothing.
 */
const ROUND_METRES: readonly number[] = [
	5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000
];

export interface ScaleBar {
	readonly metres: number;
	readonly lengthPx: number;
	readonly printedMm: number | undefined;
}

export const scaleBar = (plan: SheetPlan, budgetPx = plan.widthPx / 4): ScaleBar => {
	const pxPerMetre = 1 / plan.groundMetresPerPixel;
	const metres = ROUND_METRES.reduce(
		(best, m) => (m * pxPerMetre <= budgetPx ? m : best),
		ROUND_METRES[0] ?? 5
	);
	const lengthPx = metres * pxPerMetre;
	return {
		metres,
		lengthPx,
		printedMm:
			plan.paper === undefined ? undefined : (lengthPx / plan.widthPx) * plan.paper.pageMm.widthMm
	};
};

export const shows = (card: DiveCard, id: FurnitureId): boolean => card.furniture.includes(id);
