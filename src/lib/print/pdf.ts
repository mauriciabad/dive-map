import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb } from '@cantoo/pdf-lib';
// fontkit 2.x ships named exports only; there is no default in the browser build.
import * as fontkit from 'fontkit';
import { asset } from '$app/paths';
import type { DiveCard } from '$lib/domain/card';
import type { SheetPlan } from '$lib/domain/print';
import type { Locale } from '$lib/i18n/locale';
import { t } from '$lib/i18n/messages';
import { type Drawing, type FontRole, type Rgb, layoutFurniture } from './furniture.ts';
import type { RenderedCard } from './render.ts';

/**
 * The sheet as a PDF: a full-bleed seabed with the furniture sitting on it, the
 * way a battlemap carries its own title and key rather than mounting the map in
 * a frame.
 *
 * The layout arrives in output pixels with a top-left origin and this is the only
 * place it becomes points with a bottom-left one, so the flip happens once.
 */

const PT_PER_MM = 72 / 25.4;

type Fonts = Record<FontRole, PDFFont>;

const colour = ([r, g, b]: Rgb) => rgb(r, g, b);

const loadFont = async (doc: PDFDocument, file: string): Promise<PDFFont> => {
	const response = await fetch(asset(`/fonts/print/${file}`));
	if (!response.ok) throw new Error(`print font ${file}: HTTP ${response.status}`);
	return doc.embedFont(new Uint8Array(await response.arrayBuffer()), { subset: true });
};

/** pdf-lib takes bytes, so the lossless bitmap is encoded exactly once, here. */
const jpegBytes = async (bitmap: ImageBitmap): Promise<Uint8Array> => {
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext('2d');
	if (context === null) throw new Error('no 2d context available to encode the sheet');
	context.drawImage(bitmap, 0, 0);
	const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
	return new Uint8Array(await blob.arrayBuffer());
};

const embedSwatches = async (
	doc: PDFDocument,
	drawings: readonly Drawing[]
): Promise<ReadonlyMap<string, PDFImage>> => {
	const images = new Map<string, PDFImage>();
	for (const drawing of drawings) {
		if (drawing.kind !== 'image' || images.has(drawing.url)) continue;
		const response = await fetch(drawing.url);
		if (!response.ok) continue;
		images.set(drawing.url, await doc.embedJpg(new Uint8Array(await response.arrayBuffer())));
	}
	return images;
};

const paint = (
	page: PDFPage,
	drawing: Drawing,
	scale: number,
	pageHeight: number,
	fonts: Fonts,
	images: ReadonlyMap<string, PDFImage>
): void => {
	switch (drawing.kind) {
		case 'rect':
			page.drawRectangle({
				x: drawing.x * scale,
				y: pageHeight - (drawing.y + drawing.h) * scale,
				width: drawing.w * scale,
				height: drawing.h * scale,
				...(drawing.fill === undefined ? {} : { color: colour(drawing.fill) }),
				...(drawing.fillOpacity === undefined ? {} : { opacity: drawing.fillOpacity }),
				...(drawing.stroke === undefined ? {} : { borderColor: colour(drawing.stroke) }),
				...(drawing.strokeWidth === undefined ? {} : { borderWidth: drawing.strokeWidth * scale }),
				...(drawing.strokeOpacity === undefined ? {} : { borderOpacity: drawing.strokeOpacity })
			});
			return;
		case 'text':
			page.drawText(drawing.text, {
				x: drawing.x * scale,
				y: pageHeight - drawing.y * scale,
				size: drawing.size * scale,
				font: fonts[drawing.font],
				color: colour(drawing.colour),
				...(drawing.opacity === undefined ? {} : { opacity: drawing.opacity })
			});
			return;
		case 'image': {
			const image = images.get(drawing.url);
			if (image === undefined) return;
			page.drawImage(image, {
				x: drawing.x * scale,
				y: pageHeight - (drawing.y + drawing.h) * scale,
				width: drawing.w * scale,
				height: drawing.h * scale
			});
			return;
		}
		case 'path': {
			const [first, ...rest] = drawing.points;
			if (first === undefined) return;
			const path = [
				`M ${first[0]} ${first[1]}`,
				...rest.map(([x, y]) => `L ${x} ${y}`),
				drawing.closed === true ? 'Z' : ''
			].join(' ');
			// drawSvgPath translates to (x, y) then scales by (s, -s), so anchoring it
			// at the top of the page turns the layout's y-down space into the page's.
			// Its border width is set inside that scaled space, so it stays unscaled.
			page.drawSvgPath(path, {
				x: 0,
				y: pageHeight,
				scale,
				...(drawing.fill === undefined ? {} : { color: colour(drawing.fill) }),
				...(drawing.stroke === undefined ? {} : { borderColor: colour(drawing.stroke) }),
				...(drawing.strokeWidth === undefined ? {} : { borderWidth: drawing.strokeWidth })
			});
			return;
		}
	}
};

export const composeCardPdf = async (
	card: DiveCard,
	plan: SheetPlan,
	rendered: RenderedCard,
	locale: Locale
): Promise<Uint8Array> => {
	const paper = plan.paper;
	if (paper === undefined) {
		throw new Error(
			`a PDF page needs a size in points and this sheet is ${plan.widthPx}x${plan.heightPx} pixels, which has none. Export it as a PNG.`
		);
	}
	if (rendered.clamped) {
		throw new Error(
			`the map came back at ${rendered.width}x${rendered.height} instead of ${rendered.requestedWidth}x${rendered.requestedHeight}, so the page would print stretched under a scale it does not hold.`
		);
	}

	const doc = await PDFDocument.create();
	doc.registerFontkit(fontkit);
	const fonts: Fonts = {
		title: await loadFont(doc, 'Alegreya-Bold.ttf'),
		label: await loadFont(doc, 'AlegreyaSans-Bold.ttf'),
		body: await loadFont(doc, 'AlegreyaSans-Regular.ttf')
	};

	const pageWidth = paper.pageMm.widthMm * PT_PER_MM;
	const pageHeight = paper.pageMm.heightMm * PT_PER_MM;
	const page = doc.addPage([pageWidth, pageHeight]);
	const scale = pageWidth / plan.widthPx;

	// Where the card is inside the paper. A guillotine operator and every prepress
	// tool made since read the TrimBox; without it a bleed is a page a few
	// millimetres too big and no way to know by how much. BleedBox is the whole
	// page, because the map runs to the paper edge either way.
	if (paper.bleedMm > 0) {
		const inset = paper.bleedMm * PT_PER_MM;
		page.setBleedBox(0, 0, pageWidth, pageHeight);
		page.setTrimBox(inset, inset, pageWidth - 2 * inset, pageHeight - 2 * inset);
	}

	page.drawImage(await doc.embedJpg(await jpegBytes(rendered.bitmap)), {
		x: 0,
		y: 0,
		width: pageWidth,
		height: pageHeight
	});

	const drawings = layoutFurniture({
		card,
		plan,
		rendered,
		locale,
		// Font metrics are linear, so measuring at the layout's own size returns
		// output pixels directly and the PDF breaks lines where the PNG does.
		measure: (text, size, font) => fonts[font].widthOfTextAtSize(text, size)
	});
	const images = await embedSwatches(doc, drawings);
	for (const drawing of drawings) paint(page, drawing, scale, pageHeight, fonts, images);

	doc.setTitle(card.title);
	doc.setSubject(t(locale, 'disclaimer'));
	doc.setCreator('divemap.mauri.app');
	return doc.save();
};
