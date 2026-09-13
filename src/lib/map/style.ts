import { asset } from '$app/paths';
import type {
	DataDrivenPropertyValueSpecification,
	ExpressionSpecification,
	FilterSpecification,
	LayerSpecification,
	Map as MapLibre,
	LineLayerSpecification,
	PropertyValueSpecification,
	RasterSourceSpecification,
	StyleSpecification
} from 'maplibre-gl';
import {
	type Ground,
	HABITATS,
	NO_TEXTURE_CHOICES,
	SUBSTRATES,
	type TextureChoices,
	textureOf
} from '$lib/domain/habitat';
import { POSITION_SOURCES, positionLayers } from '$lib/geo/style-layers';
export { PALETTE } from './palette.ts';
import { PALETTE } from './palette.ts';
import {
	DEFAULT_LAND_PAINT,
	DEFAULT_SEABED_PAINT,
	type IsobathStyle,
	type LayerId,
	type PaintLevel,
	markerLayerId
} from '$lib/domain/card';
import {
	AUTO_INTERVAL,
	DEPTH_BANDS,
	type PaintedBand,
	depthMarks,
	paintedBands
} from '$lib/domain/isobaths';
import type { DiveFeatureKind } from '$lib/domain/osm';
import type { Locale } from '$lib/i18n/locale';
import {
	PLATE_KINDS,
	KEY_KINDS,
	LABEL_ONLY_KINDS,
	MARKERS,
	MARKER_CLOSE,
	MARKER_PLATE_IMAGE,
	MARKER_HALO,
	MARKER_INK,
	MARKER_PLATE,
	MARKER_RIM,
	MINOR_KINDS,
	markerFrom,
	markerHalo,
	markerImageId
} from './markers.ts';
import {
	LAND_SOURCE,
	LAND_SOURCE_ID,
	WORLD_SOURCE,
	WORLD_SOURCE_ID,
	landLayers,
	worldLayers
} from './land.ts';
import {
	FLOURISH_TEXTURE,
	GROUND_FALLBACK_TEXTURE,
	LAND_TEXTURE,
	UNSURVEYED_TEXTURE
} from './textures.ts';

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
 * Both catalogues go in, with the layer's own winning on a collision. Each returns
 * a few codes only the other defines, and 30509, 30512 and 30513 are published by
 * both: seagrass on habitats, and on substrate the ground the survey reads under
 * the meadow. The order is what keeps each layer answering its own question.
 */
const patternFor = (
	ground: 'habitats' | 'substrate',
	chosen: TextureChoices
): DataDrivenPropertyValueSpecification<string> => {
	const lookup: Record<string, string> = {};
	const ordered = ground === 'habitats' ? [SUBSTRATES, HABITATS] : [HABITATS, SUBSTRATES];
	for (const catalogue of ordered) {
		for (const c of catalogue) lookup[c.code] = textureOf(c, chosen);
	}
	return ['coalesce', ['get', ['get', 'code'], ['literal', lookup]], GROUND_FALLBACK_TEXTURE];
};

/**
 * Lines a dive plan turns on, drawn heavier. `to-number` is not decoration:
 * match type-checks its input, so a depth that arrives as a string falls
 * silently through to the thin branch.
 *
 * Not every marked depth is one of them. A mark a diver has unticked keeps its
 * colour and loses its weight, which is the whole of what unticking it means.
 */
const heavyIf = (heavy: readonly number[], wide: number, thin: number): ExpressionSpecification => [
	'match',
	['to-number', ['get', 'depth']],
	[...heavy],
	wide,
	thin
];

const heavyDepths = (style: IsobathStyle): readonly number[] =>
	depthMarks(style)
		.filter((mark) => mark.emphasised)
		.map((mark) => mark.depthM);

/**
 * The wash over water the DEM never reached. It is the void colour, so the open
 * sea that was already empty out there composites back to exactly itself, and
 * habitat that carries on past the survey reads as deep water rather than as a
 * bright shelf.
 */
const BEYOND_WASH = 'rgba(3, 41, 59, 0.8)';

export const SATELLITE_SOURCE_ID = 'satellite';
export const ICGC_TERRITORIAL_SOURCE_ID = 'satellite-icgc-territorial';
export const ICGC_SATELLITE_SOURCE_ID = 'satellite-icgc';
export const ICGC_BATHYMETRY_SOURCE_ID = 'satellite-icgc-bathymetry';

/**
 * PNOA Máxima Actualidad, the national ortophoto. It covers the whole Spanish
 * coast down to 25 cm and serves to z20 at Tamariu. It is the backing
 * photograph, not the one this map is about.
 *
 * The INSPIRE WMS rather than the WMTS at the same host, and that is the whole
 * point of it. PNOA is flown over land, so it has nothing over the sea, and the
 * WMTS answers for the sea anyway: a 256 px opaque JPEG of flat near-black, a
 * different shade per tile. Measured off Begur at z14, three sea tiles came back
 * at luminance 7.8, 7.6 and 28.1, which is what put a black rectangle with a
 * visible tile grid over the water the moment a diver switched the photograph
 * on, in the half of the map they are here for.
 *
 * The WMS with `transparent=true` answers the same three tiles with a 334-byte
 * fully transparent PNG, and `image/vnd.jpeg-png` keeps the JPEG where there is
 * something to send: 15.6 KB over Begur against the WMTS's 17.9 KB. Which is the
 * same arrangement the ICGC layer above already runs on, for the same reason.
 * Over twelve land tiles it is also the faster of the two, at a median 455 ms
 * against 581 ms, so the tile cache was not buying anything either.
 *
 * Neither source here is ours. Neither is precached: the service worker ignores
 * every cross-origin request, so an area saved for the boat holds the survey and
 * not somebody else's photograph.
 */
