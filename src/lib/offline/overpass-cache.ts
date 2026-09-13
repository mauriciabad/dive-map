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

/**
 * How far behind the OSM database a mirror may be and still be worth taking. The
 * same fourteen days `OSM_MAX_AGE_DAYS` allows the build-time fetch.
 */
export const MAX_BASE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The soonest this device asks the mirrors again after an attempt that came back
 * with nothing usable. Half an hour is long enough that a marina full of reloads
 * costs Overpass one round of requests, and short enough that a boat which finds
 * signal mid-morning has today's buoys by the second dive.
 */
export const RETRY_MS = 30 * 60 * 1000;

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

/**
 * What this device knows, which is two separate facts. `entry` is the last good
 * answer and can be absent forever. `triedAt` is the last time the mirrors were
 * asked at all, and it is what stops a device whose mirrors are all down from
 * asking again on every single page load.
 */
export interface OsmRecord {
	readonly triedAt: number;
	readonly entry: CachedOsm | undefined;
}

export interface OsmStore {
	read(): Promise<OsmRecord | undefined>;
	write(record: OsmRecord): Promise<void>;
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

const isOsmRecord = (value: unknown): value is OsmRecord => {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Partial<OsmRecord>;
	return (
		typeof record.triedAt === 'number' && (record.entry === undefined || isCachedOsm(record.entry))
	);
};

export function cacheStorageOsmStore(cacheName: string = OSM_CACHE): OsmStore {
	return {
		async read() {
			const cache = await caches.open(cacheName);
			const hit = await cache.match(OSM_CACHE_KEY);
			if (hit === undefined) return undefined;
			const parsed: unknown = await hit.json();
			return isOsmRecord(parsed) ? parsed : undefined;
		},
		async write(record) {
			const cache = await caches.open(cacheName);
			await cache.put(
				OSM_CACHE_KEY,
				new Response(JSON.stringify(record), {
					headers: { 'content-type': 'application/json' }
				})
			);
		}
	};
}

/** For tests, and for a browser that refuses Cache Storage in a private window. */
export function memoryOsmStore(): OsmStore {
	let held: OsmRecord | undefined;
	return {
		read: () => Promise.resolve(held),
		write: (record) => {
			held = record;
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
	readonly retryMs?: number;
	readonly maxBaseAgeMs?: number;
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

const baseAge = (entry: CachedOsm, now: number): number => {
	const at = Date.parse(entry.base);
	return Number.isFinite(at) ? now - at : Number.POSITIVE_INFINITY;
};

/**
 * Ask the mirrors in order and take the first one that is caught up.
 *
 * The mirrors replicate at wildly different rates, and a lagging one answers a
 * valid query with a valid-looking short result: no error, no remark, just fewer
 * features. This is not theoretical. Measured from a browser on one afternoon,
 * overpass-api.de refused the request outright, kumi.systems did not answer inside
 * forty seconds, and private.coffee answered in five from a database forty-seven
 * days behind, which was missing features the shipped file already had.
 *
 * So a lagging answer is refused rather than kept as a fallback. The fallback here
 * is `static/data/osm.geojson`, which is itself an Overpass answer that was current
 * when it was built, and replacing it with something older would make the map worse
 * while looking like an update.
 */
async function askTheMirrors(options: LiveOsmOptions): Promise<CachedOsm | undefined> {
	const maxBaseAgeMs = options.maxBaseAgeMs ?? MAX_BASE_AGE_MS;
	const query = overpassQuery(options.bbox ?? DIVE_BBOX, QUERY_TIMEOUT_S);
	for (const mirror of options.mirrors ?? OVERPASS_MIRRORS) {
		try {
			const fetched = await askOverpass(mirror, query, options);
			if (baseAge(fetched, fetched.fetchedAt) <= maxBaseAgeMs) return fetched;
		} catch {
			// The next mirror, then whatever is already on the map. A diver does not
			// need to hear about either and could do nothing about it from a boat.
		}
	}
	return undefined;
}

const served = (entry: CachedOsm, now: number, ttlMs: number): LiveOsm => ({
	...entry,
	origin: 'cache',
	stale: !isFresh(entry, now, ttlMs)
});

/**
 * The freshest dive features this device can get to, or undefined when it has never
 * had any. Never throws: every failure is a reason to keep what is already on the
 * map.
 *
 * Overpass is asked only when both clocks say so. The TTL says the copy in hand is
 * old enough to be worth replacing, and the retry floor says the last attempt was
 * long enough ago to be worth repeating. The second one is what a boat notices: two
 * of the three mirrors are usually refusing or timing out, and without it every page
 * load would spend three failed requests to learn that again.
 */
export async function liveDiveFeatures(options: LiveOsmOptions): Promise<LiveOsm | undefined> {
	const ttlMs = options.ttlMs ?? OSM_TTL_MS;
	const record = await options.store.read().catch(() => undefined);
	const held = record?.entry;
	const now = options.now();

	const expired = held === undefined || !isFresh(held, now, ttlMs);
	const rested = record === undefined || now - record.triedAt >= (options.retryMs ?? RETRY_MS);
	if (!expired || !rested || !(options.online ?? true)) {
		return held === undefined ? undefined : served(held, now, ttlMs);
	}

	const fetched = await askTheMirrors(options);
	// Never trade a copy for one built from an older database, and stamp the attempt
	// either way so a device behind a broken mirror asks again on the retry floor
	// rather than on every reload.
	const keep = fetched !== undefined && (held === undefined || fetched.base >= held.base);
	const entry = keep ? fetched : held;
	await options.store.write({ triedAt: now, entry }).catch(() => undefined);
	if (entry === undefined) return undefined;
	return keep ? { ...entry, origin: 'network', stale: false } : served(entry, now, ttlMs);
}
