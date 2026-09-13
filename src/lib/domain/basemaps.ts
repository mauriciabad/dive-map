/**
 * Every base map a diver can put under the chart, and the tile services they are
 * drawn from.
 *
 * A base map is one choice, not a set of switches. That is the whole shape of
 * this file and it is what makes the ordering question go away: a base map owns
 * an ordered list of tile services, the catalogue fixes that order, and the
 * picker chooses between base maps rather than between layers. Nothing a diver
 * can press is able to put a 25 cm photograph over a 5 cm one, because nothing a
 * diver can press touches the order at all.
 *
 * Only one base map has more than one service in it. `satellite-costa` is the
 * 5 cm coastal flight over PNOA, and the split is the point: PNOA carries the
 * land because it is the only one of the four with any, and the coastal flight
 * carries the water because it is the finest thing flown over it and it shares a
 * survey with the bathymetry underneath.
 *
 * This is domain data and not style code, which is why it is here rather than in
 * `$lib/map/style.ts`. The state layer has to name a base map to save one, and a
 * saved configuration should not drag a MapLibre style spec in behind it.
 */

/**
 * Which of the three shelves a base map sits on.
 *
 * `satellite` is a photograph, `standard` is a road map, `classic` is a
 * topographic sheet. The kind is a label for the picker and nothing else: every
 * base map replaces the one before it, so no two kinds ever draw at once and
 * there is no stacking rule between them to get wrong.
 */
export type BaseMapKind = 'satellite' | 'standard' | 'classic';

/** The chart on its own, with no photograph and no borrowed map under it. */
export const NO_BASE_MAP = 'none';

export type BaseMapId =
	| typeof NO_BASE_MAP
	| 'satellite-costa'
	| 'satellite-icgc'
	| 'satellite-ign'
	| 'satellite-esri'
	| 'standard-osm'
	| 'standard-icgc'
	| 'standard-ign'
	| 'classic-icgc'
	| 'classic-ign';

/**
 * One raster service, and everything a style needs to ask it for tiles.
 *
 * `id` is the source id as well as the key, so a service two base maps share is
 * one source in the style and one set of warm tiles between them.
 */
export interface TileService {
	readonly id: string;
	readonly tiles: string;
	readonly maxzoom: number;
	/** Absent means the service answers anywhere on earth. */
	readonly bounds?: readonly [number, number, number, number];
	readonly attribution: string;
}

export interface BaseMap {
	readonly id: BaseMapId;
	readonly kind: BaseMapKind;
	/** The archive's own name. Never translated: these are proper nouns. */
	readonly name: string;
	/**
	 * Coarsest first. A later service paints over an earlier one, so this is the
	 * resolution order and the catalogue is the only thing that sets it.
	 */
	readonly services: readonly TileService[];
	/** The best of its kind, which is what the picker stars. One per kind. */
	readonly recommended: boolean;
	/** Ground resolution, for the photographs where the trade is worth saying. */
	readonly grain?: string;
	/**
	 * The archive's own MapLibre style over its own vector tiles, where it
	 * publishes one that renders as the map it sells.
	 *
	 * Present on one base map out of ten, and the `services` beside it are the
	 * same product as a raster, so nothing is stranded while the style layer
	 * cannot graft an external style in yet. A vector option that needed a style
	 * written by hand to approximate the original is not recorded here at all: it
	 * would be a worse copy of a map we can have exactly.
	 */
	readonly style?: string;
}

/**
 * The extent both ICGC WMS services declare, and the same rectangle for each.
 * Outside Catalonia neither has anything to answer with.
 */
const ICGC_BOUNDS = [0.024303, 40.061468, 3.360594, 43.400669] as const;

const CC_BY = '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';
const ICGC = '<a href="https://www.icgc.cat/" target="_blank" rel="noopener">ICGC</a>';
const IGN = '<a href="https://www.ign.es/" target="_blank" rel="noopener">IGN</a>';

/**
 * PNOA Máxima Actualidad, the national ortophoto, at 25 cm.
 *
 * The INSPIRE WMS rather than the WMTS at the same host, and that is the whole
 * point of it. PNOA is flown over land, so it has nothing over the sea, and the
 * WMTS answers for the sea anyway: a 256 px opaque JPEG of flat near-black, a
 * different shade per tile. Measured off Begur at z14, three sea tiles came back
 * at luminance 7.8, 7.6 and 28.1, which is a black rectangle with a visible tile
 * grid over the half of the map a diver is here for.
 *
 * The WMS with `transparent=true` answers those same three tiles with a
 * 334-byte fully transparent PNG, and `image/vnd.jpeg-png` keeps the JPEG where
 * there is something to send. Over twelve land tiles it is also the faster of
 * the two, at a median 455 ms against 581 ms.
 *
 * Issue #40 asks for the WMTS template here, out of a selector built before any
 * of that was measured. This is the same photograph from the same body, by the
 * service that does not paint the sea black.
 */
