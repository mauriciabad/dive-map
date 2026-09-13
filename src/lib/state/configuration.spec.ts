import { describe, expect, it } from 'vitest';
import {
	LIBRARY_KEY,
	LIBRARY_LIMIT,
	STORAGE_VERSION,
	WORKING_KEY,
	parseCamera,
	readLibrary,
	readWorking,
	shippedConfiguration,
	writeLibrary,
	writeWorking
} from './configuration.ts';
import { memoryStore } from './storage.ts';
import { DEFAULT_ISOBATHS } from '$lib/domain/card';

const ca = shippedConfiguration('ca');

const stored = (blob: unknown) => {
	const store = memoryStore();
	store.write(LIBRARY_KEY, typeof blob === 'string' ? blob : JSON.stringify(blob));
	return store;
};

describe('readLibrary', () => {
	it('round-trips saved configurations and the one a new tab opens with', () => {
		const store = memoryStore();
		expect(
			writeLibrary(store, {
				saved: [
					{ name: 'Nit', configuration: { ...ca, smoothed: false } },
					{ name: 'Medes', configuration: ca }
				],
				openWith: 'Medes'
			})
		).toBe(true);
		const back = readLibrary(store, 'ca');
		expect(back).toEqual({
			kind: 'ok',
			value: {
				saved: [
					{ name: 'Nit', configuration: { ...ca, smoothed: false } },
					{ name: 'Medes', configuration: ca }
				],
				openWith: 'Medes'
			}
		});
	});

	it('reports nothing stored rather than inventing a library', () => {
		expect(readLibrary(memoryStore(), 'ca')).toEqual({ kind: 'empty' });
	});

	it('refuses a blob written by a later version instead of guessing at it', () => {
		const store = stored({ version: STORAGE_VERSION + 1, saved: [] });
		expect(readLibrary(store, 'ca')).toEqual({ kind: 'unreadable', why: 'newer' });
	});

	/** Refusing is only better than dropping if the blob is still there afterwards. */
	it('leaves a blob it refuses on the device', () => {
		const blob = JSON.stringify({ version: STORAGE_VERSION + 1, saved: [] });
		const store = stored(blob);
		readLibrary(store, 'ca');
		expect(store.read(LIBRARY_KEY)).toBe(blob);
	});

	it('treats a damaged blob as unreadable rather than throwing', () => {
		expect(readLibrary(stored('{ not json'), 'ca')).toEqual({ kind: 'unreadable', why: 'damaged' });
		expect(readLibrary(stored({ saved: [] }), 'ca')).toEqual({
			kind: 'unreadable',
			why: 'damaged'
		});
		expect(readLibrary(stored({ version: 1, saved: 'nope' }), 'ca')).toEqual({
			kind: 'unreadable',
			why: 'damaged'
		});
	});

	it('keeps the first of two entries sharing a name', () => {
		const store = stored({
			version: 1,
			saved: [
				{ name: 'Nit', configuration: { ...ca, smoothed: false } },
				{ name: 'Nit', configuration: ca }
			]
		});
		const back = readLibrary(store, 'ca');
		expect(back.kind === 'ok' && back.value.saved.map((e) => e.configuration.smoothed)).toEqual([
			false
		]);
	});

	it('drops a default that names a configuration nobody saved', () => {
		const store = stored({
			version: 1,
			openWith: 'Gone',
			saved: [{ name: 'Nit', configuration: ca }]
		});
		const back = readLibrary(store, 'ca');
		expect(back.kind === 'ok' && back.value.openWith).toBeUndefined();
	});

	/**
	 * The cap belongs to saving. Hiding what is past it would lose those entries
	 * on the next save, which is the one thing this store must not do.
	 */
	it('reads back more than one browser is allowed to save', () => {
		const store = stored({
			version: 1,
			saved: Array.from({ length: LIBRARY_LIMIT + 5 }, (_, i) => ({
				name: `Setup ${i}`,
				configuration: ca
			}))
		});
		const back = readLibrary(store, 'ca');
		expect(back.kind === 'ok' && back.value.saved.length).toBe(LIBRARY_LIMIT + 5);
	});

	it('skips an entry with no usable name rather than losing the rest', () => {
		const store = stored({
			version: 1,
			saved: [
				{ name: '   ', configuration: ca },
				{ name: 'Medes', configuration: ca }
			]
		});
		const back = readLibrary(store, 'ca');
		expect(back.kind === 'ok' && back.value.saved.map((e) => e.name)).toEqual(['Medes']);
	});
});

