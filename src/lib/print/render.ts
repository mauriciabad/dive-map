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
	/** Habitat codes present in the frame, for the legend. */
	readonly habitatCodes: readonly string[];
}

const idle = (map: MapLibre): Promise<void> =>
	new Promise((resolve) => {
		if (map.loaded() && map.areTilesLoaded()) {
			resolve();
			return;
		}
		map.once('idle', () => {
			resolve();
		});
	});

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

	const host = document.createElement('div');
	host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width / devicePixelRatio}px;height:${height / devicePixelRatio}px;`;
	document.body.append(host);

	try {
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

		await new Promise<void>((resolve, reject) => {
			map.once('load', () => {
				resolve();
			});
			map.once('error', (e) => {
				reject(new Error(e.error.message));
			});
		});

		const loaded = await loadTextures(texturePalette(), PRINT_TEXTURE_SIZE);
		for (const { name, bitmap } of loaded) {
			if (map.hasImage(name)) map.updateImage(name, bitmap);
			else map.addImage(name, bitmap, { pixelRatio: 2 });
		}

		map.triggerRepaint();
		await idle(map);

		const codes = new Set<string>();
		for (const f of map.queryRenderedFeatures({ layers: ['ground-fill'] })) {
			const code = f.properties['code'];
			if (typeof code === 'string') codes.add(code);
		}

		const canvas = map.getCanvas();
		const rendered: RenderedCard = {
			dataUrl: canvas.toDataURL('image/jpeg', 0.92),
			width: canvas.width,
			height: canvas.height,
			requestedWidth: width,
			requestedHeight: height,
			clamped: canvas.width < width || canvas.height < height,
			habitatCodes: [...codes]
		};
		map.remove();
		return rendered;
	} finally {
		host.remove();
	}
};