const SATELLITE_TILES =
	'https://www.ign.es/wms-inspire/pnoa-ma?service=WMS&request=GetMap&version=1.1.1' +
	'&layers=OI.OrthoimageCoverage&styles=&srs=EPSG:3857' +
	'&format=image/vnd.jpeg-png&transparent=true' +
	'&width=256&height=256&bbox={bbox-epsg-3857}';

/**
 * ICGC's Ortofoto de Catalunya, the whole territory at 25 cm.
 *
 * `orto-costa` above is a ribbon along the shore and nothing else, which is what
 * put an IGN photograph on screen every time the map was not pointed at the
 * water. Measured at the camera this map had last been left on, a field outside
 * Palafrugell about 4 km inland, all 35 `orto-costa` tiles the screen asked for
 * came back as the 334-byte transparent no-data PNG, and the whole view was
 * PNOA while the credit line still read ICGC. The same tile from this service is
 * a 16.9 KB JPEG. Off Tamariu it is 19.0 KB and over the Medes 20.8 KB, so it
 * carries the coast as well and only loses to `orto-costa` on resolution.
 *
 * Same `image/vnd.jpeg-png` contract as its two neighbours, and that is what lets
 * three photographs stack: measured at 334 bytes fully transparent over open sea
 * and over France, so it covers Catalonia and hands the rest back to PNOA.
 *
 * `maxzoom` is 19 against the other two at 20 because 25 cm is the grain. At this
 * latitude z19 is 0.22 m a pixel and z20 is 0.11, so a z20 request is the server
 * resampling its own 25 cm source. MapLibre stretching its z19 tile gets there
 * from the same pixels without the round trip, and on the coast `orto-costa` is
 * the layer answering at those zooms anyway.
 */
const ICGC_TERRITORIAL_TILES =
	'https://geoserveis.icgc.cat/servei/catalunya/orto-territorial/wms?service=WMS' +
	'&request=GetMap&version=1.1.1&layers=ortofoto_color_vigent&styles=&srs=EPSG:3857' +
	'&format=image/vnd.jpeg-png&transparent=true' +
	'&width=256&height=256&bbox={bbox-epsg-3857}';

/**
 * ICGC's Ortofoto de costa, the finest photograph this map has and the one it
 * wants wherever the coast is on screen.
 *
 * It is flown by the body that made the bathymetry underneath it, on the same
 * campaigns, so the shoreline in the picture and the 0 m isobath are the same
 * survey rather than two that disagree by a few metres. 10 cm over most of the
 * coast and 5 cm over the 2022 bathymetry strip, against PNOA's 25 cm.
 *
 * WMS and not WMTS. The WMTS service at the same host answers GetCapabilities
 * with a 500 and its RESTful templates return HTML, which is what sent an earlier
 * attempt to IGN instead. `orto-costa` is the aggregate layer over the whole
 * dated series, so it resolves to the most recent flight that covers a given
 * pixel without this style naming a year that will go stale.
 *
 * `image/vnd.jpeg-png` is what makes it an overlay rather than a replacement.
 * MapServer returns JPEG where the strip is opaque, about 20 KB a tile, and a
 * 334-byte fully transparent PNG everywhere it has no coverage. So along the
 * coast this is the picture, and away from it the territorial ICGC photograph
 * below shows through untouched. Measured at Tamariu z16 through z20.
 *
 * What that transparency does not do is reach inland, and it is not meant to.
 * PNOA underneath carries the land. This layer carries the water, which is the
 * half of the map a diver came for.
 */
const ICGC_SATELLITE_TILES =
	'https://geoserveis.icgc.cat/servei/catalunya/orto-costa/wms?service=WMS' +
	'&request=GetMap&version=1.1.1&layers=orto-costa&styles=&srs=EPSG:3857' +
	'&format=image/vnd.jpeg-png&transparent=true' +
	'&width=256&height=256&bbox={bbox-epsg-3857}';

/**
 * The 2022 bathymetry flight out of the same coastal series, at 5 cm, and the
 * finest photograph on this map by a factor of two.
 *
 * `orto-costa` above is the aggregate over every dated flight, so it answers
 * anywhere on the coast but at whatever grain that stretch was last flown at,
 * usually 10 cm. This is the single campaign that was flown alongside the
 * bathymetry the seabed is drawn from, so the picture and the depth model are
 * one survey rather than two that disagree.
 *
 * It covers less than the aggregate and that is the trade the owner asked for.
 * Measured at z16 it answers 90 KB at Tamariu, 166 KB over the Medes, 127 KB at
 * Llafranc, 112 KB at Palamós and 70 KB at Cap de Creus, and the 334-byte
 * transparent no-data PNG at Sitges and anywhere inland. So it carries the dive
 * coast and hands everything else to PNOA below.
 *
 * `maxzoom` is 21 rather than the 20 its neighbours stop at because 5 cm is the
 * grain: at this latitude z21 is 0.055 m a pixel, which is the source's own
 * resolution and not a resample. Checked at Tamariu, z21 comes back a 13.9 KB
 * JPEG rather than an empty tile.
 */
const ICGC_BATHYMETRY_TILES =
	'https://geoserveis.icgc.cat/servei/catalunya/orto-costa/wms?service=WMS' +
	'&request=GetMap&version=1.1.1&layers=orto-costa-rgb-5cm-202206-202207-batimetria' +
	'&styles=&srs=EPSG:3857&format=image/vnd.jpeg-png&transparent=true' +
	'&width=256&height=256&bbox={bbox-epsg-3857}';

/**
 * The extent both ICGC services declare, and the same rectangle for each. Outside
 * Catalonia neither has anything to answer with, so there is nothing to ask for.
 */
const ICGC_BOUNDS: [number, number, number, number] = [
	0.024303, 40.061468, 3.360594, 43.400669
];

/**
 * A photograph is identified by the one string that is its source id, its layer
 * id and the key a picker stores, so the three cannot drift apart.
 */
