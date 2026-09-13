import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	OSM_TTL_MS,
	OVERPASS_MIRRORS,
	RETRY_MS,
	liveDiveFeatures,
	memoryOsmStore,
	type LiveOsmOptions
} from './overpass-cache.ts';

const ANSWER = readFileSync(new URL('../domain/fixtures/overpass.json', import.meta.url), 'utf8');

interface Call {
	readonly url: string;
	readonly query: string;
}

interface Overpass {
	readonly calls: Call[];
	readonly fetch: LiveOsmOptions['fetch'];
}

const overpass = (answers: readonly (string | Error)[]): Overpass => {
	const calls: Call[] = [];
	let index = 0;
	return {
		calls,
		fetch: (url, init) => {
			const body = init.body;
			calls.push({ url, query: body instanceof URLSearchParams ? (body.get('data') ?? '') : '' });
			const answer = answers[Math.min(index++, answers.length - 1)] ?? ANSWER;
			if (answer instanceof Error) return Promise.reject(answer);
			return Promise.resolve(new Response(answer, { status: 200 }));
		}
	};
};

const at = (now: number, extra: Partial<LiveOsmOptions> = {}): LiveOsmOptions => ({
	store: memoryOsmStore(),
	fetch: overpass([ANSWER]).fetch,
	now: () => now,
	...extra
});

