import { asset } from '$app/paths';
import type {
	DataDrivenPropertyValueSpecification,
	ExpressionSpecification,
	LayerSpecification,
	StyleSpecification
} from 'maplibre-gl';
import { HABITATS, SUBSTRATES } from '$lib/domain/habitat';
import { POSITION_SOURCES, positionLayers } from '$lib/geo/style-layers';
export { PALETTE } from './palette.ts';
import { PALETTE } from './palette.ts';
import { type IsobathStyle, type LayerId, markerLayerId } from '$lib/domain/card';
import type { DiveFeatureKind } from '$lib/domain/osm';
import type { Locale } from '$lib/i18n/locale';
import {
	DISC_KINDS,
	KEY_KINDS,
	LABEL_ONLY_KINDS,
	MARKERS,
	MARKER_DISC_IMAGE,
	MARKER_INK,
	MARKER_RIM,
	MINOR_KINDS,
	markerHalo,
	markerImageId
} from './markers.ts';
import { LAND_SOURCE, LAND_SOURCE_ID, landLayers } from './land.ts';
import { UNSURVEYED_TEXTURE } from './textures.ts';

/**
 * The seabed drawn as painted terrain, in the grammar of the texture pack it is
 * painted with. Three things stack to make depth legible without reading a
 * number: the habitat texture is the ground, the hillshade is the light falling
 * on it, and the depth veil is the water column between the diver and it. The
 * veil is transparent at the surface and near-opaque at 80 m, which is what
 * actually happens to light in water, so shallow reads sharp and warm and deep
 * reads blue and far away.
 *
 * Isobaths sit above the veil so they stay readable at depth, and the five
 * depths a recreational dive plan turns on are drawn heavier than the rest.
 */

/**
 * The water column, as a colour-relief ramp over the DEM. Stops are elevation in
 * metres, so negative underwater. Alpha, not hue, carries the depth: tinting a
 * painted texture blue without also veiling it just makes it look dirty.
 *
 * The curve is deliberately slack above 30 m. Measured over Tamariu at z16, the
 * seabed textures carry a luminance spread of 71.6 on their own; the first curve
 * cut that to 27.8, which is where the ground stops reading as ground. Divers
 * spend their dive between 5 and 40 m, so that band keeps its texture and the
 * veil does its receding work below 40.
 *
 * The -95 stop is what stops the veil drawing where there is no DEM. An absent
 * texel is read as RGB 0,0,0, and under the Mapbox encoding that decodes to
 * -10000 m, which used to clamp to the deepest colour on the ramp. Harbour
 * basins, river mouths and every other hole the bathymetry skips came out as
 * near-black water beside the shore because of it. The survey bottoms out at
 * -80.73 m over the whole coast, so anything past -95 is missing, not deep.
 */
const DEPTH_VEIL: ExpressionSpecification = [
	'interpolate',
	['linear'],
	['elevation'],
	-95,
	'rgba(0, 0, 0, 0)',
	-90,
	'rgba(0, 42, 62, 0.84)',
	-80,
	'rgba(0, 56, 80, 0.74)',
	-50,
	'rgba(2, 79, 119, 0.52)',
	-40,
	'rgba(2, 90, 130, 0.38)',
	-30,
	'rgba(4, 107, 150, 0.24)',
	-18,
	'rgba(10, 143, 155, 0.14)',
	-5,
	'rgba(35, 201, 172, 0.05)',
	0,
	'rgba(42, 217, 180, 0)',
	0.01,
	'rgba(0, 0, 0, 0)'
];

/**
 * code -> texture image id, built from the catalogues so the two cannot drift.
 * An object lookup rather than a 60-branch match: one literal instead of a
 * variadic tuple, and it types without a cast.
 *
 * Both catalogues go in, with the layer's own winning on a collision. The
 * substrate layer returns 30509, 30512 and 30513 for 37% of its features, and
 * those seagrass classes exist only in the habitat catalogue; without the
 * fallback every Posidonia and Cymodocea bed would render as bare sand.
 */
