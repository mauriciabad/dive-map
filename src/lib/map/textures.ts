import { asset } from '$app/paths';
import { HABITATS, SUBSTRATES, UNSURVEYED_TEXTURE, textureOf } from '$lib/domain/habitat';
import type { TextureChoices } from '$lib/domain/habitat';

/**
 * Seabed textures ship as both JPEG XL and WebP at four sizes. Only Safari
 * decodes JXL without a flag today, so the format is decided once at startup by
 * actually decoding a pixel rather than by sniffing the user agent.
 *
 * Measured on this texture set, JXL at matched quality is about level with WebP
 * overall and roughly 10 percent smaller lossless. It is here because it costs
 * nothing to offer, not because it saves much.
 */

export const TEXTURE_SIZES = [256, 512, 1024] as const;
export type TextureSize = (typeof TEXTURE_SIZES)[number];

export type TextureFormat = 'jxl' | 'webp';

/** A real one-pixel lossless JXL, produced by libjxl. If it decodes, JXL is readable. */
const JXL_PROBE =
	'data:image/jxl;base64,/woAEBAJCAIBAIQCSxibnHGEAziAAzggSsA5BQEAIESACBABIkCE//fv+e+hMeeca+1zb5IkCQFVVVVVVdX///9z7+vu7u6G//fv+e+hMeeca+1zb5IkCQFVVVVVVdX///9z7+vu7u6G//fv+e+hMeeca+1zb5IkCQFVVVVVVdX///9z7+vu7u6G//fv+e+hMeeca+1zb5IkCQFVVVVVVdX///9z7+vu7u4+AAA=';

let detected: Promise<TextureFormat> | undefined;

export const textureFormat = (): Promise<TextureFormat> => {
	detected ??= (async (): Promise<TextureFormat> => {
		if (typeof createImageBitmap !== 'function') return 'webp';
		try {
			const bitmap = await createImageBitmap(await (await fetch(JXL_PROBE)).blob());
			bitmap.close();
			return 'jxl';
		} catch {
			return 'webp';
		}
	})();
	return detected;
};

/**
 * How wide one repeat of a seabed pattern lands on screen.
 *
 * A fill-pattern is laid out in CSS pixels: MapLibre divides the image by the
 * pixelRatio it was registered at. That ratio was a constant 2 while the image
 * size followed the device, so the same seabed repeated every 256 CSS pixels on
 * a laptop and every 512 on a retina screen, where it reads as blotches rather
 * than as ground. Registering each texture at `bitmap.width / PATTERN_CSS_SIZE`
 * pins the repeat wherever it is drawn, and the size below is then only a
 * question of how many device pixels to spend on it.
 */
export const PATTERN_CSS_SIZE = 256;

export const patternPixelRatio = (bitmapWidth: number): number => bitmapWidth / PATTERN_CSS_SIZE;

/**
 * Which texture size to load. Enough device pixels for the screen it is drawn
 * on, capped on a phone because the whole set is decoded and held: the 32
 * textures the catalogues name are 134 MB of bitmap at 1024 and 34 MB at 512,
 * and the phone is the device that also has to hold the tiles offline. Printing
 * always takes the full one.
 *
 * The floor is what makes this safe to land before every caller passes the
 * ratio above to `addImage`. A caller still registering at a fixed 2 gets
 * 512 / 2, which is the same 256 CSS pixels, on every screen up to 2x.
 */
export const sizeForScreen = (devicePixelRatio: number, coarsePointer: boolean): TextureSize => {
	const wanted = Math.max(PATTERN_CSS_SIZE * devicePixelRatio, PATTERN_CSS_SIZE * 2);
	const cap: TextureSize = coarsePointer ? 512 : 1024;
	return TEXTURE_SIZES.find((size) => size >= wanted && size <= cap) ?? cap;
};

export const textureUrl = (name: string, size: TextureSize, format: TextureFormat): string =>
	asset(`/textures/${size}/${name}.${format}`);

export { UNSURVEYED_TEXTURE } from '$lib/domain/habitat';

/**
 * The two textures the style paints with that no class names.
 *
 * The first is the whisper of rock under the coastline, on the surveyed land
 * and on the world beyond it. The second is what a ground polygon falls back to
 * when its code is in neither catalogue, which the live codes say never happens
 * and which would be a hole in the seabed if it did.
 *
 * Both are `fill-pattern` names like any other, so both have to be in the
 * registry on their own account. Both rode on the habitat catalogue instead,
 * unnoticed, because a class happened to name each of them. Repaint that class
 * and the style asks for an image nobody registered, which MapLibre answers by
 * drawing nothing at all rather than by complaining.
 */
