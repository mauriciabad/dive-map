import {
	DIVE_BBOX,
	OverpassError,
	overpassQuery,
	parseOverpassAnswer,
	toDiveCollection,
	type DiveCollection
} from '$lib/domain/overpass';

/**
 * One Overpass answer, cached, for the whole boat.
 *
 * The rules this obeys, in the order they matter:
 *
 *   1. The map paints without it. The caller already has the build-time
 *      `osm.geojson` on screen, so everything here is an upgrade that either
 *      arrives or does not. Nothing awaits it and nothing fails when it fails.
 *   2. A reload is free. A cached answer inside its TTL is served without
 *      touching the network, so ten reloads at the dock are one query.
 *   3. Offline keeps what it had. The cache outlives its TTL; a stale copy beats
 *      a network that is not there, and `osm.geojson` is under that.
 *   4. A half answer is refused. `parseOverpassAnswer` throws on a remark, and an
 *      empty reduction is treated as a failed fetch, so a bad mirror cannot
 *      replace a good cache with nothing.
 */

/**
 * Six hours. The owner edits these features himself, so a boat that reloads before
 * leaving the marina should pick up this morning's mooring buoy. Shorter buys
 * nothing anybody would notice and spends someone else's Overpass budget.
 */
export const OSM_TTL_MS = 6 * 60 * 60 * 1000;

/** Overpass answers this bbox in about twenty seconds. Past this the signal is not there. */
const TIMEOUT_MS = 75_000;

/** Overpass's own budget for the query, which it enforces server side. */
const QUERY_TIMEOUT_S = 90;

export const OSM_CACHE = 'divemap-osm-live';

/**
 * The cache entry's key. Not a real endpoint: Cache Storage keys on a URL and this
 * names the thing rather than where it came from. The `v1` is the payload shape, so
 * a change to the reduction orphans the old entry instead of reading it back wrong.
 */
export const OSM_CACHE_KEY = 'https://divemap.mauri.app/live/osm-v1.json';

export const OVERPASS_MIRRORS: readonly string[] = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter',
	'https://overpass.private.coffee/api/interpreter'
];

export interface CachedOsm {
	/** Epoch milliseconds when this answer was fetched. */
	readonly fetchedAt: number;
	/** The replication timestamp of the Overpass database that answered. */
	readonly base: string;
	readonly collection: DiveCollection;
}

export interface OsmStore {
	read(): Promise<CachedOsm | undefined>;
	write(entry: CachedOsm): Promise<void>;
}

/** Where the answer came from, which is the only thing a caller needs to log. */
export type OsmOrigin = 'network' | 'cache';

export interface LiveOsm extends CachedOsm {
	readonly origin: OsmOrigin;
	/** True when the entry is past its TTL and was served because nothing better arrived. */
	readonly stale: boolean;
}

const isCachedOsm = (value: unknown): value is CachedOsm => {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Partial<CachedOsm>;
	return (
		typeof entry.fetchedAt === 'number' &&
		typeof entry.base === 'string' &&
		Array.isArray(entry.collection?.features)
	);
};

export function cacheStorageOsmStore(cacheName: string = OSM_CACHE): OsmStore {
	return {
		async read() {
			const cache = await caches.open(cacheName);
			const hit = await cache.match(OSM_CACHE_KEY);
			if (hit === undefined) return undefined;
			const parsed: unknown = await hit.json();
			return isCachedOsm(parsed) ? parsed : undefined;
		},
		async write(entry) {
			const cache = await caches.open(cacheName);
			await cache.put(
				OSM_CACHE_KEY,
				new Response(JSON.stringify(entry), {
					headers: { 'content-type': 'application/json' }
				})
			);
		}
	};
}

/** For tests, and for a browser that refuses Cache Storage in a private window. */
export function memoryOsmStore(): OsmStore {
	let held: CachedOsm | undefined;
	return {
		read: () => Promise.resolve(held),
		write: (entry) => {
			held = entry;
			return Promise.resolve();
		}
	};
}

export interface LiveOsmOptions {
	readonly store: OsmStore;
	readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
	readonly now: () => number;
	/** False skips the network outright, which is the whole of the offline path. */
	readonly online?: boolean;
	readonly bbox?: readonly [number, number, number, number];
	readonly mirrors?: readonly string[];
	readonly ttlMs?: number;
	readonly timeoutMs?: number;
}

const isFresh = (entry: CachedOsm, now: number, ttlMs: number): boolean =>
	now - entry.fetchedAt < ttlMs && now >= entry.fetchedAt;

async function askOverpass(
	mirror: string,
	query: string,
	options: LiveOsmOptions
): Promise<CachedOsm> {
	const response = await options.fetch(mirror, {
		method: 'POST',
		body: new URLSearchParams({ data: query }),
		signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS)
	});
	if (!response.ok) throw new OverpassError(`${mirror} answered ${response.status}`);
	const answer = parseOverpassAnswer(await response.json());
	const collection = toDiveCollection(answer.elements);
	// An answer with nothing in it for a bbox that holds nine hundred features is a
	// broken mirror, not an empty coast. Refusing it here is what keeps a good cache.
	if (collection.features.length === 0) {
		throw new OverpassError(`${mirror} answered with no dive features`);
	}
	return { fetchedAt: options.now(), base: answer.base, collection };
}

/**
 * The freshest dive features this device can get to, or undefined when it has
 * never had any. Never throws: every failure is a reason to keep what is already
 * on the map.
 */
export async function liveDiveFeatures(options: LiveOsmOptions): Promise<LiveOsm | undefined> {
	const ttlMs = options.ttlMs ?? OSM_TTL_MS;
	const cached = await options.store.read().catch(() => undefined);
	const now = options.now();
	if (cached !== undefined && isFresh(cached, now, ttlMs)) {
		return { ...cached, origin: 'cache', stale: false };
	}

	if (options.online ?? true) {
		const query = overpassQuery(options.bbox ?? DIVE_BBOX, QUERY_TIMEOUT_S);
		for (const mirror of options.mirrors ?? OVERPASS_MIRRORS) {
			try {
				const fetched = await askOverpass(mirror, query, options);
				await options.store.write(fetched).catch(() => undefined);
				return { ...fetched, origin: 'network', stale: false };
			} catch {
				// The next mirror, then the cache. A diver does not need to hear about
				// either, and there is nothing on this path they could do about it.
			}
		}
	}

	return cached === undefined ? undefined : { ...cached, origin: 'cache', stale: true };
}
