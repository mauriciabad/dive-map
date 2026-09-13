import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import { type BaseMap, type BaseMapId } from '$lib/domain/basemaps';
import { MAP_FONT } from './fonts.ts';

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

/**
 * The nearest stack this map serves glyphs for.
 *
 * A MapLibre style has one `glyphs` URL and this map's own labels are drawn from
 * it, so a grafted layer cannot bring its own font server along. ICGC's style
 * asks for Fira Sans in three weights, sometimes as a zoom function; both forms
 * come through here as one string. The labels land in this map's typeface, which
 * is the one place a graft is not the archive's own product and the only one the
 * format leaves open.
 */
const fontFor = (declared: unknown): string =>
	JSON.stringify(declared ?? '').includes('Bold') ? MAP_FONT.label : MAP_FONT.secondary;

/**
 * A foreign layer, renamed onto its renamed source and made to ask for a font
 * this map can serve.
 */
const rewritten = (layer: LayerSpecification): LayerSpecification => {
	const id = `${PREFIX}${layer.id}`;
	if (!('source' in layer)) return { ...layer, id };
	const source = `${PREFIX}${layer.source}`;
	if (layer.type !== 'symbol') return { ...layer, id, source };
	const layout = layer.layout ?? {};
	return {
		...layer,
		id,
		source,
		layout: { ...layout, 'text-font': [fontFor(layout['text-font'])] }
	};
};

/** Whether the archive wants this layer drawn at all. */
const drawn = (layer: LayerSpecification): boolean => layer.layout?.visibility !== 'none';

/**
 * Take a fetched style down to the layers it actually draws and the sources
 * those layers read.
 *
 * The hidden 83 are the other products the same document describes, the
 * ortophoto and the dark variants among them. Carrying them would declare four
 * more sources, and MapLibre fetches a source's TileJSON whether or not anything
 * draws from it.
 */
export const graftStyle = (id: BaseMapId, spec: StyleSpecification): GraftedBaseMap => {
	const layers = spec.layers.filter(drawn).map(rewritten);
	const used = new Set(layers.flatMap((layer) => ('source' in layer ? [layer.source] : [])));
	const sources = Object.fromEntries(
		Object.entries(spec.sources)
			.map(([key, source]): [string, SourceSpecification] => [`${PREFIX}${key}`, source])
			.filter(([key]) => used.has(key))
	);
	return {
		id,
		sources,
		layers,
		...(typeof spec.sprite === 'string' ? { sprite: spec.sprite } : {})
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
		const grafted = graftStyle(map.id, body);
		held.set(url, grafted);
		return grafted;
	} catch {
		return undefined;
	}
};
