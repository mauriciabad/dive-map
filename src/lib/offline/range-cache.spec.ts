import { readFileSync } from 'node:fs';
import { PMTiles } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_TEXTURES, SEABED_TEXTURES } from '$lib/domain/habitat';
import { assetPolicy, precachePaths } from './assets.ts';
import { CHUNK_CACHE, isStaleCache } from './cache-names.ts';
import { cachedRangeSource } from './pmtiles-source.ts';
import { precacheList, routeRequest, type FetchRoute } from './service-worker.ts';
import {
	contentTag,
	createRangeReader,
	lengthTag,
	memoryChunkStore,
	parseRangeHeader,
	rangeResponse,
	type ChunkStore,
	type StoredChunk
} from './range-cache.ts';
import { tilesInBounds } from './tiles.ts';

const ARCHIVE = new Uint8Array(readFileSync(new URL('./fixture.pmtiles', import.meta.url)));
const URL_UNDER_TEST = 'https://divemap.mauri.app/tiles/fixture.pmtiles';

interface Network {
	online: boolean;
	requests: number;
}

function rangeServer(network: Network): typeof globalThis.fetch {
	return (_input, init) => {
		if (!network.online) return Promise.reject(new Error('network unavailable'));
		network.requests += 1;
		const range = parseRangeHeader(new Headers(init?.headers).get('Range'));
		if (range === null) {
			return Promise.resolve(new Response(ARCHIVE, { status: 200 }));
		}
		const start = range.offset;
		const end = Math.min(start + range.length, ARCHIVE.length);
		return Promise.resolve(
			new Response(ARCHIVE.slice(start, end), {
				status: 206,
				headers: {
					'Content-Range': `bytes ${start}-${end - 1}/${ARCHIVE.length}`,
					ETag: '"fixture-v1"'
				}
			})
		);
	};
}

