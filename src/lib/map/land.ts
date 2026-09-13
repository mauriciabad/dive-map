import type {
	DataDrivenPropertyValueSpecification,
	ExpressionSpecification,
	LayerSpecification,
	SourceSpecification
} from 'maplibre-gl';
import { asset } from '$app/paths';
import { PALETTE } from './palette.ts';

/**
 * What is drawn inside the coastline, and how quiet it stays.
 *
 * The land exists to frame the sea. A diver is here to read the bottom, so
 * nothing on this side of the shore may pull an eye off it. The rule that follows
 * from that, and the one thing to keep if everything else here is rewritten: land
 * detail is separated by hue and by weight, never by brightness. Nothing drawn
 * inland may be brighter than the seabed, because the seabed is the subject and
 * the eye goes to the brightest thing in the frame whatever the intent was.
 *
 * The other half of staying quiet is knowing when to appear at all. The tiles
 * carry land detail only within 3, 8 or 30 km of the shore, depending on the zoom
 * the layer starts at, and every gate below is the zoom at which the view reaches
 * less far inland than the strip that feeds it. That is what stops a clipped
 * strip ever showing its own inner edge. See pipeline/scripts/osm_land.py.
 */

export const LAND_SOURCE_ID = 'land';

export const LAND_SOURCE: SourceSpecification = {
	type: 'vector',
	url: `pmtiles://${asset('/tiles/land.pmtiles')}`,
	maxzoom: 15
};

/**
 * Where land detail starts. A zoom below it the coast is 116 km across on a
 * laptop, where a network of lines is grey felt rather than information and the
 * 30 km strip would show its own inner edge. z11 is the first zoom whose view
 * reaches less far inland than that strip carries.
 */
const DETAIL_MINZOOM = 11;

/**
 * kind -> value as one object lookup rather than a variadic `match`, for the same
 * reason `style.ts` does it: a single literal instead of a tuple TypeScript cannot
 * prove is well formed, and it stays valid when the list is empty.
 *
 * Typed as an expression rather than as a property value on purpose. The property
 * union still carries MapLibre's legacy `{ type, stops }` function form, which is
 * not a valid argument to `interpolate`, so a lookup declared that way cannot be
 * nested inside a zoom ramp. An expression can be, and is still a property value.
 */
const colourByKind = (
	cases: Readonly<Record<string, string>>,
	fallback: string
): ExpressionSpecification => ['coalesce', ['get', ['get', 'kind'], ['literal', { ...cases }]], fallback];

const numberByKind = (
	cases: Readonly<Record<string, number>>,
	fallback: number
): ExpressionSpecification => ['coalesce', ['get', ['get', 'kind'], ['literal', { ...cases }]], fallback];

const WATERWAY_WIDTH: DataDrivenPropertyValueSpecification<number> = [
	'interpolate',
	['linear'],
	['zoom'],
	11,
	numberByKind({ river: 0.9 }, 0.5),
	14,
	numberByKind({ river: 2.2, canal: 1.1 }, 0.8),
	18,
	numberByKind({ river: 5.4, canal: 2.6 }, 1.8)
];

export interface LandOptions {
	readonly visible: boolean;
}

const visibility = ({ visible }: LandOptions): 'visible' | 'none' => (visible ? 'visible' : 'none');

/**
 * Fresh water inside the coastline.
 *
 * This is the half of the land detail a diver reads for a reason rather than for
 * orientation. A river mouth is why the visibility at a site is bad after rain,
 * and a lagoon behind a beach is why the entry silts. Everything else on land is
 * context; this is cause.
 *
 * Slots between the land fill and the shoreline, so the drawn coast stays the
 * sharpest edge on the map and nothing here can spill past it.
 */
export const landWaterLayers = (options: LandOptions): LayerSpecification[] => {
	const layout = { visibility: visibility(options) } as const;
	return [
		{
			id: 'land-water',
			type: 'fill',
			source: LAND_SOURCE_ID,
			'source-layer': 'water',
			minzoom: DETAIL_MINZOOM,
			layout,
			paint: {
				// Flat colour, never a seabed texture: those carry habitat meaning and a
				// lake has no habitat class. See palette.ts for why it is not the void
				// colour, which was the first answer and the wrong one.
				'fill-color': colourByKind({ wetland: PALETTE.landMarsh }, PALETTE.landWaterFill),
				'fill-opacity': 0.75
			}
		},
		{
			// The fill alone disappears into the land at the size most of these are.
			// The rim is what makes a farm reservoir read as water at a glance.
			id: 'land-water-edge',
			type: 'line',
			source: LAND_SOURCE_ID,
			'source-layer': 'water',
			minzoom: DETAIL_MINZOOM,
			layout: { ...layout, 'line-join': 'round' },
			paint: {
				'line-color': colourByKind({ wetland: PALETTE.landMarshEdge }, PALETTE.landWater),
				'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 18, 1.6],
				'line-opacity': 0.42
			}
		},
		{
			id: 'land-waterway',
			type: 'line',
			source: LAND_SOURCE_ID,
			'source-layer': 'waterway',
			minzoom: DETAIL_MINZOOM,
			layout: { ...layout, 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': PALETTE.landWater,
				'line-width': WATERWAY_WIDTH,
				// A river is a line you follow to its mouth, because a mouth is why the
				// visibility at a site is bad. An irrigation canal is not, and there are
				// hundreds of them across the Baix Ter plain.
				'line-opacity': numberByKind({ river: 0.6, canal: 0.3 }, 0.3)
			}
		}
	];
};

/** Every land layer, in the order a brush would lay them down. */
export const landLayers = (options: LandOptions): LayerSpecification[] => [
	...landWaterLayers(options)
];

/** For anything that wants to know whether the land tiles actually drew. */
export const LAND_LAYER_IDS: readonly string[] = ['land-water', 'land-water-edge', 'land-waterway'];