export type PhotographId =
	| typeof SATELLITE_SOURCE_ID
	| typeof ICGC_TERRITORIAL_SOURCE_ID
	| typeof ICGC_SATELLITE_SOURCE_ID
	| typeof ICGC_BATHYMETRY_SOURCE_ID;

export interface Photograph {
	readonly id: PhotographId;
	readonly tiles: string;
	readonly maxzoom: number;
	/** Absent means the service answers anywhere on earth, which only PNOA does. */
	readonly bounds?: [number, number, number, number];
	readonly attribution: string;
	/** Ground resolution. A picker has to be able to say what the trade is. */
	readonly grain: string;
}

/**
 * Every photograph this map can draw, coarsest first, because a later entry
 * paints over an earlier one and that ordering is the whole feature.
 *
 * All four answer a tile they have nothing for with a 334-byte fully transparent
 * PNG rather than a blank rectangle, which is what `image/vnd.jpeg-png` buys and
 * what lets any subset of them stack: the screen resolves per pixel to the finest
 * photograph in the chosen set that actually has one.
 */
export const PHOTOGRAPHS: readonly Photograph[] = [
	{
		id: SATELLITE_SOURCE_ID,
		tiles: SATELLITE_TILES,
		maxzoom: 20,
		attribution:
			'<a href="https://pnoa.ign.es/" target="_blank" rel="noopener">PNOA</a> cedido por © Instituto Geográfico Nacional de España',
		grain: '25 cm'
	},
	{
		id: ICGC_TERRITORIAL_SOURCE_ID,
		tiles: ICGC_TERRITORIAL_TILES,
		maxzoom: 19,
		bounds: ICGC_BOUNDS,
		attribution:
			'<a href="https://www.icgc.cat/" target="_blank" rel="noopener">ICGC</a> ortofoto de Catalunya, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>',
		grain: '25 cm'
	},
	{
		id: ICGC_SATELLITE_SOURCE_ID,
		tiles: ICGC_SATELLITE_TILES,
		maxzoom: 20,
		bounds: ICGC_BOUNDS,
		attribution:
			'<a href="https://www.icgc.cat/" target="_blank" rel="noopener">ICGC</a> ortofoto de costa, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>',
		grain: '10 cm'
	},
	{
		id: ICGC_BATHYMETRY_SOURCE_ID,
		tiles: ICGC_BATHYMETRY_TILES,
		maxzoom: 21,
		bounds: ICGC_BOUNDS,
		attribution:
			'<a href="https://www.icgc.cat/" target="_blank" rel="noopener">ICGC</a> ortofoto de costa 5 cm, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>',
		grain: '5 cm'
	}
];

/**
 * Two photographs, and the split between them is the point: PNOA carries the
 * land because it is the only one of the four that has any, and the 5 cm coastal
 * flight carries the water because it is the finest thing flown over it and it
 * shares a survey with the bathymetry underneath.
 *
 * The two 25 cm Catalan layers are left out on purpose. Either one would sit
 * between these and win the land off PNOA at the same grain, for nothing. They
 * stay in `PHOTOGRAPHS` so a diver who wants them can turn them on.
 */
export const DEFAULT_PHOTOGRAPHS: readonly PhotographId[] = [
	SATELLITE_SOURCE_ID,
	ICGC_BATHYMETRY_SOURCE_ID
];

/** The depth ramp, which is what water no marked depth governs is still drawn in. */
const rampColour = (): ExpressionSpecification =>
	[
		'interpolate',
		['linear'],
		['to-number', ['get', 'depth']],
		...DEPTH_BANDS.flatMap((b) => [b.from, b.light, b.to + 0.99, b.dark])
	] as ExpressionSpecification;

/**
 * Every contour in the colour of the band it belongs to, as one step over depth.
 *
 * The bands come from the domain rather than being worked out again here, so the
 * ruler in the side panel and the ink on the map cannot drift apart: they are the
 * same list of runs, drawn twice.
 */
const isobathColour = (style: IsobathStyle): DataDrivenPropertyValueSpecification<string> => {
	const bands = paintedBands(style);
	const paintOf = (band: PaintedBand): string | ExpressionSpecification =>
		band.colour ?? rampColour();
	const first = bands[0];
	if (first === undefined) return rampColour();
	if (bands.length === 1) return paintOf(first);
	return [
		'step',
		['to-number', ['get', 'depth']],
		paintOf(first),
		...bands.slice(1).flatMap((band) => [band.fromM, paintOf(band)])
	] as DataDrivenPropertyValueSpecification<string>;
};

const isobathWidth = (
	heavy: readonly number[],
	extra = 0
): DataDrivenPropertyValueSpecification<number> => [
	'interpolate',
	['linear'],
	['zoom'],
	10,
	heavyIf(heavy, 0.9 + extra, 0.3 + extra),
	14,
	heavyIf(heavy, 2.0 + extra, 0.7 + extra),
	18,
	heavyIf(heavy, 4.4 + extra, 1.4 + extra)
];

/**
 * The dark stroke under every contour, and what the ortophoto does to it.
 *
 * Over the painted seabed it is a soft shadow dropped a pixel and a half, and
 * that is all the separation the palette needs. The depth bands run from #93e9c0
 * to #ff7a6b, luminance 150 to 210, over ground that measures around 60.
 *
 * A photograph puts the same lines over different ground. Sunlit sand in three
 * metres of water is the brightest thing PNOA returns, and the two bands a
 * recreational plan reads most are the palest two in the ramp: 0 to 4 m cream at
 * luminance 230 and 5 to 17 m mint at 213. Those are the contours that vanish.
 *
 * Repainting the bands was the other option and it is the wrong one, because the
 * band colour is the thing that says which depth a diver is looking at without
 * reading a number, and it would change the map for everyone to fix a layer that
 * is off by default. So the shadow becomes a casing instead: centred rather than
 * dropped, near-opaque, and 0.7 px of black proud of the line on each side at
 * every zoom. Every band keeps its own colour and reads it against black.
 *
 * 0.7 and not more. At 1.2 the thin metre contours came out as black threads
 * with a hint of colour in them, because the casing was then wider than the 0.7
 * px line it was carrying. Compared side by side over the photograph at zoom
 * 16.4, 0.7 is the widest casing that still leaves the band colour readable on
 * the lines between the emphasised ones.
 */
