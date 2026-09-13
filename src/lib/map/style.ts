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
import {
	HABITAT_POINTS,
	HABITAT_POINT_FROM,
	HABITAT_POINT_SORT,
	habitatPointImageId
} from './habitat-points.ts';
import type { GraftedBaseMap } from './basemap-style.ts';
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
import { type BaseMapId, NO_BASE_MAP, TILE_SERVICES, serviceDraws } from '$lib/domain/basemaps';
import {
	AUTO_INTERVAL,
	DEPTH_BANDS,
	type PaintedBand,
	depthMarks,
	haloOf,
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
	MINOR_KINDS,
	markerFrom,
	markerHalo,
	markerImageId
} from './markers.ts';
import { SPOT_LAYER_ID, SPOT_SOURCE_ID, spotDepthLayers } from './spot-depths.ts';
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
 * How deep the veil is drawn to, and what it has become by then.
 *
 * The survey bottoms out at -80.73 m over the whole coast, so the floor sits a
 * little past it and the deepest real water is never pinned to the end of a ramp.
 */
const VEIL_FLOOR_M = 90;
const VEIL_ALPHA_AT_FLOOR = 0.84;

/**
 * The bend in the curve, and the only number that decides how much texture a
 * diver keeps.
 *
 * Above 1 the veil is slack at the top of the water column and does its receding
 * work at the bottom, which is what the measurement asked for: over Tamariu at
 * z16 the seabed textures carry a luminance spread of 71.6 on their own, and the
 * first curve here cut that to 27.8, where ground stops reading as ground.
 * Divers spend their dive between 5 and 40 m, so that band keeps its texture.
 *
 * 1.14 is where a single curve lands on the measured points: 0.13 at 18 m, 0.24
 * at 30 m, 0.33 at 40 m, 0.73 at 80 m.
 */
const VEIL_CURVE = 1.14;

/** The two ends of the water. Everything between them is worked out, not picked. */
const VEIL_SHALLOW: readonly [number, number, number] = [42, 217, 180];
const VEIL_DEEP: readonly [number, number, number] = [0, 42, 62];

/**
 * How fast each channel gives up, as an exponent on the normalised depth.
 *
 * Red first, green next, blue last, which is the order water absorbs them in and
 * the reason deep water reads blue. Three smooth curves rather than a list of
 * picked colours, so the hue has no corner in it either. They land within a few
 * levels of the colours that were picked by hand at 5, 18, 50 and 80 m, which is
 * how far that hand-tuning is preserved.
 */
const VEIL_FADE: readonly [number, number, number] = [0.5, 0.75, 1.4];

/**
 * The water column, as a colour-relief ramp over the DEM. Stops are elevation in
 * metres, so negative underwater. Alpha, not hue, carries the depth: tinting a
 * painted texture blue without also veiling it just makes it look dirty.
 *
 * One continuous curve of depth, sampled every metre, and that is the point of
 * it. The ramp this replaces was eight hand-placed stops, and its slope changed
 * at 5, 18, 30, 40 and 50 m, which are the depths the map draws isobaths at. The
 * eye reads a slope change as an edge, so the veil grew an edge along every
 * marked contour and the whole thing looked keyed to the isobaths rather than to
 * the depth. Nothing here knows what depths are marked.
 */
