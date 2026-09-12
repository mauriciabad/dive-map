import { PDFDocument, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
// fontkit 2.x ships named exports only; there is no default in the browser build.
import * as fontkit from 'fontkit';
import { asset } from '$app/paths';
import { type DiveCard, scaleBar } from '$lib/domain/card';
import { PAPER, sheetSizeMm } from '$lib/domain/print';
import { type HabitatClass, legendFor } from '$lib/domain/habitat';
import { type Locale } from '$lib/i18n/locale';
import { t } from '$lib/i18n/messages';
import type { RenderedCard } from './render';

/**
 * The sheet a diver holds on the boat: a full-bleed seabed with the furniture
 * sitting on it, the way a battlemap carries its own title and key rather than
 * mounting the map in a frame. Everything is positioned in millimetres and
 * converted once, because the card is specified on paper.
 */

const PT_PER_MM = 72 / 25.4;
const mm = (v: number): number => v * PT_PER_MM;

const INK = rgb(0.11, 0.09, 0.06);
const PAPER_INK = rgb(0.94, 0.89, 0.81);
const BRASS = rgb(0.72, 0.54, 0.25);
const DIM = rgb(0.75, 0.69, 0.6);
const PLATE = rgb(0.08, 0.06, 0.05);

const LEGEND_WIDTH_MM = 46;
const PLATE_ALPHA = 0.82;

interface Fonts {
	readonly title: PDFFont;
	readonly label: PDFFont;
	readonly body: PDFFont;
}

const loadFont = async (doc: PDFDocument, file: string): Promise<PDFFont> => {
	const response = await fetch(asset(`/fonts/print/${file}`));
	if (!response.ok) throw new Error(`print font ${file}: HTTP ${response.status}`);
	return doc.embedFont(new Uint8Array(await response.arrayBuffer()), { subset: true });
};

const plate = (page: PDFPage, x: number, y: number, w: number, h: number): void => {
	page.drawRectangle({
		x: mm(x),
		y: mm(y),
		width: mm(w),
		height: mm(h),
		color: PLATE,
		opacity: PLATE_ALPHA,
		borderColor: BRASS,
		borderWidth: 0.5,
		borderOpacity: 0.5
	});
};

const drawScaleBar = (page: PDFPage, card: DiveCard, fonts: Fonts, x: number, y: number): void => {
	const bar = scaleBar(card);
	const h = 2.2;
	const segments = 4;
	for (let i = 0; i < segments; i++) {
		page.drawRectangle({
			x: mm(x + (bar.lengthMm / segments) * i),
			y: mm(y),
			width: mm(bar.lengthMm / segments),
			height: mm(h),
			color: i % 2 === 0 ? PAPER_INK : INK,
			borderColor: PAPER_INK,
			borderWidth: 0.4
		});
	}
	page.drawText(`0`, { x: mm(x), y: mm(y + h + 1.2), size: 7, font: fonts.body, color: PAPER_INK });
	page.drawText(`${bar.metres} m`, {
		x: mm(x + bar.lengthMm - 6),
		y: mm(y + h + 1.2),
		size: 7,
		font: fonts.body,
		color: PAPER_INK
	});
	page.drawText(`1:${card.scale}`, {
		x: mm(x + bar.lengthMm + 4),
		y: mm(y + 0.4),
		size: 8,
		font: fonts.label,
		color: BRASS
	});
};

const drawLegend = async (
	doc: PDFDocument,
	page: PDFPage,
	classes: readonly HabitatClass[],
	fonts: Fonts,
	locale: Locale,
	x: number,
	top: number
): Promise<void> => {
	const rowH = 9;
	const height = classes.length * rowH + 12;
	plate(page, x, top - height, LEGEND_WIDTH_MM, height);

	page.drawText(t(locale, 'habitats').toUpperCase(), {
		x: mm(x + 3),
		y: mm(top - 6),
		size: 7,
		font: fonts.label,
		color: BRASS
	});

	let y = top - 12;
	for (const c of classes) {
		const response = await fetch(asset(`/textures/swatch/${c.texture}.jpg`));
		if (response.ok) {
			const image = await doc.embedJpg(new Uint8Array(await response.arrayBuffer()));
			page.drawImage(image, { x: mm(x + 3), y: mm(y - 5.5), width: mm(6.5), height: mm(6.5) });
			page.drawRectangle({
				x: mm(x + 3),
				y: mm(y - 5.5),
				width: mm(6.5),
				height: mm(6.5),
				borderColor: BRASS,
				borderWidth: 0.4
			});
		}
		const name = locale === 'ca' ? c.ca : locale === 'es' ? c.es : c.en;
		const lines = wrap(name, 26);
		let ly = y;
		for (const line of lines.slice(0, 2)) {
			page.drawText(line, {
				x: mm(x + 11.5),
				y: mm(ly - 3.4),
				size: 6.4,
				font: fonts.body,
				color: PAPER_INK
			});
			ly -= 3;
		}
		y -= rowH;
	}
};

const wrap = (text: string, max: number): string[] => {
	const words = text.split(' ');
	const lines: string[] = [];
	let line = '';
	for (const w of words) {
		if (line.length + w.length + 1 > max && line.length > 0) {
			lines.push(line);
			line = w;
		} else {
			line = line.length === 0 ? w : `${line} ${w}`;
		}
	}
	if (line.length > 0) lines.push(line);
	return lines;
};

export const composeCardPdf = async (
	card: DiveCard,
	rendered: RenderedCard,
	locale: Locale,
	maxDepthM?: number
): Promise<Uint8Array> => {
	const doc = await PDFDocument.create();
	doc.registerFontkit(fontkit);

	const fonts: Fonts = {
		title: await loadFont(doc, 'Alegreya-Bold.ttf'),
		label: await loadFont(doc, 'AlegreyaSans-Bold.ttf'),
		body: await loadFont(doc, 'AlegreyaSans-Regular.ttf')
	};

	const sheet = sheetSizeMm(card.sheet);
	const page = doc.addPage([mm(sheet.widthMm), mm(sheet.heightMm)]);
	const m = card.sheet.marginMm;

	page.drawRectangle({
		x: 0,
		y: 0,
		width: mm(sheet.widthMm),
		height: mm(sheet.heightMm),
		color: INK
	});

	const image = await doc.embedJpg(rendered.dataUrl);
	page.drawImage(image, {
		x: mm(m),
		y: mm(m),
		width: mm(sheet.widthMm - 2 * m),
		height: mm(sheet.heightMm - 2 * m)
	});

	page.drawRectangle({
		x: mm(m),
		y: mm(m),
		width: mm(sheet.widthMm - 2 * m),
		height: mm(sheet.heightMm - 2 * m),
		borderColor: BRASS,
		borderWidth: 1.1
	});

	const titleTop = sheet.heightMm - m - 4;
	const titleH = card.subtitle === undefined ? 15 : 20;
	plate(page, m + 4, titleTop - titleH, 96, titleH);
	page.drawText(card.title, {
		x: mm(m + 7),
		y: mm(titleTop - 10),
		size: 17,
		font: fonts.title,
		color: PAPER_INK
	});
	if (card.subtitle !== undefined) {
		page.drawText(card.subtitle, {
			x: mm(m + 7),
			y: mm(titleTop - 16),
			size: 8.5,
			font: fonts.body,
			color: DIM
		});
	}

	if (maxDepthM !== undefined) {
		const w = 30;
		plate(page, sheet.widthMm - m - 4 - w, titleTop - 15, w, 15);
		page.drawText(`${maxDepthM}`, {
			x: mm(sheet.widthMm - m - 4 - w + 4),
			y: mm(titleTop - 12),
			size: 22,
			font: fonts.title,
			color: BRASS
		});
		page.drawText('m', {
			x: mm(sheet.widthMm - m - 4 - w + 4 + `${maxDepthM}`.length * 6.2),
			y: mm(titleTop - 12),
			size: 10,
			font: fonts.label,
			color: BRASS
		});
	}

	const present = new Set(rendered.habitatCodes);
	const legend = legendFor(present, 12);
	if (legend.length > 0) {
		await drawLegend(doc, page, legend, fonts, locale, sheet.widthMm - m - 4 - LEGEND_WIDTH_MM, titleTop - (maxDepthM === undefined ? 0 : 19));
	}

	const footH = 17;
	plate(page, m + 4, m + 4, 104, footH);
	drawScaleBar(page, card, fonts, m + 7, m + 11);
	page.drawText(t(locale, 'disclaimer'), {
		x: mm(m + 7),
		y: mm(m + 7),
		size: 6.4,
		font: fonts.body,
		color: DIM
	});

	page.drawText(
		'Batimetria i línia de costa © ICGC CC BY 4.0 · Hàbitats marins © Generalitat de Catalunya CC BY 4.0 · © OpenStreetMap contributors',
		{ x: mm(m + 4), y: mm(m - 2.6), size: 4.6, font: fonts.body, color: DIM }
	);

	doc.setTitle(card.title);
	doc.setSubject(t(locale, 'disclaimer'));
	doc.setCreator('divemap.mauri.app');
	return doc.save();
};

export const A3_PORTRAIT_MM = PAPER.A3;
