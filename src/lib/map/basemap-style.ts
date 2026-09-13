import type {
	LayerSpecification,
	RequestTransformFunction,
	SourceSpecification,
	StyleSpecification
} from 'maplibre-gl';
import { type BaseMap, type BaseMapId } from '$lib/domain/basemaps';
import { MAP_FONT_STACKS } from './fonts.ts';

/**
 * An archive's own MapLibre style, made safe to splice under this map's chart.
 *
 * One base map out of ten publishes one. ICGC's `icgc_mapa_estandard` is 235
 * layers over their own vector tiles with their own glyphs and sprites, and it
 * is the ICGC standard map drawn by ICGC rather than an imitation of it. Every
 * other option here is a photograph or a published sheet, and neither has a
 * vector edition that renders as the thing it is named after. See issue #43.
 *
 * Grafted rather than loaded with `setStyle`, because `setStyle` would be the
 * whole map: the chart, the isobaths, the habitats and the markers are this
 * app's product and the base map is what goes under them.
 */
export interface GraftedBaseMap {
	/** The base map this was fetched for, so a stale arrival cannot draw over a newer choice. */
	readonly id: BaseMapId;
	readonly sources: Readonly<Record<string, SourceSpecification>>;
	readonly layers: readonly LayerSpecification[];
	/** The archive's own sprite sheet, which its icon layers name images out of. */
	readonly sprite?: string;
	/**
	 * The archive's own glyph server, which its label layers name faces out of.
	 *
	 * A MapLibre style has one `glyphs` URL and this map's own labels are drawn
	 * from ours, so a grafted layer cannot declare a font server of its own. See
	 * `glyphsFromArchive`, which is how ICGC's Fira Sans still reaches the map.
	 */
	readonly glyphs?: string;
}

/**
 * What every id out of a foreign style is prefixed with.
 *
 * Two styles written by two bodies will collide eventually, and a collision is
 * silent: MapLibre keeps one layer and drops the other. `background` alone is
 * enough to lose this map's void colour.
 */
const PREFIX = 'basemap-';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What a fetched document has to carry before this file treats it as a style.
 *
 * Shallow on purpose. MapLibre validates every layer it is handed and reports
 * what it cannot draw, so re-checking 235 layer specs here would be a second
 * half-copy of a validator that already exists. What it cannot report is a 404
 * page parsed as JSON, and that is what this catches.
 */
const isStyleSpec = (value: unknown): value is StyleSpecification =>
	isRecord(value) && Array.isArray(value['layers']) && isRecord(value['sources']);

/** The font stacks this map serves out of `static/fonts`, and the only ones. */
const SERVED: ReadonlySet<string> = new Set<string>(MAP_FONT_STACKS);

/** `/fonts/<stack>/<range>.pbf`, the one shape this map's glyphs URL takes. */
const GLYPH_PATH = /\/fonts\/([^/]+)\/(\d+-\d+)\.pbf$/;

/**
 * Send a glyph request for a face this map does not serve to the archive that
 * asked for it.
 *
 * The graft used to rewrite every foreign `text-font` to one of this map's own
 * faces, which is why the ICGC map came out in Alegreya. It also read a label
 * layer's zoom function as one string and found `Bold` in it, so the one layer
 * that steps from regular to bold at z8 came out bold at every zoom.
 *
 * ICGC serves Fira Sans in three faces at 74 to 80 KB a range, with
 * `Access-Control-Allow-Origin: *`, which makes the borrowed map the archive's
 * own product in the archive's own letters rather than a copy of it in ours.
 * The chart's labels never leave `static/fonts`: only a stack this map has no
 * directory for is sent away, so nothing that has to work on a boat moves.
 */
export const glyphsFromArchive =
	(current: () => GraftedBaseMap | undefined): RequestTransformFunction =>
	(url: string) => {
		const template = current()?.glyphs;
		if (template === undefined) return undefined;
		const asked = GLYPH_PATH.exec(url);
		const stack = asked?.[1];
		const range = asked?.[2];
		if (stack === undefined || range === undefined) return undefined;
		if (SERVED.has(decodeURIComponent(stack))) return undefined;
		return { url: template.replace('{fontstack}', stack).replace('{range}', range) };
	};