const CASING_WIDENING_OVER_PHOTO = 1.4;

const isobathCasing = (options: StyleOptions): NonNullable<LineLayerSpecification['paint']> => {
	const overPhoto = options.visible.includes('satellite');
	return {
		'line-color': overPhoto ? 'rgba(2, 9, 14, 0.92)' : 'rgba(4, 16, 24, 0.55)',
		'line-blur': overPhoto ? 0.6 : 2.2,
		'line-translate': overPhoto ? [0, 0] : [0, 1.6],
		'line-width': isobathWidth(
			heavyDepths(options.isobaths),
			overPhoto ? CASING_WIDENING_OVER_PHOTO : 0
		)
	};
};

/**
 * The tiles carry every metre. Filtering the interval here rather than baking it
 * means the side panel can change it with no new data, and an emphasised depth
 * survives an interval that would otherwise drop it.
 *
 * 0 m is a depth the panel can offer now. It used to be excluded outright on the
 * grounds that it was the coastline rather than a contour, which was true of the
 * line the map drew then and is not true now: the shoreline is this same 0 m
 * contour. So it is excluded only until a diver asks for it, and asking puts it
 * in the contour ink as well as under the coastline switch.
 */
const AUTO_STEP: ExpressionSpecification = [
	'step',
	['zoom'],
	AUTO_INTERVAL[0]?.intervalM ?? 20,
	...AUTO_INTERVAL.slice(1).flatMap((step) => [step.fromZoom, step.intervalM])
] as ExpressionSpecification;

const isobathFilter = ({
	intervalM,
	autoInterval,
	emphasised,
	maxDepthM
}: IsobathStyle): ExpressionSpecification => [
	'all',
	['<=', ['to-number', ['get', 'depth']], maxDepthM],
	// 0 m is drawn when a diver asks for it and not otherwise. Zero is divisible by
	// every interval, so without this it would come back at every setting rather
	// than at the ones that include it, and the shoreline already draws that exact
	// contour under the coastline switch. Asking for it puts it in the contour ink
	// as well, which is the point of offering it.
	...(emphasised.includes(0)
		? []
		: [['!=', ['to-number', ['get', 'depth']], 0] as ExpressionSpecification]),
	[
		'any',
		['in', ['to-number', ['get', 'depth']], ['literal', [...emphasised]]],
		[
			'==',
			['%', ['to-number', ['get', 'depth']], autoInterval ? AUTO_STEP : Math.max(1, intervalM)],
			0
		]
	]
];

/**
 * The three layers the isobath settings own, and the only ones any of those
 * settings can touch.
 *
 * Kept as one function because they are also pushed to a live map on their own,
 * without the style around them. See `applyIsobathLayers`: a diver dragging the
 * interval slider changes these and nothing else, and a rebuild of the whole
 * style for each frame of a drag measured at 100 ms a frame against 0.7 ms for
 * pushing these three.
 */
export const ISOBATH_LAYER_IDS: readonly string[] = ['isobath-glow', 'isobath', 'isobath-label'];

