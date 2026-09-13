import { assetPolicy, precachePaths, withinDeployment } from './assets.ts';
import { CHUNK_CACHE, isStaleCache, runtimeCache, shellCache } from './cache-names.ts';
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
	skipWaiting(): Promise<void>;
	addEventListener(
		type: 'install' | 'activate',
		handler: (event: ExtendableEventLike) => void
	): void;
	addEventListener(type: 'fetch', handler: (event: FetchEventLike) => void): void;
}

export interface ServiceWorkerManifest {
	readonly version: string;
	/**
	 * Where the site is served from, worked out by `$service-worker` from
	 * `location.pathname` rather than from the build. Empty at the site root and
	 * `/dive-map` on the github.io project URL, and every path below carries it.
	 */
	readonly base: string;
	readonly build: readonly string[];
	readonly files: readonly string[];
	readonly prerendered: readonly string[];
}

/** The origin the worker answers for, and where in it the site starts. */
export interface Deployment {
	readonly origin: string;
	readonly base: string;
}

export type FetchRoute = 'ignore' | 'range' | 'runtime' | 'shell' | 'network-first';

/**
 * What the shell must hold to boot, and what it would merely like to have.
 *
 * This split is what keeps an update alive. `cache.addAll` is all or nothing, so a
 * single response that is not ok throws away the entire installing worker: no
 * waiting worker, no notice, no update, and the browser goes on serving the old
 * build with nothing anywhere to say why. One 404 from a deploy landing mid-install,
 * or one request dropped on a boat, out of two hundred and thirty-six.
 *
 * `build` and `prerendered` are this version's own HTML and bundle. A shell missing
 * any of them cannot start the app, so an install that cannot fetch them all really
 * has failed and should. The static files are not like that. Fonts, icons, avatars,
 * textures and the habitat data all have a runtime route that fetches and caches
 * them on first use, so one that misses the install costs a request later and
 * nothing else.
 */
export interface PrecachePlan {
	readonly required: readonly string[];
	readonly optional: readonly string[];
}

/**
 * Cache keys, which are served paths and carry the base. What a path is *for* is
 * decided by its own part, which does not.
 */
export function precachePlan(manifest: ServiceWorkerManifest): PrecachePlan {
	const required = [...new Set([...manifest.build, ...manifest.prerendered])];
	const taken = new Set(required);
	return {
		required,
		optional: precachePaths(manifest.base, manifest.files).filter((path) => !taken.has(path))
	};
}

export function precacheList(manifest: ServiceWorkerManifest): string[] {
	const plan = precachePlan(manifest);
	return [...plan.required, ...plan.optional];
}

/**
 * Every precache fetch revalidates. This is the fix for issue #46.
 *
 * GitHub Pages serves the HTML and everything in `static` with `max-age=600`, and a
 * plain fetch during install is free to answer any of them out of the browser's HTTP
 * cache. It does. The installing worker fills this version's shell with the previous
 * version's index.html and the previous version's data, activates, and serves them
 * under this version's name. The version moves and the build does not, and reloading
 * cannot help because the stale copy is now the cached one. On a day with sixty
 * deploys the ten-minute window is almost never clear.
 *
 * `no-cache` rather than `reload` because it still revalidates rather than
 * re-downloads: the textures and fonts that did not change answer 304 and cost a
 * round trip instead of their bytes, which on a phone at the dock is the difference
 * that matters.
 */
async function fetchFresh(path: string): Promise<Response> {
	return fetch(new Request(path, { cache: 'no-cache' }));
}

async function precache(cache: Cache, plan: PrecachePlan): Promise<void> {
	await Promise.all(
		plan.required.map(async (path) => {
			const response = await fetchFresh(path);
			if (!response.ok) throw new Error(`${path} answered ${response.status}`);
			await cache.put(path, response);
		})
	);
	await Promise.all(
		plan.optional.map(async (path) => {
			try {
				const response = await fetchFresh(path);
				if (response.ok) await cache.put(path, response);
			} catch {
				// Its runtime route will fetch it on first use.
			}
		})
	);
}

export function routeRequest(
	request: Pick<Request, 'method' | 'url'>,
	deployment: Deployment,
	precached: ReadonlySet<string>
): FetchRoute {
	if (request.method !== 'GET') return 'ignore';
	const url = new URL(request.url);
	if (url.origin !== deployment.origin) return 'ignore';
	// Same host, someone else's project. On a shared origin that is another site.
	const own = withinDeployment(deployment.base, url.pathname);
	if (own === undefined) return 'ignore';

	switch (assetPolicy(own)) {
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
	const plan = precachePlan(manifest);
	const precached = new Set([...plan.required, ...plan.optional]);
	const deployment: Deployment = { origin: scope.location.origin, base: manifest.base };
	const ranges = createRangeReader({
		store: cacheStorageChunkStore(CHUNK_CACHE),
		fetch: (input, init) => fetch(input, init),
		// The runtime store outlives a deploy, so something has to prove it still
		// matches what is deployed. A saved area's reader does not do this.
		revalidate: true
	});

	scope.addEventListener('install', (event) => {
		/*
		 * Take over immediately instead of waiting for every tab to close.
		 *
		 * A deploy replaces the PMTiles archives. An old worker still serving chunks
		 * of the previous archive alongside freshly fetched ones hands pmtiles a
		 * mixture, and pmtiles rightly refuses it: "Server returned non-matching
		 * ETag after one retry". The app then cannot start until someone clears site
		 * data by hand, which is not something to ask of anyone, least of all on a
		 * boat.
		 *
		 * Waiting for a page to say when was tried instead and is worse on both
		 * counts. A reload does not release a waiting worker, so every browser
		 * holding the build before this one would have stayed on it until its last
		 * tab closed, and `skipWaiting` called later from a message has to wait for
		 * the running worker to finish whatever it is serving, which on a map is
		 * whenever the tiles stop. When to reload is the page's question, and the
		 * page answers it in offline/registration.ts.
		 */
		event.waitUntil(
			(async () => {
				const cache = await caches.open(shell);
				await precache(cache, plan);
				await scope.skipWaiting();
			})()
		);
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
			// The shell is cached under its served path, so on a subpath that is
			// `/dive-map/` and asking for `/` finds nothing at all.
			const root =
				request.mode === 'navigate' ? await caches.match(`${manifest.base}/`) : undefined;
			if (root !== undefined) return root;
			throw error;
		}
	}

	scope.addEventListener('fetch', (event) => {
		const { request } = event;
		switch (routeRequest(request, deployment, precached)) {
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