/** A foreign layer, renamed onto its renamed source. */
const rewritten = (layer: LayerSpecification): LayerSpecification => {
	const id = `${PREFIX}${layer.id}`;
	if (!('source' in layer)) return { ...layer, id };
	return { ...layer, id, source: `${PREFIX}${layer.source}` };
};

/**
 * Whether the archive that published the style is the one that serves this
 * source.
 *
 * ICGC's document declares a global Mapterhorn hillshade beside their own 5 m
 * terrain, and MapLibre credits every source it draws from its TileJSON. So
 * grafting the document whole put a third party's name in the attribution and
 * started fetching world DEM tiles for a map of one coast, over whatever
 * connection a diver has on a boat. A graft draws what the archive serves and
 * nothing else, which is the boundary the sprite and the glyphs already sit
 * inside.
 */
const servedBy = (archive: string, source: SourceSpecification): boolean => {
	const at = (value: unknown): readonly string[] => (typeof value === 'string' ? [value] : []);
	const declared = [
		...at('url' in source ? source.url : undefined),
		...at('data' in source ? source.data : undefined),
		...('tiles' in source && Array.isArray(source.tiles) ? source.tiles.flatMap(at) : [])
	];
	const host = new URL(archive).host;
	return declared.every((url) => {
		try {
			return new URL(url, archive).host === host;
		} catch {
			return false;
		}
	});
};

/** Whether the archive wants this layer drawn at all. */
const drawn = (layer: LayerSpecification): boolean => layer.layout?.visibility !== 'none';

/**
 * Take a fetched style down to the layers it actually draws, and to the sources
 * those layers read from the archive that published it.
 *
 * The hidden 83 are the other products the same document describes, the
 * ortophoto and the dark variants among them. Carrying them would declare four
 * more sources, and MapLibre fetches a source's TileJSON whether or not anything
 * draws from it.
 *
 * `from` is where the document came from, which is what `servedBy` holds every
 * source to. A layer whose source does not survive that goes with it: MapLibre
 * refuses a layer that names a source the style does not declare.
 */
export const graftStyle = (
	id: BaseMapId,
	spec: StyleSpecification,
	from: string
): GraftedBaseMap => {
	const offered = Object.fromEntries(
		Object.entries(spec.sources)
			.filter(([, source]) => servedBy(from, source))
			.map(([key, source]): [string, SourceSpecification] => [`${PREFIX}${key}`, source])
	);
	const layers = spec.layers
		.filter(drawn)
		.map(rewritten)
		.filter((layer) => !('source' in layer) || layer.source in offered);
	const used = new Set(layers.flatMap((layer) => ('source' in layer ? [layer.source] : [])));
	return {
		id,
		sources: Object.fromEntries(Object.entries(offered).filter(([key]) => used.has(key))),
		layers,
		...(typeof spec.sprite === 'string' ? { sprite: spec.sprite } : {}),
		...(typeof spec.glyphs === 'string' ? { glyphs: spec.glyphs } : {})
	};
};

/**
 * Fetched once per style document and held, so flicking back to a base map does
 * not fetch 111 KB of JSON again.
 */
const held = new Map<string, GraftedBaseMap>();

/**
 * The archive's own style for a base map that publishes one, or nothing.
 *
 * Nothing is a working answer and not a failure: every base map here also lists
 * a raster service of the same product, so a style that will not fetch on a boat
 * leaves the diver with the map they asked for drawn the other way.
 */
export const loadBaseMapStyle = async (map: BaseMap): Promise<GraftedBaseMap | undefined> => {
	const url = map.style;
	if (url === undefined) return undefined;
	const cached = held.get(url);
	if (cached !== undefined) return cached;
	try {
		const response = await fetch(url);
		if (!response.ok) return undefined;
		const body: unknown = await response.json();
		if (!isStyleSpec(body)) return undefined;
		const grafted = graftStyle(map.id, body, url);
		held.set(url, grafted);
		return grafted;
	} catch {
		return undefined;
	}
};
