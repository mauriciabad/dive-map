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
import { DEFAULT_ISOBATHS, DEFAULT_LAND_PAINT, DEFAULT_SEABED_PAINT } from '$lib/domain/card';

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

	it('takes a saved sheet back the way it was written', () => {
		const print = {
			sheet: { kind: 'stock', stock: 'A4', orientation: 'landscape', dpi: 300, bleedMm: 3 },
			framing: { by: 'scale', scale: 5000 },
			furniture: ['title', 'scaleBar']
		};
		expect(configurationFrom({ ...ca, print })).toMatchObject({ print });
	});

	/** A3 portrait handed back here would claim somebody chose it. */
	it('leaves out a sheet it cannot read rather than inventing one', () => {
		expect(
			configurationFrom({ ...ca, print: { sheet: { kind: 'napkin' } } })?.print
		).toBeUndefined();
		expect(configurationFrom({ ...ca })?.print).toBeUndefined();
	});

	it('takes back a texture chosen for a class', () => {
		const textures = { 'habitats-20': 'ch_shipwood', 'substrate-6': 'ch_stones' };
		expect(configurationFrom({ ...ca, textures })?.textures).toEqual(textures);
	});

	/**
	 * The case that paints a hole in the seabed: a fill-pattern naming an image the
	 * map never registered draws nothing at all. Dropping the entry leaves the class
	 * on the catalogue's own texture, which is the only safe answer.
	 */
	it('drops a choice naming a texture that is not built and keeps the rest', () => {
		const back = configurationFrom({
			...ca,
			textures: { 'habitats-20': 'ch_unicorn', 'habitats-12': 'ch_stones' }
		});
		expect(back?.textures).toEqual({ 'habitats-12': 'ch_stones' });
	});

	it('drops a choice naming a class no catalogue has', () => {
		const back = configurationFrom({
			...ca,
			textures: { 'habitats-99': 'ch_stones', 'seagrass-1': 'ch_stones', '30512': 'ch_stones' }
		});
		expect(back?.textures).toEqual({});
	});

	it('reads a blob written before the field existed as no choices at all', () => {
		const before: Record<string, unknown> = { ...ca };
		Reflect.deleteProperty(before, 'textures');
		expect(configurationFrom(before)?.textures).toEqual({});
	});

	it('refuses a textures field that is not a set of choices', () => {
		expect(configurationFrom({ ...ca, textures: ['ch_stones'] })?.textures).toEqual({});
		expect(configurationFrom({ ...ca, textures: 'ch_stones' })?.textures).toEqual({});
		expect(configurationFrom({ ...ca, textures: { 'habitats-20': 7 } })?.textures).toEqual({});
	});

	it('never lets the hatch for unsurveyed water be chosen for a class', () => {
		expect(
			configurationFrom({ ...ca, textures: { 'habitats-20': 'unsurveyed' } })?.textures
		).toEqual({});
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

describe('how much paint is left over the photograph', () => {
	const stored = (configuration: Record<string, unknown>) => {
		const store = memoryStore();
		store.write(
			WORKING_KEY,
			JSON.stringify({ version: STORAGE_VERSION, configuration: { ...ca, ...configuration } })
		);
		return readWorking(store, 'ca')?.configuration;
	};

	it('keeps any level the slider can reach, on either side of the shore', () => {
		expect(stored({ seabedPaint: 0.25 })?.seabedPaint).toBe(0.25);
		expect(stored({ seabedPaint: 0.63 })?.seabedPaint).toBe(0.63);
		expect(stored({ landPaint: 0 })?.landPaint).toBe(0);
		expect(stored({ landPaint: 1 })?.landPaint).toBe(1);
	});

	it('refuses a level off the scale or not a number at all', () => {
		expect(stored({ seabedPaint: 1.4 })?.seabedPaint).toBe(DEFAULT_SEABED_PAINT);
		expect(stored({ seabedPaint: -0.2 })?.seabedPaint).toBe(DEFAULT_SEABED_PAINT);
		expect(stored({ landPaint: 'half' })?.landPaint).toBe(DEFAULT_LAND_PAINT);
	});

	it('falls back for a blob written before the one strength became two levels', () => {
		const old = stored({ photoStrength: 0.5 });
		expect(old?.seabedPaint).toBe(DEFAULT_SEABED_PAINT);
		expect(old?.landPaint).toBe(DEFAULT_LAND_PAINT);
	});
});
