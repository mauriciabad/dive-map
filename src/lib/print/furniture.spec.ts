import { describe, expect, it } from 'vitest';
import { type DiveCard, newCard, planFor } from '$lib/domain/card';
import { NO_TEXTURE_CHOICES, habitatByCode } from '$lib/domain/habitat';
import { FURNITURE_IDS, type FurnitureId, type Sheet } from '$lib/domain/print';
import { scale } from '$lib/domain/units';
import { type Drawing, type Measure, layoutFurniture } from './furniture.ts';
import type { RenderedCard } from './render.ts';

/**
 * The layout is pure, so every rule the sheet has to obey is checkable here
 * rather than by squinting at a PDF. A generous measure is deliberate: it makes
 * every text run wider than the real fonts will draw it, so a layout that fits
 * under this one fits under Alegreya.
 */
const measure: Measure = (text, size, font) =>
	text.length * size * (font === 'title' ? 0.62 : 0.55);

const HERE = { lng: 3.2165, lat: 41.9275 };

const SHEETS = {
	'A3 portrait': { kind: 'stock', stock: 'A3', orientation: 'portrait', dpi: 200, bleedMm: 0 },
	'A4 landscape': {
		kind: 'stock',
		stock: 'A4',
		orientation: 'landscape',
		dpi: 200,
		bleedMm: 0
	},
	'A5 portrait': { kind: 'stock', stock: 'A5', orientation: 'portrait', dpi: 200, bleedMm: 0 },
	'500 by 250 mm': { kind: 'millimetres', widthMm: 500, heightMm: 250, dpi: 150, bleedMm: 0 },
	'A3 with 3 mm bleed': {
		kind: 'stock',
		stock: 'A3',
		orientation: 'portrait',
		dpi: 200,
		bleedMm: 3
	},
	'1920 by 1080 raster': { kind: 'pixels', widthPx: 1920, heightPx: 1080 }
} as const satisfies Record<string, Sheet>;

const SHEET_NAMES = Object.keys(SHEETS) as readonly (keyof typeof SHEETS)[];

/** Structural stand-in: the layout reads nothing off the bitmap, only around it. */
const BITMAP: ImageBitmap = {
	width: 1,
	height: 1,
	close: () => undefined
};

const rendered = (over: Partial<RenderedCard> = {}): RenderedCard => ({
	bitmap: BITMAP,
	width: 2339,
	height: 3307,
	requestedWidth: 2339,
	requestedHeight: 3307,
	clamped: false,
	complete: true,
	habitatCodes: ['30102', '30512', '30509', '30302', '30103'],
	textures: NO_TEXTURE_CHOICES,
	maxDepthM: 42,
	problems: [],
	pixelSpread: 31,
	pixelMean: 128,
	missingImages: [],
	...over
});

const cardOn = (sheet: Sheet, over: Partial<DiveCard> = {}): DiveCard => ({
	...newCard(HERE, 'Illa Roja'),
	subtitle: 'Begur, Baix Empordà',
	sheet,
	framing: sheet.kind === 'pixels' ? { by: 'zoom', zoom: 17 } : { by: 'scale', scale: scale(2000) },
	...over
});

const lay = (card: DiveCard, over: Partial<RenderedCard> = {}): readonly Drawing[] =>
	layoutFurniture({
		card,
		plan: planFor(card),
		rendered: rendered(over),
		locale: 'ca',
		measure
	});

interface Rect {
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
}

/** Ink extent of a drawing. Text is measured, and its y is the baseline. */
const extent = (drawing: Drawing): Rect => {
	switch (drawing.kind) {
		case 'rect':
		case 'image':
			return {
				x0: drawing.x,
				y0: drawing.y,
				x1: drawing.x + drawing.w,
				y1: drawing.y + drawing.h
			};
		case 'text':
			return {
				x0: drawing.x,
				y0: drawing.y - drawing.size,
				x1: drawing.x + measure(drawing.text, drawing.size, drawing.font),
				y1: drawing.y + drawing.size * 0.3
			};
		case 'path':
			return {
				x0: Math.min(...drawing.points.map(([x]) => x)),
				y0: Math.min(...drawing.points.map(([, y]) => y)),
				x1: Math.max(...drawing.points.map(([x]) => x)),
				y1: Math.max(...drawing.points.map(([, y]) => y))
			};
	}
};

const PLATE_FILL = [0.08, 0.06, 0.05];

const plates = (drawings: readonly Drawing[]): readonly Rect[] =>
	drawings
		.filter((d) => d.kind === 'rect' && d.fill?.every((c, i) => c === PLATE_FILL[i]) === true)
		.map(extent);

const overlaps = (a: Rect, b: Rect): boolean =>
	a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.y0 < b.y1 - 1e-6 && b.y0 < a.y1 - 1e-6;

const texts = (drawings: readonly Drawing[]): readonly string[] =>
	drawings.filter((d) => d.kind === 'text').map((d) => d.text);