const patternFor = (
	ground: 'habitats' | 'substrate'
): DataDrivenPropertyValueSpecification<string> => {
	const lookup: Record<string, string> = {};
	const ordered = ground === 'habitats' ? [SUBSTRATES, HABITATS] : [HABITATS, SUBSTRATES];
	for (const catalogue of ordered) {
		for (const c of catalogue) {
			if (c.code !== undefined) lookup[c.code] = c.texture;
		}
	}
	return ['coalesce', ['get', ['get', 'code'], ['literal', lookup]], 'ch_sand'];
};

/**
 * Lines a dive plan turns on, drawn heavier. `to-number` is not decoration:
 * match type-checks its input, so a depth that arrives as a string falls
 * silently through to the thin branch.
 */
const heavyIf = (
	emphasised: readonly number[],
	heavy: number,
	light: number
): ExpressionSpecification => [
	'match',
	['to-number', ['get', 'depth']],
	[...emphasised],
	heavy,
	light
];

/**
 * Depth bands, keyed to what a recreational dive plan actually turns on. Each
 * band ramps from light to dark across its own range and then jumps at the
 * boundary, so a diver reads the band at a glance and the exact metre on the
 * heavy line. Depths are whole metres, so the 0.99 stops make the jump hard
 * rather than a one-metre fade.
 */
export const DEPTH_BANDS: readonly {
	readonly from: number;
	readonly to: number;
	readonly light: string;
	readonly dark: string;
}[] = [
	{ from: 0, to: 4, light: '#ffe9b0', dark: '#f5c96a' },
	{ from: 5, to: 17, light: '#93e9c0', dark: '#35c48e' },
	{ from: 18, to: 29, light: '#7ad2ff', dark: '#2b9fe4' },
	{ from: 30, to: 39, light: '#9aabff', dark: '#4b63d8' },
	{ from: 40, to: 49, light: '#c9a0ff', dark: '#8c4fd8' },
	{ from: 50, to: 79, light: '#ff9fb6', dark: '#e04a6c' },
	{ from: 80, to: 140, light: '#ff7a6b', dark: '#9b2418' }
];

/**
 * The wash over water the DEM never reached. It is the void colour, so the open
 * sea that was already empty out there composites back to exactly itself, and
 * habitat that carries on past the survey reads as deep water rather than as a
 * bright shelf.
 */
const BEYOND_WASH = 'rgba(3, 41, 59, 0.8)';

const isobathColour = (): DataDrivenPropertyValueSpecification<string> => {
	const stops = DEPTH_BANDS.flatMap((b) => [b.from, b.light, b.to + 0.99, b.dark]);
	return [
		'interpolate',
		['linear'],
		['to-number', ['get', 'depth']],
		...stops
	] as DataDrivenPropertyValueSpecification<string>;
};

const isobathWidth = (
	emphasised: readonly number[]
): DataDrivenPropertyValueSpecification<number> => [
	'interpolate',
	['linear'],
	['zoom'],
	10,
	heavyIf(emphasised, 0.9, 0.3),
	14,
	heavyIf(emphasised, 2.0, 0.7),
	18,
	heavyIf(emphasised, 4.4, 1.4)
];

/**
 * The tiles carry every metre. Filtering the interval here rather than baking it
 * means the side panel can change it with no new data, and an emphasised depth
 * survives an interval that would otherwise drop it.
 */
const AUTO_INTERVAL: ExpressionSpecification = ['step', ['zoom'], 20, 12, 10, 14, 5, 15, 2, 16, 1];

const isobathFilter = ({
	intervalM,
	autoInterval,
	emphasised,
	maxDepthM
}: IsobathStyle): ExpressionSpecification => [
	'all',
	['<=', ['to-number', ['get', 'depth']], maxDepthM],
	// 0 m is the coastline, not a depth contour. It has its own layer and its own
	// switch, and leaving it in here drew it twice, once under the interval rules
	// that can thin it out.
	['!=', ['to-number', ['get', 'depth']], 0],
	[
		'any',
		['in', ['to-number', ['get', 'depth']], ['literal', [...emphasised]]],
		[
			'==',
			['%', ['to-number', ['get', 'depth']], autoInterval ? AUTO_INTERVAL : Math.max(1, intervalM)],
			0
		]
	]
];

