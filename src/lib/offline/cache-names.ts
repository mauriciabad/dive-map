export const SHELL_CACHE_PREFIX = 'divemap-shell-';
export const RUNTIME_CACHE_PREFIX = 'divemap-runtime-';
export const AREA_CACHE_PREFIX = 'divemap-area-';
export const MANIFEST_CACHE = 'divemap-areas';

/**
 * The archive chunks a diver has already paid for, carried across deploys.
 *
 * This cache used to be the versioned runtime one, and that is what issue #36 was.
 * Every deploy mints a new version, `isStaleCache` deletes the old runtime cache on
 * activate, and the whole chunk store goes with it. Forty deploys landed on the day
 * the bug was filed, so somebody who loaded the coast at home and went to sea after
 * any one of them arrived with an empty cache and a map of markers on grey.
 *
 * A deploy is the wrong question to ask of a chunk. `createRangeReader` already
 * checks every stored chunk against the content tag the network reports for the
 * archive and calls `dropUrl` on the whole archive when they disagree, so a chunk
 * that really is stale is caught on the first read that reaches the network, and one
 * that is still current survives a deploy that did not touch it.
 */
export const CHUNK_CACHE = 'divemap-chunks';

export function shellCache(version: string): string {
	return `${SHELL_CACHE_PREFIX}${version}`;
}

export function runtimeCache(version: string): string {
	return `${RUNTIME_CACHE_PREFIX}${version}`;
}

/**
 * A deploy replaces the shell and the runtime cache, because the bytes behind a URL may have changed
 * and neither of those two carries anything that could tell. Saved areas, the manifest and the chunk
 * store outlive it. The diver pinned the first two on purpose, and the third can prove itself.
 */
export function isStaleCache(name: string, version: string): boolean {
	if (name === shellCache(version) || name === runtimeCache(version)) return false;
	return name.startsWith(SHELL_CACHE_PREFIX) || name.startsWith(RUNTIME_CACHE_PREFIX);
}

/**
 * Every cache this app opens is named from this file, and every name starts here.
 * The hand clear that promises to leave nothing behind finds them by this prefix, so
 * a cache opened under a name that skipped it would outlive a clear that said it took
 * everything. `maintenance.spec.ts` holds the exported names to it.
 */
export const APP_CACHE_PREFIX = 'divemap-';

/**
 * What a hand clear takes.
 *
 * `map-data` is the cure for a deploy that went wrong: the chunk store and the
 * runtime cache between them hold everything that came off the network while
 * somebody browsed, and both refill themselves from the network on the next read.
 * Saved areas are not in it, and neither is the shell, which is the app doing the
 * clearing.
 *
 * `everything` is the scope that does include saved areas, which is why the panel
 * asks before it runs it. A diver pinned those on purpose and cannot get them back
 * at sea.
 */
export type ClearScope = 'map-data' | 'everything';

export function inClearScope(scope: ClearScope, name: string): boolean {
	if (!name.startsWith(APP_CACHE_PREFIX)) return false;
	if (scope === 'everything') return true;
	return name === CHUNK_CACHE || name.startsWith(RUNTIME_CACHE_PREFIX);
}
