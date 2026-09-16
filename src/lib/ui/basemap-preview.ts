import { asset } from '$app/paths';
import { type BaseMapId, NO_BASE_MAP } from '$lib/domain/basemaps';

/**
 * The extracted tile the picker draws beside each base map's name.
 *
 * One file per base map, pulled once by
 * `pipeline/scripts/build_basemap_previews.mjs` and served from `static/`. A
 * live tile per row would cost nine requests every time the panel opened and
 * would come up blank on a boat with no signal, which is where this map is read.
 *
 * `none` has no file on purpose. It is the chart with nothing under it, so there
 * is no archive to photograph, and the picker draws the chart's own mark for it
 * instead.
 *
 * Spelled out one literal at a time because `asset()` resolves a known static
 * file, so a base map added to the catalogue without a preview is a build error
 * here rather than a broken image on the water.
 */
const FILES: Readonly<Record<Exclude<BaseMapId, typeof NO_BASE_MAP>, string>> = {
	'satellite-costa': asset('/basemaps/satellite-costa.webp'),
	'satellite-icgc': asset('/basemaps/satellite-icgc.webp'),
	'satellite-ign': asset('/basemaps/satellite-ign.webp'),
	'satellite-esri': asset('/basemaps/satellite-esri.webp'),
	'standard-osm': asset('/basemaps/standard-osm.webp'),
	'standard-icgc': asset('/basemaps/standard-icgc.webp'),
	'standard-ign': asset('/basemaps/standard-ign.webp'),
	'classic-icgc': asset('/basemaps/classic-icgc.webp'),
	'classic-ign': asset('/basemaps/classic-ign.webp')
};

/** Undefined for `none`, which is the one choice with no photograph to show. */
export const baseMapPreview = (id: BaseMapId): string | undefined =>
	id === NO_BASE_MAP ? undefined : FILES[id];
