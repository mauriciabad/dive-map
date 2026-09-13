import { describe, expect, it } from 'vitest';
import { haloOf, paintOf } from '$lib/domain/isobaths';
import { MapState } from './map-view.svelte.ts';

describe('what the photograph does to the layers under it', () => {
	it('takes the veil and the relief down with it', () => {
		const view = new MapState();
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([true, true]);
		view.toggle('satellite');
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([false, false]);
	});

	it('gives them back when it goes away', () => {
		const view = new MapState();
		view.toggle('satellite');
		view.toggle('satellite');
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([true, true]);
	});

	/** The owner's words: unless it was already disabled previously. */
	it('leaves off what the diver had already turned off', () => {
		const view = new MapState();
		view.toggle('hillshade');
		view.toggle('satellite');
		view.toggle('satellite');
		expect(view.shows('hillshade')).toBe(false);
	});

	it('lets go of a layer the diver switched by hand while the photograph was up', () => {
		const view = new MapState();
		view.toggle('satellite');
		view.toggle('hillshade');
		view.toggle('satellite');
		expect(view.shows('hillshade')).toBe(true);
	});

	it('holds the veil switch down and says so, and leaves the relief switch working', () => {
		const view = new MapState();
		view.toggle('satellite');
		expect([view.lockedByPhoto('depth-tint'), view.lockedByPhoto('hillshade')]).toEqual([
			true,
			false
		]);
		view.toggle('depth-tint');
		expect(view.shows('depth-tint')).toBe(false);
	});

	it('settles a stored configuration that predates any of this', () => {
		const view = new MapState();
		// `baseMap` is what says whether a photograph is on. `layers` still carries
		// the flag the style reads, and a parsed old blob sets both, so this is what
		// one of those looks like on the way in.
		view.apply({
			...view.configuration,
			baseMap: 'satellite-costa',
			layers: ['satellite', 'depth-tint', 'hillshade']
		});
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([false, false]);
		view.toggle('satellite');
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([true, true]);
	});
});

describe('what the photograph does to the contour outline', () => {
	const outlined = (view: MapState): boolean => haloOf(view.isobaths).on;

	it('draws it when a photograph arrives and drops it when the photograph goes', () => {
		const view = new MapState();
		expect(outlined(view)).toBe(false);
		view.toggle('satellite');
		expect(outlined(view)).toBe(true);
		view.toggle('satellite');
		expect(outlined(view)).toBe(false);
	});

	it('leaves an outline the diver drew over the chart alone', () => {
		const view = new MapState();
		view.toggleHalo();
		view.toggle('satellite');
		view.toggle('satellite');
		expect(outlined(view)).toBe(true);
	});

	it('lets go of an outline the diver dropped while the photograph was up', () => {
		const view = new MapState();
		view.toggle('satellite');
		view.toggleHalo();
		view.toggle('satellite');
		expect(outlined(view)).toBe(false);
		view.toggle('satellite');
		expect(outlined(view)).toBe(true);
	});

	it('keeps the colour and the strength across all of that', () => {
		const view = new MapState();
		view.toggle('satellite');
		view.isobaths = {
			...view.isobaths,
			paint: { ...paintOf(view.isobaths), halo: { ...haloOf(view.isobaths), opacity: 0.8 } }
		};
		view.toggle('satellite');
		view.toggle('satellite');
		expect(haloOf(view.isobaths).opacity).toBe(0.8);
	});
});
