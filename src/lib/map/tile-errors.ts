import type { Map as MapLibre } from 'maplibre-gl';

/**
 * The source a failure belongs to, or undefined when it belongs to none.
 *
 * Every error a source fires reaches the map with that source's id attached,
 * whether it was one tile that would not fetch or the archive's own header. What
 * is left over names no source at all, and a style that will not parse is the
 * whole of that case: it is the one failure that means nothing is coming.
 *
 * `sourceId` and `tile` are real at runtime and absent from `ErrorEvent`, whose
 * constructor spreads an untyped `data` object onto the instance, so they are
 * narrowed rather than asserted.
 */
export const failedSource = (event: object): string | undefined => {
	if (!('sourceId' in event)) return undefined;
	const { sourceId } = event;
	return typeof sourceId === 'string' ? sourceId : undefined;
};

/**
 * The source whose tile failed, or undefined when the failure was not about a tile.
 *
 * A finer cut than `failedSource`, for the print path. One tile that fails to
 * fetch leaves a hole in a corner of something otherwise finished, and a sheet
 * with a hole that says so beats no sheet at all. An archive that never opened
 * at all is a sheet with nothing on it, and a diver has to be told.
 */
export const failedTileSource = (event: object): string | undefined => {
	if (!('tile' in event)) return undefined;
	const { tile } = event;
	return typeof tile === 'object' && tile !== null ? failedSource(event) : undefined;
};

/**
 * The part of the map these questions ask about, and nothing more, so the
 * answers can be tested without one. MapLibre's own `Map` satisfies it.
 */
export interface MapFacts {
	getZoom(): number;
	getLayersOrder(): string[];
	getLayer(id: string): LayerFacts | undefined;
	getSource(id: string): object | undefined;
}

/** What a layer says about where it draws from and when it draws at all. */
export interface LayerFacts {
	readonly source: string;
	/** Whatever the style put there. Only the word MapLibre reads as off matters here. */
	readonly visibility: unknown;
	/**
	 * Absent, whatever MapLibre's types promise, when the style did not set them.
	 * A layer with no bounds draws at every zoom, and comparing against the
	 * `undefined` that is really there answers false at all of them.
	 */
	readonly minzoom?: number;
	readonly maxzoom?: number;
}

const PMTILES = 'pmtiles://';

/**
 * Whether this source is an archive the map ships, rather than a service it asks.
 *
 * The distinction is the ortophoto. It is somebody else's tile server, it fails
 * once per tile on a boat, and a diver who switched it on has asked a network
 * for a photograph rather than lost the seabed under it. The archives are the
 * seabed: one file each, sitting next to the app, and one of those failing to
 * open is the survey going missing.
 */
export const isArchive = (map: MapFacts, sourceId: string): boolean => {
	const source = map.getSource(sourceId);
	if (source === undefined || !('url' in source)) return false;
	const { url } = source;
	return typeof url === 'string' && url.startsWith(PMTILES);
};

/**
 * Whether the view on screen is drawing from this source right now.
 *
 * Asked of the map every time rather than kept in step with it. Which layers are
 * on, and the zoom each starts drawing at, are already in the style, and a
 * second copy here is the one that would go stale.
 */
export const viewDrawsFrom = (map: MapFacts, sourceId: string): boolean => {
	const zoom = map.getZoom();
	return map.getLayersOrder().some((id) => {
		const layer = map.getLayer(id);
		if (layer?.source !== sourceId || layer.visibility === 'none') return false;
		return (
			(layer.minzoom === undefined || zoom >= layer.minzoom) &&
			(layer.maxzoom === undefined || zoom < layer.maxzoom)
		);
	});
};

/**
 * Say when an archive the view is drawing from would not open, and stop saying
 * it when it opens.
 *
 * The two halves are asked at different moments on purpose. Whether a failure is
 * an archive refusing to open can only be answered as it fires. Whether the
 * diver is looking at that archive has to be answered again every time the map
 * moves or a layer goes off, and that is what keeps an archive nothing on screen
 * needs quiet: it sits in the set saying nothing until the view comes to it.
 *
 * `isSourceLoaded` looks like the way to ask whether an archive came back and is
 * not. MapLibre's `loaded()` opens with `if (this._sourceErrored) return true`,
 * because its question is whether the source has settled rather than whether it
 * has anything. The one event that means an archive opened is its own metadata,
 * which a failed header never fires, so that is what clears it.
 */
export const watchArchives = (
	map: MapLibre,
	view: { archiveUnreadable: boolean }
): (() => void) => {
	const unopened = new Set<string>();
	const read = (): void => {
		view.archiveUnreadable = [...unopened].some((id) => viewDrawsFrom(map, id));
	};
	const onerror = (event: object): void => {
		const source = failedSource(event);
		// One tile of an archive that did open is the hole in the sheet `failedTileSource`
		// is named for, and the map still draws everything either side of it.
		if (source === undefined || failedTileSource(event) !== undefined) return;
		if (!isArchive(map, source)) return;
		unopened.add(source);
		read();
	};
	const onsourcedata = (event: { readonly sourceId: string; readonly sourceDataType: string }) => {
		if (event.sourceDataType === 'metadata') unopened.delete(event.sourceId);
		read();
	};
	map.on('error', onerror);
	map.on('sourcedata', onsourcedata);
	map.on('moveend', read);
	map.on('styledata', read);
	return () => {
		map.off('error', onerror);
		map.off('sourcedata', onsourcedata);
		map.off('moveend', read);
		map.off('styledata', read);
	};
};
