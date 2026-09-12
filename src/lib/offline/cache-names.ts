export const SHELL_CACHE_PREFIX = 'divemap-shell-';
export const RUNTIME_CACHE_PREFIX = 'divemap-runtime-';
export const AREA_CACHE_PREFIX = 'divemap-area-';
export const MANIFEST_CACHE = 'divemap-areas';

export function shellCache(version: string): string {
	return `${SHELL_CACHE_PREFIX}${version}`;
}

export function runtimeCache(version: string): string {
	return `${RUNTIME_CACHE_PREFIX}${version}`;
}

/**
 * A deploy replaces the shell and the runtime cache, because the archive bytes behind a URL may have
 * changed. Saved areas and the manifest outlive it: the diver pinned those on purpose.
 */
export function isStaleCache(name: string, version: string): boolean {
	if (name === shellCache(version) || name === runtimeCache(version)) return false;
	return name.startsWith(SHELL_CACHE_PREFIX) || name.startsWith(RUNTIME_CACHE_PREFIX);
}
