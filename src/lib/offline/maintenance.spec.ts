import { beforeEach, describe, expect, it } from 'vitest';
import * as cacheNames from './cache-names.ts';
import { clearCaches, formatBytes } from './maintenance.ts';
import { OSM_CACHE } from './overpass-cache.ts';

const held = new Set<string>();

function installFakeCaches(): void {
	held.clear();
	Object.defineProperty(globalThis, 'caches', {
		configurable: true,
		value: {
			keys: () => Promise.resolve([...held]),
			delete: (name: string) => Promise.resolve(held.delete(name))
		}
	});
}

const SOMEBODY_ELSES = 'workbox-precache-v2';

function fill(): void {
	held.add('divemap-shell-1789326791661');
	held.add('divemap-runtime-1789326791661');
	held.add('divemap-runtime-1789320000000');
	held.add('divemap-chunks');
	held.add('divemap-areas');
	held.add('divemap-area-7cd3d296');
	held.add(SOMEBODY_ELSES);
}

describe('clearing by hand', () => {
	beforeEach(() => {
		installFakeCaches();
		fill();
	});

	it('takes the chunk store and every runtime cache, and leaves the saved area', async () => {
		expect(await clearCaches('map-data')).toBe(3);

		expect([...held]).toEqual([
			'divemap-shell-1789326791661',
			'divemap-areas',
			'divemap-area-7cd3d296',
			SOMEBODY_ELSES
		]);
	});

	it('takes the saved area only under the scope that says so out loud', async () => {
		await clearCaches('map-data');
		expect(held.has('divemap-area-7cd3d296')).toBe(true);

		await clearCaches('everything');
		expect(held.has('divemap-area-7cd3d296')).toBe(false);
		expect(held.has('divemap-areas')).toBe(false);
	});

	it('leaves another site on the same origin alone under either scope', async () => {
		await clearCaches('everything');
		expect([...held]).toEqual([SOMEBODY_ELSES]);
	});

	it('ends in the same place run twice, so a half-done clear is fixed by pressing again', async () => {
		await clearCaches('map-data');
		const left = [...held];
		expect(await clearCaches('map-data')).toBe(0);
		expect([...held]).toEqual(left);
	});

	/**
	 * The promise "everything" makes is only as good as the prefix, so this reads the
	 * names out of the module rather than trusting the four written above.
	 */
	it('claims every cache name this app can open, including the one declared elsewhere', () => {
		const opened = Object.entries(cacheNames)
			.filter(([key, value]) => typeof value === 'string' && key !== 'APP_CACHE_PREFIX')
			.map(([, value]) => String(value));

		expect(opened.length).toBeGreaterThan(0);
		for (const name of [...opened, OSM_CACHE]) {
			expect(cacheNames.inClearScope('everything', name)).toBe(true);
		}
	});
});

describe('the storage number', () => {
	it('reads as a phone reports its own storage', () => {
		expect(formatBytes(0, 'en')).toBe('0 B');
		expect(formatBytes(940, 'en')).toBe('940 B');
		expect(formatBytes(1000, 'en')).toBe('1.0 kB');
		expect(formatBytes(340_000_000, 'en')).toBe('340 MB');
		expect(formatBytes(1_240_000_000, 'en')).toBe('1.2 GB');
	});

	it('writes the decimal mark the reader uses', () => {
		expect(formatBytes(1_240_000_000, 'ca')).toBe('1,2 GB');
	});

	it('never reports less than nothing, whatever the browser estimated', () => {
		expect(formatBytes(-1, 'en')).toBe('0 B');
	});
});