const PNOA: TileService = {
	id: 'satellite',
	tiles:
		'https://www.ign.es/wms-inspire/pnoa-ma?service=WMS&request=GetMap&version=1.1.1' +
		'&layers=OI.OrthoimageCoverage&styles=&srs=EPSG:3857' +
		'&format=image/vnd.jpeg-png&transparent=true' +
		'&width=256&height=256&bbox={bbox-epsg-3857}',
	maxzoom: 20,
	attribution: `<a href="https://pnoa.ign.es/" target="_blank" rel="noopener">PNOA</a> cedido por © Instituto Geográfico Nacional de España`
};

/**
 * ICGC's Ortofoto de Catalunya, the whole territory at 25 cm.
 *
 * `maxzoom` is 19 against its neighbours at 20 because 25 cm is the grain. At
 * this latitude z19 is 0.22 m a pixel and z20 is 0.11, so a z20 request is the
 * server resampling its own source. MapLibre stretching its z19 tile gets there
 * from the same pixels without the round trip.
 */
const ICGC_TERRITORIAL: TileService = {
	id: 'satellite-icgc-territorial',
	tiles:
		'https://geoserveis.icgc.cat/servei/catalunya/orto-territorial/wms?service=WMS' +
		'&request=GetMap&version=1.1.1&layers=ortofoto_color_vigent&styles=&srs=EPSG:3857' +
		'&format=image/vnd.jpeg-png&transparent=true' +
		'&width=256&height=256&bbox={bbox-epsg-3857}',
	maxzoom: 19,
	bounds: ICGC_BOUNDS,
	attribution: `${ICGC} ortofoto de Catalunya, ${CC_BY}`
};

/**
 * The 2022 bathymetry flight out of ICGC's coastal series, at 5 cm, and the
 * finest photograph on this map by a factor of two.
 *
 * It was flown alongside the bathymetry the seabed is drawn from, so the picture
 * and the depth model are one survey rather than two that disagree. Measured at
 * z16 it answers 90 KB at Tamariu, 166 KB over the Medes and 70 KB at Cap de
 * Creus, and the 334-byte transparent no-data PNG at Sitges and anywhere inland,
 * so it carries the dive coast and hands everything else to PNOA below.
 *
 * `maxzoom` is 21 rather than 20 because 5 cm is the grain: at this latitude z21
 * is 0.055 m a pixel, which is the source's own resolution and not a resample.
 */
const ICGC_BATHYMETRY: TileService = {
	id: 'satellite-icgc-bathymetry',
	tiles:
		'https://geoserveis.icgc.cat/servei/catalunya/orto-costa/wms?service=WMS' +
		'&request=GetMap&version=1.1.1&layers=orto-costa-rgb-5cm-202206-202207-batimetria' +
		'&styles=&srs=EPSG:3857&format=image/vnd.jpeg-png&transparent=true' +
		'&width=256&height=256&bbox={bbox-epsg-3857}',
	maxzoom: 21,
	bounds: ICGC_BOUNDS,
	attribution: `${ICGC} ortofoto de costa 5 cm, ${CC_BY}`
};

/**
 * Esri's World Imagery, the only photograph here that covers the world.
 *
 * `server.arcgisonline.com` rather than the `clarity.maptiles` host issue #40
 * carries. Clarity 301s every tile past about z19 off to a dated wayback
 * archive: measured at z20 over Begur it costs two redirects to reach a 10.9 KB
 * JPEG. This host answers the same zoom directly, and it is the one ICGC's own
 * style document uses.
 *
 * Note the `{z}/{y}/{x}` order, which is Esri's and not everyone else's.
 */
const ESRI_IMAGERY: TileService = {
	id: 'satellite-esri',
	tiles:
		'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
	maxzoom: 20,
	attribution:
		'© <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics'
};

