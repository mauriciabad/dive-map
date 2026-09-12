import { Map as MapLibre, addProtocol } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { buildStyle, type StyleOptions } from '$lib/map/style';
import { PRINT_TEXTURE_SIZE, loadTextures, texturePalette } from '$lib/map/textures';
import { type DiveCard, zoomForCard } from '$lib/domain/card';
import { pixelSize } from '$lib/domain/print';

/**
 * Render a card off-screen at print resolution.
 *
 * Two measured constraints shape this. MapLibre's default maxCanvasSize of 4096
 * silently clamps an A3 request to 2893x4096 and getPixelRatio() still reports
 * the value you asked for, so the only honest check is canvas.width. And WebKit
 * caps a canvas at 16,777,216 pixels, which A3 at 300dpi exceeds by about 4%,
 * so the sheet's dpi is what keeps this inside the ceiling rather than luck.
 */

const SAFARI_CANVAS_PIXEL_CAP = 16_777_216;

export interface RenderedCard {
	readonly dataUrl: string;
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
		await new Promise((r) => setTimeout(r, 250));
		steady = map.loaded() && map.areTilesLoaded() ? steady + 1 : 0;
		// Three consecutive clean reads, because a new tile request can land
		// between two of them and briefly make a half-drawn map look finished.
		if (steady >= 3) return true;
	}
	return false;
};

export const renderCard = async (
	card: DiveCard,
	style: StyleOptions,
	devicePixelRatio = 2
): Promise<RenderedCard> => {
	const { width, height } = pixelSize(card.sheet);
	if (width * height > SAFARI_CANVAS_PIXEL_CAP) {
		throw new RangeError(
			`${card.sheet.paper} at ${card.sheet.dpi}dpi is ${width * height} pixels, over the ${SAFARI_CANVAS_PIXEL_CAP} canvas ceiling. Lower the dpi.`
		);
	}

	addProtocol('pmtiles', new Protocol().tile);

	// Decode the patterns before the map exists. A tile resolves fill-pattern when
	// it is parsed, and a pattern added afterwards never reaches an already-parsed
	// tile, so the habitats come out unpainted. The live map only escapes this
	// because styledata fires early and repeatedly.
	const textures = await loadTextures(texturePalette(), PRINT_TEXTURE_SIZE);

	// On-screen but invisible, not parked off-canvas. A container at left:-20000px
	// is never composited, so the map runs, reports itself loaded, and hands back a
	// drawing buffer holding nothing but the clear colour.
	const host = document.createElement('div');
	host.style.cssText = [
		'position:fixed',
		'inset:0',
		'z-index:-1',
		'opacity:0.01',
		'pointer-events:none',
		`width:${width / devicePixelRatio}px`,
		`height:${height / devicePixelRatio}px`
	].join(';');
	document.body.append(host);

	try {
		const problems: string[] = [];
		const missingImages: string[] = [];
		const map = new MapLibre({
			container: host,
			style: buildStyle(style),
			center: [card.centre.lng, card.centre.lat],
			zoom: zoomForCard(card),
			bearing: card.bearing,
			pixelRatio: devicePixelRatio,
			maxCanvasSize: [8192, 8192],
			canvasContextAttributes: { preserveDrawingBuffer: true },
			attributionControl: false,
			interactive: false,
			fadeDuration: 0
		});

		map.on('error', (e) => problems.push(e.error.message.slice(0, 160)));
		map.on('styleimagemissing', (e) => missingImages.push(e.id));
		const install = (): void => {
			for (const { name, bitmap } of textures) {
				if (!map.hasImage(name)) map.addImage(name, bitmap, { pixelRatio: 2 });
			}
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
		await new Promise((r) => requestAnimationFrame(() => { requestAnimationFrame(r); }));

		const codes = new Set<string>();
		for (const f of map.queryRenderedFeatures({ layers: ['ground-fill'] })) {
			// Tile properties are untyped by construction; narrow rather than trust.
			const code: unknown = f.properties['code'];
			if (typeof code === 'string') codes.add(code);
		}

		const canvas = map.getCanvas();
		const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
		let pixelSpread = -1;
		if (gl !== null) {
			const side = 300;
			const px = new Uint8Array(side * side * 4);
			gl.readPixels(
				Math.floor(canvas.width / 2 - side / 2),
				Math.floor(canvas.height / 2 - side / 2),
				side,
				side,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				px
			);
			let sum = 0;
			let sumSq = 0;
			for (let i = 0; i < px.length; i += 4) {
				const l = 0.299 * (px[i] ?? 0) + 0.587 * (px[i + 1] ?? 0) + 0.114 * (px[i + 2] ?? 0);
				sum += l;
				sumSq += l * l;
			}
			const n = px.length / 4;
			const mean = sum / n;
			pixelSpread = Math.round(Math.sqrt(sumSq / n - mean * mean) * 100) / 100;
		}

		const rendered: RenderedCard = {
			dataUrl: canvas.toDataURL('image/jpeg', 0.92),
			width: canvas.width,
			height: canvas.height,
			requestedWidth: width,
			requestedHeight: height,
			clamped: canvas.width < width || canvas.height < height,
			complete: settled,
			problems,
			pixelSpread,
			missingImages,
			habitatCodes: [...codes]
		};
		map.remove();
		return rendered;
	} finally {
		host.remove();
	}
};
