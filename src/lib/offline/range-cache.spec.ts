import { readFileSync } from 'node:fs';
import { PMTiles } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import { assetPolicy, precachePaths } from './assets.ts';
import { isStaleCache } from './cache-names.ts';
import { cachedRangeSource } from './pmtiles-source.ts';
import { precacheList, routeRequest, type FetchRoute } from './service-worker.ts';
import {
	createRangeReader,
	memoryChunkStore,
	parseRangeHeader,
	rangeResponse
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

describe('asset policy', () => {
	it('precaches the small textures and leaves the print sizes to first use', () => {
		expect(assetPolicy('/textures/256/ch_sand.webp')).toBe('precache');
		expect(assetPolicy('/textures/512/ch_sand.webp')).toBe('precache');
		expect(assetPolicy('/textures/1024/ch_sand.webp')).toBe('runtime');
		expect(assetPolicy('/textures/2048/ch_sand.webp')).toBe('runtime');
	});

	it('never precaches a pmtiles archive and always precaches the small data files', () => {
		expect(assetPolicy('/tiles/bathymetry.pmtiles')).toBe('range');
		expect(assetPolicy('/tiles/dem.pmtiles')).toBe('range');
		expect(assetPolicy('/data/osm.geojson')).toBe('precache');
		expect(
			precachePaths(['/tiles/a.pmtiles', '/data/osm.geojson', '/textures/2048/x.webp'])
		).toEqual(['/data/osm.geojson']);
	});
});

describe('service worker routing', () => {
	const origin = 'https://divemap.mauri.app';
	const manifest = {
		version: '1700000000000',
		build: ['/_app/immutable/entry/app.js'],
		files: ['/textures/256/ch_sand.webp', '/textures/2048/ch_sand.webp', '/tiles/bathy.pmtiles'],
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
		expect(route(`${origin}/textures/2048/ch_sand.webp`)).toBe('runtime');
		expect(route(`${origin}/textures/256/ch_sand.webp`)).toBe('shell');
		expect(route(`${origin}/`)).toBe('shell');
		expect(route(`${origin}/data/osm.geojson`)).toBe('network-first');
		expect(route('https://tiles.example.com/a.pmtiles')).toBe('ignore');
		// The ortophoto is somebody else's photograph on somebody else's server, and a
		// saved area is for the survey. Cross-origin is what keeps it out.
		expect(route('https://www.ign.es/wmts/pnoa-ma?service=WMTS')).toBe('ignore');
		expect(route(`${origin}/`, 'POST')).toBe('ignore');
	});

	it('drops the caches a deploy replaced and keeps the areas a diver pinned', () => {
		const names = [
			'divemap-shell-old',
			'divemap-runtime-old',
			'divemap-shell-1700000000000',
			'divemap-runtime-1700000000000',
			'divemap-area-abc',
			'divemap-areas'
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