export interface StyleOptions {
	readonly locale: Locale;
	readonly isobaths: IsobathStyle;
	readonly visible: readonly LayerId[];
	/** Substrate instead of habitat in the ground layer. They occupy the same slot. */
	readonly groundLayer: 'habitats' | 'substrate';
	/** Off shows the survey's own 10m raster staircase, which is what it actually measured. */
	readonly smoothed: boolean;
}

const vis = (options: StyleOptions, id: LayerId): 'visible' | 'none' =>
	options.visible.includes(id) ? 'visible' : 'none';

/**
 * Both grounds are always in the style and only one is visible.
 *
 * Swapping one layer's `source` between the two looked tidier and did not work:
 * MapLibre's style diff cannot express a source change on an existing layer, so
 * switching from habitats to seafloor type silently did nothing. Visibility is
 * something the diff handles, and it keeps both sets of tiles warm for the switch
 * back.
 */
const groundLayers = (options: StyleOptions): LayerSpecification[] =>
	(['habitats', 'substrate'] as const).flatMap((ground) =>
		([true, false] as const).flatMap((smooth): LayerSpecification[] => {
			const visibility =
				options.groundLayer === ground &&
				options.visible.includes(ground) &&
				options.smoothed === smooth
					? 'visible'
					: 'none';
			const suffix = smooth ? '' : '-raw';
			const source = `${ground}${suffix}`;
			return [
				{
					id: `ground-${ground}${suffix}-fill`,
					type: 'fill',
					source,
					'source-layer': ground,
					layout: { visibility },
					paint: {
						'fill-pattern': patternFor(ground),
						'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 13, 0.92]
					}
				},
				{
					id: `ground-${ground}${suffix}-edge`,
					type: 'line',
					source,
					'source-layer': ground,
					layout: { visibility, 'line-join': 'round' },
					paint: {
						'line-color': PALETTE.terrainEdgeSoft,
						'line-blur': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 18, 5],
						'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 18, 5],
						// The survey admits 40% per-class accuracy and 75% purity, so the
						// edge is a soft shadow rather than a hard line. Certainty the data
						// does not have would be a lie a diver could act on.
						'line-opacity': 0.7
					}
				}
			];
		})
	);

/** Every ground fill, for anything that queries what is under a point. */
export const GROUND_FILL_LAYERS = [
	'ground-habitats-fill',
	'ground-substrate-fill',
	'ground-habitats-raw-fill',
	'ground-substrate-raw-fill'
] as const;

const isKind = (...kinds: readonly string[]): ExpressionSpecification => [
	'in',
	['get', 'kind'],
	['literal', [...kinds]]
];

/**
 * Per-kind switches ride the same visible set as every other layer, so a card
 * prints exactly the markers the screen showed. A kind is dropped by filtering it
 * out of its group rather than by hiding a layer of its own, which keeps ten
 * switches down to four layers.
 */
const shown = (
	options: StyleOptions,
	kinds: readonly DiveFeatureKind[]
): readonly DiveFeatureKind[] =>
	kinds.filter((kind) => options.visible.includes(markerLayerId(kind)));

/** The image is 32 CSS pixels wide at size 1, so these are marks of 22 to 40 pixels. */
const MARKER_SIZE: DataDrivenPropertyValueSpecification<number> = [
	'interpolate',
	['linear'],
	['zoom'],
	10,
	0.7,
	14,
	0.95,
	18,
	1.25
];

/**
 * kind -> value as one object lookup rather than a variadic `match`. Same reason
 * as `patternFor`: it is a single literal instead of a tuple TypeScript cannot
 * prove is well formed, and it stays valid when every kind in a group is
 * switched off and the list is empty.
 */
const byKind = (
	kinds: readonly DiveFeatureKind[],
	value: (kind: DiveFeatureKind) => string,
	fallback: string
): DataDrivenPropertyValueSpecification<string> => {
	const lookup: Record<string, string> = {};
	for (const kind of kinds) lookup[kind] = value(kind);
	return ['coalesce', ['get', ['get', 'kind'], ['literal', lookup]], fallback];
};

