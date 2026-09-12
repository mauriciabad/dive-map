import { asset } from '$app/paths';
import type { DiveCard } from '$lib/domain/card';
import type { SheetPlan } from '$lib/domain/print';
import type { Locale } from '$lib/i18n/locale';
import {
	type Drawing,
	type FontRole,
	type Measure,
	type Rgb,
	layoutFurniture
} from './furniture.ts';
import type { RenderedCard } from './render.ts';

/**
 * The sheet as a lossless raster, for a phone in a dry bag or a screen on the
 * boat. It paints the same display list the PDF does, so the two cannot drift.
 */

const FONT_ROLES = ['title', 'label', 'body'] as const satisfies readonly FontRole[];

const FONT_FILE: Record<FontRole, string> = {
	title: 'Alegreya-Bold.ttf',
	label: 'AlegreyaSans-Bold.ttf',
	body: 'AlegreyaSans-Regular.ttf'
};

const FAMILY: Record<FontRole, string> = {
	title: 'DiveSheetTitle',
	label: 'DiveSheetLabel',
	body: 'DiveSheetBody'
};

const fontSpec = (size: number, role: FontRole): string => `${size}px "${FAMILY[role]}", serif`;

/**
 * The same three TTFs pdf-lib embeds. Measuring against anything else would break
 * the lines somewhere other than the PDF does, and the two sheets would no longer
 * be the same sheet.
 */
const loadFonts = async (): Promise<void> => {
	await Promise.all(
		FONT_ROLES.map(async (role) => {
			const face = new FontFace(FAMILY[role], `url(${asset(`/fonts/print/${FONT_FILE[role]}`)})`);
			document.fonts.add(await face.load());
		})
	);
};

let fontsLoaded: Promise<void> | undefined;
const fontsReady = (): Promise<void> => (fontsLoaded ??= loadFonts());

const css = ([r, g, b]: Rgb): string =>
	`rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

const loadSwatches = async (
	drawings: readonly Drawing[]
): Promise<ReadonlyMap<string, ImageBitmap>> => {
	const images = new Map<string, ImageBitmap>();
	for (const drawing of drawings) {
		if (drawing.kind !== 'image' || images.has(drawing.url)) continue;
		const response = await fetch(drawing.url);
		if (!response.ok) continue;
		images.set(drawing.url, await createImageBitmap(await response.blob()));
	}
	return images;
};

const paint = (
	context: CanvasRenderingContext2D,
	drawing: Drawing,
	images: ReadonlyMap<string, ImageBitmap>
): void => {
	switch (drawing.kind) {
		case 'rect':
			if (drawing.fill !== undefined) {
				context.globalAlpha = drawing.fillOpacity ?? 1;
				context.fillStyle = css(drawing.fill);
				context.fillRect(drawing.x, drawing.y, drawing.w, drawing.h);
			}
			if (drawing.stroke !== undefined) {
				context.globalAlpha = drawing.strokeOpacity ?? 1;
				context.strokeStyle = css(drawing.stroke);
				context.lineWidth = drawing.strokeWidth ?? 1;
				context.strokeRect(drawing.x, drawing.y, drawing.w, drawing.h);
			}
			context.globalAlpha = 1;
			return;
		case 'text':
			context.globalAlpha = drawing.opacity ?? 1;
			context.fillStyle = css(drawing.colour);
			context.font = fontSpec(drawing.size, drawing.font);
			context.textBaseline = 'alphabetic';
			context.fillText(drawing.text, drawing.x, drawing.y);
			context.globalAlpha = 1;
			return;
		case 'image': {
			const image = images.get(drawing.url);
			if (image !== undefined) {
				context.drawImage(image, drawing.x, drawing.y, drawing.w, drawing.h);
			}
			return;
		}
		case 'path': {
			const [first, ...rest] = drawing.points;
			if (first === undefined) return;
			context.beginPath();
			context.moveTo(first[0], first[1]);
			for (const [x, y] of rest) context.lineTo(x, y);
			if (drawing.closed === true) context.closePath();
			if (drawing.fill !== undefined) {
				context.fillStyle = css(drawing.fill);
				context.fill();
			}
			if (drawing.stroke !== undefined) {
				context.strokeStyle = css(drawing.stroke);
				context.lineWidth = drawing.strokeWidth ?? 1;
				context.stroke();
			}
			return;
		}
	}
};

const toPng = async (canvas: HTMLCanvasElement): Promise<Blob> =>
	new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob === null) reject(new Error('the browser refused to encode the sheet as a PNG'));
			else resolve(blob);
		}, 'image/png');
	});

export const composeCardPng = async (
	card: DiveCard,
	plan: SheetPlan,
	rendered: RenderedCard,
	locale: Locale
): Promise<Blob> => {
	await fontsReady();

	const canvas = document.createElement('canvas');
	canvas.width = plan.widthPx;
	canvas.height = plan.heightPx;
	const context = canvas.getContext('2d');
	if (context === null) throw new Error('no 2d context available to compose the sheet');
	context.drawImage(rendered.bitmap, 0, 0);

	const measure: Measure = (text, size, font) => {
		context.font = fontSpec(size, font);
		return context.measureText(text).width;
	};
	const drawings = layoutFurniture({ card, plan, rendered, locale, measure });
	const images = await loadSwatches(drawings);
	for (const drawing of drawings) paint(context, drawing, images);

	return toPng(canvas);
};
