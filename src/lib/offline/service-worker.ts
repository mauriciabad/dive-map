import { assetPolicy, precachePaths } from './assets.ts';
import { isStaleCache, runtimeCache, shellCache } from './cache-names.ts';
import {
	cacheStorageChunkStore,
	createRangeReader,
	parseRangeHeader,
	rangeResponse
} from './range-cache.ts';

/**
 * The worker globals are declared structurally because `lib.webworker` cannot be loaded alongside
 * `lib.dom`, which is what the rest of the app compiles against. Only the members used here.
 */
export interface ExtendableEventLike {
	waitUntil(promise: Promise<unknown>): void;
}

export interface FetchEventLike {
	readonly request: Request;
	respondWith(response: Promise<Response>): void;
}

export interface ServiceWorkerScope {
	readonly location: { readonly origin: string };
	readonly clients: { claim(): Promise<void> };
	addEventListener(
		type: 'install' | 'activate',
		handler: (event: ExtendableEventLike) => void
	): void;
	addEventListener(type: 'fetch', handler: (event: FetchEventLike) => void): void;
}

export interface ServiceWorkerManifest {
	readonly version: string;
	readonly build: readonly string[];
	readonly files: readonly string[];
	readonly prerendered: readonly string[];
}

export type FetchRoute = 'ignore' | 'range' | 'runtime' | 'shell' | 'network-first';

export function precacheList(manifest: ServiceWorkerManifest): string[] {
	return [
		...new Set([...manifest.build, ...manifest.prerendered, ...precachePaths(manifest.files)])
	];
}

export function routeRequest(
	request: Pick<Request, 'method' | 'url'>,
	origin: string,
	precached: ReadonlySet<string>
): FetchRoute {
	if (request.method !== 'GET') return 'ignore';
	const url = new URL(request.url);
	if (url.origin !== origin) return 'ignore';

	switch (assetPolicy(url.pathname)) {
		case 'range':
			return 'range';
		case 'runtime':
			return 'runtime';
		case 'precache':
			return precached.has(url.pathname) ? 'shell' : 'network-first';
	}
}

export function registerServiceWorker(
	scope: ServiceWorkerScope,
	manifest: ServiceWorkerManifest
): void {
	const shell = shellCache(manifest.version);
	const runtime = runtimeCache(manifest.version);
	const precached = new Set(precacheList(manifest));
	const ranges = createRangeReader({
		store: cacheStorageChunkStore(runtime),
		fetch: (input, init) => fetch(input, init)
	});

	scope.addEventListener('install', (event) => {
		event.waitUntil(caches.open(shell).then((cache) => cache.addAll([...precached])));
	});

	scope.addEventListener('activate', (event) => {
		event.waitUntil(
			(async () => {
				for (const name of await caches.keys()) {
					if (isStaleCache(name, manifest.version)) await caches.delete(name);
				}
				await scope.clients.claim();
			})()
		);
	});

	async function serveRange(request: Request): Promise<Response> {
		const range = parseRangeHeader(request.headers.get('Range'));
		if (range === null) return fetch(request);
		const read = await ranges.read(request.url, range.offset, range.length);
		return rangeResponse(read, range.offset);
	}

	async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
		const cache = await caches.open(cacheName);
		const hit = await cache.match(request);
		if (hit !== undefined) return hit;
		const response = await fetch(request);
		if (response.ok) await cache.put(request, response.clone());
		return response;
	}

	async function networkFirst(request: Request): Promise<Response> {
		try {
			const response = await fetch(request);
			if (response.ok) {
				const cache = await caches.open(runtime);
				await cache.put(request, response.clone());
			}
			return response;
		} catch (error) {
			const hit = await caches.match(request);
			if (hit !== undefined) return hit;
			// A deep link opened offline still gets the prerendered shell to boot from.
			const root = request.mode === 'navigate' ? await caches.match('/') : undefined;
			if (root !== undefined) return root;
			throw error;
		}
	}

	scope.addEventListener('fetch', (event) => {
		const { request } = event;
		switch (routeRequest(request, scope.location.origin, precached)) {
			case 'ignore':
				return;
			case 'range':
				event.respondWith(serveRange(request));
				return;
			case 'runtime':
				event.respondWith(cacheFirst(request, runtime));
				return;
			case 'shell':
				event.respondWith(cacheFirst(request, shell));
				return;
			case 'network-first':
				event.respondWith(networkFirst(request));
				return;
		}
	});
}