const veilAt = (depthM: number): string => {
	const t = depthM / VEIL_FLOOR_M;
	const channel = (index: 0 | 1 | 2): number =>
		Math.round(
			VEIL_SHALLOW[index] + (VEIL_DEEP[index] - VEIL_SHALLOW[index]) * t ** VEIL_FADE[index]
		);
	const alpha = VEIL_ALPHA_AT_FLOOR * t ** VEIL_CURVE;
	return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${alpha.toFixed(3)})`;
};

const veilStops = (): (number | string)[] => {
	const stops: (number | string)[] = [];
	for (let depthM = VEIL_FLOOR_M; depthM >= 0; depthM -= 1) stops.push(-depthM, veilAt(depthM));
	return stops;
};

/**
 * The -95 stop is what stops the veil drawing where there is no DEM. An absent
 * texel is read as RGB 0,0,0, and under the Mapbox encoding that decodes to
 * -10000 m, which used to clamp to the deepest colour on the ramp. Harbour
 * basins, river mouths and every other hole the bathymetry skips came out as
 * near-black water beside the shore because of it. The survey bottoms out at
 * -80.73 m over the whole coast, so anything past -95 is missing, not deep.
 *
 * The 0.01 stop is the same guard at the other end, for land.
 */
const DEPTH_VEIL = [
	'interpolate',
	['linear'],
	['elevation'],
	-95,
	'rgba(0, 0, 0, 0)',
	...veilStops(),
	0.01,
	'rgba(0, 0, 0, 0)'
] as ExpressionSpecification;

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

/**
 * What the national shelf survey is owed for the deep water.
 *
 * Its licence is CC BY 4.0 with one extra clause, that the source is named as the
 * ministry rather than as the survey, so the ministry is what this says. Hung on
 * the sources themselves rather than added to MapView's list, because the credit
 * belongs to two archives and MapLibre already shows a source's own attribution
 * whenever that source is on the map.
 */
const MAPA_CREDIT =
	'<a href="https://www.mapa.gob.es/" target="_blank" rel="noopener">Ministerio de Agricultura, Pesca y Alimentación</a> Cartografiado Marino, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';

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
 * The stroke under every contour, and what the outline switch does to it.
 *
 * Over the painted seabed it is a soft dark shadow dropped a pixel and a half,
 * and that is all the separation the palette needs. The depth bands run from
 * #93e9c0 to #ff7a6b, luminance 150 to 210, over ground that measures around 60.
 *
 * A photograph puts the same lines over ground nobody chose. Repainting the
 * bands to suit it was the other option and it is the wrong one, because the
 * band colour is what says which depth a diver is looking at without reading a
 * number. So the shadow becomes a halo instead: centred rather than dropped, and
 * 0.7 px proud of the line on each side at every zoom.
 *
 * Which stroke is drawn is `halo.on` and nothing else. The base map works that
 * switch rather than this expression, so a diver can keep the outline over the
 * chart or drop it over a photograph and get what they asked for either way.
 *
 * 0.7 and not more. At 1.2 the thin metre contours came out as threads of halo
 * with a hint of colour in them, because the halo was then wider than the 0.7 px
 * line it was carrying. Compared side by side over the photograph at zoom 16.4,
 * 0.7 is the widest halo that still leaves the band colour readable on the lines
 * between the emphasised ones.
 *
 * The colour and strength are the diver's, and `DEFAULT_HALO` says why white at
 * part opacity beat the near-opaque black this started as.
 */
const HALO_WIDENING = 1.4;

const isobathCasing = (options: StyleOptions): NonNullable<LineLayerSpecification['paint']> => {
	const halo = haloOf(options.isobaths);
	return {
		// Opacity as its own property on the outline, so a diver dragging the
		// strength slider changes one number rather than the map rebuilding a colour
		// string. The shadow branch keeps its alpha in the colour, so it asks for 1
		// here: MapLibre multiplies the two.
		'line-color': halo.on ? halo.colour : 'rgba(4, 16, 24, 0.55)',
		'line-opacity': halo.on ? halo.opacity : 1,
		'line-blur': halo.on ? 0.6 : 2.2,
		'line-translate': halo.on ? [0, 0] : [0, 1.6],
		'line-width': isobathWidth(heavyDepths(options.isobaths), halo.on ? HALO_WIDENING : 0)
	};
};

/**
 * The tiles carry every metre. Filtering the interval here rather than baking it
 * means the side panel can change it with no new data, and an emphasised depth
 * survives an interval that would otherwise drop it.
 *
 * 0 m is a marked depth the map ships with. It used to be excluded outright on
 * the grounds that it was the coastline rather than a contour, which was true of
 * the line the map drew then and is not true now: the shoreline is this same 0 m
 * contour. So it is in the contour ink until a diver takes it off the ruler.
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
	// 0 m is drawn while it is marked and not otherwise. Zero is divisible by every
	// interval, so without this a diver who took it off the ruler would get it back
	// at every interval setting.
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
 * The layers a depth setting owns, and the only ones any of those settings can
 * touch.
 *
 * Kept as one function because they are also pushed to a live map on their own,
 * without the style around them. See `applyIsobathLayers`: a diver dragging the
 * interval slider changes these and nothing else, and a rebuild of the whole
 * style for each frame of a drag measured at 100 ms a frame against 0.7 ms for
 * pushing these three.
 *
 * The spot depths are in here because they obey the same maximum depth as the
 * contours and are switched from the same panel, so a diver dragging that limit
 * moves every depth on the map in one push rather than half of them in a push and
 * the rest in a rebuild.
 */
export const ISOBATH_LAYER_IDS: readonly string[] = [
	'isobath-deep-glow',
	'isobath-deep',
	'isobath-deep-label',
	'isobath-glow',
	'isobath',
	'isobath-label',
	SPOT_LAYER_ID
];

/**
 * How much wider the national contours are drawn than the ICGC ones.
 *
 * Those sit on painted habitat with hundreds of neighbours; these sit on the
 * deep-water wash, which is the darkest thing on the map. Everything else about
 * them is the shallow set's expression, unchanged.
 */
const DEEP_WIDENING = 0.3;

/**
 * The national shelf survey's contours, drawn in the water the ICGC one never
 * reached. Issue #41.
 *
 * They are tiled already clipped to that water, so the join is a hard one: ICGC
 * contours stop and these start, with no attempt to stitch a 1 m ladder onto a
 * 5 m one. That is what the owner asked for, and the alternative is inventing
 * agreement between two surveys that measured on different decades and different
 * echo sounders.
 *
 * Every isobath setting reaches them, through the same expressions the ICGC set
 * is drawn with: the interval, the maximum depth, the marks, the colours, the
 * outline and the labels. They used to have a fixed ladder of their own and a
 * fixed rule that the fifties carried the weight, so the panel described half the
 * contours on screen and a diver setting an interval saw it ignored below 50 m.
 *
 * One limit is the archive rather than the expression. It carries five metre
 * steps on the shelf and fifty down the slope, so an interval the archive has no
 * line for draws nothing there. An interval of 2 m gets 50, 60, 70 out here and
 * every metre inshore. That is the data, not a rule, and it is water past any
 * scuba plan.
 */
const deepIsobathLayers = (options: StyleOptions): readonly LayerSpecification[] => [
	{
		id: 'isobath-deep-glow',
		type: 'line',
		source: 'isobaths-deep',
		'source-layer': 'isobaths',
		filter: isobathFilter(options.isobaths),
		layout: { visibility: vis(options, 'isobaths'), 'line-join': 'round' },
		paint: isobathCasing(options)
	},
	{
		id: 'isobath-deep',
		type: 'line',
		source: 'isobaths-deep',
		'source-layer': 'isobaths',
		filter: isobathFilter(options.isobaths),
		layout: { visibility: vis(options, 'isobaths'), 'line-join': 'round' },
		paint: {
			'line-color': isobathColour(options.isobaths),
			// The lines between the marks stay louder than the ICGC ones do, for the
			// same reason they are drawn wider.
			'line-opacity': [
				'match',
				['to-number', ['get', 'depth']],
				[...heavyDepths(options.isobaths)],
				0.95,
				0.8
			],
			'line-width': isobathWidth(heavyDepths(options.isobaths), DEEP_WIDENING)
		}
	},
	{
		id: 'isobath-deep-label',
		type: 'symbol',
		source: 'isobaths-deep',
		'source-layer': 'isobaths',
		minzoom: 10,
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
			'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 18, 13],
			'text-letter-spacing': 0.06,
			'text-max-angle': 90,
			'symbol-spacing': 200
		},
		paint: {
			'text-color': PALETTE.paper,
			'text-halo-color': PALETTE.isobathMajor,
			'text-halo-width': 1.6
		}
	}
];

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
	 * Which borrowed map is under the chart. One id, never a set, so nothing a
	 * diver can press decides which photograph is on top of which: the catalogue
	 * in `$lib/domain/basemaps` owns that order and this only names a choice.
	 */
	readonly baseMap: BaseMapId;
	/**
	 * An archive's own MapLibre style, fetched and made safe to splice in, for the
	 * one base map that publishes one. Drawn instead of that base map's raster
	 * while it is here; see `$lib/map/basemap-style.ts`.
	 */
	readonly graft?: GraftedBaseMap;
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
/** Whether a borrowed map is under the chart, which is what both paint levels answer to. */
const onBaseMap = (options: StyleOptions): boolean => options.baseMap !== NO_BASE_MAP;

const photoFade = (options: StyleOptions): number =>
	onBaseMap(options) ? (options.landPaint ?? DEFAULT_LAND_PAINT) : 1;

const groundOpacity = (options: StyleOptions): DataDrivenPropertyValueSpecification<number> => {
	const paint = onBaseMap(options) ? (options.seabedPaint ?? DEFAULT_SEABED_PAINT) : 1;
	return ['interpolate', ['linear'], ['zoom'], 9, 0.55 * paint, 13, 0.92 * paint];
};

const vis = (options: StyleOptions, id: LayerId): 'visible' | 'none' =>
	options.visible.includes(id) ? 'visible' : 'none';

/** Whether the grafted vector style is the thing drawing the chosen base map. */
const graftDraws = (options: StyleOptions): boolean => options.graft?.id === options.baseMap;

/**
 * A tile service draws when the chosen base map lists it, and the catalogue's
 * order decides which of two sits on top. Nothing here can reorder them.
 *
 * The one exception is a base map whose own vector style has arrived: the raster
 * is the same product, so drawing both would be the same map twice.
 */
const serviceVis = (options: StyleOptions, service: string): 'visible' | 'none' =>
	!graftDraws(options) && serviceDraws(options.baseMap, service) ? 'visible' : 'none';

const baseMapSources = (): Record<string, RasterSourceSpecification> =>
	Object.fromEntries(
		TILE_SERVICES.map((service) => [
			service.id,
			{
				type: 'raster',
				tiles: [service.tiles],
				tileSize: 256,
				maxzoom: service.maxzoom,
				...(service.bounds === undefined ? {} : { bounds: [...service.bounds] }),
				attribution: service.attribution
			} satisfies RasterSourceSpecification
		])
	);

/**
 * Every tile service is in the style and the unchosen ones are merely hidden.
 *
 * Building only the chosen layers would be smaller and is the wrong shape:
 * MapLibre's style diff handles a visibility change and cannot express a layer
 * appearing in the middle of the stack, so a picker that switched base maps
 * would rebuild the style and drop every warm tile on the screen.
 *
 * Hidden also means unattributed. MapLibre credits a source only while a visible
 * layer uses it, which is what stops the credit line naming ICGC over a picture
 * that is entirely PNOA. That mismatch is what the owner reported, and it is the
 * whole reason the credit rides on the source rather than on a list somewhere.
 */
const baseMapLayers = (options: StyleOptions): LayerSpecification[] =>
	TILE_SERVICES.map((service) => ({
		id: service.id,
		type: 'raster',
		source: service.id,
		layout: { visibility: serviceVis(options, service.id) },
		// Never dimmed. What decides whether a base map can be seen is how much
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
 * The habitat survey's point records, one mark each.
 *
 * A layer of its own rather than a variant of the ground fill, because these are
 * not a finer cut of the polygons: the survey publishes them as points because
 * what it found there is too small to hold a polygon at its own scale, and
 * drawing one as a patch of seabed would claim an extent nobody measured. They
 * ride their own switch for the same reason, so the layer answers to the diver
 * and not to whichever catalogue the ground happens to be painted from.
 *
 * `icon-allow-overlap` stays off at every zoom. There are 1,259 coralligenous
 * records on this coast and no zoom at which painting all of them says anything;
 * what a diver wants out of this layer is where the gorgonian grounds are, which
 * is what the spread left after collision shows.
 */
const habitatPointLayers = (options: StyleOptions): LayerSpecification[] => {
	const image: Record<string, string> = {};
	const colour: Record<string, string> = {};
	for (const { code, colour: ink } of HABITAT_POINTS) {
		image[code] = habitatPointImageId(code);
		colour[code] = ink;
	}
	return [
		{
			id: 'habitat-point',
			type: 'symbol',
			source: 'habitat-points',
			minzoom: HABITAT_POINT_FROM,
			layout: {
				visibility: vis(options, 'habitat-points'),
				'icon-image': ['coalesce', ['get', ['get', 'code'], ['literal', image]], ''],
				// Smaller than a chart mark at every zoom. A dive site is somewhere you
				// are going and this is what is growing there, so it must not win the
				// eye against one.
				'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 0.85, 18, 1.05],
				'icon-allow-overlap': false,
				'icon-ignore-placement': false,
				'symbol-sort-key': [
					'coalesce',
					['get', ['get', 'code'], ['literal', HABITAT_POINT_SORT]],
					HABITAT_POINTS.length + 1
				]
			},
			paint: {
				'icon-color': ['coalesce', ['get', ['get', 'code'], ['literal', colour]], PALETTE.paper],
				'icon-halo-color': MARKER_INK,
				'icon-halo-width': MARKER_HALO
			}
		}
	];
};

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
			// No rim. The owner asked for the dive flag in red and white and nothing
			// else, and a halo on an SDF plate draws a brass edge round every plate
			// kind at once, so the flag was the one that could not have what it asked
			// for while this was here.
			paint: { 'icon-color': MARKER_PLATE }
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
	// The archive's sprite sheet while its style is grafted in, and no sheet
	// otherwise: this map draws its own markers and textures through the image
	// registry, so the slot is free for whoever is borrowing it.
	...(graftDraws(options) && options.graft?.sprite !== undefined
		? { sprite: options.graft.sprite }
		: {}),
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
			maxzoom: 14,
			// The archive is ICGC out to where their survey stops and the national
			// shelf survey past it, so both licences are owed a line. MapView carries
			// the ICGC one already; this is the half it does not know about.
			attribution: MAPA_CREDIT
		},
		isobaths: {
			type: 'vector',
			url: `pmtiles://${asset('/tiles/isobaths.pmtiles')}`,
			maxzoom: 16
		},
		'isobaths-deep': {
			type: 'vector',
			url: `pmtiles://${asset('/tiles/isobaths-deep.pmtiles')}`,
			maxzoom: 15,
			attribution: MAPA_CREDIT
		},
		[SPOT_SOURCE_ID]: {
			type: 'vector',
			url: `pmtiles://${asset('/tiles/spot-depths.pmtiles')}`,
			// A step past the contours, because a printed A3 sits at z18.8 and the
			// sheet is where a diver has the most room for these and the most use for
			// them. Past 17 the archive overzooms, which for points is exact.
			maxzoom: 17
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
		...baseMapSources(),
		...(graftDraws(options) ? (options.graft?.sources ?? {}) : {}),
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
		'habitat-points': { type: 'geojson', data: asset('/data/habitat-points.geojson') },
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
		...baseMapLayers(options),

		// The archive's own vector style, for the one base map that publishes one.
		// In the same slot as the rasters and under everything this map draws
		// itself, because what it replaces is the picture under the chart.
		...(graftDraws(options) ? (options.graft?.layers ?? []) : []),

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

		// Under the ICGC contours, which is the order the two surveys rank in. Where
		// they somehow overlap, the better one is the one on top.
		...deepIsobathLayers(options),
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
				// rectangle across Aragon. The coast is the 0 m contour the isobath layer
				// draws, so nothing here needs an outline.
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

		// Under the chart marks, so a dive site always wins the pixels a gorgonian
		// record wants. MapLibre places the later layer first and a placed symbol
		// keeps its ground.
		...habitatPointLayers(options),

		// Over the habitat records and under the chart marks. A spot depth is the
		// shape of the bottom, which is the first thing this map is for, so it takes
		// the pixels from a gorgonian record that wants the same ones; a dive site or
		// a mooring buoy still takes them from it.
		...spotDepthLayers({
			visible: options.visible.includes('spot-depths'),
			maxDepthM: options.isobaths.maxDepthM
		}),

		...osmLayers(options),

		// Always last and always visible: tracking is switched by emptying the
		// sources, so turning it on does not rebuild the style.
		...positionLayers()
	]
});