const byNumberKind = (
	kinds: readonly DiveFeatureKind[],
	value: (kind: DiveFeatureKind) => number,
	fallback: number
): DataDrivenPropertyValueSpecification<number> => {
	const lookup: Record<string, number> = {};
	for (const kind of kinds) lookup[kind] = value(kind);
	return ['coalesce', ['get', ['get', 'kind'], ['literal', lookup]], fallback];
};

/**
 * One layer per collision group. Key marks are few and must never be dropped;
 * minor ones run to four hundred mooring piles inside a single marina, so they
 * thin out as they crowd instead of painting a mat.
 */
const markerLayer = (
	id: string,
	options: StyleOptions,
	kinds: readonly DiveFeatureKind[],
	{ crowds, minzoom }: { readonly crowds: boolean; readonly minzoom?: number }
): LayerSpecification => ({
	id,
	type: 'symbol',
	source: 'osm',
	...(minzoom === undefined ? {} : { minzoom }),
	filter: isKind(...kinds),
	layout: {
		visibility: vis(options, 'osm'),
		'icon-image': byKind(kinds, markerImageId, MARKER_DISC_IMAGE),
		'icon-size': MARKER_SIZE,
		// A key mark is never dropped, but it still occupies its pixels, so a
		// neighbour's label steps around it rather than landing on top of it.
		'icon-allow-overlap': !crowds,
		'icon-ignore-placement': false,
		// The dive site outranks the furniture when two marks want the same pixels.
		'symbol-sort-key': ['index-of', ['get', 'kind'], ['literal', [...kinds]]]
	},
	paint: {
		'icon-color': byKind(kinds, (kind) => MARKERS[kind].colour, PALETTE.paper),
		'icon-halo-color': MARKER_INK,
		// MapLibre divides this by icon-size before reading the field, so a constant
		// is a constant on screen. Past 6 the shader draws no halo at all.
		'icon-halo-width': byNumberKind(kinds, (kind) => markerHalo(MARKERS[kind]), 2.2)
	}
});

/**
 * OSM features, drawn as the objects they are rather than as pins. What makes a
 * mark survive a busy texture underneath is the dark halo the distance field
 * gives every glyph, not a plate: see markers.ts for which kind earns which.
 *
 * Restricted areas come first because they are the one thing a diver must see
 * even when everything else is off: a swimming zone is where you may not surface.
 */