/**
 * OpenStreetMap's own tiles.
 *
 * The template in issue #40 is Leaflet's `{s}.tile.openstreetmap.org`. MapLibre
 * has no `{s}`, and the subdomains are deprecated anyway, so this is the host
 * the OSMF now asks everyone to use.
 *
 * Raster, and staying raster. Nobody serves the OpenStreetMap standard style as
 * vector tiles. The OSMF's own vector service exists, at
 * `vector.openstreetmap.org/shortbread_v1`, but it stops at zoom 14 and the
 * styles the OSMF demonstrates it with are VersaTiles', which look nothing like
 * this. Rendered beside this raster at Begur z13, OpenFreeMap Liberty drops the
 * woodland green, the contours and the pink road casings that are what makes
 * the OSM map recognisable as itself. Every vector alternative is a different
 * map, so the choice is this one or an imitation, and an imitation is worse.
 */
const OSM_STANDARD: TileService = {
	id: 'standard-osm',
	tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
	maxzoom: 19,
	attribution:
		'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
};

/**
 * ICGC's standard map, out of their Servei de Mapa Base.
 *
 * Not the template issue #40 carries. That one is the old `contextmaps/wmts`
 * path and the whole path is gone: checked at 14/8338/6085, both the standard
 * map and the ortophoto on it answer 404, and ICGC's own style document now
 * points at `mapa-base` for the rasters and at vector tiles for everything else.
 * This is the raster the owner's selector was asking for, at the address that
 * answers today: 95 KB of PNG at z14 over Begur.
 *
 * `maxzoom` is 20 because z21 is the first the service refuses, with a 400.
 */
const ICGC_STANDARD: TileService = {
	id: 'standard-icgc',
	tiles: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wmts/estandard/MON3857NW/{z}/{x}/{y}.png',
	maxzoom: 20,
	bounds: ICGC_BOUNDS,
	attribution: `${ICGC} mapa estàndard, ${CC_BY}`
};

/**
 * ICGC's own MapLibre style for the standard map, drawn from ICGC's own vector
 * tiles rather than from their raster renderer.
 *
 * Named here and not yet drawn: the style layer has to graft an external style
 * in, which `$lib/map/style.ts` does not do yet. It is recorded now because
 * choosing it was a measurement rather than a preference. Rendered beside the
 * raster above at Begur z13, the vector style is the same product: same greens,
 * same road casings, same label faces, same green trail line. It is 235 layers
 * over `mapa-base2/vt`, maxzoom 15, with ICGC's glyphs and sprites, which is
 * what makes it the ICGC map rather than an imitation of it drawn from ICGC
 * data. Being vector is also what lets it be toned to sit under the painted
 * chart instead of fighting it.
 *
 * No other base map here has one. The photographs cannot have one, the two
 * topographic sheets have no vector edition that renders as the sheet, and
 * nothing serves the OpenStreetMap standard style as vector tiles at all.
 */
const ICGC_STANDARD_STYLE = 'https://geoserveis.icgc.cat/contextmaps/icgc_mapa_estandard.json';

/** IGN Base, the national road map. */
const IGN_STANDARD: TileService = {
	id: 'standard-ign',
	tiles:
		'https://www.ign.es/wmts/ign-base?service=WMTS&request=GetTile&version=1.0.0' +
		'&Format=image/png&layer=IGNBaseTodo&style=default' +
		'&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
	maxzoom: 20,
	attribution: `${IGN} IGN Base`
};

/** ICGC's topographic sheet, the one a walker on this coast knows. */
const ICGC_TOPO: TileService = {
	id: 'classic-icgc',
	tiles:
		'https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/topo/GRID3857/{z}/{x}/{y}.png',
	maxzoom: 20,
	attribution: `${ICGC} mapa topogràfic, ${CC_BY}`
};

/** The MTN, Spain's national topographic sheet, as a raster. */
const IGN_MTN: TileService = {
	id: 'classic-ign',
	tiles:
		'https://www.ign.es/wmts/mapa-raster?service=WMTS&request=GetTile&version=1.0.0' +
		'&Format=image/jpeg&layer=MTN&style=default' +
		'&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
	maxzoom: 20,
	attribution: `${IGN} MTN`
};

/**
 * The nine base maps a diver can choose, and `none` is the tenth by being the
 * absence of all of them.
 *
 * Order here is the order the picker shows, grouped by kind. Within a base map
 * the `services` order is the resolution order and nothing outside this file
 * sets it.
 */
