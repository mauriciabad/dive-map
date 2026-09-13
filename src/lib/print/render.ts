import { Map as MapLibre, addProtocol } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { installMarkerImages } from '$lib/map/marker-images';
import { GROUND_FILL_LAYERS, type StyleOptions, buildStyle } from '$lib/map/style';
import { PRINT_TEXTURE_SIZE, loadTextures, texturePalette } from '$lib/map/textures';
import { type DiveCard, planFor } from '$lib/domain/card';
import { CANVAS_PIXEL_CAP, renderZoom } from '$lib/domain/print';

/**
 * Render a card off-screen at print resolution.
 *
 * Five measured constraints shape this, each of which fails silently.
 *
 * 1. MapLibre clamps a canvas past `maxCanvasSize` and `getPixelRatio()` keeps
 *    reporting the value you asked for, so `canvas.width` is the only honest
 *    check on what came out.
 * 2. WebKit refuses a canvas past `CANVAS_PIXEL_CAP` pixels, which A3 at 300dpi
 *    exceeds by about 4%.
 * 3. A tile resolves `fill-pattern` when it is parsed, so a pattern added after
 *    that never reaches it and the habitats come out unpainted. Install the
 *    textures before the map exists and again on every `styledata`.
 * 4. A container parked off-canvas at `left:-20000px` is never composited: the
 *    map runs, reports itself loaded, and hands back a buffer holding nothing but
 *    the clear colour. It has to be on-screen and nearly transparent.
 * 5. MapLibre's zoom is metres per CSS pixel and `pixelRatio` multiplies the
 *    buffer under it, so the zoom to set is `renderZoom(plan, pixelRatio)` and not
 *    the plan's own. Ratio 2 is deliberate: it is what makes labels and line
 *    weights land thick enough to read on laminate.
 */

/** Ratio 2 is what makes map labels and line weights survive lamination. */
export const PRINT_PIXEL_RATIO = 2;

export interface RenderedCard {
	/** Lossless, so a PNG export never passes through a JPEG. */
	readonly bitmap: ImageBitmap;
	/** What the canvas actually produced, which is not always what was asked for. */
	readonly width: number;
	readonly height: number;
	readonly requestedWidth: number;
	readonly requestedHeight: number;
	readonly clamped: boolean;
	/** False when tiles were still arriving at the deadline, so the sheet may be short. */
	readonly complete: boolean;
	/** Habitat codes present in the frame, for the legend. */
	readonly habitatCodes: readonly string[];
	/** Deepest isobath drawn in frame, for the depth badge. */
	readonly maxDepthM: number | undefined;
	/** Anything the print map complained about while drawing. */
	readonly problems: readonly string[];
	/** Luminance spread over the sheet. Near zero means a flat, empty card. */
	readonly pixelSpread: number;
	/** Patterns the style asked for and never got, which paint as nothing at all. */
	readonly missingImages: readonly string[];
}

/**
 * Wait for every tile in frame, by polling rather than by listening.
 *
 * `idle` is a single shot: if it fires between the load handler and the listener
 * being attached, the next one can arrive after a repaint but before any tile has
 * drawn, and the export silently captures an empty sheet.
 */
const tilesSettled = async (map: MapLibre, timeoutMs = 60_000): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	let steady = 0;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		steady = map.loaded() && map.areTilesLoaded() ? steady + 1 : 0;
		// Three consecutive clean reads, because a new tile request can land
		// between two of them and briefly make a half-drawn map look finished.
		if (steady >= 3) return true;
	}
	return false;
};

const luminanceSpread = (canvas: HTMLCanvasElement): number => {
	const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
	const side = Math.min(300, canvas.width, canvas.height);
	if (gl === null || side < 1) return -1;
	const pixels = new Uint8Array(side * side * 4);
	gl.readPixels(
		Math.max(0, Math.floor((canvas.width - side) / 2)),
		Math.max(0, Math.floor((canvas.height - side) / 2)),
		side,
		side,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		pixels
	);
	let sum = 0;
	let sumSquares = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		const l =
			0.299 * (pixels[i] ?? 0) + 0.587 * (pixels[i + 1] ?? 0) + 0.114 * (pixels[i + 2] ?? 0);
		sum += l;
		sumSquares += l * l;
	}
	const n = pixels.length / 4;
	const mean = sum / n;
	return Math.round(Math.sqrt(sumSquares / n - mean * mean) * 100) / 100;
};

