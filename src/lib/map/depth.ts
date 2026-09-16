import type { IControl, Map as MapLibre, MapMouseEvent } from 'maplibre-gl';

/**
 * How deep it is at one point, read off the contour archives rather than off the
 * lines the map happens to be drawing.
 *
 * There is no cheap way to sample the DEM in the browser: it ships as Terrain-RGB
 * tiles the GPU reads and nothing else does. The contours are the same surveys,
 * they are already loaded, and reading them means the number never disagrees with
 * a line a diver can see.
 *
 * Read from the source and not from what is rendered, which is the whole point.
 * The drawn interval is a function of the zoom, 20 m out at z11 and 1 m at z16,
 * so a reading taken off the drawn lines answered in multiples of 20 when the
 * camera was pulled back. Measured over the same spot on the Roses shelf, the
 * rendered reading gave 60 m at z10 and 70 m at z14; the source gives 70 m at
 * both, and at z12, because every metre is in the tiles at every zoom.
 *
 * What is left is the archives' own spacing, which varies by where the tap lands
 * rather than by the camera: one metre inshore where the ICGC survey reaches,
 * five on the national shelf and fifty down the slope past it. And the tap's own
 * precision, which is a pixel of ground wherever the diver is zoomed to.
 */

/** The contour archives, both read, nearest line wins. */
const CONTOUR_SOURCES: readonly { readonly id: string; readonly layer: string }[] = [
	{ id: 'isobaths', layer: 'isobaths' },
	{ id: 'isobaths-deep', layer: 'isobaths' }
];

/**
 * How far out a contour still counts, in metres of seabed.
 *
 * Past this the tap was over land, over water no survey reached, or over a plain
 * so flat that the nearest line says nothing about the spot. A kilometre is well
 * past the widest gap the ICGC survey leaves inshore.
 */
const REACH_M = 1000;

/** Metres per degree of latitude. A search radius on this coast needs no more. */
const M_PER_DEGREE = 111_320;

export interface LngLat {
	readonly lng: number;
	readonly lat: number;
}

/** Every vertex of a line or multi-line, in the order they were drawn. */
const verticesOf = (geometry: GeoJSON.Geometry): readonly (readonly GeoJSON.Position[])[] => {
	if (geometry.type === 'LineString') return [geometry.coordinates];
	if (geometry.type === 'MultiLineString') return geometry.coordinates;
	return [];
};

/**
 * The depth of the contour nearest one point, and nothing about any other.
 *
 * Vertices rather than segments. The archives carry a contour as a dense
 * polyline, so the nearest vertex is within a few metres of the nearest point on
 * the line, and a segment projection would buy that back at the cost of the
 * arithmetic to get it wrong in.
 *
 * Degrees rather than screen pixels, and squared rather than rooted, because this
 * walks about 200,000 vertices at a coast-wide zoom and the answer has to be the
 * same one whatever the camera is doing. Measured at 22 ms at z10 and 40 ms at
 * z12, which is a tap and not a frame; see `showDepthUnderCursor` for what that
 * costs the readout.
 */
export const depthAt = (map: MapLibre, at: LngLat): number | undefined => {
	const lngScale = Math.cos((at.lat * Math.PI) / 180);
	const reach = (REACH_M / M_PER_DEGREE) ** 2;
	let best: number | undefined;
	let bestAway = reach;
	for (const source of CONTOUR_SOURCES) {
		let hits: readonly {
			readonly properties: Record<string, unknown>;
			readonly geometry: GeoJSON.Geometry;
		}[];
		try {
			hits = map.querySourceFeatures(source.id, { sourceLayer: source.layer });
		} catch {
			continue;
		}
		for (const feature of hits) {
			const depthM = Number(feature.properties['depth']);
			if (!Number.isFinite(depthM)) continue;
			for (const line of verticesOf(feature.geometry)) {
				for (const [lng, lat] of line) {
					if (lng === undefined || lat === undefined) continue;
					const east = (lng - at.lng) * lngScale;
					const north = lat - at.lat;
					const away = east * east + north * north;
					if (away < bestAway) {
						bestAway = away;
						best = depthM;
					}
				}
			}
		}
	}
	return best;
};

/**
 * How long the pointer has to stop before the readout reads.
 *
 * The scan costs tens of milliseconds, which is nothing on a tap and would be a
 * dropped frame on every mousemove. So it runs when the pointer settles instead
 * of chasing it, which also stops the number flickering through every contour a
 * sweep crosses. Long enough not to fire mid-sweep, short enough to feel like an
 * answer rather than a wait.
 */
const SETTLE_MS = 140;

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

/**
 * The depth under a resting pointer, in the corner.
 *
 * Touch is excluded on purpose. A finger has no hover, so a readout that followed
 * it would only ever repeat what the tap already opened, over the seabed the
 * finger is covering.
 */
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

	let settling: ReturnType<typeof setTimeout> | undefined;

	const hide = (): void => {
		element.style.display = 'none';
	};

	const read = (event: MapMouseEvent): void => {
		if (settling !== undefined) clearTimeout(settling);
		hide();
		const at = { lng: event.lngLat.lng, lat: event.lngLat.lat };
		settling = setTimeout(() => {
			const depthM = depthAt(map, at);
			if (depthM === undefined) return;
			element.textContent = `${depthM} m`;
			element.style.display = 'block';
		}, SETTLE_MS);
	};

	const clear = (): void => {
		if (settling !== undefined) clearTimeout(settling);
		hide();
	};

	map.on('mousemove', read);
	map.on('mouseout', clear);
	return () => {
		if (settling !== undefined) clearTimeout(settling);
		map.off('mousemove', read);
		map.off('mouseout', clear);
		map.removeControl(control);
	};
};
