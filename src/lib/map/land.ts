import type {
	DataDrivenPropertyValueSpecification,
	ExpressionSpecification,
	LayerSpecification,
	SourceSpecification
} from 'maplibre-gl';
import { asset } from '$app/paths';
import { PALETTE } from './palette.ts';
import { LAND_TEXTURE } from './textures.ts';

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

export const WORLD_SOURCE_ID = 'world';

/**
 * Stops at z11 on purpose. Above it the survey covers the screen and the ICGC
 * coastline is the line being read; this only has to hold up where that one is
 * not there, and MapLibre overzooms the rest.
 */
export const WORLD_SOURCE: SourceSpecification = {
	type: 'vector',
	url: `pmtiles://${asset('/tiles/world.pmtiles')}`,
	maxzoom: 11
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
): ExpressionSpecification => [
	'coalesce',
	['get', ['get', 'kind'], ['literal', { ...cases }]],
	fallback
];

const numberByKind = (
	cases: Readonly<Record<string, number>>,
	fallback: number
): ExpressionSpecification => [
	'coalesce',
	['get', ['get', 'kind'], ['literal', { ...cases }]],
	fallback
];

const isKind = (...kinds: readonly string[]): ExpressionSpecification => [
	'in',
	['get', 'kind'],
	['literal', [...kinds]]
];

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

/**
 * Road weight, by how much of the coast a line is meant to carry.
 *
 * A path is thinner than a residential street and more use than one, because a
 * path is how a diver walks to a shore entry, so it gets the higher opacity of
 * the two. That is the whole reason paths are on this map.
 */
const ROAD_WIDTH: DataDrivenPropertyValueSpecification<number> = [
	'interpolate',
	['linear'],
	['zoom'],
	11,
	numberByKind({ major: 0.9, road: 0.55 }, 0.4),
	14,
	numberByKind({ major: 2.3, road: 1.4, street: 0.8 }, 0.75),
	18,
	numberByKind({ major: 5, road: 3, street: 1.8 }, 1.5)
];

const ROAD_OPACITY: ExpressionSpecification = numberByKind(
	{ major: 0.85, road: 0.7, street: 0.48, track: 0.55, path: 0.62, steps: 0.62 },
	0.5
);

export interface LandOptions {
	readonly visible: boolean;
	/**
	 * What a flat base fill is multiplied by so the ortophoto under it can be seen.
	 * 1 with the photograph off, 0 at full strength. Only the fills that are a flat
	 * colour take it: the shoreline, the roads and the rivers are what a diver reads
	 * the photograph with, so they keep their weight.
	 */
	readonly photoFade: number;
}

const visibility = ({ visible }: LandOptions): 'visible' | 'none' => (visible ? 'visible' : 'none');

/**
 * The land outside the survey, so the map does not end in a straight line.
 *
 * Fully zoomed out, which is now where the map opens, Catalonia was a grey
 * rectangle with three ruler-straight edges: the cuts at the French and
 * Valencian borders, and the synthetic inland closure the coastline build draws
 * to shut the mainland polygon. None of the three is a coast and all three read
 * as one, which made the first thing anyone saw look like a torn page.
 *
 * This is not a basemap under the map. It is the same painted land continued, in
 * the same fill and the same rock at the same opacity. The pipeline slides it
 * four kilometres in under the ICGC polygon rather than butting the two together,
 * because tippecanoe simplifies a shared edge independently in each tile and at
 * the zoom the map opens at that is kilometres of wander. The overlap is always
 * inland of the coastline, so none of it can show.
 * See pipeline/scripts/build_world_tiles.sh.
 */
export const worldLayers = (options: LandOptions): LayerSpecification[] => {
	const layout = { visibility: visibility(options) } as const;
	return [
		{
			id: 'world-land',
			type: 'fill',
			source: WORLD_SOURCE_ID,
			'source-layer': 'land',
			layout,
			// Same reason as the surveyed land: its outline pass runs along the seam
			// under Catalonia as well as along the coast, and `world-coast` draws the
			// only part of that boundary anybody should see.
			paint: {
				'fill-color': PALETTE.land,
				'fill-opacity': options.photoFade,
				'fill-antialias': false
			}
		},
		{
			// The same whisper of rock as the surveyed land. A fill pattern is laid out
			// in world space rather than per polygon, so the grain runs straight across
			// the border without anything lining it up.
			id: 'world-land-texture',
			type: 'fill',
			source: WORLD_SOURCE_ID,
			'source-layer': 'land',
			layout,
			// Antialias off for the same reason as the surveyed land's rock: the
			// outline pass lays the pattern down a second time and draws a bright
			// hairline round every edge of it.
			paint: {
				'fill-pattern': LAND_TEXTURE,
				'fill-opacity': 0.16 * options.photoFade,
				'fill-antialias': false
			}
		},
		{
			// Only the real coast: the pipeline drops the stretch of this boundary that
			// is the seam against the ICGC land, which would otherwise draw a shoreline
			// straight down the middle of the Pyrenees, and the frame edge with it.
			id: 'world-coast',
			type: 'line',
			source: WORLD_SOURCE_ID,
			'source-layer': 'coast',
			layout: { ...layout, 'line-join': 'round' },
			paint: {
				'line-color': PALETTE.landEdge,
				'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 18, 3.5],
				// A step under the surveyed shore, which is the one this map is about.
				'line-opacity': 0.8
			}
		}
	];
};

