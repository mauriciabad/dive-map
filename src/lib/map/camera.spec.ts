import type { Map as MapLibre } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { constrainToData } from './camera.ts';

/**
 * The centre of the bounding box of a coast that runs diagonally, which is where
 * the map opens and which is outside the data ring. That is the only case the
 * guard does anything in, and it is the case the zoom button died in.
 */
const OUTSIDE = { lng: 1.9235, lat: 41.4232 };

/** Tamariu, well inside the footprint, so the guard has nothing to say. */
const INSIDE = { lng: 3.2085, lat: 41.9172 };

interface Listeners {
	move: (() => void)[];
	moveend: (() => void)[];
	resize: (() => void)[];
}

/**
 * The correction is recorded but never applied, so the camera stays where it was
 * put and every trigger is scored on its own. Applying it would move the centre
 * inside the limit on the first correction and make every later assertion pass
 * for the wrong reason. `setCenter` still fires `move` the way MapLibre does, so
 * the reentry guard is under test too.
 */
const fakeMap = (centre: { lng: number; lat: number }, zooming: boolean) => {
	const listeners: Listeners = { move: [], moveend: [], resize: [] };
	const corrections: { lng: number; lat: number }[] = [];
	const map = {
		getCanvas: () => ({ clientWidth: 1200, clientHeight: 800 }),
		getCenter: () => centre,
		getZoom: () => 12,
		getMaxZoom: () => 22,
		cameraForBounds: () => ({ zoom: 7 }),
		setMinZoom: () => undefined,
		setCenter: (next: { lng: number; lat: number }) => {
			corrections.push(next);
			for (const fire of listeners.move) fire();
		},
		isZooming: () => zooming,
		on: (event: keyof Listeners, fire: () => void) => {
			listeners[event].push(fire);
		},
		off: () => undefined
	};
	return { map: map as unknown as MapLibre, listeners, corrections };
};

describe('keeping the camera where there is something to show', () => {
	it('leaves a centre inside the footprint alone', () => {
		const { map, listeners, corrections } = fakeMap(INSIDE, false);
		constrainToData(map);
		for (const fire of listeners.move) fire();
		expect(corrections).toEqual([]);
	});

	it('pulls a centre outside the footprint back while panning', () => {
		const { map, listeners, corrections } = fakeMap(OUTSIDE, false);
		constrainToData(map);
		corrections.length = 0;
		for (const fire of listeners.move) fire();
		expect(corrections.length).toBe(1);
	});

	/**
	 * The regression. `setCenter` is a jump and a jump stops the running animation,
	 * so correcting here killed the zoom button's own ease: from 7.6 the presses
	 * landed on 8.6, 8.92, 8.93, 8.93, 8.94 and then nothing.
	 */
	it('does not touch the centre while the zoom is animating', () => {
		const { map, listeners, corrections } = fakeMap(OUTSIDE, true);
		constrainToData(map);
		corrections.length = 0;
		for (const fire of listeners.move) fire();
		expect(corrections).toEqual([]);
	});

	it('corrects the same centre once the zoom has landed', () => {
		const { map, listeners, corrections } = fakeMap(OUTSIDE, true);
		constrainToData(map);
		corrections.length = 0;
		for (const fire of listeners.moveend) fire();
		expect(corrections.length).toBe(1);
	});
});
