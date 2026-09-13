import { LngLat, type Map as MapLibre } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { constrainToData } from './camera.ts';

/**
 * The centre of the bounding box of a coast that runs diagonally, which is where
 * the map opens and which is outside the data ring. That is the only case the
 * guard does anything in, and it is the case the zoom button died in.
 */
const OUTSIDE = new LngLat(1.9235, 41.4232);

/** Tamariu, well inside the footprint, so the guard has nothing to say. */
const INSIDE = new LngLat(3.2085, 41.9172);

/** Far enough out that the pull is unmistakable rather than a rounding step. */
const FAR_OUT = new LngLat(0.4, 40.2);

/**
 * The hook is the whole guard, so the double only has to hand it over and record
 * the jumps the guard makes on its own. One jump at attach is the design; any
 * jump after that is the bug this shape exists to close, because a jump halts
 * the gesture handlers and ends the drag under the diver's finger.
 */
const fakeMap = () => {
	const jumps: LngLat[] = [];
	let hook: ((next: { center: LngLat; zoom: number }) => { center?: LngLat }) | null = null;
	let centre = OUTSIDE;
	const map = {
		getCanvas: () => ({ clientWidth: 1200, clientHeight: 800 }),
		getCenter: () => centre,
		getMaxZoom: () => 22,
		cameraForBounds: () => ({ zoom: 7 }),
		setMinZoom: () => undefined,
		setCenter: (next: LngLat) => {
			jumps.push(next);
			centre = next;
		},
		setTransformCameraUpdate: (fn: typeof hook) => {
			hook = fn;
		},
		on: () => undefined,
		off: () => undefined
	};
	return {
		map: map as unknown as MapLibre,
		jumps,
		ask: (center: LngLat, zoom = 12) => {
			if (hook === null) throw new Error('the guard installed no hook');
			return hook({ center, zoom });
		}
	};
};

describe('keeping the camera where there is something to show', () => {
	it('consents to a centre inside the footprint', () => {
		const { map, ask } = fakeMap();
		constrainToData(map);
		expect(ask(INSIDE)).toEqual({});
	});

	it('holds a centre outside the footprint at the edge of the ring', () => {
		const { map, ask } = fakeMap();
		constrainToData(map);
		const held = ask(FAR_OUT).center;
		expect(held).toBeDefined();
		if (held === undefined) return;
		// Back towards the coast on both axes, and not all the way to it.
		expect(held.lng).toBeGreaterThan(FAR_OUT.lng);
		expect(held.lat).toBeGreaterThan(FAR_OUT.lat);
		// Held, not overshot: asking again from where it landed moves it under a
		// metre, so a finger against the boundary sees a camera that has stopped.
		const again = ask(held).center ?? held;
		expect(Math.abs(again.lng - held.lng)).toBeLessThan(1e-5);
	});

	/**
	 * The regression, and its sibling. A jump halts whatever the map is doing:
	 * 5db7d8a was the zoom button's ease being killed a few hundredths of a level
	 * in, and the owner then reported the same jump ending a drag that reached the
	 * boundary, so coming back the other way needed a fresh touch. The guard now
	 * answers the camera instead of moving it, and jumps exactly once, before
	 * anybody has touched the map.
	 */
	it('jumps once at attach and never again', () => {
		const { map, jumps, ask } = fakeMap();
		constrainToData(map);
		expect(jumps.length).toBe(1);
		for (let i = 0; i < 20; i++) ask(FAR_OUT, 9 + i / 10);
		expect(jumps.length).toBe(1);
	});

	it('keeps less of the ring in frame as the zoom goes in', () => {
		const { map, ask } = fakeMap();
		constrainToData(map);
		const wide = ask(FAR_OUT, 9).center;
		const close = ask(FAR_OUT, 14).center;
		expect(wide).toBeDefined();
		expect(close).toBeDefined();
		if (wide === undefined || close === undefined) return;
		// The circle inscribed in the viewport covers less ground the further in
		// the zoom goes, so the camera has to sit nearer the coast to keep the same
		// fraction of it on screen. East is towards the coast here.
		expect(close.lng).toBeGreaterThan(wide.lng);
	});
});
