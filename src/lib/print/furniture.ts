import { asset } from '$app/paths';
import { type DiveCard, scaleBar, shows } from '$lib/domain/card';
import { legendFor } from '$lib/domain/habitat';
import type { SheetPlan } from '$lib/domain/print';
import type { Locale } from '$lib/i18n/locale';
import { t } from '$lib/i18n/messages';
import type { RenderedCard } from './render.ts';

/**
 * The furniture as a backend-independent display list.
 *
 * The PDF and the PNG are the same sheet on two different surfaces, and the one
 * way they drift is by each doing its own arithmetic. So the layout runs once,
 * in output pixels with a top-left origin, and each backend only translates
 * primitives into its own calls.
 */

export type Rgb = readonly [number, number, number];

export type FontRole = 'title' | 'label' | 'body';

export type Drawing =
	| {
			readonly kind: 'rect';
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
			readonly fill?: Rgb;
			readonly fillOpacity?: number;
			readonly stroke?: Rgb;
			readonly strokeWidth?: number;
			readonly strokeOpacity?: number;
	  }
	| {
			readonly kind: 'text';
			readonly x: number;
			/** The BASELINE, not the top of the glyph box. */
			readonly y: number;
			readonly text: string;
			readonly size: number;
			readonly font: FontRole;
			readonly colour: Rgb;
			readonly opacity?: number;
	  }
	| {
			readonly kind: 'image';
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
			readonly url: string;
	  }
	| {
			readonly kind: 'path';
			readonly points: readonly (readonly [number, number])[];
			readonly fill?: Rgb;
			readonly stroke?: Rgb;
			readonly strokeWidth?: number;
			readonly closed?: boolean;
	  };

/** Width of a run of text in output pixels, measured by the backend's own font. */
export type Measure = (text: string, size: number, font: FontRole) => number;

const INK: Rgb = [0.11, 0.09, 0.06];
const PAPER_INK: Rgb = [0.94, 0.89, 0.81];
const BRASS: Rgb = [0.72, 0.54, 0.25];
const DIM: Rgb = [0.75, 0.69, 0.6];
const PLATE: Rgb = [0.08, 0.06, 0.05];
const PLATE_ALPHA = 0.82;

/**
 * Sizes in furniture units. A unit is a millimetre on A3 and `plan.unitPx` has
 * already absorbed sheet size and print density, so every number here is a
 * multiple of it and the same layout holds on A5, on A2 and on a raster.
 */
const PAD = 3;
const GAP = 2.5;
const COLUMN_GAP = 4;
const RIGHT_COLUMN = 46;
const TITLE_COLUMN = 96;
const NORTH_SIDE = 24;
const LEGEND_ROW = 7;
const LEGEND_SWATCH = 5;
const BAR_HEIGHT = 2.6;
const BAR_SEGMENTS = 4;
const HAIRLINE = 0.18;

/**
 * Line advance and ascent, as multiples of the type size. The advance is
 * deliberately larger than the ascent and descent Alegreya actually uses, which
 * is what makes a text plate sized from these numbers always contain the ink it
 * holds, so bounds only ever have to be checked on plates.
 */
const LINE = 1.32;
const ASCENT = 1;

const SIZE = {
	title: 6,
	subtitle: 3,
	depth: 7.8,
	depthUnit: 3.5,
	legendHead: 2.5,
	legendBody: 2.3,
	barLabel: 2.5,
	ratio: 2.9,
	ruler: 2.1,
	disclaimer: 2.4,
	attribution: 1.8,
	north: 3.2
} as const;

/**
 * The ICGC licence asks for this line and the bathymetry metadata forbids
 * navigation use, so it is a quotation, not copy to be improved.
 */
const ATTRIBUTION =
	'Batimetria i línia de costa © ICGC CC BY 4.0 · Hàbitats marins © Generalitat de Catalunya CC BY 4.0 · © OpenStreetMap contributors';

const ELLIPSIS = '…';

