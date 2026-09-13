import { describe, expect, it } from 'vitest';
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
