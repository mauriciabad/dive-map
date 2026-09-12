import type { LayerSpecification, SourceSpecification } from 'maplibre-gl';
import { gradientFor } from './frame.ts';
import { PALETTE } from '$lib/map/style';

/**
 * What `style.ts` has to add for the boat to appear. Exported rather than
 * described in a handover note so there is one copy of it: the style spreads
 * these in, and `verify-position.mjs` injects the same objects into a live map,
 * which means the thing verified is the thing shipped.
 *
 * Both sources start empty and both layers are always visible. Tracking is
 * switched on and off by emptying the sources, never by touching the style, so
 * this costs no style rebuild and has no entry in the layer panel to get out of
 * step with.
 *
 * `lineMetrics` on the trail is not optional: `line-gradient` interpolates on
 * `line-progress`, and without line metrics that property does not exist and
 * MapLibre drops the paint property, taking the trail with it.
 */

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export const POSITION_SOURCES: Readonly<Record<string, SourceSpecification>> = {
	trail: { type: 'geojson', lineMetrics: true, data: EMPTY },
	position: { type: 'geojson', data: EMPTY }
};

/**
 * A placeholder ramp. `LocationControl` replaces it on every update with stops
 * built from the age of each vertex, and re-applies after a style rebuild. It is
 * a real two-stop gradient rather than a stub because a layer whose gradient
 * fails to parse is dropped at style load, before anything can replace it.
 */
const PLACEHOLDER_GRADIENT = gradientFor([
	[0, 0],
	[1, 0.92]
]);

export const positionLayers = (): LayerSpecification[] => [
	{
		id: 'trail-line',
		type: 'line',
		source: 'trail',
		layout: { 'line-cap': 'round', 'line-join': 'round' },
		paint: {
			'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 4.5, 18, 8],
			...(PLACEHOLDER_GRADIENT === undefined ? {} : { 'line-gradient': PLACEHOLDER_GRADIENT })
		}
	},
	{
		id: 'trajectory-line',
		type: 'line',
		source: 'position',
		filter: ['==', ['get', 'kind'], 'trajectory'],
		layout: { 'line-cap': 'round' },
		paint: {
			'line-color': PALETTE.shallow,
			'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 18, 3.6],
			'line-dasharray': [2.5, 2],
			'line-opacity': 0.9
		}
	},
	{
		id: 'position-avatar',
		type: 'symbol',
		source: 'position',
		filter: ['==', ['get', 'kind'], 'position'],
		layout: {
			'icon-image': ['get', 'avatar'],
			// Degrees clockwise from north, which is what the course estimate gives
			// and what every figure was drawn bow-up for.
			'icon-rotate': ['get', 'course'],
			'icon-rotation-alignment': 'map',
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
			'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 0.85, 18, 1.05]
		},
		paint: {
			// A position older than a few seconds is dimmed rather than hidden. On a
			// boat the last known spot is still worth something; pretending it is
			// current is not.
			'icon-opacity': ['case', ['get', 'stale'], 0.55, 1]
		}
	}
];