function hex(buffer: ArrayBuffer): string {
	return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('chunked range cache', () => {
	it('serves the same bytes from cache after the network goes away', async () => {
		const network: Network = { online: true, requests: 0 };
		const reader = createRangeReader({
			store: memoryChunkStore(),
			fetch: rangeServer(network),
			chunkSize: 256
		});

		const first = await reader.read(URL_UNDER_TEST, 700, 900);
		expect(first.fromCache).toBe(false);
		expect(first.data.byteLength).toBe(900);
		expect(network.requests).toBe(5);

		network.online = false;
		const second = await reader.read(URL_UNDER_TEST, 700, 900);

		expect(second.fromCache).toBe(true);
		expect(hex(second.data)).toBe(hex(first.data));
		expect(hex(second.data)).toBe(hex(ARCHIVE.slice(700, 1600).buffer));
		expect(network.requests).toBe(5);
	});

	it('still fails for a range nobody cached, so the offline read is not a silent passthrough', async () => {
		const network: Network = { online: true, requests: 0 };
		const reader = createRangeReader({
			store: memoryChunkStore(),
			fetch: rangeServer(network),
			chunkSize: 256
		});

		await reader.read(URL_UNDER_TEST, 0, 100);
		network.online = false;

		await expect(reader.read(URL_UNDER_TEST, 1500, 100)).rejects.toThrow('network unavailable');
	});

	it('reassembles a read that starts and ends mid-chunk', async () => {
		const network: Network = { online: true, requests: 0 };
		const reader = createRangeReader({
			store: memoryChunkStore(),
			fetch: rangeServer(network),
			chunkSize: 64
		});

		const read = await reader.read(URL_UNDER_TEST, 33, 200);
		expect(hex(read.data)).toBe(hex(ARCHIVE.slice(33, 233).buffer));
		expect(read.total).toBe(ARCHIVE.length);
	});

	it('returns what exists when the requested range runs past the end of the archive', async () => {
		const network: Network = { online: true, requests: 0 };
		const reader = createRangeReader({
			store: memoryChunkStore(),
			fetch: rangeServer(network),
			chunkSize: 256
		});

		const read = await reader.read(URL_UNDER_TEST, 0, 16384);
		expect(read.data.byteLength).toBe(ARCHIVE.length);
		expect(read.total).toBe(ARCHIVE.length);
	});

	it('builds a 206 whose Content-Range describes the window it returned', async () => {
		const network: Network = { online: true, requests: 0 };
		const reader = createRangeReader({
			store: memoryChunkStore(),
			fetch: rangeServer(network),
			chunkSize: 256
		});

		const response = rangeResponse(await reader.read(URL_UNDER_TEST, 512, 128), 512);
		expect(response.status).toBe(206);
		expect(response.headers.get('Content-Range')).toBe(`bytes 512-639/${ARCHIVE.length}`);
		expect(response.headers.get('ETag')).toBe('"fixture-v1"');
	});
});

describe('pmtiles over the chunk cache', () => {
	it('reads a real tile with the network unavailable', async () => {
		const network: Network = { online: true, requests: 0 };
		const store = memoryChunkStore();
		const online = createRangeReader({ store, fetch: rangeServer(network), chunkSize: 256 });

		const warm = new PMTiles(cachedRangeSource(URL_UNDER_TEST, online));
		const header = await warm.getHeader();
		expect(header.maxZoom).toBe(12);
		const before = await warm.getZxy(6, 32, 24);
		expect(before?.data.byteLength).toBeGreaterThan(0);
		expect(network.requests).toBeGreaterThan(0);

		network.online = false;
		const requestsBefore = network.requests;

		const cold = new PMTiles(cachedRangeSource(URL_UNDER_TEST, online));
		const after = await cold.getZxy(6, 32, 24);

		expect(after).toBeDefined();
		expect(hex(after?.data ?? new ArrayBuffer(0))).toBe(hex(before?.data ?? new ArrayBuffer(1)));
		expect(network.requests).toBe(requestsBefore);
	});
});

/** GitHub Pages hands out hex mtime and hex size, and a deploy moves the mtime. */
interface Deploy {
	etag: string;
	requests: number;
}

function deployedServer(deploy: Deploy): typeof globalThis.fetch {
	return (_input, init) => {
		deploy.requests += 1;
		const range = parseRangeHeader(new Headers(init?.headers).get('Range'));
		if (range === null) return Promise.resolve(new Response(ARCHIVE, { status: 200 }));
		const start = range.offset;
		const end = Math.min(start + range.length, ARCHIVE.length);
		return Promise.resolve(
			new Response(ARCHIVE.slice(start, end), {
				status: 206,
				headers: {
					'Content-Range': `bytes ${start}-${end - 1}/${ARCHIVE.length}`,
					ETag: deploy.etag
				}
			})
		);
	};
}

/**
 * What the browser actually holds, in two tiers.
 *
 * `cacheStorageChunkStore` reads at origin scope, so a chunk pinned by a saved
 * area answers an ordinary map pan. Its `dropUrl` deletes only from the runtime
 * cache it opened, because evicting what a diver pinned is the one thing it must
 * never do. A purge therefore cannot clear a pinned chunk, which is why a stale
 * one keeps coming back and why pmtiles keeps refusing the read after its retry.
 */
function twoTierStore(): {
	store: ChunkStore;
	pinned: Map<string, StoredChunk>;
	runtime: Map<string, StoredChunk>;
} {
	const pinned = new Map<string, StoredChunk>();
	const runtime = new Map<string, StoredChunk>();
	const store: ChunkStore = {
		get: (key) => Promise.resolve(pinned.get(key) ?? runtime.get(key) ?? null),
		put: (key, chunk) => {
			runtime.set(key, chunk);
			return Promise.resolve();
		},
		dropUrl: () => {
			runtime.clear();
			return Promise.resolve();
		}
	};
	return { store, pinned, runtime };
}

describe('an ETag that moves on every deploy', () => {
	// The two the owner actually saw, on a coastline.pmtiles that had not changed.
	const BEFORE = '"6aa65807-39dd38"';
	const AFTER = '"6aa659cc-39dd38"';

	it('keeps the size half and throws the deploy stamp away', () => {
		expect(contentTag(BEFORE)).toBe('"39dd38"');
		expect(contentTag(AFTER)).toBe(contentTag(BEFORE));
	});

	it('leaves an ETag that is already about the bytes alone', () => {
		expect(contentTag('"9b2cf1a4e5d6079e8f3a1b2c4d5e6f70"')).toBe(
			'"9b2cf1a4e5d6079e8f3a1b2c4d5e6f70"'
		);
		expect(contentTag('"fixture-v1"')).toBe('"fixture-v1"');
		expect(contentTag(null)).toBeNull();
	});

	/**
	 * Half warm on purpose. A deploy empties the runtime cache, but `dropUrl` and
	 * the version sweep both leave the caches a diver pinned, and the chunk store
	 * searches at origin scope so those still answer. A pinned chunk carrying the
	 * old stamp meeting a fresh one carrying the new stamp is the whole bug, and a
	 * read served entirely from either side never sees it.
	 */
	it('fetches only what is missing when a deploy moved nothing but the stamp', async () => {
		const deploy: Deploy = { etag: BEFORE, requests: 0 };
		const store = memoryChunkStore();
		const first = createRangeReader({ store, fetch: deployedServer(deploy), chunkSize: 256 });
		await first.read(URL_UNDER_TEST, 0, 600);

		deploy.etag = AFTER;
		deploy.requests = 0;
		// A new reader, because a reload is what the visitor actually does.
		const second = createRangeReader({ store, fetch: deployedServer(deploy), chunkSize: 256 });
		const reread = await second.read(URL_UNDER_TEST, 0, 1200);

		// Chunks 0 to 2 were already held and only 3 and 4 are missing. Treating the
		// stamp as identity condemns the three and refetches all five.
		expect(deploy.requests).toBe(2);
		expect(reread.etag).toBe('"39dd38"');
		expect(hex(reread.data)).toBe(hex(ARCHIVE.slice(0, 1200).buffer));
	});

	/**
	 * The property the reported bug turns on.
	 *
	 * The map reads archives through pmtiles' stock `Protocol`, so the Source is
	 * pmtiles' own `FetchSource` and the service worker answers its range requests
	 * from the chunk cache. `FetchSource` is the only thing in pmtiles that compares
	 * ETags: it keeps the one from the header read and throws `EtagMismatch` on any
	 * later read that disagrees. `cachedRangeSource` never throws it, which is why
	 * the saved-area download path was fine and only the map broke.
	 *
	 * So what has to hold is that the ETag on our response does not move when the
	 * bytes did not. A pinned chunk answering the header read and a fresh chunk
	 * answering a tile read have to agree, and before this fix they did not.
	 */
	it('puts one ETag on the response either side of a deploy', async () => {
		const deploy: Deploy = { etag: BEFORE, requests: 0 };
		const { store, pinned, runtime } = twoTierStore();
		const warm = createRangeReader({ store, fetch: deployedServer(deploy), chunkSize: 256 });
		await warm.read(URL_UNDER_TEST, 0, 256);
		for (const [key, chunk] of runtime) pinned.set(key, chunk);
		runtime.clear();

		deploy.etag = AFTER;
		const reader = createRangeReader({ store, fetch: deployedServer(deploy), chunkSize: 256 });
		// What pmtiles reads first, and remembers the ETag of. Served from the pin.
		const header = rangeResponse(await reader.read(URL_UNDER_TEST, 0, 100), 0);
		// A later read the pin does not cover, so this one is fetched.
		const tile = rangeResponse(await reader.read(URL_UNDER_TEST, 1500, 100), 1500);

		expect(deploy.requests).toBeGreaterThan(0);
		expect(header.headers.get('ETag')).toBe('"39dd38"');
		expect(tile.headers.get('ETag')).toBe(header.headers.get('ETag'));
	});

	/**
	 * The size half moving means a different archive, and the read that notices is
	 * the first one to reach past what is cached. A read served entirely from a warm
	 * cache asks nothing and so learns nothing, which is correct: that is the offline
	 * case, and pinned chunks are what a diver pinned them for.
	 */
	it('purges and refetches when the size half really did move', async () => {
		const deploy: Deploy = { etag: BEFORE, requests: 0 };
		const store = memoryChunkStore();
		const before = createRangeReader({ store, fetch: deployedServer(deploy), chunkSize: 256 });
		const warmed = await before.read(URL_UNDER_TEST, 0, 600);
		expect(warmed.etag).toBe('"39dd38"');

		deploy.etag = '"6aa659cc-41aa00"';
		deploy.requests = 0;
		const after = createRangeReader({ store, fetch: deployedServer(deploy), chunkSize: 256 });
		const reread = await after.read(URL_UNDER_TEST, 0, 1200);

		expect(reread.etag).toBe('"41aa00"');
		expect(reread.fromCache).toBe(false);
		expect(deploy.requests).toBeGreaterThan(0);
		// Every byte from the new archive, none of it mixed with the old chunks.
		expect(hex(reread.data)).toBe(hex(ARCHIVE.slice(0, 1200).buffer));
	});
});

/** Everything the deploy sweep used to cover, now that chunks outlive a deploy. */
describe('a server that sends no ETag', () => {
	const SHORTER = ARCHIVE.slice(0, ARCHIVE.length - 16).map((byte, index) =>
		index === 100 ? byte ^ 0xff : byte
	);

	interface Served {
		bytes: Uint8Array<ArrayBuffer>;
		requests: number;
	}

	function taglessServer(served: Served): typeof globalThis.fetch {
		return (_input, init) => {
			served.requests += 1;
			const range = parseRangeHeader(new Headers(init?.headers).get('Range'));
			if (range === null) return Promise.resolve(new Response(served.bytes, { status: 200 }));
			const start = range.offset;
			const end = Math.min(start + range.length, served.bytes.length);
			return Promise.resolve(
				new Response(served.bytes.slice(start, end), {
					status: 206,
					headers: { 'Content-Range': `bytes ${start}-${end - 1}/${served.bytes.length}` }
				})
			);
		};
	}

	it('identifies the archive by the length every range response states', async () => {
		const served: Served = { bytes: ARCHIVE, requests: 0 };
		const reader = createRangeReader({
			store: memoryChunkStore(),
			fetch: taglessServer(served),
			chunkSize: 256
		});

		const read = await reader.read(URL_UNDER_TEST, 0, 600);
		expect(read.etag).toBe(lengthTag(ARCHIVE.length));
	});

	it('purges and refetches when the archive behind the URL changes length', async () => {
		const served: Served = { bytes: ARCHIVE, requests: 0 };
		const store = memoryChunkStore();
		const before = createRangeReader({ store, fetch: taglessServer(served), chunkSize: 256 });
		await before.read(URL_UNDER_TEST, 0, 600);

		served.bytes = SHORTER;
		served.requests = 0;
		const after = createRangeReader({ store, fetch: taglessServer(served), chunkSize: 256 });
		const reread = await after.read(URL_UNDER_TEST, 0, 1200);

		expect(reread.etag).toBe(lengthTag(SHORTER.length));
		expect(reread.fromCache).toBe(false);
		expect(hex(reread.data)).toBe(hex(SHORTER.slice(0, 1200).buffer));
		expect(hex(reread.data)).not.toBe(hex(ARCHIVE.slice(0, 1200).buffer));
	});
});

describe('asset policy', () => {
	it('precaches the small textures and leaves the print sizes to first use', () => {
		expect(assetPolicy('/textures/256/ch_sand.webp')).toBe('precache');
		expect(assetPolicy('/textures/512/ch_sand.webp')).toBe('precache');
		expect(assetPolicy('/textures/1024/ch_sand.webp')).toBe('runtime');
	});

	// A picker-only texture is whatever the build emits over and above the two
	// catalogues. Precaching all of them put two hundred files into the install and
	// delayed the first repaint after a choice; a boat only needs the seabed the
	// catalogues actually paint. Taken off the catalogues rather than named here,
	// because a texture promoted into a catalogue starts precaching and a name
	// written down in this file would then be asserting the opposite of the rule.
	it('leaves a texture only the picker offers to first use', () => {
		const pickerOnly = SEABED_TEXTURES.filter((name) => !CATALOGUE_TEXTURES.includes(name));
		expect(pickerOnly.length).toBeGreaterThan(0);
		const eager = pickerOnly.filter(
			(name) => assetPolicy(`/textures/512/${name}.webp`) !== 'runtime'
		);
		expect(eager).toEqual([]);
		expect(assetPolicy('/textures/512/unsurveyed.webp')).toBe('precache');
	});

	it('never precaches a pmtiles archive and always precaches the small data files', () => {
		expect(assetPolicy('/tiles/bathymetry.pmtiles')).toBe('range');
		expect(assetPolicy('/tiles/dem.pmtiles')).toBe('range');
		expect(assetPolicy('/data/osm.geojson')).toBe('precache');
		expect(
			precachePaths(['/tiles/a.pmtiles', '/data/osm.geojson', '/textures/1024/x.webp'])
		).toEqual(['/data/osm.geojson']);
	});
});

describe('service worker routing', () => {
	const origin = 'https://divemap.mauri.app';
	const manifest = {
		version: '1700000000000',
		build: ['/_app/immutable/entry/app.js'],
		files: ['/textures/256/ch_sand.webp', '/textures/1024/ch_sand.webp', '/tiles/bathy.pmtiles'],
		prerendered: ['/']
	};
	const precached = new Set(precacheList(manifest));

	it('precaches the shell and the small textures but never the archive', () => {
		expect(precached).toEqual(
			new Set(['/_app/immutable/entry/app.js', '/', '/textures/256/ch_sand.webp'])
		);
	});

	it('sends each request to the strategy that keeps it alive offline', () => {
		const route = (url: string, method = 'GET'): FetchRoute =>
			routeRequest({ method, url }, origin, precached);

		expect(route(`${origin}/tiles/bathy.pmtiles`)).toBe('range');
		expect(route(`${origin}/textures/1024/ch_sand.webp`)).toBe('runtime');
		expect(route(`${origin}/textures/256/ch_sand.webp`)).toBe('shell');
		expect(route(`${origin}/`)).toBe('shell');
		expect(route(`${origin}/data/osm.geojson`)).toBe('network-first');
		expect(route('https://tiles.example.com/a.pmtiles')).toBe('ignore');
		// The ortophoto is somebody else's photograph on somebody else's server, and a
		// saved area is for the survey. Cross-origin is what keeps it out.
		expect(route('https://www.ign.es/wms-inspire/pnoa-ma?service=WMS')).toBe('ignore');
		expect(route(`${origin}/`, 'POST')).toBe('ignore');
	});

	/**
	 * `divemap-chunks` in that list is issue #36. It used to be the versioned runtime
	 * cache, so every deploy deleted the archive bytes a diver had already paid for,
	 * and on a site that deploys forty times a day the map was empty by the time the
	 * boat left. A chunk proves itself by its content tag instead.
	 */
	it('drops the caches a deploy replaced and keeps the areas and chunks a diver paid for', () => {
		const names = [
			'divemap-shell-old',
			'divemap-runtime-old',
			'divemap-shell-1700000000000',
			'divemap-runtime-1700000000000',
			'divemap-area-abc',
			'divemap-areas',
			CHUNK_CACHE
		];
		expect(names.filter((name) => isStaleCache(name, manifest.version))).toEqual([
			'divemap-shell-old',
			'divemap-runtime-old'
		]);
	});
});

describe('range header parsing', () => {
	it('reads a bounded range and refuses an open-ended one', () => {
		expect(parseRangeHeader('bytes=0-16383')).toEqual({ offset: 0, length: 16384 });
		expect(parseRangeHeader('bytes=100-')).toBeNull();
		expect(parseRangeHeader(null)).toBeNull();
	});
});

describe('tiles in bounds', () => {
	it('covers the Medes bbox at every zoom in the range', () => {
		const tiles = tilesInBounds(
			{ west: 3.21, south: 42.03, east: 3.24, north: 42.06 },
			{ min: 10, max: 12 }
		);
		expect(new Set(tiles.map((tile) => tile.z))).toEqual(new Set([10, 11, 12]));
		expect(tiles.every((tile) => tile.x < 2 ** tile.z && tile.y < 2 ** tile.z)).toBe(true);

		// The tiles holding 3.2234E 42.0470N, the Illes Medes dive site.
		const keys = new Set(tiles.map((tile) => `${tile.z}/${tile.x}/${tile.y}`));
		expect(keys).toContain('10/521/379');
		expect(keys).toContain('11/1042/759');
		expect(keys).toContain('12/2084/1519');
	});
});