/** A mark is the one thing drawn outside the card, so it is the one thing excused. */
const isTrimMark = (drawing: Drawing): boolean =>
	drawing.kind === 'path' && drawing.points.length === 2;

const expectInside = (card: DiveCard, drawings: readonly Drawing[]): void => {
	const plan = planFor(card);
	const low = plan.bleedPx + plan.safePx;
	const highX = plan.widthPx - plan.bleedPx - plan.safePx;
	const highY = plan.heightPx - plan.bleedPx - plan.safePx;
	for (const drawing of drawings) {
		if (isTrimMark(drawing)) continue;
		const box = extent(drawing);
		expect({ kind: drawing.kind, ...box }).toMatchObject({
			x0: expect.closeTo(Math.max(box.x0, low), 6) as number,
			y0: expect.closeTo(Math.max(box.y0, low), 6) as number,
			x1: expect.closeTo(Math.min(box.x1, highX), 6) as number,
			y1: expect.closeTo(Math.min(box.y1, highY), 6) as number
		});
	}
};

const expectNoOverlap = (drawings: readonly Drawing[]): void => {
	const found = plates(drawings);
	for (let i = 0; i < found.length; i++) {
		for (let j = i + 1; j < found.length; j++) {
			const a = found[i];
			const b = found[j];
			if (a === undefined || b === undefined) continue;
			expect({ a, b, overlapping: overlaps(a, b) }).toMatchObject({ overlapping: false });
		}
	}
};

/** One drawing each element cannot be drawn without. */
const SIGNATURE: Record<FurnitureId, (drawings: readonly Drawing[]) => boolean> = {
	title: (d) => texts(d).some((text) => text.startsWith('Illa Roja')),
	depth: (d) => texts(d).includes('42'),
	legend: (d) => d.some((one) => one.kind === 'image'),
	scaleBar: (d) => texts(d).includes('0'),
	// A half of the needle, which a two-point trim mark can never be mistaken for.
	northArrow: (d) => d.some((one) => one.kind === 'path' && one.points.length === 3),
	attribution: (d) => texts(d).some((text) => text.startsWith('Batimetria'))
};

describe('the furniture stays on the sheet', () => {
	for (const name of SHEET_NAMES) {
		it(`keeps every drawing inside the safe inset on ${name}`, () => {
			const card = cardOn(SHEETS[name]);
			expectInside(card, lay(card));
		});

		it(`never overlaps two plates on ${name}`, () => {
			expectNoOverlap(lay(cardOn(SHEETS[name])));
		});

		it(`keeps the north arrow in its corner at every bearing on ${name}`, () => {
			for (const bearing of [0, 45, 90, 180, 270, 359, -30, 420]) {
				const card = cardOn(SHEETS[name], { bearing });
				const drawings = lay(card);
				expectInside(card, drawings);
				expectNoOverlap(drawings);
			}
		});

		it(`holds both rules for every element switched off on ${name}`, () => {
			for (const id of FURNITURE_IDS) {
				const without = FURNITURE_IDS.filter((other) => other !== id);
				for (const furniture of [[id], without]) {
					const card = cardOn(SHEETS[name], { furniture });
					const drawings = lay(card);
					expectInside(card, drawings);
					expectNoOverlap(drawings);
				}
			}
		});
	}

	it('draws nothing at all for an element that is off', () => {
		const sheet = SHEETS['A3 portrait'];
		for (const id of FURNITURE_IDS) {
			const off = cardOn(sheet, { furniture: FURNITURE_IDS.filter((other) => other !== id) });
			const on = cardOn(sheet, { furniture: [id] });
			expect({ id, off: SIGNATURE[id](lay(off)), on: SIGNATURE[id](lay(on)) }).toEqual({
				id,
				off: false,
				on: true
			});
		}
	});

	it('lays the right column out as a stack, so dropping the depth badge lifts the legend', () => {
		const sheet = SHEETS['A3 portrait'];
		const withDepth = lay(cardOn(sheet));
		const withoutDepth = lay(cardOn(sheet), { maxDepthM: undefined });
		const topOf = (drawings: readonly Drawing[]): number =>
			Math.min(...drawings.filter((d) => d.kind === 'image').map((d) => d.y));
		expect(topOf(withoutDepth)).toBeLessThan(topOf(withDepth));
		expectInside(cardOn(sheet), withoutDepth);
		expectNoOverlap(withoutDepth);
	});
});

