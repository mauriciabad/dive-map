import {
	type CameraUpdateTransformFunction,
	LngLatBounds,
	type Map as MapLibre,
	MercatorCoordinate
} from 'maplibre-gl';
import { DATA_EXTENT } from './data-extent.ts';

/**
 * Keep the camera somewhere the map has something to show.
 *
 * A bounding box around the survey was the obvious guard and it is the wrong one
 * here: the Catalan coast runs diagonally, so the box is mostly empty sea to the
 * south-east and a diver panning into it stays legal while the screen goes
 * blank. The rule enforced instead is that data has to be on screen. The centre
 * is measured against the outline of the bathymetry footprint, which is the
 * outer extent of everything drawn, and has to stay inside it or within the
 * circle inscribed in the viewport of it. That circle is in frame at any
 * bearing, so ground inside it is drawn, and the diagonal costs nothing.
 *
 * The guard is a `transformCameraUpdate` hook rather than a correction fired on
 * `move`. MapLibre calls the hook with the camera it is about to take up, on
 * every frame of a gesture and every frame of an animation, and takes back
 * whatever the hook returns. So the boundary is enforced by refusing to go
 * further out, which is a camera that never travels, rather than by a jump that
 * puts it back.
 *
 * That distinction is the whole bug this shape exists to close. `setCenter` is a
 * jump, and `Camera.stop` halts the gesture handlers on its way through, so a
 * finger held against the boundary had its drag cancelled under it and the diver
 * had to lift and start again to come back the other way. The same jump killed
 * the zoom button's ease, which 5db7d8a worked around by not correcting while
 * the zoom was animating. The hook needs neither exception: nothing here jumps,
 * so there is no animation to cancel and no gesture to end, and a drag that
 * meets the edge simply stops moving out and follows the finger back in.
 */

interface Vertex {
	readonly x: number;
	readonly y: number;
}

interface Edge {
	readonly a: Vertex;
	readonly b: Vertex;
}

/** Closed into edges once, so nothing downstream has to index past the end of the ring. */
const RING = ((): readonly Edge[] => {
	const edges: Edge[] = [];
	let first: Vertex | undefined;
	let previous: Vertex | undefined;
	for (const [lng, lat] of DATA_EXTENT) {
		const mercator = MercatorCoordinate.fromLngLat({ lng, lat });
		const vertex = { x: mercator.x, y: mercator.y };
		first ??= vertex;
		if (previous !== undefined) edges.push({ a: previous, b: vertex });
		previous = vertex;
	}
	if (first !== undefined && previous !== undefined) edges.push({ a: previous, b: first });
	return edges;
})();

const DATA_BOUNDS = ((): LngLatBounds => {
	let west = Infinity;
	let south = Infinity;
	let east = -Infinity;
	let north = -Infinity;
	for (const [lng, lat] of DATA_EXTENT) {
		west = Math.min(west, lng);
		south = Math.min(south, lat);
		east = Math.max(east, lng);
		north = Math.max(north, lat);
	}
	return new LngLatBounds([west, south], [east, north]);
})();

/**
 * How much of the inscribed circle has to hold data. At 1 the guard stops the
 * drag the instant the last of it would leave the frame, which lands the coast
 * on the very edge of the screen and reads as having overshot. Just under half
 * keeps a recognisable patch of seabed in view at the limit.
 */
const KEEP_WITHIN = 0.45;

/** MapLibre's world is 512 CSS pixels at zoom 0, not 256. */
const WORLD_AT_ZOOM_0 = 512;

/** Ray casting, counting the crossings of a horizontal ray running east. */
const inside = (x: number, y: number): boolean => {
	let hit = false;
	for (const { a, b } of RING) {
		if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
	}
	return hit;
};

const closestOnRing = (x: number, y: number): Vertex & { readonly distance: number } => {
	let best: Vertex = { x, y };
	let bestSquared = Infinity;
	for (const { a, b } of RING) {
		const span = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
		const along =
			span === 0
				? 0
				: Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / span));
		const px = a.x + along * (b.x - a.x);
		const py = a.y + along * (b.y - a.y);
		const squared = (x - px) ** 2 + (y - py) ** 2;
		if (squared < bestSquared) {
			bestSquared = squared;
			best = { x: px, y: py };
		}
	}
	return { x: best.x, y: best.y, distance: Math.sqrt(bestSquared) };
};

export const constrainToData = (map: MapLibre): (() => void) => {
	/**
	 * As far out as anyone needs to go is the whole survey on screen. Recomputed
	 * on resize because a phone turning from portrait to landscape moves the
	 * answer by about a zoom level.
	 */
	const clampZoom = (): void => {
		const camera = map.cameraForBounds(DATA_BOUNDS, { padding: 24 });
		if (camera?.zoom === undefined) return;
		map.setMinZoom(Math.min(camera.zoom, map.getMaxZoom()));
	};

	/**
	 * The camera MapLibre is about to take up, answered with the one it may have.
	 * An empty answer is consent, so a centre over the survey costs one point in
	 * polygon test and nothing else.
	 */
	const hold: CameraUpdateTransformFunction = (next) => {
		const canvas = map.getCanvas();
		const inscribed = Math.min(canvas.clientWidth, canvas.clientHeight) / 2;
		if (inscribed <= 0) return {};
		const centre = MercatorCoordinate.fromLngLat(next.center);
		if (inside(centre.x, centre.y)) return {};
		const limit = (inscribed * KEEP_WITHIN) / (WORLD_AT_ZOOM_0 * 2 ** next.zoom);
		const edge = closestOnRing(centre.x, centre.y);
		if (edge.distance <= limit || edge.distance === 0) return {};
		const pull = limit / edge.distance;
		return {
			center: new MercatorCoordinate(
				edge.x + (centre.x - edge.x) * pull,
				edge.y + (centre.y - edge.y) * pull,
				0
			).toLngLat()
		};
	};

	clampZoom();
	map.setTransformCameraUpdate(hold);
	// The camera the map was built with never went through the hook. This is the
	// one jump the guard makes, and it is made before anyone has touched the map.
	map.setCenter(map.getCenter());
	map.on('resize', clampZoom);
	return () => {
		map.setTransformCameraUpdate(null);
		map.off('resize', clampZoom);
	};
};