const isobathLayers = (options: StyleOptions): readonly LayerSpecification[] => [
	{
		id: 'isobath-glow',
		type: 'line',
		source: 'isobaths',
		'source-layer': 'isobaths',
		filter: isobathFilter(options.isobaths),
		layout: { visibility: vis(options, 'isobaths'), 'line-join': 'round' },
		paint: isobathCasing(options)
	},
	{
		id: 'isobath',
		type: 'line',
		source: 'isobaths',
		'source-layer': 'isobaths',
		filter: isobathFilter(options.isobaths),
		layout: { visibility: vis(options, 'isobaths'), 'line-join': 'round' },
		paint: {
			'line-color': isobathColour(options.isobaths),
			// The heavy lines carry their band's full strength; the metre lines
			// between them stay quiet enough not to become a mat.
			'line-opacity': [
				'match',
				['to-number', ['get', 'depth']],
				[...heavyDepths(options.isobaths)],
				0.95,
				0.45
			],
			'line-width': isobathWidth(heavyDepths(options.isobaths))
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
			['in', ['to-number', ['get', 'depth']], ['literal', [...heavyDepths(options.isobaths)]]]
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
	}
];

/** Where the isobath layers are pushed when the style itself is not being replaced. */
type PaintProperty = Parameters<MapLibre['setPaintProperty']>[1];
type PaintValue = Parameters<MapLibre['setPaintProperty']>[2];
type LayoutProperty = Parameters<MapLibre['setLayoutProperty']>[1];
type LayoutValue = Parameters<MapLibre['setLayoutProperty']>[2];

export interface LayerWriter {
	readonly filter: (id: string, filter: FilterSpecification | undefined) => void;
	readonly paint: (id: string, property: PaintProperty, value: PaintValue) => void;
	readonly layout: (id: string, property: LayoutProperty, value: LayoutValue) => void;
}

const properties = (
	layer: LayerSpecification
): {
	readonly filter: FilterSpecification | undefined;
	readonly paint: Readonly<Record<string, unknown>>;
	readonly layout: Readonly<Record<string, unknown>>;
} => ({
	filter: 'filter' in layer ? layer.filter : undefined,
	paint: layer.paint ?? {},
	layout: layer.layout ?? {}
});

/** The isobath layers of a built style, which is what a live push works from. */
export const isobathLayersOf = (style: StyleSpecification): readonly LayerSpecification[] =>
	style.layers.filter((layer) => ISOBATH_LAYER_IDS.includes(layer.id));

/**
 * Push what the isobath settings changed straight at the layers, instead of
 * handing MapLibre a whole new style to diff.
 *
 * Only what actually moved is written. A diver dragging the colour picker
 * changes one line colour, and repainting a filter the map already has would
 * throw away every parsed tile in the viewport for nothing. `before` is what was
 * pushed last, or the layers of the style the map was built with; the return
 * value is the new baseline.
 */
export const applyIsobathLayers = (
	into: LayerWriter,
	style: StyleSpecification,
	before: readonly LayerSpecification[] | undefined
): readonly LayerSpecification[] => {
	const layers = isobathLayersOf(style);
	for (const layer of layers) {
		const next = properties(layer);
		const last = before?.find((candidate) => candidate.id === layer.id);
		const old = last === undefined ? undefined : properties(last);
		const changed = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
		if (changed(next.filter, old?.filter)) into.filter(layer.id, next.filter);
		// A name and a value read back off a layer MapLibre built are by construction
		// ones its own setters accept. `Object.entries` is what loses that, not the data.
		for (const [property, value] of Object.entries(next.paint)) {
			if (changed(value, old?.paint[property])) {
				into.paint(layer.id, property as PaintProperty, value as PaintValue);
			}
		}
		for (const [property, value] of Object.entries(next.layout)) {
			if (changed(value, old?.layout[property])) {
				into.layout(layer.id, property as LayoutProperty, value as LayoutValue);
			}
		}
	}
	return layers;
};

export interface StyleOptions {
	readonly locale: Locale;
	readonly isobaths: IsobathStyle;
	readonly visible: readonly LayerId[];
	/** Substrate instead of habitat in the ground layer. They occupy the same slot. */
	readonly groundLayer: 'habitats' | 'substrate';
	/** Off shows the survey's own 10m raster staircase, which is what it actually measured. */
	readonly smoothed: boolean;
	/** A diver's own texture per seabed class. Absent means every class keeps the catalogue's own. */
	readonly textures?: TextureChoices;
	/** How much seabed paint is left over the photograph. Absent is all of it. */
	readonly seabedPaint?: PaintLevel;
	/** How much land paint is left over the photograph. Absent is none of it. */
	readonly landPaint?: PaintLevel;
	/**
	 * Which of `PHOTOGRAPHS` the one `satellite` switch turns on. Absent is
	 * `DEFAULT_PHOTOGRAPHS`. Order here is ignored: the stack always paints in
	 * catalogue order, coarsest under finest, so a picker cannot put a 25 cm
	 * photograph over a 5 cm one by listing it second.
	 */
	readonly photographs?: readonly PhotographId[];
	/**
	 * Whether the `world` source has painted yet. Only the hillshade reads it, and
	 * only because until the land is down that layer lights the DEM's nodata plane
	 * as a hard rectangle over inland Catalonia. Required rather than optional so
	 * that a new caller has to decide: an offscreen map that is captured after it
	 * settles has no race to lose and passes true.
	 */
	readonly worldPainted: boolean;
}

/**
 * What every flat wash on the land side is multiplied by.
 *
 * Turning the photograph on used to change nothing a diver could see, because it
 * sat under four opaque things at once. Measured at Tamariu z15, a land pixel
 * read 13,47,62 against the photograph's own 55,73,72: `sea-beyond-dem` washed it
 * at 0.8 alpha first, because the survey's complement is the whole interior and
 * not just open sea, and then `world-land` and `land` finished it at full
 * opacity. Less than a fifteenth of the photograph survived.
 *
 * `sea-beyond-dem` takes the land level rather than the seabed one for that
 * reason. Its polygon is mostly land, and land is the only place it does harm.
 */
const photoFade = (options: StyleOptions): number =>
	options.visible.includes('satellite') ? (options.landPaint ?? DEFAULT_LAND_PAINT) : 1;

const groundOpacity = (options: StyleOptions): DataDrivenPropertyValueSpecification<number> => {
	const paint = options.visible.includes('satellite')
		? (options.seabedPaint ?? DEFAULT_SEABED_PAINT)
		: 1;
	return ['interpolate', ['linear'], ['zoom'], 9, 0.55 * paint, 13, 0.92 * paint];
};

const vis = (options: StyleOptions, id: LayerId): 'visible' | 'none' =>
	options.visible.includes(id) ? 'visible' : 'none';

/**
 * A photograph draws when the one switch is on and the picker kept it, so asking
 * for the photograph still puts every layer up and down together.
 */
const photographVis = (options: StyleOptions, id: PhotographId): 'visible' | 'none' =>
	vis(options, 'satellite') === 'visible' &&
	(options.photographs ?? DEFAULT_PHOTOGRAPHS).includes(id)
		? 'visible'
		: 'none';

const photographSources = (): Record<string, RasterSourceSpecification> =>
	Object.fromEntries(
		PHOTOGRAPHS.map((photo) => [
			photo.id,
			{
				type: 'raster',
				tiles: [photo.tiles],
				tileSize: 256,
				maxzoom: photo.maxzoom,
				...(photo.bounds === undefined ? {} : { bounds: photo.bounds }),
				attribution: photo.attribution
			} satisfies RasterSourceSpecification
		])
	);

/**
 * Every photograph is in the style and the unpicked ones are merely hidden.
 *
 * Building only the picked layers would be smaller and is the wrong shape:
 * MapLibre's style diff handles a visibility change and cannot express a layer
 * appearing in the middle of the stack, so a picker that adds one back would
 * rebuild the style and drop every warm tile on the screen.
 *
 * Hidden also means unattributed. MapLibre credits a source only while a visible
 * layer uses it, which is what stops the credit line naming ICGC over a picture
 * that is entirely PNOA. That mismatch is what the owner reported.
 */
const photographLayers = (options: StyleOptions): LayerSpecification[] =>
	PHOTOGRAPHS.map((photo) => ({
		id: photo.id,
		type: 'raster',
		source: photo.id,
		layout: { visibility: photographVis(options, photo.id) },
		// Never dimmed. What decides whether a photograph can be seen is how much
		// paint is left over it, and that is what the two paint levels are for.
		// Dimming the picture as well only muddied both.
		paint: { 'raster-opacity': 1 }
	}));

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
						'fill-pattern': patternFor(ground, options.textures ?? NO_TEXTURE_CHOICES),
						'fill-opacity': groundOpacity(options)
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

/** Every ground fill, for anything that queries what is drawn under a point. */
export const GROUND_FILL_LAYERS = [
	'ground-habitats-fill',
	'ground-substrate-fill',
	'ground-habitats-raw-fill',
	'ground-substrate-raw-fill'
] as const;

/**
 * A zero-opacity copy of the ground nobody is looking at. Issues #29 and #39.
 *
 * Two things a tap has to answer that the drawn layer alone cannot. The surveyed
 * depth is the habitat survey's `dmin` and `dmax` per polygon, and the substrate
 * product is a different ICGC layer with no depth field at all, so with Seafloor
 * type showing there was nothing under the pointer carrying one. And the card now
 * names the class in both catalogues, which means reading a layer that is not
 * painted whichever way the switch is set.
 *
 * Baking a depth onto the substrate polygons in the build was the other option and
 * it is the wrong one. The two products do not share a partition, so joining them
 * would report a slightly different range in each mode for the same tap, and what
 * the owner reported is that everything else on the card is identical. Reading
 * both modes off the one survey that measured depth makes them identical by
 * construction.
 *
 * A probe is what makes the query possible: MapLibre will not return features from
 * a layer whose visibility is `none`, so the polygons have to stay rendered to stay
 * queryable. Zero opacity draws nothing and still answers.
 *
 * Both are in the style at every moment so nothing has to check before naming one
 * in a query, and each turns on only where it earns its keep: the probe for the
 * ground being drawn is off, because that ground's own fill already answers, and
 * with the ground switched off entirely there is nothing to answer about.
 */
const probeId = (ground: Ground): string => `ground-${ground}-probe`;

const groundProbeLayers = (options: StyleOptions): LayerSpecification[] =>
	(['habitats', 'substrate'] as const).map((ground) => ({
		id: probeId(ground),
		type: 'fill',
		source: ground,
		'source-layer': ground,
		layout: {
			visibility:
				options.groundLayer !== ground && options.visible.includes(options.groundLayer)
					? 'visible'
					: 'none'
		},
		paint: { 'fill-opacity': 0 }
	}));

/**
 * Which catalogue each layer a tap may query answers for.
 *
 * A code on its own does not name a class: habitat 30202 is circalittoral rock
 * dominated by invertebrates and substrate 30202 is a biogenic reef. The layer a
 * hit came off is the other half of the answer, and this is where the card reads
 * it rather than guessing from the switch.
 */
export const GROUND_BY_LAYER: Readonly<Record<string, Ground>> = {
	'ground-habitats-fill': 'habitats',
	'ground-habitats-raw-fill': 'habitats',
	'ground-substrate-fill': 'substrate',
	'ground-substrate-raw-fill': 'substrate',
	[probeId('habitats')]: 'habitats',
	[probeId('substrate')]: 'substrate'
};

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

/** An expression rather than a property value, so a step can nest one. */
const byNumberKind = (
	kinds: readonly DiveFeatureKind[],
	value: (kind: DiveFeatureKind) => number,
	fallback: number
): ExpressionSpecification => {
	const lookup: Record<string, number> = {};
	for (const kind of kinds) lookup[kind] = value(kind);
	return ['coalesce', ['get', ['get', 'kind'], ['literal', lookup]], fallback];
};

/**
 * A key mark holds its pixels from `MARKER_CLOSE` in and gives way outside it.
 * Out there the whole survey is in one frame and every dive site on the coast is
 * stacked on one headland, so letting a mark drop is what turns that pile back
 * into a spread. See `MARKER_CLOSE` for why the switch cannot sit anywhere else.
 */
const KEY_OVERLAP: PropertyValueSpecification<boolean> = [
	'step',
	['zoom'],
	false,
	MARKER_CLOSE,
	true
];

/**
 * One layer per collision group. Minor marks run to four hundred mooring piles
 * inside a single marina, so they thin out as they crowd instead of painting a
 * mat, at every zoom they are drawn at.
 */
const markerLayer = (
	id: string,
	options: StyleOptions,
	kinds: readonly DiveFeatureKind[],
	{ crowds }: { readonly crowds: boolean }
): LayerSpecification => ({
	id,
	type: 'symbol',
	source: 'osm',
	// A minzoom on the layer is one answer for ten kinds. The table says when
	// each of them starts and the filter reads that per feature. MapLibre
	// evaluates a zoom expression in a filter at integer zooms, which is why
	// every number in that column is a whole one.
	filter: [
		'all',
		isKind(...kinds),
		['>=', ['zoom'], ['coalesce', ['get', ['get', 'kind'], ['literal', markerFrom(kinds)]], 0]]
	],
	layout: {
		visibility: vis(options, 'osm'),
		'icon-image': byKind(kinds, markerImageId, MARKER_PLATE_IMAGE),
		'icon-size': MARKER_SIZE,
		'icon-allow-overlap': crowds ? false : KEY_OVERLAP,
		'icon-ignore-placement': false,
		// The dive site outranks the furniture when two marks want the same pixels.
		'symbol-sort-key': ['index-of', ['get', 'kind'], ['literal', [...kinds]]]
	},
	paint: {
		'icon-color': byKind(kinds, (kind) => MARKERS[kind].colour, PALETTE.paper),
		'icon-halo-color': MARKER_INK,
		// MapLibre divides this by icon-size before reading the field, so a constant
		// is a constant on screen. Past 6 the shader draws no halo at all.
		'icon-halo-width': [
			'step',
			['zoom'],
			MARKER_HALO,
			MARKER_CLOSE,
			byNumberKind(kinds, (kind) => markerHalo(MARKERS[kind]), MARKER_HALO)
		]
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
	const plates = shown(options, PLATE_KINDS);
	// Both kinds of zone have an outline worth drawing and they do not mean the
	// same thing, so each takes its own family colour rather than sharing a paint.
	const zones = shown(options, ['restricted-area', 'marine-reserve', 'swimming-area']);
	return [
		{
			id: 'osm-restricted',
			type: 'fill',
			source: 'osm',
			filter: ['all', ['==', ['geometry-type'], 'Polygon'], isKind(...zones)],
			layout: { visibility },
			paint: {
				'fill-color': byKind(zones, (kind) => MARKERS[kind].colour, PALETTE.paper),
				'fill-opacity': 0.14
			}
		},
		{
			id: 'osm-restricted-edge',
			type: 'line',
			source: 'osm',
			filter: ['all', ['==', ['geometry-type'], 'Polygon'], isKind(...zones)],
			layout: { visibility },
			paint: {
				'line-color': byKind(zones, (kind) => MARKERS[kind].colour, PALETTE.paper),
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
			// A circle is never dropped, so out where the glyphs thin out this would
			// leave a blur under every site whose mark gave way.
			minzoom: MARKER_CLOSE,
			// Points only. A circle layer draws one circle per vertex, so a dive site
			// mapped as an area would be ringed with shadows along its outline.
			filter: ['all', ['==', ['geometry-type'], 'Point'], isKind(...plates)],
			layout: { visibility },
			paint: {
				'circle-color': 'rgba(10, 8, 5, 0.45)',
				'circle-blur': 0.8,
				'circle-translate': [1.5, 2.5],
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 11, 18, 14]
			}
		},
		{
			// The red field of the diver-down flag, under the stripe that crosses it.
			// The only kind on this map with anything behind its glyph: it says this
			// is the thing you came for and you can tap it. Every other kind is its
			// own silhouette on bare ground.
			id: 'osm-marker-plate',
			type: 'symbol',
			source: 'osm',
			minzoom: MARKER_CLOSE,
			filter: isKind(...plates),
			layout: {
				visibility,
				'icon-image': MARKER_PLATE_IMAGE,
				'icon-size': MARKER_SIZE,
				'icon-allow-overlap': true,
				'icon-ignore-placement': false
			},
			paint: {
				'icon-color': MARKER_PLATE,
				'icon-halo-color': MARKER_RIM,
				'icon-halo-width': 1.6
			}
		},
		// Furniture first, then the dive and what threatens it, so a crowded marina
		// never draws over a wreck.
		markerLayer('osm-marker-minor', options, shown(options, MINOR_KINDS), { crowds: true }),
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
			// Nineteen names over two hundred kilometres of coast was a list, not a
			// map. A name arrives with the plate, once the frame holds one bay.
			minzoom: MARKER_CLOSE,
			filter: isKind(...shown(options, ['dive-site'])),
			layout: {
				visibility,
				'text-field': localName,
				'text-font': labelFont,
				'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 18, 16],
				// Sixteen dive sites fit in one frame off Medes and their names do not,
				// so seven were dropped and a site at planning zoom had nothing to call
				// it. Nothing else was taking the space: holding the icons off placement
				// changed nothing, and letting the names overlap recovered all sixteen.
				// A single anchor gives a name one slot to fit in, so MapLibre tries
				// these in turn and drops it only when every one of them is taken.
				'text-variable-anchor': [
					'top',
					'bottom',
					'left',
					'right',
					'top-left',
					'top-right',
					'bottom-left',
					'bottom-right'
				],
				// Radial rather than an offset, because the anchor moves: the clearance
				// from the plate has to be a radius rather than a direction.
				'text-radial-offset': 1.3,
				'text-justify': 'auto',
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
		...photographSources(),
		'dem-edge': { type: 'geojson', data: asset('/data/dem-edge.geojson') },
		// Land only, and the land is the inside of the 0 m isobath. The line that
		// bounds it is not in here: it is the 0 m contour in `isobaths`, which is the
		// same geometry unstitched and unsimplified.
		coastline: {
			type: 'vector',
			url: `pmtiles://${asset('/tiles/coastline.pmtiles')}`,
			maxzoom: 16
		},
		[LAND_SOURCE_ID]: LAND_SOURCE,
		[WORLD_SOURCE_ID]: WORLD_SOURCE,
		osm: { type: 'geojson', data: asset('/data/osm.geojson') },
		...POSITION_SOURCES,
		annotations: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
	},
	layers: [
		{ id: 'void', type: 'background', paint: { 'background-color': PALETTE.void } },

		// Under the painted seabed and everything above it, not over. The map's job
		// is still to brief a dive, and an ortophoto laid over the habitat polygons
		// would be a different product. The ground fills run 0.55 to 0.92 opacity, so
		// with both on the photograph reads as what is under the paint; a diver who
		// wants the photograph itself turns the ground layer off, which is the switch
		// that was already there.
		...photographLayers(options),

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
				'fill-opacity': groundOpacity(options)
			}
		},

		...groundLayers(options),
		...groundProbeLayers(options),

		{
			// Held back until the `world` source has painted, because until then this
			// layer lights the DEM's nodata plane as if it were ground.
			//
			// `gdalwarp` writes every cell the survey never reached as 0, and the
			// encoding makes 0 a real, flat 0 m surface, so inland Catalonia comes out
			// as a lit rectangle. Measured on the three tiles that do it, 92.9, 96.1
			// and 98.5 per cent of their cells are that plane against about 1 per cent
			// real land elevation. That is why clipping the DEM to the coastline does
			// not fix it: it would rewrite the 1 per cent and leave the rectangle. A
			// hillshade layer takes no per-pixel mask either.
			//
			// What actually covers the plane is `world-land`, out of a 487 KB archive
			// that loses the race to a 33 MB one on a cold load. So the flash is a
			// race rather than a data problem, and the fix is to not start until the
			// winner is on screen. See issue #22.
			id: 'hillshade',
			type: 'hillshade',
			source: 'seabed-dem',
			// Kept at 9 on its own merit now that the flash is handled above: the
			// opening view sits at 7.56 and the relief says nothing legible there
			// anyway, nine DEM tiles across a whole coastline.
			minzoom: 9,
			layout: { visibility: options.worldPainted ? vis(options, 'hillshade') : 'none' },
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
			// The water column painted as alpha, up to 0.84 at depth.
			//
			// It used to carry its own "off whenever the photograph is on" clause here.
			// That silenced this layer and not `sea-beyond-dem` below, which reads the
			// same switch, so the wash went on painting over the photograph with the
			// switch gone from the panel. `MapState` takes `depth-tint` down when the
			// photograph goes up, so both layers read one answer and this one reads it
			// the same way every other layer does.
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
			// Fades with the photograph because this polygon is the survey's complement,
			// which is open sea and the whole interior alike. Over land it is the first
			// thing that buries the ortophoto.
			paint: { 'fill-color': BEYOND_WASH, 'fill-opacity': photoFade(options) }
		},
		{
			// Wave crests, the way a drawn chart carries them, in the only water this
			// map has nothing to say about. `beyond` is the survey's own complement, so
			// the marks cannot land on a habitat polygon, an isobath or a depth a diver
			// could be briefed on: where there is data there is no decoration, and the
			// boundary between the two is a dataset rather than a judgement.
			//
			// A pattern rather than scattered symbols because a pattern is anchored in
			// world coordinates, so the same view draws the same crests every time and a
			// card reprints identically, with no seed, no hash and no lattice to get
			// wrong. One repeat is 1024 CSS px, which is wider than most screens.
			//
			// `beyond` also covers the land, which is why this rides the coastline
			// switch as well as its own. The opaque land fills above are what keep the
			// crests off Girona, exactly as they keep the wash above off it, and with
			// the coastline off there is no land drawn to hide behind.
			id: 'sea-flourish',
			type: 'fill',
			source: 'dem-edge',
			filter: ['==', ['get', 'kind'], 'beyond'],
			layout: {
				visibility:
					options.visible.includes('flourishes') && options.visible.includes('coastline')
						? 'visible'
						: 'none'
			},
			paint: {
				'fill-pattern': FLOURISH_TEXTURE,
				// Gone by the time anyone is briefing a dive. Decoration belongs to the
				// zooms where the whole coast is the subject, not to the one where a diver
				// is reading a wall off the contours.
				'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.85, 12.5, 0.85, 14.5, 0]
			}
		},

		...isobathLayers(options),

		// Before the surveyed land, so that where the two datasets disagree by a few
		// metres along the Catalan shore the ICGC polygon is the one that wins.
		...worldLayers({
			visible: options.visible.includes('coastline'),
			photoFade: photoFade(options)
		}),

		{
			id: 'land',
			type: 'fill',
			source: 'coastline',
			'source-layer': 'land',
			layout: { visibility: vis(options, 'coastline') },
			paint: {
				'fill-color': PALETTE.land,
				'fill-opacity': photoFade(options),
				// The outline pass draws this same dark fill one pixel wide along the
				// whole polygon boundary, and three sides of that boundary are not coast:
				// they are the cuts at the two borders and the synthetic inland closure.
				// Over the world land outside them that pixel reads 53 against 74 and
				// comes and goes with the tile simplification, which is what drew a dotted
				// rectangle across Aragon. The coast itself is drawn by `shoreline`, so
				// nothing here needs an outline.
				'fill-antialias': false
			}
		},
		{
			// A whisper of rock so the shore is not a flat plate, at an opacity that
			// keeps land quieter than the seabed it frames.
			id: 'land-texture',
			type: 'fill',
			source: 'coastline',
			'source-layer': 'land',
			layout: { visibility: vis(options, 'coastline') },
			paint: {
				'fill-pattern': LAND_TEXTURE,
				'fill-opacity': 0.16 * photoFade(options),
				// A fill antialiases by drawing its own outline as a second pass, which
				// for a pattern fill lays the rock down twice along the edge. Measured
				// at the minimum zoom that is 46 to 73 inside and 95 on the edge pixel,
				// and the edge in question is not a coast: it is the straight inland
				// rectangle the coastline build draws to close the mainland polygon. It
				// showed as a dotted line across Aragon the moment the map started
				// opening fully zoomed out. The shape is already drawn by the fill under
				// this one, so the outline pass has nothing to contribute.
				'fill-antialias': false
			}
		},

		// Land detail rides the coastline switch rather than one of its own. The
		// land fill is what it is drawn on, so a river with the land turned off
		// would hang over open water, and the two can only sensibly move together.
		...landLayers({
			visible: options.visible.includes('coastline'),
			photoFade: photoFade(options)
		}),

		{
			// The shoreline, drawn from the 0 m isobath rather than from the land
			// polygon under it. Two reasons, and both have been paid for. Stroking the
			// polygon draws the synthetic inland closure and the straight cuts at the
			// French and Valencian borders as if they were coast. And the polygon is a
			// stitched, simplified reading of this contour, where this is the contour
			// itself, including the harbour walls and river channels the stitch walks
			// past and the island rings that used to need a second layer to get drawn.
			id: 'shoreline',
			type: 'line',
			source: 'isobaths',
			'source-layer': 'isobaths',
			filter: ['==', ['to-number', ['get', 'depth']], 0],
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