const osmLayers = (options: StyleOptions): LayerSpecification[] => {
	const visibility = vis(options, 'osm');
	const labelFont = ['Alegreya Sans Bold'];
	// A place name is only translated when a mapper said so. Falling back to `name`
	// keeps Barda de Fitor as Barda de Fitor in every language, which is what the
	// boat crew actually says.
	const localName: ExpressionSpecification = [
		'coalesce',
		['get', `name:${options.locale}`],
		['get', 'name'],
		['get', 'alt_name'],
		''
	];
	const discs = shown(options, DISC_KINDS);
	const restricted = shown(options, ['restricted-area']);
	return [
		{
			id: 'osm-restricted',
			type: 'fill',
			source: 'osm',
			filter: ['all', ['==', ['geometry-type'], 'Polygon'], isKind(...restricted)],
			layout: { visibility },
			paint: { 'fill-color': MARKERS['restricted-area'].colour, 'fill-opacity': 0.14 }
		},
		{
			id: 'osm-restricted-edge',
			type: 'line',
			source: 'osm',
			filter: ['all', ['==', ['geometry-type'], 'Polygon'], isKind(...restricted)],
			layout: { visibility },
			paint: {
				'line-color': MARKERS['restricted-area'].colour,
				'line-width': 1.6,
				'line-dasharray': [3, 2],
				'line-opacity': 0.8
			}
		},
		{
			id: 'osm-site-area',
			type: 'line',
			source: 'osm',
			filter: [
				'all',
				['==', ['geometry-type'], 'Polygon'],
				isKind(...shown(options, ['dive-site', 'rock']))
			],
			layout: { visibility, 'line-join': 'round' },
			paint: {
				'line-color': PALETTE.paper,
				'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 2.6],
				'line-opacity': 0.75
			}
		},
		{
			// The plate's own shadow, so a dive site reads as a thing lying on the
			// chart rather than a hole punched in it.
			id: 'osm-marker-shadow',
			type: 'circle',
			source: 'osm',
			// Points only. A circle layer draws one circle per vertex, so a dive site
			// mapped as an area would be ringed with shadows along its outline.
			filter: ['all', ['==', ['geometry-type'], 'Point'], isKind(...discs)],
			layout: { visibility },
			paint: {
				'circle-color': 'rgba(10, 8, 5, 0.45)',
				'circle-blur': 0.8,
				'circle-translate': [1.5, 2.5],
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 11, 18, 14]
			}
		},
		{
			// The one circle left on this map. It is an affordance, not a colour
			// carrier: it says this is the thing you came for and you can tap it.
			// Every other kind is its own silhouette on bare ground.
			id: 'osm-marker-disc',
			type: 'symbol',
			source: 'osm',
			filter: isKind(...discs),
			layout: {
				visibility,
				'icon-image': MARKER_DISC_IMAGE,
				'icon-size': MARKER_SIZE,
				'icon-allow-overlap': true,
				'icon-ignore-placement': false
			},
			paint: {
				'icon-color': MARKER_INK,
				'icon-halo-color': MARKER_RIM,
				'icon-halo-width': 1.6
			}
		},
		// Furniture first, then the dive and what threatens it, so a crowded marina
		// never draws over a wreck.
		markerLayer('osm-marker-minor', options, shown(options, MINOR_KINDS), {
			crowds: true,
			minzoom: 11
		}),
		markerLayer('osm-marker-key', options, shown(options, KEY_KINDS), { crowds: false }),
		{
			// A harbour is the one kind with no mark at all. Its name is what anybody
			// is looking for, and a pin at the centroid of a basin points at water.
			id: 'osm-harbour-label',
			type: 'symbol',
			source: 'osm',
			minzoom: 11,
			filter: isKind(...shown(options, LABEL_ONLY_KINDS)),
			layout: {
				visibility,
				'text-field': localName,
				'text-font': labelFont,
				'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 18, 14],
				'text-max-width': 8,
				'text-letter-spacing': 0.05
			},
			paint: {
				'text-color': MARKERS.harbour.colour,
				'text-halo-color': PALETTE.ink,
				'text-halo-width': 1.8,
				'text-opacity': 0.9
			}
		},
		{
			id: 'osm-dive-site-label',
			type: 'symbol',
			source: 'osm',
			filter: isKind(...shown(options, ['dive-site'])),
			layout: {
				visibility,
				'text-field': localName,
				'text-font': labelFont,
				'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 18, 16],
				// Clear of the plate, which grows with the zoom the text does.
				'text-offset': [0, 1.4],
				'text-anchor': 'top',
				'text-max-width': 9,
				'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'maxDepth'], 0]]
			},
			paint: {
				'text-color': PALETTE.paper,
				'text-halo-color': PALETTE.ink,
				'text-halo-width': 1.8
			}
		},
		{
			id: 'osm-dive-site-depth',
			type: 'symbol',
			source: 'osm',
			minzoom: 13,
			filter: ['all', isKind(...shown(options, ['dive-site'])), ['has', 'maxDepth']],
			layout: {
				visibility,
				'text-field': ['concat', '-', ['to-string', ['get', 'maxDepth']], ' m'],
				'text-font': labelFont,
				'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13],
				'text-offset': [0, 2.8],
				'text-anchor': 'top'
			},
			paint: {
				'text-color': PALETTE.buoy,
				'text-halo-color': PALETTE.ink,
				'text-halo-width': 1.6
			}
		},

		{
			id: 'annotation-area',
			type: 'fill',
			source: 'annotations',
			filter: ['==', ['geometry-type'], 'Polygon'],
			layout: { visibility: vis(options, 'annotations') },
			paint: {
				'fill-color': ['coalesce', ['get', 'colour'], PALETTE.brass],
				'fill-opacity': 0.2
			}
		},
		{
			id: 'annotation-line',
			type: 'line',
			source: 'annotations',
			filter: ['!=', ['geometry-type'], 'Point'],
			layout: {
				visibility: vis(options, 'annotations'),
				'line-cap': 'round',
				'line-join': 'round'
			},
			paint: {
				'line-color': ['coalesce', ['get', 'colour'], PALETTE.brass],
				'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 18, 5]
			}
		},
		{
			id: 'annotation-point',
			type: 'circle',
			source: 'annotations',
			filter: ['==', ['geometry-type'], 'Point'],
			layout: { visibility: vis(options, 'annotations') },
			paint: {
				'circle-color': ['coalesce', ['get', 'colour'], PALETTE.brass],
				'circle-stroke-color': PALETTE.ink,
				'circle-stroke-width': 2,
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 18, 9]
			}
		},
		{
			id: 'annotation-label',
			type: 'symbol',
			source: 'annotations',
			filter: ['has', 'label'],
			layout: {
				visibility: vis(options, 'annotations'),
				'text-field': ['get', 'label'],
				'text-font': labelFont,
				'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 18, 15],
				'text-offset': [0, 1.2],
				'text-anchor': 'top',
				'text-max-width': 10
			},
			paint: {
				'text-color': PALETTE.paper,
				'text-halo-color': PALETTE.ink,
				'text-halo-width': 1.8
			}
		}
	];
};

