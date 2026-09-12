import { asset } from '$app/paths';
import { HABITATS, SUBSTRATES } from '$lib/domain/habitat';

/**
 * Seabed textures ship as both JPEG XL and WebP at four sizes. Only Safari
 * decodes JXL without a flag today, so the format is decided once at startup by
 * actually decoding a pixel rather than by sniffing the user agent.
 *
 * Measured on this texture set, JXL at matched quality is about level with WebP
 * overall and roughly 10 percent smaller lossless. It is here because it costs
 * nothing to offer, not because it saves much.
 */

export const TEXTURE_SIZES = [256, 512, 1024, 2048] as const;
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
 * Which texture size to load. The screen set trades grain for memory on a phone;
 * printing always takes the full one, because a 512px pattern blown up to A3 at
 * 200dpi is visibly soft.
 */
export const sizeForScreen = (devicePixelRatio: number, coarsePointer: boolean): TextureSize => {
	if (coarsePointer) return devicePixelRatio > 1.5 ? 512 : 256;
	return devicePixelRatio > 1.5 ? 1024 : 512;
};

export const PRINT_TEXTURE_SIZE: TextureSize = 2048;

export const textureUrl = (name: string, size: TextureSize, format: TextureFormat): string =>
	asset(`/textures/${size}/${name}.${format}`);

/** Every distinct texture either catalogue references, deduplicated. */
export const texturePalette = (): readonly string[] => [
	...new Set([...HABITATS, ...SUBSTRATES].map((c) => c.texture))
];

export interface LoadedTexture {
	readonly name: string;
	readonly bitmap: ImageBitmap;
}

/**
 * MapLibre's addImage wants an ImageBitmap. Fetching each texture separately
 * rather than packing a sprite sheet is deliberate: it lets the print path swap
 * in the 2048 set under the same image ids without rebuilding a sprite.
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
			return { name, bitmap: await createImageBitmap(await response.blob()) };
		})
	);
};