export const renderCard = async (
	card: DiveCard,
	style: StyleOptions,
	pixelRatio = PRINT_PIXEL_RATIO
): Promise<RenderedCard> => {
	const plan = planFor(card);
	if (plan.oversized) {
		throw new RangeError(
			`${plan.widthPx}x${plan.heightPx} is ${plan.widthPx * plan.heightPx} pixels, over the ${CANVAS_PIXEL_CAP} a browser canvas holds. Lower the density or the size.`
		);
	}

	addProtocol('pmtiles', new Protocol().tile);
	const textures = await loadTextures(texturePalette(), PRINT_TEXTURE_SIZE);

	const host = document.createElement('div');
	host.style.cssText = [
		'position:fixed',
		'inset:0',
		'z-index:-1',
		'opacity:0.01',
		'pointer-events:none',
		`width:${plan.widthPx / pixelRatio}px`,
		`height:${plan.heightPx / pixelRatio}px`
	].join(';');
	document.body.append(host);

	try {
		const problems: string[] = [];
		const missingImages: string[] = [];
		const map = new MapLibre({
			container: host,
			style: buildStyle(style),
			center: [card.centre.lng, card.centre.lat],
			zoom: renderZoom(plan, pixelRatio),
			bearing: card.bearing,
			pixelRatio,
			// The hard 8192 that used to be here truncated any pixel sheet wider than
			// it, and a pixel sheet is the one size the user typed out by hand.
			maxCanvasSize: [Math.max(4096, plan.widthPx), Math.max(4096, plan.heightPx)],
			canvasContextAttributes: { preserveDrawingBuffer: true },
			attributionControl: false,
			interactive: false,
			fadeDuration: 0
		});

		map.on('error', (e) => problems.push(e.error.message.slice(0, 160)));
		map.on('styleimagemissing', (e) => missingImages.push(e.id));
		const install = (): void => {
			for (const texture of textures) {
				// The sheet's own pixelRatio scales the canvas; a texture's scales the
				// pattern. Reusing the outer one here shrank the seabed by a factor of four.
				if (!map.hasImage(texture.name)) {
					map.addImage(texture.name, texture.bitmap, { pixelRatio: texture.pixelRatio });
				}
			}
			installMarkerImages(map);
		};
		map.on('styledata', install);
		install();

		await new Promise<void>((resolve, reject) => {
			map.once('load', () => {
				resolve();
			});
			map.once('error', (e) => {
				reject(new Error(e.error.message));
			});
		});

		map.triggerRepaint();
		const settled = await tilesSettled(map);
		// One more frame after the last tile lands, so the buffer holds it.
		await new Promise((resolve) => {
			requestAnimationFrame(() => {
				requestAnimationFrame(resolve);
			});
		});

		const codes = new Set<string>();
		for (const feature of map.queryRenderedFeatures({ layers: [...GROUND_FILL_LAYERS] })) {
			// Tile properties are untyped by construction; narrow rather than trust.
			const code: unknown = feature.properties['code'];
			if (typeof code === 'string') codes.add(code);
		}
		if (codes.size === 0 && style.visible.includes(style.groundLayer)) {
			problems.push('ground layer is on but returned no habitat codes, so the legend is empty');
		}

		let maxDepthM: number | undefined;
		for (const feature of map.queryRenderedFeatures({ layers: ['isobath'] })) {
			const raw: unknown = feature.properties['depth'];
			const depth = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
			if (Number.isFinite(depth)) maxDepthM = Math.max(maxDepthM ?? depth, depth);
		}

		const canvas = map.getCanvas();
		const rendered: RenderedCard = {
			bitmap: await createImageBitmap(canvas),
			width: canvas.width,
			height: canvas.height,
			requestedWidth: plan.widthPx,
			requestedHeight: plan.heightPx,
			clamped: canvas.width < plan.widthPx || canvas.height < plan.heightPx,
			complete: settled,
			habitatCodes: [...codes],
			maxDepthM,
			problems,
			pixelSpread: luminanceSpread(canvas),
			missingImages
		};
		map.remove();
		return rendered;
	} finally {
		host.remove();
	}
};