export const buildStyle = (options: StyleOptions): StyleSpecification => ({
	version: 8,
	name: 'Seabed',
	glyphs: asset('/fonts/{fontstack}/{range}.pbf'),
	// Every source declares its real maxzoom. Without it MapLibre keeps asking for
	// tiles above what the archive holds, gets nothing back, and reports no error,
	// so the map simply empties out as you zoom in. A printed card at 1:2000 sits
	// at z18.8, well past every archive here, and came out blank because of it.
	sources: {
		'seabed-dem': {
			type: 'raster-dem',
			url: `pmtiles://${asset('/tiles/seabed-dem.pmtiles')}`,
			encoding: 'mapbox',
			tileSize: 512,
			maxzoom: 14
		},
		isobaths: {
			type: 'vector',
			url: `pmtiles://${asset('/tiles/isobaths.pmtiles')}`,
			maxzoom: 16
		},
		habitats: {
			type: 'vector',
			url: `pmtiles://${asset('/tiles/habitats.pmtiles')}`,
			maxzoom: 15
		},
		substrate: {
			type: 'vector',
			url: `pmtiles://${asset('/tiles/substrate.pmtiles')}`,
			maxzoom: 15
		},
		'habitats-raw': {
			type: 'vector',
			url: `pmtiles://${asset('/tiles/habitats-raw.pmtiles')}`,
			maxzoom: 15
		},
		'substrate-raw': {
			type: 'vector',
			url: `pmtiles://${asset('/tiles/substrate-raw.pmtiles')}`,
			maxzoom: 15
		},
		'dem-edge': { type: 'geojson', data: asset('/data/dem-edge.geojson') },
		coastline: {
			type: 'vector',
			url: `pmtiles://${asset('/tiles/coastline.pmtiles')}`,
			maxzoom: 16
		},
		[LAND_SOURCE_ID]: LAND_SOURCE,
		osm: { type: 'geojson', data: asset('/data/osm.geojson') },
		...POSITION_SOURCES,
		annotations: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
	},
	layers: [
		{ id: 'void', type: 'background', paint: { 'background-color': PALETTE.void } },

		{
			// Where the bathymetry reached but the habitat survey did not. Left bare it
			// showed the background through, which reads as a hole in the map next to
			// the shore and as a stepped cliff at the survey's offshore limit. Hatch is
			// the chart convention for ground nobody has classified, and it is generated
			// rather than taken from the texture pack, so it cannot be read as a class.
			id: 'seabed-unmapped',
			type: 'fill',
			source: 'dem-edge',
			filter: ['==', ['get', 'kind'], 'covered'],
			layout: { visibility: vis(options, options.groundLayer) },
			paint: {
				'fill-pattern': UNSURVEYED_TEXTURE,
				'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 13, 0.92]
			}
		},

		...groundLayers(options),

		{
			id: 'hillshade',
			type: 'hillshade',
			source: 'seabed-dem',
			layout: { visibility: vis(options, 'hillshade') },
			paint: {
				// Low sun from the north-west. A high sun flattens a seabed whose whole
				// relief is a few tens of metres.
				'hillshade-illumination-direction': 315,
				// The Catalan shelf drops maybe 80m over kilometres. At a realistic sun
				// angle and exaggeration the relief is invisible, so both are pushed well
				// past truthful: this layer's job is to say which way is downhill.
				'hillshade-illumination-altitude': 15,
				'hillshade-exaggeration': 1,
				'hillshade-shadow-color': 'rgba(6, 14, 20, 0.7)',
				'hillshade-highlight-color': 'rgba(255, 250, 232, 0.5)',
				'hillshade-accent-color': 'rgba(10, 30, 42, 0.5)'
			}
		},
		{
			id: 'depth-veil',
			type: 'color-relief',
			source: 'seabed-dem',
			layout: { visibility: vis(options, 'depth-tint') },
			paint: { 'color-relief-color': DEPTH_VEIL }
		},
		{
			// The DEM ends offshore at a median 52 m and both the hillshade and the veil
			// read it, so past that boundary habitat paints bare and bright against
			// veiled deep water. Neither layer takes a per-pixel mask, so open sea gets
			// washed in the deep-water colour instead. The wash is the void colour, so
			// water that was already empty out there is unchanged.
			id: 'sea-beyond-dem',
			type: 'fill',
			source: 'dem-edge',
			filter: ['==', ['get', 'kind'], 'beyond'],
			layout: { visibility: vis(options, 'depth-tint') },
			paint: { 'fill-color': BEYOND_WASH }
		},
		{
			// The wash would still meet the veil on one pixel. This lays the same colour
			// along the boundary as a wide blurred line, offset inwards, which spreads
			// the junction over a few hundred metres. The rings are wound with the
			// covered side on the left, which is what makes one negative offset push the
			// band inwards on every ring, holes included.
			id: 'dem-edge-fade',
			type: 'line',
			source: 'dem-edge',
			filter: ['==', ['get', 'kind'], 'edge'],
			layout: { visibility: vis(options, 'depth-tint'), 'line-join': 'round' },
			paint: {
				'line-color': BEYOND_WASH,
				'line-width': 56,
				'line-blur': 40,
				'line-offset': -26
			}
		},

		{
			id: 'isobath-glow',
			type: 'line',
			source: 'isobaths',
			'source-layer': 'isobaths',
			filter: isobathFilter(options.isobaths),
			layout: { visibility: vis(options, 'isobaths'), 'line-join': 'round' },
			paint: {
				'line-color': 'rgba(4, 16, 24, 0.55)',
				'line-blur': 2.2,
				'line-translate': [0, 1.6],
				'line-width': isobathWidth(options.isobaths.emphasised)
			}
		},
		{
			id: 'isobath',
			type: 'line',
			source: 'isobaths',
			'source-layer': 'isobaths',
			filter: isobathFilter(options.isobaths),
			layout: { visibility: vis(options, 'isobaths'), 'line-join': 'round' },
			paint: {
				'line-color': isobathColour(),
				// The heavy lines carry their band's full strength; the metre lines
				// between them stay quiet enough not to become a mat.
				'line-opacity': [
					'match',
					['to-number', ['get', 'depth']],
					[...options.isobaths.emphasised],
					0.95,
					0.45
				],
				'line-width': isobathWidth(options.isobaths.emphasised)
			}
		},
		{
			id: 'isobath-label',
			type: 'symbol',
			source: 'isobaths',
			'source-layer': 'isobaths',
			minzoom: 13,
			filter: [
				'all',
				isobathFilter(options.isobaths),
				['in', ['to-number', ['get', 'depth']], ['literal', [...options.isobaths.emphasised]]]
			],
			layout: {
				visibility: options.isobaths.labels ? vis(options, 'isobaths') : 'none',
				'symbol-placement': 'line',
				'text-field': ['concat', ['to-string', ['get', 'depth']], ' m'],
				'text-font': ['Alegreya Sans Bold'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13],
				'text-letter-spacing': 0.06,
				// A seabed contour is far more sinuous than a road. Measured over Tamariu,
				// 25 degrees places nothing at all out of 408 candidate contours and 90
				// places labels on four of the five emphasised depths.
				'text-max-angle': 90,
				'symbol-spacing': 140
			},
			paint: {
				'text-color': PALETTE.paper,
				'text-halo-color': PALETTE.isobathMajor,
				'text-halo-width': 1.6
			}
		},

		{
			id: 'land',
			type: 'fill',
			source: 'coastline',
			'source-layer': 'land',
			layout: { visibility: vis(options, 'coastline') },
			paint: { 'fill-color': PALETTE.land }
		},
		{
			// A whisper of rock so the shore is not a flat plate, at an opacity that
			// keeps land quieter than the seabed it frames.
			id: 'land-texture',
			type: 'fill',
			source: 'coastline',
			'source-layer': 'land',
			layout: { visibility: vis(options, 'coastline') },
			paint: { 'fill-pattern': 'ch_rock', 'fill-opacity': 0.16 }
		},

		// Land detail rides the coastline switch rather than one of its own. The
		// land fill is what it is drawn on, so a river with the land turned off
		// would hang over open water, and the two can only sensibly move together.
		...landLayers({ visible: options.visible.includes('coastline') }),

		{
			// The real surveyed shoreline. Stroking the land polygon instead would draw
			// the synthetic inland closure and the straight cuts at the French and
			// Valencian borders as if they were coast.
			id: 'shoreline',
			type: 'line',
			source: 'coastline',
			'source-layer': 'coastline',
			layout: { visibility: vis(options, 'coastline'), 'line-join': 'round' },
			paint: {
				'line-color': PALETTE.landEdge,
				'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 18, 3.5]
			}
		},
		{
			// ICGC's coastline product contains no island geometry, so Illes Medes and
			// the rest come from the 0 m isobath instead and have no line to draw.
			// Stroke their polygon or the most dived site in Catalonia has no edge.
			id: 'island-edge',
			type: 'line',
			source: 'coastline',
			'source-layer': 'land',
			filter: ['==', ['get', 'src'], 'isobata-0m'],
			layout: { visibility: vis(options, 'coastline'), 'line-join': 'round' },
			paint: {
				'line-color': PALETTE.landEdge,
				'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 18, 3.5]
			}
		},

		{
			// The coastline, as the survey itself drew it. The habitat and substrate
			// polygons were cut against the 0 m isobath, so this is the one line the
			// painted ground is guaranteed to meet, and it is the line the land fill
			// is the inside of. Its own switch, on by default, because a diver reading
			// a shore entry wants to see exactly where the water starts.
			id: 'zero-isobath-glow',
			type: 'line',
			source: 'isobaths',
			'source-layer': 'isobaths',
			filter: ['==', ['to-number', ['get', 'depth']], 0],
			layout: { visibility: vis(options, 'zero-isobath'), 'line-join': 'round' },
			paint: {
				'line-color': 'rgba(8, 20, 28, 0.75)',
				'line-blur': 2,
				'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 14, 4.5, 18, 8]
			}
		},
		{
			id: 'zero-isobath',
			type: 'line',
			source: 'isobaths',
			'source-layer': 'isobaths',
			filter: ['==', ['to-number', ['get', 'depth']], 0],
			layout: { visibility: vis(options, 'zero-isobath'), 'line-join': 'round' },
			paint: {
				'line-color': '#ffe9b0',
				'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2, 18, 4]
			}
		},

		...osmLayers(options),

		// Always last and always visible: tracking is switched by emptying the
		// sources, so turning it on does not rebuild the style.
		...positionLayers()
	]
});
