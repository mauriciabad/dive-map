export type AssetPolicy = 'precache' | 'runtime' | 'range';

const RULES: readonly (readonly [RegExp, AssetPolicy])[] = [
	[/\.pmtiles$/, 'range'],
	[/^\/textures\/(?:1024|2048)\//, 'runtime']
];

/**
 * 256 and 512 textures precache (about 0.7 MB) because a blank seabed polygon on a boat is a
 * failure. 1024 and 2048 exist for A3 printing on a laptop that has a network, so they cache
 * on first use instead of costing a phone 4.7 MB at the dock.
 */
export function assetPolicy(pathname: string): AssetPolicy {
	for (const [pattern, policy] of RULES) {
		if (pattern.test(pathname)) return policy;
	}
	return 'precache';
}

export function precachePaths(paths: readonly string[]): string[] {
	return paths.filter((path) => assetPolicy(path) === 'precache');
}
