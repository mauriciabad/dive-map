import { CATALOGUE_TEXTURES, UNSURVEYED_TEXTURE } from '$lib/domain/habitat';

export type AssetPolicy = 'precache' | 'runtime' | 'range';

/** Named by the file, so `/textures/512/ch_sand.webp` answers `ch_sand`. */
const TEXTURE = /^\/textures\/\d+\/(.+)\.(?:webp|jxl)$/;

/** What the map paints before a diver has chosen anything. */
const PAINTED: ReadonlySet<string> = new Set([UNSURVEYED_TEXTURE, ...CATALOGUE_TEXTURES]);

const RULES: readonly (readonly [RegExp, AssetPolicy])[] = [[/\.pmtiles$/, 'range']];

/**
 * A boat carries the seabed it will actually paint.
 *
 * The picker offers every texture the build emits, and precaching all of them put
 * two hundred files into the install instead of eighty-eight. That is not only
 * weight at the dock: the install competed with the map's own fetches hard enough
 * to push the first repaint after a choice past the point a diver would call
 * immediate. So the thirty-one the catalogues name precache at 256 and 512, and
 * the rest are fetched when somebody picks one and kept in the runtime cache from
 * then on. 1024 is only ever asked for above 2x on a fine pointer, so it waits
 * for first use whatever the texture is.
 */
export function assetPolicy(pathname: string): AssetPolicy {
	for (const [pattern, policy] of RULES) {
		if (pattern.test(pathname)) return policy;
	}
	const texture = TEXTURE.exec(pathname);
	if (texture === null) return 'precache';
	if (pathname.startsWith('/textures/1024/')) return 'runtime';
	return PAINTED.has(texture[1] ?? '') ? 'precache' : 'runtime';
}

/**
 * The site's own part of a served path, or undefined where the path is not inside
 * the deployment at all.
 *
 * The rules above are written against the site root, and on the github.io project
 * URL nothing arrives that way: `$service-worker` works its base out from
 * `location.pathname`, so every manifest entry and every request comes through as
 * `/dive-map/textures/...`. `assetPolicy` then matched none of them and answered
 * `precache` for all of them, which is the default and the widest one. The install
 * would have gone from eighty-eight files to the whole static tree, every 1024
 * texture included, and the reason that split exists is that the wide install was
 * measured slowing the first repaint after a diver picks a texture.
 *
 * Strip it once, here, and the rules stay written against the one path shape.
 */
export function withinDeployment(base: string, pathname: string): string | undefined {
	if (base === '') return pathname;
	if (pathname === base) return '/';
	return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : undefined;
}

export function precachePaths(base: string, paths: readonly string[]): string[] {
	return paths.filter((path) => {
		const own = withinDeployment(base, path);
		return own !== undefined && assetPolicy(own) === 'precache';
	});
}