/** Trim by grapheme, so a Catalan name with a combining mark never loses half a letter. */
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const graphemes = (text: string): string[] =>
	[...SEGMENTER.segment(text)].map((part) => part.segment);

const fit = (text: string, size: number, font: FontRole, max: number, measure: Measure): string => {
	if (measure(text, size, font) <= max) return text;
	const chars = graphemes(text);
	while (chars.length > 0) {
		chars.pop();
		const candidate = chars.join('').replace(/[\s…]+$/u, '') + ELLIPSIS;
		if (measure(candidate, size, font) <= max) return candidate;
	}
	return '';
};

const wrap = (
	text: string,
	size: number,
	font: FontRole,
	max: number,
	maxLines: number,
	measure: Measure
): readonly string[] => {
	const words = text.split(' ').filter((word) => word.length > 0);
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		const candidate = line === '' ? word : `${line} ${word}`;
		if (line !== '' && measure(candidate, size, font) > max) {
			lines.push(line);
			line = word;
		} else {
			line = candidate;
		}
	}
	if (line !== '') lines.push(line);

	const kept = lines.slice(0, maxLines);
	const overflow = kept[maxLines - 1];
	if (lines.length > maxLines && overflow !== undefined) {
		kept[maxLines - 1] = `${overflow}${ELLIPSIS}`;
	}
	return kept.map((one) => fit(one, size, font, max, measure)).filter((one) => one.length > 0);
};