describe('what the sheet is allowed to claim', () => {
	it('prints the ratio and the ruler check on paper', () => {
		const card = cardOn(SHEETS['A3 portrait']);
		expect(texts(lay(card))).toEqual(
			expect.arrayContaining([expect.stringMatching(/^1:\d+$/) as string])
		);
		expect(texts(lay(card))).toEqual(
			expect.arrayContaining([expect.stringMatching(/^\d+\.\d mm$/) as string])
		);
	});

	it('rounds the ratio to three significant figures rather than printing a false precision', () => {
		const card = cardOn(SHEETS['A3 portrait'], { framing: { by: 'zoom', zoom: 17.3 } });
		const ratio = texts(lay(card)).find((text) => text.startsWith('1:'));
		expect(ratio).toBe(`1:${Number((planFor(card).paper?.scale ?? 0).toPrecision(3))}`);
	});

	it('says nothing about a scale ratio on a raster, which has no page to be a ratio of', () => {
		const card = cardOn(SHEETS['1920 by 1080 raster']);
		expect(planFor(card).paper).toBeUndefined();
		expect(texts(lay(card)).filter((text) => text.includes('1:'))).toEqual([]);
	});

	it('still gives a raster a bar in metres', () => {
		const card = cardOn(SHEETS['1920 by 1080 raster']);
		expect(texts(lay(card))).toEqual(
			expect.arrayContaining([expect.stringMatching(/^\d+ m$/) as string])
		);
	});

	it('carries the attribution verbatim, which is what the licence asks for', () => {
		const card = cardOn(SHEETS['A3 portrait']);
		expect(texts(lay(card)).join(' ')).toContain('© ICGC CC BY 4.0');
	});

	/**
	 * The national shelf licence names the ministry as the source, so a sheet that
	 * truncated the line before it reached them would be a sheet in breach. Every
	 * size, because the smallest is where the wrap runs out of room.
	 */
	for (const name of SHEET_NAMES) {
		it(`names the ministry the shelf bathymetry is owed to on ${name}`, () => {
			const line = texts(lay(cardOn(SHEETS[name]))).join(' ');
			expect(line).toContain('Ministerio de Agricultura, Pesca y Alimentación');
			expect(line).toContain('© OpenStreetMap contributors');
		});
	}
});

describe('type that does not fit', () => {
	const LONG =
		'Cala de Sant Francesc i les Illes Formigues amb la punta de Milà i el sender de ronda';

	for (const name of SHEET_NAMES) {
		it(`wraps or truncates a long title rather than running it past the plate on ${name}`, () => {
			const card = cardOn(SHEETS[name], { title: LONG });
			const drawings = lay(card);
			expectInside(card, drawings);
			expectNoOverlap(drawings);
			expect(texts(drawings).some((text) => text.startsWith('Cala de'))).toBe(true);
		});
	}

	it('truncates a single word no wrapping can break', () => {
		const card = cardOn(SHEETS['A5 portrait'], { title: 'A'.repeat(300) });
		const drawings = lay(card);
		expectInside(card, drawings);
		expect(texts(drawings).some((text) => text.endsWith('…'))).toBe(true);
	});

	it('caps the legend at the rows the column has height for', () => {
		const short = cardOn({ kind: 'pixels', widthPx: 1600, heightPx: 300 });
		const drawings = lay(short);
		expectInside(short, drawings);
		expectNoOverlap(drawings);
		expect(drawings.filter((d) => d.kind === 'image').length).toBeLessThan(5);
	});

	/**
	 * The sheet and the map beside it have to agree. A plate drawn from the
	 * catalogue while the map is painted from the diver's choice is the sheet
	 * saying the reef is one thing and showing another.
	 */
	it('draws the swatch the diver chose, not the catalogue default', () => {
		const posidonia = habitatByCode.get('30512');
		expect(posidonia?.texture).toBe('ch_grass');
		const swatches = (over: Partial<RenderedCard>) =>
			lay(cardOn(SHEETS['A3 portrait']), over)
				.flatMap((d) => (d.kind === 'image' ? [d.url] : []))
				.map((url) => url.replace(/.*\//, ''));
		expect(swatches({})).toContain('ch_grass.jpg');
		expect(swatches({ textures: { 'habitats-20': 'ch_shipwood' } })).toContain('ch_shipwood.jpg');
		expect(swatches({ textures: { 'habitats-20': 'ch_shipwood' } })).not.toContain('ch_grass.jpg');
	});
});

describe('the trim marks', () => {
	const bled = cardOn(SHEETS['A3 with 3 mm bleed']);
	const plan = planFor(bled);

	it('draws none at all when the sheet is not cut', () => {
		expect(lay(cardOn(SHEETS['A3 portrait'])).filter(isTrimMark)).toEqual([]);
	});

	it('draws two per corner, each over a heavier dark line', () => {
		expect(lay(bled).filter(isTrimMark).length).toBe(16);
	});

	it('keeps every mark in the bleed, short of the cut and clear of the card', () => {
		const bleed = plan.bleedPx;
		for (const mark of lay(bled).filter(isTrimMark)) {
			const box = extent(mark);
			const inBand =
				box.x1 <= bleed + 1e-6 ||
				box.x0 >= plan.widthPx - bleed - 1e-6 ||
				box.y1 <= bleed + 1e-6 ||
				box.y0 >= plan.heightPx - bleed - 1e-6;
			expect({ box, inBand }).toMatchObject({ inBand: true });
		}
	});
});
