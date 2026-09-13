import type { Map as MapLibre, StyleImageInterface } from 'maplibre-gl';
import { ICONS, type Icon, type IconName } from '$lib/ui/icons';
import { HABITAT_POINT_IMAGES } from './habitat-points';
import { MARKER_IMAGES } from './markers';
import { distanceField } from './sdf';
import { SPOT_IMAGES } from './spot-depths';

/**
 * The authored icons, rasterised once and handed to MapLibre as distance fields
 * so the style can tint and outline each one instead of the drawing code baking a
 * colour in. One drawing, ten colours, and the dark outline that is the only
 * reason a cream glyph survives a sunlit sand texture underneath it.
 *
 * These are generated rather than fetched, so unlike the seabed textures they
 * cost no request and can be installed before the first style finishes loading.
 * They still have to be reinstalled on every `styledata`: `setStyle` empties the
 * image registry, and an icon that is not put back leaves the markers silently
 * missing. That exact bug already cost this project a flat seabed once.
 */

/** The box every icon is drawn in. */
const BOX = 24;

/** Device pixels per box unit. Two is enough for the field; the shader does the rest. */
const SCALE = 2;

/**
 * Clear pixels around the drawing. MapLibre's halo reaches six image pixels past
 * the edge and stops; eight leaves the corner of a full-box glyph room for it.
 */
const PAD = 8;

const SIZE = BOX * SCALE + PAD * 2;

/** What one image pixel is worth on screen, so an icon at size 1 is 32 CSS pixels. */
export const MARKER_PIXEL_RATIO = SCALE;

/** The weight the whole icon set is drawn at. */
const STROKE = 2.2;

export interface MarkerImage {
	readonly id: string;
	readonly image: StyleImageInterface;
}

const draw = (context: CanvasRenderingContext2D, icon: Icon): void => {
	context.lineWidth = STROKE;
	context.lineCap = 'round';
	context.lineJoin = 'round';
	context.strokeStyle = '#fff';
	context.fillStyle = '#fff';
	// Solid shapes take the stroke too, so a filled hull and a drawn mast carry
	// the same weight and read as one drawing rather than two.
	for (const d of icon.fill ?? []) {
		const path = new Path2D(d);
		context.fill(path);
		context.stroke(path);
	}
	for (const d of icon.d ?? []) context.stroke(new Path2D(d));
	for (const [cx, cy, r] of icon.dots ?? []) {
		context.beginPath();
		context.arc(cx, cy, r, 0, Math.PI * 2);
		context.fill();
	}
};

const fieldFor = (name: IconName): StyleImageInterface => {
	const canvas = document.createElement('canvas');
	canvas.width = SIZE;
	canvas.height = SIZE;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (context === null) throw new Error('no 2d context for the marker icons');
	context.translate(PAD, PAD);
	context.scale(SCALE, SCALE);
	draw(context, ICONS[name]);

	const painted = context.getImageData(0, 0, SIZE, SIZE).data;
	const coverage = new Float64Array(SIZE * SIZE);
	for (let i = 0; i < coverage.length; i++) coverage[i] = (painted[i * 4 + 3] ?? 0) / 255;
	return { width: SIZE, height: SIZE, data: distanceField(coverage, SIZE, SIZE) };
};

/**
 * Build every marker image. Cached across style rebuilds and across the live map
 * and the print map, because the drawing never changes.
 */
let built: readonly MarkerImage[] | undefined;

export const markerImages = (): readonly MarkerImage[] => {
	built ??= [...MARKER_IMAGES, ...HABITAT_POINT_IMAGES, ...SPOT_IMAGES].map(({ id, icon }) => ({
		id,
		image: fieldFor(icon)
	}));
	return built;
};

/** Put back whatever the last `setStyle` threw away. Cheap, and it cannot loop. */
export const installMarkerImages = (map: MapLibre): void => {
	for (const { id, image } of markerImages()) {
		if (!map.hasImage(id)) map.addImage(id, image, { sdf: true, pixelRatio: MARKER_PIXEL_RATIO });
	}
};
