import type { Map as MapLibre, MapMouseEvent } from 'maplibre-gl';
import { OSM_PICK_LAYERS } from '../ui/feature-card.ts';

/**
 * A pointer over the marks that open a card.
 *
 * Only the OSM marks get it. Tapping bare seabed opens a card too, but the
 * seabed is the whole sea, and a pointer over all of it would retire the grab
 * hand and stop the map reading as something you drag.
 *
 * One `mousemove` and a query, rather than MapLibre's per-layer enter and leave.
 * Attachments are wired when the map is constructed, which is before the style
 * has loaded and before any of these layers exists, and a listener bound to a
 * layer id that is not there yet never fires. Asking the renderer what is under
 * the pointer asks whatever is on screen now, so it also survives the setStyle
 * behind every layer toggle.
 *
 * The box matches the 10 px the tap handler picks with: the cursor has to promise
 * exactly what the click will deliver.
 */
const PICK_PX = 10;

export const pointerOverMarks = (map: MapLibre): (() => void) => {
	const canvas = map.getCanvas();

	const onmove = (e: MapMouseEvent): void => {
		// Between styles, and before the first one loads, there are no layers to
		// query. MapLibre answers a query naming a layer it does not have by firing
		// an error event rather than throwing, so the catch below never sees it and
		// the map's error handler puts a banner over a map that is loading fine.
		if (!map.isStyleLoaded()) return;
		const { x, y } = e.point;
		let over: boolean;
		try {
			over =
				map.queryRenderedFeatures(
					[
						[x - PICK_PX, y - PICK_PX],
						[x + PICK_PX, y + PICK_PX]
					],
					{ layers: [...OSM_PICK_LAYERS] }
				).length > 0;
		} catch {
			return;
		}
		canvas.style.cursor = over ? 'pointer' : '';
	};

	map.on('mousemove', onmove);
	return () => {
		map.off('mousemove', onmove);
		canvas.style.cursor = '';
	};
};
