import { GeoJSONSource } from 'maplibre-gl';
import type { DiveCollection } from '$lib/domain/overpass';
import { cacheStorageOsmStore, liveDiveFeatures } from '$lib/offline/overpass-cache';
import type { MapAttachment } from './controls.ts';

/**
 * Swaps the build-time dive features for today's, once they arrive.
 *
 * The style ships `osm` pointing at `/data/osm.geojson`, which is precached and on
 * screen before this runs. So the sequence is: the map is already right, and then
 * it is right about this morning too. Nothing here can delay a paint, and a fetch
 * that fails leaves the shipped file exactly where it was.
 *
 * The re-apply on `styledata` is not belt and braces. `setStyle(style, {diff:true})`
 * runs on every layer toggle, and the diff sees a source whose data is our object
 * against a source whose data is the shipped URL, so it helpfully puts the URL
 * back. Comparing by identity makes the fix idempotent: it costs one comparison on
 * the styledata events that changed nothing, and one reparse on the ones that did.
 */

const OSM_SOURCE = 'osm';

export const liveOsmFeatures: MapAttachment = (map) => {
	let collection: DiveCollection | undefined;

	const apply = (): void => {
		if (collection === undefined) return;
		const source = map.getSource(OSM_SOURCE);
		if (!(source instanceof GeoJSONSource)) return;
		if ((source.serialize().data as unknown) === collection) return;
		// Resolves when the worker has reindexed. Nothing here waits on that: the
		// repaint is MapLibre's job and a rejection means the map is already gone.
		void source.setData(collection);
	};

	map.on('styledata', apply);

	void (async () => {
		const live = await liveDiveFeatures({
			store: cacheStorageOsmStore(),
			fetch: (input, init) => fetch(input, init),
			now: () => Date.now(),
			online: navigator.onLine
		}).catch(() => undefined);
		if (live === undefined) return;
		collection = live.collection;
		apply();
		if (import.meta.env.DEV) {
			Reflect.set(window, 'diveOsm', {
				origin: live.origin,
				stale: live.stale,
				base: live.base,
				fetchedAt: live.fetchedAt,
				features: live.collection.features.length
			});
		}
	})();

	return () => {
		map.off('styledata', apply);
	};
};
