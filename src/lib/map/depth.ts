import type { IControl, MapGeoJSONFeature, Map as MapLibre, MapMouseEvent } from 'maplibre-gl';

/**
 * The depth under a precise pointer, read off the contours already on screen.
 *
 * There is no cheap way to sample the DEM in the browser: it ships as Terrain-RGB
 * tiles the GPU reads and nothing else does. The isobaths are the same survey at
 * one metre, they are already loaded, and reading them means the number always
 * agrees with the lines the diver can see. Between two contours the honest answer
 * is the pair, not an interpolation, so that is what this reports.
 *
 * Touch is excluded on purpose. A finger has no hover, so a readout that follows
 * it would only ever repeat what the tap already opened, over the seabed the
 * finger is covering.
 */

/**
 * Screen radii searched for contours, tried in order. The first is tight enough
 * that the bracket means "here"; the wider ones exist because over a flat sand
 * plain the one metre contours are hundreds of metres apart and a fixed tight box
 * would just blink the readout off where the seabed is least interesting.
 */
const SEARCH_PX = [16, 48, 128];

const CONTOUR_LAYERS = ['isobath', 'zero-isobath'];

export interface DepthReading {
	readonly shallowestM: number;
	readonly deepestM: number;
}

interface Contour {
	readonly depthM: number;
	readonly line: GeoJSON.Geometry;
}

const contoursWithin = (map: MapLibre, x: number, y: number, radius: number): readonly Contour[] => {
	const found: Contour[] = [];
	for (const layer of CONTOUR_LAYERS) {
		let hits: readonly MapGeoJSONFeature[];
		try {
			hits = map.queryRenderedFeatures(
				[
					[x - radius, y - radius],
					[x + radius, y + radius]
				],
				{ layers: [layer] }
			);
		} catch {
			continue;
		}
		for (const feature of hits) {
			const depthM = Number(feature.properties['depth']);
			if (Number.isFinite(depthM)) found.push({ depthM, line: feature.geometry });
		}
	}
	return found;
};

export const depthUnder = (map: MapLibre, x: number, y: number): DepthReading | undefined => {
	for (const radius of SEARCH_PX) {
		const found = contoursWithin(map, x, y, radius);
		if (found.length > 0) {
			const depths = found.map((contour) => contour.depthM);
			return { shallowestM: Math.min(...depths), deepestM: Math.max(...depths) };
		}
	}
	return undefined;
};

/** Every vertex of a line or multi-line, in the order they were drawn. */
const verticesOf = (geometry: GeoJSON.Geometry): readonly GeoJSON.Position[] => {
	if (geometry.type === 'LineString') return geometry.coordinates;
	if (geometry.type === 'MultiLineString') return geometry.coordinates.flat();
	return [];
};

/**
 * Screen distance from a point to the nearest vertex of one contour.
 *
 * Vertices rather than segments. The tiles carry a metre contour as a dense
 * polyline, so the nearest vertex is within a pixel or two of the nearest point
 * on the line, and a segment projection would buy that back at the cost of the
 * arithmetic to get it wrong in.
 */
const pixelsAway = (map: MapLibre, geometry: GeoJSON.Geometry, x: number, y: number): number => {
	let nearest = Number.POSITIVE_INFINITY;
	for (const [lng, lat] of verticesOf(geometry)) {
		if (lng === undefined || lat === undefined) continue;
		const at = map.project([lng, lat]);
		nearest = Math.min(nearest, Math.hypot(at.x - x, at.y - y));
	}
	return nearest;
};

/**
 * How deep it is at one point, to the nearest contour drawn through it.
 *
 * The bracket `depthUnder` reports is right for a readout that follows a moving
 * cursor, and wrong for a card that says "the bottom here". A tap near a steep
 * shore has the 0 m coastline and the 8 m contour in the same search box, and
 * the card printed "0 to 8 m" off that: two contours the tap happened to be
 * between, not a depth. So this asks which single contour is closest and says
 * what that one reads, which is the depth at the point to within one interval.
 *
 * The tiles carry every metre, and the drawn interval is 1 m from zoom 16, so a
 * diver reading a site gets the metre. Zoomed out they get the coarse interval,
 * which is the only thing there is to read at that zoom anyway.
 */
export const depthAt = (map: MapLibre, x: number, y: number): number | undefined => {
	for (const radius of SEARCH_PX) {
		const found = contoursWithin(map, x, y, radius);
		if (found.length === 0) continue;
		let best = found[0];
		if (best === undefined) continue;
		let bestAway = pixelsAway(map, best.line, x, y);
		for (const contour of found.slice(1)) {
			const away = pixelsAway(map, contour.line, x, y);
			if (away < bestAway) {
				best = contour;
				bestAway = away;
			}
		}
		return best.depthM;
	}
	return undefined;
};

export const formatDepth = (reading: DepthReading): string =>
	reading.shallowestM === reading.deepestM
		? `${reading.shallowestM} m`
		: `${reading.shallowestM}–${reading.deepestM} m`;

const READOUT_STYLE = [
	'display: none',
	'padding: 0.25rem 0.55rem',
	'border-radius: 0.4rem',
	'background: var(--color-table-800, #1d1710)',
	'color: var(--color-paper, #efe4cf)',
	'border: 1px solid var(--color-table-600, #3a2f23)',
	'font: 600 0.85rem/1.2 system-ui, sans-serif',
	'font-variant-numeric: tabular-nums',
	'pointer-events: none',
	'white-space: nowrap'
].join(';');

export const showDepthUnderCursor = (map: MapLibre): (() => void) | undefined => {
	if (!window.matchMedia('(pointer: fine)').matches) return undefined;

	const element = document.createElement('div');
	element.className = 'maplibregl-ctrl';
	element.setAttribute('style', READOUT_STYLE);
	element.setAttribute('aria-live', 'off');

	const control: IControl = {
		onAdd: () => element,
		onRemove: () => {
			element.remove();
		}
	};
	map.addControl(control, 'bottom-left');

	let pending = 0;
	const read = (event: MapMouseEvent): void => {
		if (pending !== 0) return;
		pending = requestAnimationFrame(() => {
			pending = 0;
			const reading = depthUnder(map, event.point.x, event.point.y);
			element.textContent = reading === undefined ? '' : formatDepth(reading);
			element.style.display = reading === undefined ? 'none' : 'block';
		});
	};

	const clear = (): void => {
		element.style.display = 'none';
	};

	map.on('mousemove', read);
	map.on('mouseout', clear);
	return () => {
		if (pending !== 0) cancelAnimationFrame(pending);
		map.off('mousemove', read);
		map.off('mouseout', clear);
		map.removeControl(control);
	};
};
