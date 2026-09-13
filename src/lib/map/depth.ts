import type { IControl, Map as MapLibre, MapMouseEvent } from 'maplibre-gl';

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

const contoursWithin = (map: MapLibre, x: number, y: number, radius: number): readonly number[] => {
	const depths: number[] = [];
	for (const layer of CONTOUR_LAYERS) {
		let found: readonly { readonly properties: Record<string, unknown> }[];
		try {
			found = map.queryRenderedFeatures(
				[
					[x - radius, y - radius],
					[x + radius, y + radius]
				],
				{ layers: [layer] }
			);
		} catch {
			continue;
		}
		for (const feature of found) {
			const metres = Number(feature.properties['depth']);
			if (Number.isFinite(metres)) depths.push(metres);
		}
	}
	return depths;
};

export const depthUnder = (map: MapLibre, x: number, y: number): DepthReading | undefined => {
	for (const radius of SEARCH_PX) {
		const depths = contoursWithin(map, x, y, radius);
		if (depths.length > 0) {
			return { shallowestM: Math.min(...depths), deepestM: Math.max(...depths) };
		}
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