const NOW = Date.parse('2026-09-13T08:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** The fixture, answered by a mirror whose database is this many days behind. */
const daysBehind = (days: number): string => {
	const answer: unknown = JSON.parse(ANSWER);
	const base = new Date(NOW - days * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');
	return JSON.stringify({ ...(answer as object), osm3s: { timestamp_osm_base: base } });
};

describe('the live OSM fetch', () => {
	it('fetches when nothing is cached, and caches what it got', async () => {
		const store = memoryOsmStore();
		const net = overpass([ANSWER]);
		const first = await liveDiveFeatures(at(1000, { store, fetch: net.fetch }));
		expect(first?.origin).toBe('network');
		expect(first?.collection.features.length).toBeGreaterThan(0);
		expect(net.calls).toHaveLength(1);
		expect((await store.read())?.entry?.collection.features.length).toBe(
			first?.collection.features.length
		);
	});

	it('sends one query no matter how many times the boat reloads', async () => {
		const store = memoryOsmStore();
		const net = overpass([ANSWER]);
		let clock = 1000;
		for (let reload = 0; reload < 10; reload++) {
			clock += 60_000;
			await liveDiveFeatures(at(clock, { store, fetch: net.fetch }));
		}
		expect(net.calls).toHaveLength(1);
	});

	it('goes back to Overpass once the TTL is past', async () => {
		const store = memoryOsmStore();
		const net = overpass([ANSWER]);
		await liveDiveFeatures(at(1000, { store, fetch: net.fetch }));
		const later = await liveDiveFeatures(at(1000 + OSM_TTL_MS + 1, { store, fetch: net.fetch }));
		expect(net.calls).toHaveLength(2);
		expect(later?.origin).toBe('network');
	});

	it('serves the stale cache when every mirror is down', async () => {
		const store = memoryOsmStore();
		await liveDiveFeatures(at(1000, { store, fetch: overpass([ANSWER]).fetch }));
		const dead = overpass([new Error('offline')]);
		const later = await liveDiveFeatures(at(1000 + OSM_TTL_MS + 1, { store, fetch: dead.fetch }));
		expect(later?.origin).toBe('cache');
		expect(later?.stale).toBe(true);
		expect(later?.collection.features.length).toBeGreaterThan(0);
		expect(dead.calls).toHaveLength(OVERPASS_MIRRORS.length);
	});

	it('returns nothing rather than throwing when there is no cache and no network', async () => {
		const dead = overpass([new Error('offline')]);
		expect(await liveDiveFeatures(at(1000, { fetch: dead.fetch }))).toBeUndefined();
	});

	it('never touches the network when the browser says it is offline', async () => {
		const net = overpass([ANSWER]);
		expect(await liveDiveFeatures(at(1000, { fetch: net.fetch, online: false }))).toBeUndefined();
		expect(net.calls).toHaveLength(0);
	});

	it('refuses a timed-out answer and keeps the cache it had', async () => {
		const store = memoryOsmStore();
		const good = await liveDiveFeatures(at(1000, { store, fetch: overpass([ANSWER]).fetch }));
		const partial = JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' });
		const later = await liveDiveFeatures(
			at(1000 + OSM_TTL_MS + 1, { store, fetch: overpass([partial]).fetch })
		);
		expect(later?.origin).toBe('cache');
		expect(later?.collection.features.length).toBe(good?.collection.features.length);
	});

	it('refuses an answer with no dive features in it', async () => {
		const empty = JSON.stringify({ elements: [] });
		expect(await liveDiveFeatures(at(1000, { fetch: overpass([empty]).fetch }))).toBeUndefined();
	});

	it('falls through the mirrors in order until one answers', async () => {
		const net = overpass([new Error('down'), ANSWER]);
		const result = await liveDiveFeatures(at(1000, { fetch: net.fetch }));
		expect(result?.origin).toBe('network');
		expect(net.calls.map((c) => c.url)).toEqual(OVERPASS_MIRRORS.slice(0, 2));
	});

	it('walks past a mirror serving an old database', async () => {
		const net = overpass([daysBehind(60), daysBehind(1)]);
		const result = await liveDiveFeatures(at(NOW, { fetch: net.fetch }));
		expect(net.calls).toHaveLength(2);
		expect(Date.parse(result?.base ?? '')).toBe(NOW - DAY);
	});

	it('takes nothing at all when every mirror is behind', async () => {
		// The shipped osm.geojson is itself a current Overpass answer, so a mirror
		// weeks behind would make the map worse while looking like an update.
		const net = overpass([daysBehind(60), daysBehind(20), daysBehind(40)]);
		expect(await liveDiveFeatures(at(NOW, { fetch: net.fetch }))).toBeUndefined();
		expect(net.calls).toHaveLength(OVERPASS_MIRRORS.length);
	});

	it('keeps a cache built from a newer database than any mirror offers', async () => {
		const store = memoryOsmStore();
		const good = await liveDiveFeatures(at(NOW, { store, fetch: overpass([daysBehind(1)]).fetch }));
		const lagging = overpass([daysBehind(60)]);
		const later = await liveDiveFeatures(at(NOW + OSM_TTL_MS + 1, { store, fetch: lagging.fetch }));
		expect(later?.origin).toBe('cache');
		expect(later?.base).toBe(good?.base);
	});

	it('does not ask again on the next load after every mirror failed', async () => {
		const store = memoryOsmStore();
		const dead = overpass([new Error('reset')]);
		expect(await liveDiveFeatures(at(NOW, { store, fetch: dead.fetch }))).toBeUndefined();
		expect(dead.calls).toHaveLength(OVERPASS_MIRRORS.length);
		// Nine more reloads inside the retry floor. This is the whole reason the
		// attempt is stamped: without it every one of them spends three failed
		// requests to learn what the first one already knows.
		for (let reload = 0; reload < 9; reload++) {
			await liveDiveFeatures(at(NOW + reload * 60_000, { store, fetch: dead.fetch }));
		}
		expect(dead.calls).toHaveLength(OVERPASS_MIRRORS.length);
	});

	it('asks again once the retry floor has passed', async () => {
		const store = memoryOsmStore();
		const dead = overpass([new Error('reset')]);
		await liveDiveFeatures(at(NOW, { store, fetch: dead.fetch }));
		const back = overpass([daysBehind(1)]);
		const result = await liveDiveFeatures(at(NOW + RETRY_MS, { store, fetch: back.fetch }));
		expect(result?.origin).toBe('network');
		expect(back.calls).toHaveLength(1);
	});

	it('holds the retry floor over a cache that is past its TTL', async () => {
		const store = memoryOsmStore();
		await liveDiveFeatures(at(NOW, { store, fetch: overpass([daysBehind(1)]).fetch }));
		const dead = overpass([new Error('reset')]);
		const first = await liveDiveFeatures(at(NOW + OSM_TTL_MS + 1, { store, fetch: dead.fetch }));
		expect(first?.origin).toBe('cache');
		expect(first?.stale).toBe(true);
		await liveDiveFeatures(at(NOW + OSM_TTL_MS + 60_000, { store, fetch: dead.fetch }));
		expect(dead.calls).toHaveLength(OVERPASS_MIRRORS.length);
	});

	it('survives a cache that throws, which is a private window', async () => {
		const broken = {
			read: () => Promise.reject(new Error('no storage')),
			write: () => Promise.reject(new Error('no storage'))
		};
		const result = await liveDiveFeatures(
			at(1000, { store: broken, fetch: overpass([ANSWER]).fetch })
		);
		expect(result?.origin).toBe('network');
	});
});