export const BASE_MAPS: readonly BaseMap[] = [
	{
		id: 'satellite-costa',
		kind: 'satellite',
		name: 'Costa',
		services: [PNOA, ICGC_BATHYMETRY],
		recommended: true,
		grain: '5 cm'
	},
	{
		id: 'satellite-icgc',
		kind: 'satellite',
		name: 'ICGC',
		services: [ICGC_TERRITORIAL],
		recommended: false,
		grain: '25 cm'
	},
	{
		id: 'satellite-ign',
		kind: 'satellite',
		name: 'IGN',
		services: [PNOA],
		recommended: false,
		grain: '25 cm'
	},
	{
		id: 'satellite-esri',
		kind: 'satellite',
		name: 'Esri',
		services: [ESRI_IMAGERY],
		recommended: false
	},
	{ id: 'standard-osm', kind: 'standard', name: 'OSM', services: [OSM_STANDARD], recommended: true },
	{
		id: 'standard-icgc',
		kind: 'standard',
		name: 'ICGC',
		services: [ICGC_STANDARD],
		recommended: false,
		style: ICGC_STANDARD_STYLE
	},
	{
		id: 'standard-ign',
		kind: 'standard',
		name: 'IGN',
		services: [IGN_STANDARD],
		recommended: false
	},
	{ id: 'classic-icgc', kind: 'classic', name: 'ICGC', services: [ICGC_TOPO], recommended: true },
	{ id: 'classic-ign', kind: 'classic', name: 'IGN', services: [IGN_MTN], recommended: false }
];

/** The order the picker lists its shelves in. */
export const BASE_MAP_KINDS: readonly BaseMapKind[] = ['satellite', 'standard', 'classic'];

/**
 * Every service any base map draws from, once each, in the order a style should
 * declare them.
 *
 * Two base maps share PNOA, so a plain flatMap would declare it twice. The style
 * builds one source per entry here and every base map's layers point into them,
 * which is what keeps the tiles warm when a diver moves between Costa and IGN.
 */
export const TILE_SERVICES: readonly TileService[] = [
	...new Map(BASE_MAPS.flatMap((map) => map.services).map((s) => [s.id, s])).values()
];

/** What the map ships with: the chart on its own. */
export const DEFAULT_BASE_MAP: BaseMapId = NO_BASE_MAP;

const BY_ID: ReadonlyMap<string, BaseMap> = new Map(BASE_MAPS.map((map) => [map.id, map]));

export const isBaseMapId = (value: unknown): value is BaseMapId =>
	value === NO_BASE_MAP || (typeof value === 'string' && BY_ID.has(value));

export const baseMapOf = (id: BaseMapId): BaseMap | undefined => BY_ID.get(id);

/** Which services a chosen base map draws, coarsest first. Empty for `none`. */
export const servicesOf = (id: BaseMapId): readonly TileService[] =>
	BY_ID.get(id)?.services ?? [];

/** Whether a service draws under the given choice, which is what a style asks per layer. */
export const serviceDraws = (id: BaseMapId, service: string): boolean =>
	servicesOf(id).some((s) => s.id === service);

/**
 * The two base maps the quick toggle flicks between, with the resting one first.
 *
 * A pair rather than a list, so exactly two is what the type says and not a rule
 * every caller has to remember. Pressing the toggle from the resting map brings
 * the other one; pressing it from anywhere else brings the resting one back.
 */
export type QuickPair = readonly [BaseMapId, BaseMapId];

/** The chart on its own, and the 5 cm coastal photograph over it. */
export const DEFAULT_QUICK_PAIR: QuickPair = [NO_BASE_MAP, 'satellite-costa'];

/** What one press of the toggle puts under the chart. */
export const quickNext = (pair: QuickPair, current: BaseMapId): BaseMapId =>
	current === pair[0] ? pair[1] : pair[0];

/**
 * Put a base map in the resting slot, pushing whatever was resting into the
 * other one.
 *
 * A push two deep, and that is the entire rule. Every pair of ten is two taps
 * away, no tap can leave the same map in both slots, and no tap can empty one.
 * Choosing the resting map again changes nothing, because it is already there.
 */
export const withQuickChoice = (pair: QuickPair, id: BaseMapId): QuickPair =>
	id === pair[0] ? pair : [id, pair[0]];

/** Whether a stored pair is one this version can still draw, both halves of it. */
export const isQuickPair = (value: unknown): value is QuickPair =>
	Array.isArray(value) &&
	value.length === 2 &&
	isBaseMapId(value[0]) &&
	isBaseMapId(value[1]) &&
	value[0] !== value[1];
