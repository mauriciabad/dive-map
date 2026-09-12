import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { evictArea, listAreas, saveArea, type SaveProgress } from './areas.ts';
import { parseRangeHeader } from './range-cache.ts';

const ARCHIVE = new Uint8Array(readFileSync(new URL('./fixture.pmtiles', import.meta.url)));
const ARCHIVE_URL = 'https://divemap.mauri.app/tiles/fixture.pmtiles';

function keyOf(request: RequestInfo | URL): string {
	if (typeof request === 'string') return request;
	return request instanceof URL ? request.href : request.url;
}

class FakeCache {
	readonly entries = new Map<string, Response>();

	match(request: RequestInfo | URL): Promise<Response | undefined> {
		return Promise.resolve(this.entries.get(keyOf(request))?.clone());
	}

	put(request: RequestInfo | URL, response: Response): Promise<void> {
		this.entries.set(keyOf(request), response);
		return Promise.resolve();
	}
}

const caches = new Map<string, FakeCache>();
let requests = 0;
let online = true;

function installFakes(): void {
	caches.clear();
	requests = 0;
	online = true;

	const open = (name: string): Promise<FakeCache> => {
		const existing = caches.get(name) ?? new FakeCache();
		caches.set(name, existing);
		return Promise.resolve(existing);
	};

	Object.defineProperty(globalThis, 'caches', {
		configurable: true,
		value: {
			open,
			keys: () => Promise.resolve([...caches.keys()]),
			delete: (name: string) => Promise.resolve(caches.delete(name)),
			async match(request: RequestInfo | URL) {
				for (const cache of caches.values()) {
					const hit = await cache.match(request);
					if (hit !== undefined) return hit;
				}
				return undefined;
			}
		}
	});

	globalThis.fetch = (_input, init) => {
		if (!online) return Promise.reject(new Error('network unavailable'));
		requests += 1;
		const range = parseRangeHeader(new Headers(init?.headers).get('Range'));
		if (range === null) return Promise.resolve(new Response(ARCHIVE, { status: 200 }));
		const end = Math.min(range.offset + range.length, ARCHIVE.length);
		return Promise.resolve(
			new Response(ARCHIVE.slice(range.offset, end), {
				status: 206,
				headers: { 'Content-Range': `bytes ${range.offset}-${end - 1}/${ARCHIVE.length}` }
			})
		);
	};
}

const MEDES = {
	name: 'Illes Medes',
	bounds: { west: 3.19, south: 42.02, east: 3.26, north: 42.07 },
	zoom: { min: 6, max: 8 },
	archives: [ARCHIVE_URL]
};

describe('saving an area for the boat', () => {
	beforeEach(installFakes);

	it('pins the bytes, lists the area, and reports progress that reaches the total', async () => {
		const progress: SaveProgress[] = [];
		const area = await saveArea(MEDES, { onProgress: (p) => progress.push(p) });

		expect(area.name).toBe('Illes Medes');
		expect(area.tiles).toBeGreaterThan(0);
		expect(area.bytes).toBeGreaterThan(0);
		expect(progress.at(-1)).toEqual({ done: area.tiles, total: area.tiles, bytes: area.bytes });
		expect(await listAreas()).toHaveLength(1);
		expect([...caches.keys()]).toContain(`divemap-area-${area.id}`);
	});

	it('re-saving the same water only fills gaps', async () => {
		const first = await saveArea(MEDES);
		const afterFirst = requests;
		expect(afterFirst).toBeGreaterThan(0);

		const second = await saveArea({ ...MEDES, name: 'Medes again' });
		expect(requests).toBeGreaterThan(afterFirst);

		// Each area holds its own copy, so evicting one cannot strand the other.
		expect([...caches.keys()]).toContain(`divemap-area-${first.id}`);
		expect([...caches.keys()]).toContain(`divemap-area-${second.id}`);
	});

	it('evicts an area and leaves nothing behind', async () => {
		const area = await saveArea(MEDES);
		await evictArea(area.id);

		expect(await listAreas()).toHaveLength(0);
		expect([...caches.keys()]).not.toContain(`divemap-area-${area.id}`);
	});

	it('abandons a failed save instead of listing a half-saved area', async () => {
		online = false;
		await expect(saveArea(MEDES)).rejects.toThrow('network unavailable');

		expect(await listAreas()).toHaveLength(0);
		expect([...caches.keys()].filter((name) => name.startsWith('divemap-area-'))).toEqual([]);
	});
});