export const LAND_TEXTURE = 'ch_rock';
export const GROUND_FALLBACK_TEXTURE = 'ch_sand';

/**
 * Exactly the textures the style names, and nothing else, deduplicated.
 *
 * Following the choices rather than the catalogues is what lets the picker offer
 * forty-nine textures against a registry that holds thirty-two. A class
 * repainted away from its catalogue texture takes its old one out of the set
 * unless another class still uses it, so choosing swaps a name in rather than
 * adding one. Fifty-three classes is the ceiling however wide the built set gets,
 * and the whole palette in one tile has to pack under GL_MAX_TEXTURE_SIZE at print
 * time, which at 512 it does with room to spare.
 */
export const texturePalette = (chosen: TextureChoices): readonly string[] => [
	...new Set([
		UNSURVEYED_TEXTURE,
		LAND_TEXTURE,
		GROUND_FALLBACK_TEXTURE,
		...[...HABITATS, ...SUBSTRATES].map((seabed) => textureOf(seabed, chosen))
	])
];

/**
 * What the picker's grid draws with. One step down from the map's own size,
 * because forty-nine bands open at once and the repeat is 256 CSS pixels wide
 * either way. Still the map's own file at the map's own repeat, which is what
 * makes the band an honest answer to "which one is this".
 */
export const THUMBNAIL_SIZE: TextureSize = 256;

/**
 * The wave crests the style scatters over water the survey never reached.
 *
 * Not in `texturePalette` and not in the size pyramid, because it is not a
 * seabed class: nothing picks it, the legend never names it, and the texture
 * picker must not offer it as something to paint a habitat with.
 *
 * It ships as a stencil, one 104 KB PNG carrying nothing but an alpha channel,
 * and takes its colour here from the palette rather than from the file. The
 * three crests it is built from came out of the pack flat: every opaque pixel in
 * every one of the 57 wave and foam assets is a single colour, white at
 * luminance 209 or teal at 175, with all the drawing in the alpha. So they were
 * already stencils, and a stencil can carry a chart's ink instead of a
 * battlemap's foam. Dropped in at their own 209 they would have been the
 * brightest thing on a map whose brightest thing is meant to be sunlit sand.
 */
export const FLOURISH_TEXTURE = 'flourish-waves';

/**
 * How wide one repeat lands on screen. Four times the seabed's, because these are
 * scattered marks rather than ground: at 256 the same ten crests came back every
 * 256 px and read as wallpaper. At 1024 a 1440 px screen holds under one and a
 * half repeats, so there is no grid to see.
 */
const FLOURISH_CSS_SIZE = 1024;

export const loadFlourish = async (
	ink: string,
	signal?: AbortSignal
): Promise<LoadedTexture | undefined> => {
	const response = await fetch(
		asset(`/textures/${FLOURISH_TEXTURE}.png`),
		signal ? { signal } : {}
	);
	if (!response.ok) return undefined;
	const stencil = await createImageBitmap(await response.blob());
	const { width, height } = stencil;
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d');
	if (context === null) return undefined;
	context.drawImage(stencil, 0, 0);
	stencil.close();
	// The file is alpha and nothing else, so painting through it leaves the ink
	// wherever a crest was drawn and nothing anywhere else.
	context.globalCompositeOperation = 'source-in';
	context.fillStyle = ink;
	context.fillRect(0, 0, width, height);
	return {
		name: FLOURISH_TEXTURE,
		bitmap: await createImageBitmap(canvas),
		pixelRatio: width / FLOURISH_CSS_SIZE
	};
};

export interface LoadedTexture {
	readonly name: string;
	readonly bitmap: ImageBitmap;
	/** Hand this to `addImage`. A constant here is what made the pattern follow the screen density. */
	readonly pixelRatio: number;
}

/**
 * MapLibre's addImage wants an ImageBitmap. Fetching each texture separately
 * rather than packing a sprite sheet is deliberate: it lets the print path swap
 * in the print size under the same image ids without rebuilding a sprite.
 */
export const loadTextures = async (
	names: readonly string[],
	size: TextureSize,
	signal?: AbortSignal
): Promise<readonly LoadedTexture[]> => {
	const format = await textureFormat();
	return Promise.all(
		names.map(async (name) => {
			const response = await fetch(textureUrl(name, size, format), signal ? { signal } : {});
			if (!response.ok) throw new Error(`texture ${name} at ${size}: HTTP ${response.status}`);
			const bitmap = await createImageBitmap(await response.blob());
			return { name, bitmap, pixelRatio: patternPixelRatio(bitmap.width) };
		})
	);
};