interface Box {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/** A measured element. Height is known before placement, so stacks cannot lie. */
interface Piece {
	readonly width: number;
	readonly height: number;
	readonly draw: (x: number, y: number) => readonly Drawing[];
}

const plateOf = (box: Box, unit: number): Drawing => ({
	kind: 'rect',
	x: box.x,
	y: box.y,
	w: box.w,
	h: box.h,
	fill: PLATE,
	fillOpacity: PLATE_ALPHA,
	stroke: BRASS,
	strokeWidth: HAIRLINE * unit,
	strokeOpacity: 0.5
});

interface TextLine {
	readonly text: string;
	readonly size: number;
	readonly font: FontRole;
	readonly colour: Rgb;
	readonly gapBefore: number;
}

/** Sized to the type it holds, so a short title is a badge rather than a bar of ink. */
const textPiece = (
	lines: readonly TextLine[],
	maxWidth: number,
	unit: number,
	measure: Measure
): Piece | undefined => {
	if (lines.length === 0) return undefined;
	const pad = PAD * unit;
	const height = lines.reduce((sum, line) => sum + line.gapBefore + line.size * LINE, 2 * pad);
	const width = Math.min(
		maxWidth,
		2 * pad + Math.max(...lines.map((line) => measure(line.text, line.size, line.font)))
	);
	return {
		width,
		height,
		draw: (x, y) => {
			const drawings: Drawing[] = [plateOf({ x, y, w: width, h: height }, unit)];
			let cursor = y + pad;
			for (const line of lines) {
				cursor += line.gapBefore;
				drawings.push({
					kind: 'text',
					x: x + pad,
					y: cursor + line.size * ASCENT,
					text: line.text,
					size: line.size,
					font: line.font,
					colour: line.colour
				});
				cursor += line.size * LINE;
			}
			return drawings;
		}
	};
};

const titlePiece = (
	card: DiveCard,
	width: number,
	unit: number,
	measure: Measure
): Piece | undefined => {
	const inner = Math.max(0, width - 2 * PAD * unit);
	const lines: TextLine[] = wrap(card.title, SIZE.title * unit, 'title', inner, 2, measure).map(
		(text) => ({ text, size: SIZE.title * unit, font: 'title', colour: PAPER_INK, gapBefore: 0 })
	);
	if (card.subtitle !== undefined) {
		for (const text of wrap(card.subtitle, SIZE.subtitle * unit, 'body', inner, 1, measure)) {
			lines.push({
				text,
				size: SIZE.subtitle * unit,
				font: 'body',
				colour: DIM,
				gapBefore: 0.8 * unit
			});
		}
	}
	return textPiece(lines, width, unit, measure);
};

const depthPiece = (maxDepthM: number, maxWidth: number, unit: number, measure: Measure): Piece => {
	const pad = PAD * unit;
	const size = SIZE.depth * unit;
	const unitSize = SIZE.depthUnit * unit;
	const suffix = measure('m', unitSize, 'label');
	const number = fit(
		`${Math.round(maxDepthM)}`,
		size,
		'title',
		Math.max(0, maxWidth - 2 * pad - suffix - 0.8 * unit),
		measure
	);
	const width = Math.min(maxWidth, 2 * pad + measure(number, size, 'title') + 0.8 * unit + suffix);
	const height = 2 * pad + size * LINE;
	return {
		width,
		height,
		draw: (x, y) => {
			const baseline = y + pad + size * ASCENT;
			return [
				plateOf({ x, y, w: width, h: height }, unit),
				{ kind: 'text', x: x + pad, y: baseline, text: number, size, font: 'title', colour: BRASS },
				{
					kind: 'text',
					x: x + pad + measure(number, size, 'title') + 0.8 * unit,
					y: baseline,
					text: 'm',
					size: unitSize,
					font: 'label',
					colour: BRASS
				}
			];
		}
	};
};

const legendPiece = (
	rendered: RenderedCard,
	locale: Locale,
	width: number,
	maxHeight: number,
	unit: number,
	measure: Measure
): Piece | undefined => {
	const pad = PAD * unit;
	const head = SIZE.legendHead * unit;
	const row = LEGEND_ROW * unit;
	const fits = Math.floor((maxHeight - 2 * pad - head * LINE) / row);
	if (fits < 1) return undefined;
	const classes = legendFor(new Set(rendered.habitatCodes), 12).slice(0, fits);
	if (classes.length === 0) return undefined;

	const body = SIZE.legendBody * unit;
	const textX = pad + LEGEND_SWATCH * unit + 1.5 * unit;
	const names = classes.map((habitat) =>
		wrap(habitat[locale], body, 'body', Math.max(0, width - textX - pad), 2, measure)
	);
	const height = 2 * pad + head * LINE + classes.length * row;

	return {
		width,
		height,
		draw: (x, y) => {
			const drawings: Drawing[] = [
				plateOf({ x, y, w: width, h: height }, unit),
				{
					kind: 'text',
					x: x + pad,
					y: y + pad + head * ASCENT,
					text: t(locale, 'habitats').toUpperCase(),
					size: head,
					font: 'label',
					colour: BRASS
				}
			];
			let top = y + pad + head * LINE;
			for (const [index, habitat] of classes.entries()) {
				const swatch = {
					x: x + pad,
					y: top + (row - LEGEND_SWATCH * unit) / 2,
					w: LEGEND_SWATCH * unit,
					h: LEGEND_SWATCH * unit
				};
				drawings.push(
					{ kind: 'image', ...swatch, url: asset(`/textures/swatch/${habitat.texture}.jpg`) },
					{ ...swatch, kind: 'rect', stroke: BRASS, strokeWidth: HAIRLINE * unit }
				);
				let cursor = top + 0.5 * unit;
				for (const text of names[index] ?? []) {
					drawings.push({
						kind: 'text',
						x: x + textX,
						y: cursor + body * ASCENT,
						text,
						size: body,
						font: 'body',
						colour: PAPER_INK
					});
					cursor += body * LINE;
				}
				top += row;
			}
			return drawings;
		}
	};
};

/**
 * The bar, the ratio and, on paper, what a ruler should read across the bar.
 *
 * That last line is the one that catches the commonest real scale lie: a printer
 * set to fit-to-page shrinks a sheet by three to six percent and says nothing, so
 * the ratio beside the bar is wrong and only a ruler can tell. A raster has no
 * page size, so it gets neither the ratio nor the measurement.
 */
const scaleBarPiece = (
	plan: SheetPlan,
	maxWidth: number,
	unit: number,
	measure: Measure
): Piece => {
	const pad = PAD * unit;
	// The budget picks the round number; the bar is then drawn at exactly the
	// length that number is. Stretching a bar to fill a plate is a scale lie.
	const bar = scaleBar(plan, Math.max(0, maxWidth - 2 * pad));
	const label = SIZE.barLabel * unit;
	const ratioSize = SIZE.ratio * unit;
	const rulerSize = SIZE.ruler * unit;

	const zero = '0';
	const far = `${bar.metres} m`;
	const labelRow = measure(zero, label, 'body') + 2 * unit + measure(far, label, 'body');
	const span = bar.lengthPx;

	const paper = plan.paper;
	const ratio = paper === undefined ? '' : `1:${Number(paper.scale.toPrecision(3))}`;
	const ruler = bar.printedMm === undefined ? '' : `${bar.printedMm.toFixed(1)} mm`;
	const ratioRow =
		ratio === ''
			? 0
			: measure(ratio, ratioSize, 'label') + 2 * unit + measure(ruler, rulerSize, 'body');

	const width = Math.min(maxWidth, 2 * pad + Math.max(span, labelRow, ratioRow));
	const height =
		2 * pad + label * LINE + BAR_HEIGHT * unit + (ratio === '' ? 0 : unit + ratioSize * LINE);

	return {
		width,
		height,
		draw: (x, y) => {
			const barTop = y + pad + label * LINE;
			const segment = span / BAR_SEGMENTS;
			const drawings: Drawing[] = [plateOf({ x, y, w: width, h: height }, unit)];
			for (let i = 0; i < BAR_SEGMENTS; i++) {
				drawings.push({
					kind: 'rect',
					x: x + pad + segment * i,
					y: barTop,
					w: segment,
					h: BAR_HEIGHT * unit,
					fill: i % 2 === 0 ? PAPER_INK : INK,
					stroke: PAPER_INK,
					strokeWidth: HAIRLINE * unit
				});
			}
			drawings.push(
				{
					kind: 'text',
					x: x + pad,
					y: y + pad + label * ASCENT,
					text: zero,
					size: label,
					font: 'body',
					colour: PAPER_INK
				},
				{
					kind: 'text',
					x: x + pad + span - measure(far, label, 'body'),
					y: y + pad + label * ASCENT,
					text: far,
					size: label,
					font: 'body',
					colour: PAPER_INK
				}
			);
			if (ratio !== '') {
				const baseline = barTop + BAR_HEIGHT * unit + unit + ratioSize * ASCENT;
				drawings.push(
					{
						kind: 'text',
						x: x + pad,
						y: baseline,
						text: ratio,
						size: ratioSize,
						font: 'label',
						colour: BRASS
					},
					{
						kind: 'text',
						x: x + pad + measure(ratio, ratioSize, 'label') + 2 * unit,
						y: baseline,
						text: ruler,
						size: rulerSize,
						font: 'body',
						colour: DIM
					}
				);
			}
			return drawings;
		}
	};
};

/**
 * North, turned by the bearing the sheet was framed at. Mercator is conformal, so
 * north is one direction over the whole sheet and the bearing is the only thing
 * that moves it. The N stays upright at the needle's point rather than turning
 * with it, because a letter printed upside down on a boat is not a letter.
 */
const northPiece = (bearing: number, unit: number, measure: Measure): Piece => {
	const side = NORTH_SIDE * unit;
	const size = SIZE.north * unit;
	const radians = (bearing * Math.PI) / 180;
	const turn = ([px, py]: readonly [number, number]): readonly [number, number] => [
		px * Math.cos(radians) + py * Math.sin(radians),
		py * Math.cos(radians) - px * Math.sin(radians)
	];
	const needle: readonly (readonly [number, number])[] = [
		[0, -6],
		[3, 4],
		[0, 1.5],
		[-3, 4]
	];

	return {
		width: side,
		height: side,
		draw: (x, y) => {
			const cx = x + side / 2;
			const cy = y + side / 2;
			const [tipX, tipY] = turn([0, -9]);
			return [
				plateOf({ x, y, w: side, h: side }, unit),
				{
					kind: 'path',
					points: needle.map(([px, py]) => {
						const [rx, ry] = turn([px * unit, py * unit]);
						return [cx + rx, cy + ry] as const;
					}),
					fill: BRASS,
					stroke: PAPER_INK,
					strokeWidth: HAIRLINE * unit,
					closed: true
				},
				{
					kind: 'text',
					x: cx + tipX * unit - measure('N', size, 'label') / 2,
					y: cy + tipY * unit + size * 0.36,
					text: 'N',
					size,
					font: 'label',
					colour: PAPER_INK
				}
			];
		}
	};
};

export const layoutFurniture = (input: {
	readonly card: DiveCard;
	readonly plan: SheetPlan;
	readonly rendered: RenderedCard;
	readonly locale: Locale;
	readonly measure: Measure;
}): readonly Drawing[] => {
	const { card, plan, rendered, locale, measure } = input;
	const unit = plan.unitPx;
	const left = plan.safePx;
	const top = plan.safePx;
	const right = plan.widthPx - plan.safePx;
	const bottom = plan.heightPx - plan.safePx;

	// The columns reserve their width whether or not anything is in them, so
	// switching an element off can never widen a neighbour into a third.
	const titleWidth = Math.max(
		0,
		Math.min(TITLE_COLUMN * unit, right - (RIGHT_COLUMN + COLUMN_GAP) * unit - left)
	);
	const bottomWidth = Math.max(0, right - (NORTH_SIDE + COLUMN_GAP) * unit - left);

	const drawings: Drawing[] = [];
	const add = (piece: Piece | undefined, x: number, y: number): void => {
		if (piece !== undefined) drawings.push(...piece.draw(x, y));
	};

	if (shows(card, 'title')) add(titlePiece(card, titleWidth, unit, measure), left, top);

	const depth =
		shows(card, 'depth') && rendered.maxDepthM !== undefined
			? depthPiece(rendered.maxDepthM, RIGHT_COLUMN * unit, unit, measure)
			: undefined;
	add(depth, right - (depth?.width ?? 0), top);

	const legendTop = top + (depth === undefined ? 0 : depth.height + GAP * unit);
	if (shows(card, 'legend')) {
		add(
			legendPiece(
				rendered,
				locale,
				RIGHT_COLUMN * unit,
				bottom - (NORTH_SIDE + GAP) * unit - legendTop,
				unit,
				measure
			),
			right - RIGHT_COLUMN * unit,
			legendTop
		);
	}

	let cursor = bottom;
	const stackUp = (piece: Piece | undefined): void => {
		if (piece === undefined) return;
		cursor -= piece.height;
		add(piece, left, cursor);
		cursor -= GAP * unit;
	};
	if (shows(card, 'attribution')) {
		stackUp(
			textPiece(
				wrap(
					ATTRIBUTION,
					SIZE.attribution * unit,
					'body',
					bottomWidth - 2 * PAD * unit,
					3,
					measure
				).map((text) => ({
					text,
					size: SIZE.attribution * unit,
					font: 'body' as const,
					colour: DIM,
					gapBefore: 0
				})),
				bottomWidth,
				unit,
				measure
			)
		);
	}
	if (shows(card, 'disclaimer')) {
		stackUp(
			textPiece(
				wrap(
					t(locale, 'disclaimer'),
					SIZE.disclaimer * unit,
					'body',
					bottomWidth - 2 * PAD * unit,
					3,
					measure
				).map((text) => ({
					text,
					size: SIZE.disclaimer * unit,
					font: 'body' as const,
					colour: PAPER_INK,
					gapBefore: 0
				})),
				bottomWidth,
				unit,
				measure
			)
		);
	}
	if (shows(card, 'scaleBar')) stackUp(scaleBarPiece(plan, bottomWidth, unit, measure));

	if (shows(card, 'northArrow')) {
		const arrow = northPiece(card.bearing, unit, measure);
		add(arrow, right - arrow.width, bottom - arrow.height);
	}

	return drawings;
};