describe('parsing a stored configuration', () => {
	const configurationFrom = (configuration: unknown) => {
		const back = readLibrary(stored({ version: 1, saved: [{ name: 'x', configuration }] }), 'en');
		return back.kind === 'ok' ? back.value.saved[0]?.configuration : undefined;
	};

	it('leaves out a layer this version has no switch for, and keeps the rest', () => {
		expect(
			configurationFrom({ ...ca, layers: ['osm', 'marker-cave', 'hillshade'] })?.layers
		).toEqual(['osm', 'hillshade']);
	});

	it('keeps the per-kind marker switches, which are layers like any other', () => {
		expect(
			configurationFrom({ ...ca, layers: ['marker-dive-site', 'marker-mooring'] })?.layers
		).toEqual(['marker-dive-site', 'marker-mooring']);
	});

	it('falls back to the shipped isobaths for a number nobody could have set', () => {
		const isobaths = configurationFrom({
			...ca,
			isobaths: { ...DEFAULT_ISOBATHS, intervalM: -4, maxDepthM: 1e9 }
		})?.isobaths;
		expect(isobaths?.intervalM).toBe(DEFAULT_ISOBATHS.intervalM);
		expect(isobaths?.maxDepthM).toBe(DEFAULT_ISOBATHS.maxDepthM);
	});

	it('sorts and dedupes the emphasised depths, dropping the ones off the scale', () => {
		expect(
			configurationFrom({
				...ca,
				isobaths: { ...DEFAULT_ISOBATHS, emphasised: [30, 5, 30, -1, 'x'] }
			})?.isobaths.emphasised
		).toEqual([5, 30]);
	});

	it('falls back to the browser language when the stored one is not a language we speak', () => {
		expect(configurationFrom({ ...ca, locale: 'de' })?.locale).toBe('en');
	});

	it('takes the whole configuration back when every field is missing', () => {
		expect(configurationFrom({})).toEqual({ ...shippedConfiguration('en') });
	});
});

describe('parseCamera', () => {
	it('accepts a camera a map can actually be pointed with', () => {
		expect(parseCamera({ centre: { lng: 3.2, lat: 41.9 }, zoom: 13.4, bearing: 12 })).toEqual({
			centre: { lng: 3.2, lat: 41.9 },
			zoom: 13.4,
			bearing: 12
		});
	});

	it('brings a bearing back into one turn', () => {
		expect(parseCamera({ centre: { lng: 3, lat: 41 }, zoom: 10, bearing: -90 })?.bearing).toBe(270);
	});

	it('rejects the coordinates no map can take', () => {
		expect(parseCamera({ centre: { lng: 3, lat: 41 }, zoom: Number.NaN })).toBeUndefined();
		expect(parseCamera({ centre: { lng: 3, lat: 95 }, zoom: 10 })).toBeUndefined();
		expect(parseCamera({ centre: { lng: '3', lat: 41 }, zoom: 10 })).toBeUndefined();
		expect(parseCamera('somewhere')).toBeUndefined();
	});
});

describe('the working configuration', () => {
	it('round-trips the camera with the settings', () => {
		const store = memoryStore();
		const camera = { centre: { lng: 3.1, lat: 41.8 }, zoom: 15, bearing: 45 };
		writeWorking(store, { configuration: ca, camera, from: 'Nit' });
		expect(readWorking(store, 'ca')).toEqual({ configuration: ca, camera, from: 'Nit' });
	});

	it('starts fresh from a blob it cannot read, because it is only a moment old', () => {
		const store = memoryStore();
		store.write(WORKING_KEY, '{ not json');
		expect(readWorking(store, 'ca')).toBeUndefined();
	});

	it('keeps the settings when the stored camera is nonsense', () => {
		const store = memoryStore();
		store.write(
			WORKING_KEY,
			JSON.stringify({ version: 1, configuration: ca, camera: { zoom: 'far' } })
		);
		expect(readWorking(store, 'ca')?.camera).toBeUndefined();
		expect(readWorking(store, 'ca')?.configuration).toEqual(ca);
	});
});
