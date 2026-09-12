import { mount } from 'svelte';
import { PositionTracker } from './position.svelte.ts';
import { POSITION_SOURCES, positionLayers } from './style-layers.ts';
import LocationControl from '$lib/ui/LocationControl.svelte';
import { MapState } from '$lib/state/map-view.svelte';
import type { Map as MapLibre } from 'maplibre-gl';

/**
 * Wires the position feature into a running map from outside the page, so
 * `verify-position.mjs` can drive the real control against a real MapLibre
 * instance before `style.ts` and `+page.svelte` have been changed to carry it.
 *
 * It is also the whole integration written out: two sources, three layers, one
 * component. Nothing in the app imports it, so it does not ship.
 */

export interface Harness {
	readonly tracker: PositionTracker;
	readonly view: MapState;
}

export const installPositionHarness = (map: MapLibre): Harness => {
	for (const [id, spec] of Object.entries(POSITION_SOURCES)) {
		if (map.getSource(id) === undefined) map.addSource(id, spec);
	}
	for (const layer of positionLayers()) {
		if (map.getLayer(layer.id) === undefined) map.addLayer(layer);
	}

	const host = document.createElement('div');
	document.body.append(host);
	const view = new MapState(['ca']);
	const tracker = new PositionTracker();
	mount(LocationControl, { target: host, props: { view, tracker } });
	return { tracker, view };
};
