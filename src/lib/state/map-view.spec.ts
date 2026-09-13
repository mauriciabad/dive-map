import { describe, expect, it } from 'vitest';
import { NO_BASE_MAP } from '$lib/domain/basemaps';
import { haloOf, paintOf } from '$lib/domain/isobaths';
import { MapState } from './map-view.svelte.ts';

/** The photograph on, and off again, through the one route every caller takes. */
const photograph = (view: MapState): void => {
	view.setBaseMap('satellite-costa');
};
const chartAlone = (view: MapState): void => {
	view.setBaseMap(NO_BASE_MAP);
};

describe('what a base map does to the layers under it', () => {
	it('takes the veil and the relief down with it', () => {
		const view = new MapState();
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([true, true]);
		photograph(view);
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([false, false]);
	});

	it('gives them back when it goes away', () => {
		const view = new MapState();
		photograph(view);
		chartAlone(view);
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([true, true]);
	});

	/** The owner's words: unless it was already disabled previously. */
	it('leaves off what the diver had already turned off', () => {
		const view = new MapState();
		view.toggle('hillshade');
		photograph(view);
		chartAlone(view);
		expect(view.shows('hillshade')).toBe(false);
	});

	it('lets go of a layer the diver switched by hand while the photograph was up', () => {
		const view = new MapState();
		photograph(view);
		view.toggle('hillshade');
		chartAlone(view);
		expect(view.shows('hillshade')).toBe(true);
	});

	it('holds the veil switch down and says so, and leaves the relief switch working', () => {
		const view = new MapState();
		photograph(view);
		expect([view.lockedByPhoto('depth-tint'), view.lockedByPhoto('hillshade')]).toEqual([
			true,
			false
		]);
		view.toggle('depth-tint');
		expect(view.shows('depth-tint')).toBe(false);
	});

	/** A road map is a borrowed map too, and it suspends the same two layers. */
	it('does the same for a base map that is not a photograph', () => {
		const view = new MapState();
		view.setBaseMap('standard-osm');
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([false, false]);
	});

	it('settles a stored configuration that predates any of this', () => {
		const view = new MapState();
		view.apply({
			...view.configuration,
			baseMap: 'satellite-costa',
			layers: ['depth-tint', 'hillshade']
		});
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([false, false]);
		chartAlone(view);
		expect([view.shows('depth-tint'), view.shows('hillshade')]).toEqual([true, true]);
	});
});

describe('what a base map does to the contour outline', () => {
	const outlined = (view: MapState): boolean => haloOf(view.isobaths).on;

	it('draws it when a base map arrives and drops it when the base map goes', () => {
		const view = new MapState();
		expect(outlined(view)).toBe(false);
		photograph(view);
		expect(outlined(view)).toBe(true);
		chartAlone(view);
		expect(outlined(view)).toBe(false);
	});

	it('leaves an outline the diver drew over the chart alone', () => {
		const view = new MapState();
		view.toggleHalo();
		photograph(view);
		chartAlone(view);
		expect(outlined(view)).toBe(true);
	});

	it('lets go of an outline the diver dropped while the base map was up', () => {
		const view = new MapState();
		photograph(view);
		view.toggleHalo();
		chartAlone(view);
		expect(outlined(view)).toBe(false);
		photograph(view);
		expect(outlined(view)).toBe(true);
	});

	it('keeps the colour and the strength across all of that', () => {
		const view = new MapState();
		photograph(view);
		view.isobaths = {
			...view.isobaths,
			paint: { ...paintOf(view.isobaths), halo: { ...haloOf(view.isobaths), opacity: 0.8 } }
		};
		chartAlone(view);
		photograph(view);
		expect(haloOf(view.isobaths).opacity).toBe(0.8);
	});
});

describe('the two maps the corner button flicks between', () => {
	it('ships resting on the chart with the coastal photograph opposite', () => {
		const view = new MapState();
		expect(view.quickToggle).toEqual([NO_BASE_MAP, 'satellite-costa']);
	});

	it('flicks to the other one and back', () => {
		const view = new MapState();
		view.flipBaseMap();
		expect(view.baseMap).toBe('satellite-costa');
		view.flipBaseMap();
		expect(view.baseMap).toBe(NO_BASE_MAP);
	});

	/** From a third map the button brings the resting one, not the far one. */
	it('comes back to the resting map from anywhere else', () => {
		const view = new MapState();
		view.setBaseMap('classic-icgc');
		view.flipBaseMap();
		expect(view.baseMap).toBe(NO_BASE_MAP);
	});

	/**
	 * The push-down rule, at the level a diver meets it. Any pair of the ten is two
	 * taps, because the first tap puts a map in the resting slot and pushes what
	 * was resting across.
	 */
	it('reaches any pair in two taps', () => {
		const view = new MapState();
		view.chooseQuick('classic-ign');
		view.chooseQuick('standard-osm');
		expect(view.quickToggle).toEqual(['standard-osm', 'classic-ign']);
	});

	it('never leaves the same map in both slots', () => {
		const view = new MapState();
		view.chooseQuick('satellite-costa');
		view.chooseQuick('satellite-costa');
		expect(view.quickToggle).toEqual(['satellite-costa', NO_BASE_MAP]);
	});

	/** Setting up what the button flicks between is not asking to be shown either. */
	it('does not move the map', () => {
		const view = new MapState();
		view.chooseQuick('standard-icgc');
		expect(view.baseMap).toBe(NO_BASE_MAP);
	});
});