/**
 * The sandy parts of the shore, painted with the seabed's own sand.
 *
 * Borrowing a habitat texture is a category error everywhere else on this map,
 * and here it is the point. The sand on the beach and the sand in the shallows
 * are the same sand, and a diver walking a shore entry is watching one turn into
 * the other. Painting them alike says so, and it is the only place the land and
 * the seabed are allowed to share a mark.
 *
 * Starts at z12. A beach is a thin strip and at any wider view it is a smear.
 */
export const landSandLayers = (options: LandOptions): LayerSpecification[] => {
	const base = {
		type: 'fill',
		source: LAND_SOURCE_ID,
		'source-layer': 'sand',
		minzoom: 12,
		layout: { visibility: visibility(options) }
	} as const;
	return [
		{
			...base,
			id: 'land-sand',
			paint: {
				'fill-color': PALETTE.landSand,
				'fill-opacity': 0.85 * options.photoFade,
				'fill-antialias': false
			}
		},
		{
			...base,
			id: 'land-sand-texture',
			paint: {
				'fill-pattern': 'ch_sand',
				// Slight, as asked. Enough grain to read as sand rather than as a
				// coloured patch, not enough to compete with the lit sand offshore.
				'fill-opacity': [
					'interpolate',
					['linear'],
					['zoom'],
					12,
					0.26 * options.photoFade,
					16,
					0.42 * options.photoFade
				],
				'fill-antialias': false
			}
		}
	];
};

/**
 * Fresh water inside the coastline.
 *
 * This is the half of the land detail a diver reads for a reason rather than for
 * orientation. A river mouth is why the visibility at a site is bad after rain,
 * and a lagoon behind a beach is why the entry silts. Everything else on land is
 * context; this is cause.
 *
 * Slots above the land fill, inside the polygon it is drawn on, so a river mouth
 * stops where the land does and nothing here can spill into the sea.
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

/**
 * The network people move on, in one ink.
 *
 * Split into three layers only because `line-dasharray` cannot vary per feature
 * the way width and opacity can. The split is by how the line is broken, not by
 * what it means: solid for anything surfaced, a long dash for a track, a fine
 * dot for a footpath. Nothing here is a second colour, which is what keeps a
 * dense coastal town from reading as a bright patch beside the water.
 *
 * Roads sit above the rivers they cross, because a bridge is the top thing at a
 * crossing and drawing it under the water reads as a ford.
 */
export const landRoadLayers = (options: LandOptions): LayerSpecification[] => {
	const base = {
		type: 'line',
		source: LAND_SOURCE_ID,
		'source-layer': 'road',
		minzoom: DETAIL_MINZOOM
	} as const;
	const paint = {
		'line-color': PALETTE.landInk,
		'line-width': ROAD_WIDTH,
		'line-opacity': ROAD_OPACITY
	} as const;
	const layout = { visibility: visibility(options), 'line-join': 'round' } as const;
	return [
		{
			...base,
			id: 'land-road',
			filter: isKind('major', 'road', 'street'),
			layout: { ...layout, 'line-cap': 'round' },
			paint
		},
		{
			...base,
			id: 'land-track',
			filter: isKind('track'),
			layout: { ...layout, 'line-cap': 'butt' },
			// In units of the line's own width, so the dash keeps its proportions as
			// the line thickens with zoom instead of turning into a solid line.
			paint: { ...paint, 'line-dasharray': [3, 2] }
		},
		{
			...base,
			id: 'land-path',
			filter: isKind('path', 'steps'),
			layout: { ...layout, 'line-cap': 'round' },
			paint: { ...paint, 'line-dasharray': [0.1, 2.2] }
		}
	];
};

/** Every land layer, in the order a brush would lay them down. */
export const landLayers = (options: LandOptions): LayerSpecification[] => [
	...landSandLayers(options),
	...landWaterLayers(options),
	...landRoadLayers(options)
];

/** For anything that wants to know whether the land tiles actually drew. */
export const LAND_LAYER_IDS: readonly string[] = [
	'land-sand',
	'land-sand-texture',
	'land-water',
	'land-water-edge',
	'land-waterway',
	'land-road',
	'land-track',
	'land-path'
];
