import type { IsobathStyle } from './card.ts';

/**
 * How the contours between two marked depths are coloured, and what each marked
 * depth is drawn in.
 *
 * A diver reads depth off this map by colour before they read a number, so the
 * colours are the diver's to set: one per marked depth, painting the run of
 * metre contours the mark governs. Which run that is depends on which way the
 * paint goes, and that is the one thing about this a diver has to decide.
 */

/**
 * Which line gives a band its colour.
 *
 * `downwards` paints from a marked depth down towards the next one, so a band
 * takes the colour of the shallowest line in it and the marked line is the top
 * of its own band. That is what the map has always done. `upwards` paints from a
 * marked depth up towards the surface, so a band takes the colour of its deepest
 * line and the marked line is the bottom of its own band.
 */
export type PaintMethod = 'upwards' | 'downwards';

export interface MarkPaint {
	/** `#rrggbb`. What the band this mark governs is painted in. */
	readonly colour: string;
	/**
	 * Drawn thin and unlabelled: the colour changes at this depth and nothing
	 * else does. Off by default, so a depth a diver marks is one they can see.
	 */
	readonly plain: boolean;
}

/**
 * Everything the depth ruler writes, keyed by depth rather than held beside
 * `IsobathStyle.emphasised` in the same order, so that moving a mark up the
 * ruler or dropping one out of the middle cannot slide every colour by one.
 *
 * Optional on `IsobathStyle` and staying optional. A configuration saved before
 * the ruler existed carries none, and reads as the map's original behaviour:
 * every marked depth drawn heavy in the colour its depth band has always had.
 */
export interface IsobathPaint {
	readonly method: PaintMethod;
	readonly marks: Readonly<Record<number, MarkPaint>>;
	/**
	 * Whether the marked line that no band reaches keeps a colour of its own.
	 *
	 * One line can always end up with nothing to paint: the 0 m contour painting
	 * upwards has no water above it, and a mark sitting on the maximum depth
	 * painting downwards has none below. Off makes that line follow the band
	 * beside it, so the band and its edge read as one colour.
	 */
	readonly edgeOwnColour: boolean;
}

export const DEFAULT_PAINT: IsobathPaint = {
	method: 'downwards',
	marks: {},
	edgeOwnColour: true
};

/**
 * Depth bands, keyed to what a recreational dive plan actually turns on. These
 * are what a marked depth is coloured with until a diver paints it themselves,
 * and what any water no mark governs is still drawn in.
 *
 * Each band ramps from light to dark across its own range and then jumps at the
 * boundary. Depths are whole metres, so the 0.99 stops make the jump hard rather
 * than a one-metre fade.
 */
export const DEPTH_BANDS: readonly {
	readonly from: number;
	readonly to: number;
	readonly light: string;
	readonly dark: string;
}[] = [
	{ from: 0, to: 4, light: '#ffe9b0', dark: '#f5c96a' },
	{ from: 5, to: 17, light: '#93e9c0', dark: '#35c48e' },
	{ from: 18, to: 29, light: '#7ad2ff', dark: '#2b9fe4' },
	{ from: 30, to: 39, light: '#9aabff', dark: '#4b63d8' },
	{ from: 40, to: 49, light: '#c9a0ff', dark: '#8c4fd8' },
	{ from: 50, to: 79, light: '#ff9fb6', dark: '#e04a6c' },
	{ from: 80, to: 140, light: '#ff7a6b', dark: '#9b2418' }
];

const FIRST_BAND = DEPTH_BANDS[0] ?? { from: 0, to: 0, light: '#ffe9b0', dark: '#f5c96a' };

const channels = (hex: string): readonly [number, number, number] => [
	Number.parseInt(hex.slice(1, 3), 16),
	Number.parseInt(hex.slice(3, 5), 16),
	Number.parseInt(hex.slice(5, 7), 16)
];

const mix = (from: string, to: string, at: number): string => {
	const a = channels(from);
	const b = channels(to);
	const channel = (index: 0 | 1 | 2): string =>
		Math.round(a[index] + (b[index] - a[index]) * at)
			.toString(16)
			.padStart(2, '0');
	return `#${channel(0)}${channel(1)}${channel(2)}`;
};

/**
 * What the depth ramp gives one contour. The same answer the map's own
 * interpolation arrives at, so the ruler in the panel and the line on the map
 * are never two different colours claiming to be the same depth.
 */
export const rampColour = (depthM: number): string => {
	const band = DEPTH_BANDS.find((b) => depthM >= b.from && depthM <= b.to);
	if (band === undefined) {
		return depthM < FIRST_BAND.from ? FIRST_BAND.light : (DEPTH_BANDS.at(-1)?.dark ?? '#9b2418');
	}
	return mix(band.light, band.dark, (depthM - band.from) / (band.to + 0.99 - band.from));
};

/**
 * Ink that can be read on a colour a diver picked. Nobody is stopped from
 * choosing something the panel then has to write on, so the pencil on a swatch
 * flips between the table's two inks rather than staying one and disappearing.
 * sRGB luminance, the same weighting the eye uses.
 */
export const readableInk = (colour: string): string => {
	const [red, green, blue] = channels(colour);
	return (red * 0.299 + green * 0.587 + blue * 0.114) / 255 > 0.55 ? '#14100c' : '#efe4cf';
};

/** What a depth is painted in before anybody paints it: its own band, at full strength. */
export const defaultColour = (depthM: number): string =>
	DEPTH_BANDS.find((b) => depthM >= b.from && depthM <= b.to)?.dark ?? rampColour(depthM);

/**
 * A depth with its unit, set tight. The thin space is written as an escape so no
 * invisible character lands in the source, and the unit never wraps off its
 * number in a ruler one column wide.
 */
export const metresLabel = (depthM: number): string => `${depthM}\u2009m`;

export const paintOf = (style: IsobathStyle): IsobathPaint => style.paint ?? DEFAULT_PAINT;

export const markPaint = (style: IsobathStyle, depthM: number): MarkPaint =>
	paintOf(style).marks[depthM] ?? { colour: defaultColour(depthM), plain: false };

/** One marked depth, as the ruler and the map both need it. */
export interface DepthMark {
	readonly depthM: number;
	readonly colour: string;
	/** A heavy line and a number on the map. Off is a colour change only. */
	readonly emphasised: boolean;
	/**
	 * True when no band reaches this line, so its colour paints the line and
	 * nothing else. Only ever the shallowest mark painting upwards or the deepest
	 * one painting downwards, and only when it sits on the end of the ruler.
	 */
	readonly noBand: boolean;
}

/** As many marks as the stored depth list can hold, so neither can grow past the other. */
const MARK_LIMIT = 32;

const ascending = (a: number, b: number): number => a - b;

/** The marked depths in reading order, surface first, each with what it is drawn in. */
export const depthMarks = (style: IsobathStyle): readonly DepthMark[] => {
	const depths = [...style.emphasised].sort(ascending);
	const method = paintOf(style).method;
	const last = depths.length - 1;
	return depths.map((depthM, index) => {
		const paint = markPaint(style, depthM);
		return {
			depthM,
			colour: paint.colour,
			emphasised: !paint.plain,
			noBand:
				method === 'upwards'
					? index === 0 && depthM === 0
					: index === last && depthM === style.maxDepthM
		};
	});
};

/** A run of contours drawn in one colour. `colour` absent leaves them on the depth ramp. */
export interface PaintedBand {
	readonly fromM: number;
	readonly toM: number;
	readonly colour: string | undefined;
}

/**
 * Every contour from the surface to the maximum depth, as a run of bands from
 * the top down. Contiguous and gapless, so a line's colour is a lookup rather
 * than a rule applied twice: once here for the ruler and once again, differently,
 * for the map.
 *
 * Water no mark governs keeps the depth ramp. Painting downwards that is
 * everything above the shallowest mark; painting upwards it is everything below
 * the deepest one.
 */
export const paintedBands = (style: IsobathStyle): readonly PaintedBand[] => {
	const deepest = style.maxDepthM;
	const marks = depthMarks(style).filter((mark) => mark.depthM >= 0 && mark.depthM <= deepest);
	if (marks.length === 0) return [{ fromM: 0, toM: deepest, colour: undefined }];

	const beside = (index: number): string | undefined =>
		marks[paintOf(style).method === 'upwards' ? index + 1 : index - 1]?.colour;

	const colourOf = (mark: DepthMark, index: number): string | undefined =>
		mark.noBand && !paintOf(style).edgeOwnColour ? beside(index) : mark.colour;

	const bands: PaintedBand[] = [];
	if (paintOf(style).method === 'upwards') {
		marks.forEach((mark, index) => {
			const above = marks[index - 1];
			bands.push({
				fromM: above === undefined ? 0 : above.depthM + 1,
				toM: mark.depthM,
				colour: colourOf(mark, index)
			});
		});
		const last = marks[marks.length - 1];
		if (last !== undefined && last.depthM < deepest) {
			bands.push({ fromM: last.depthM + 1, toM: deepest, colour: undefined });
		}
	} else {
		const first = marks[0];
		if (first !== undefined && first.depthM > 0) {
			bands.push({ fromM: 0, toM: first.depthM - 1, colour: undefined });
		}
		marks.forEach((mark, index) => {
			const below = marks[index + 1];
			bands.push({
				fromM: mark.depthM,
				toM: below === undefined ? deepest : below.depthM - 1,
				colour: colourOf(mark, index)
			});
		});
	}
	return bands.filter((band) => band.fromM <= band.toM);
};

/** What one contour is drawn in, for a ruler that has to show it line by line. */
export const contourColour = (bands: readonly PaintedBand[], depthM: number): string =>
	bands.find((band) => depthM >= band.fromM && depthM <= band.toM)?.colour ?? rampColour(depthM);

/**
 * How coarse the contours go when the map is picking for itself, at one zoom.
 *
 * Every metre at a dive site and coarser when the whole coast is on screen,
 * where one metre is a solid mat of ink. One table, read here for the ruler and
 * compiled into a `step` expression for the map, so the panel can never draw an
 * interval the map is not using.
 */
export const AUTO_INTERVAL: readonly { readonly fromZoom: number; readonly intervalM: number }[] = [
	{ fromZoom: 0, intervalM: 20 },
	{ fromZoom: 12, intervalM: 10 },
	{ fromZoom: 14, intervalM: 5 },
	{ fromZoom: 15, intervalM: 2 },
	{ fromZoom: 16, intervalM: 1 }
];

export const intervalAt = (style: IsobathStyle, zoom: number): number => {
	if (!style.autoInterval) return Math.max(1, style.intervalM);
	const step = AUTO_INTERVAL.findLast((entry) => zoom >= entry.fromZoom);
	return step?.intervalM ?? 20;
};

/** The contours the map draws between the surface and the maximum depth, at one zoom. */
export const contourDepths = (style: IsobathStyle, zoom: number): readonly number[] => {
	const interval = intervalAt(style, zoom);
	const drawn = new Set<number>();
	for (let depth = 0; depth <= style.maxDepthM; depth += interval) drawn.add(depth);
	for (const depth of style.emphasised)
		if (depth <= style.maxDepthM && depth >= 0) drawn.add(depth);
	// The shoreline is its own layer and its own switch. It joins the contour ink
	// only when a diver marks it, which is the rule the map's own filter follows.
	if (!style.emphasised.includes(0)) drawn.delete(0);
	return [...drawn].sort(ascending);
};

const withPaint = (style: IsobathStyle, paint: IsobathPaint): IsobathStyle => ({ ...style, paint });

export const withMethod = (style: IsobathStyle, method: PaintMethod): IsobathStyle =>
	withPaint(style, { ...paintOf(style), method });

export const withEdgeOwnColour = (style: IsobathStyle, edgeOwnColour: boolean): IsobathStyle =>
	withPaint(style, { ...paintOf(style), edgeOwnColour });

const withMarkPaint = (style: IsobathStyle, depthM: number, paint: MarkPaint): IsobathStyle => {
	const current = paintOf(style);
	return withPaint(style, { ...current, marks: { ...current.marks, [depthM]: paint } });
};

export const withColour = (style: IsobathStyle, depthM: number, colour: string): IsobathStyle =>
	withMarkPaint(style, depthM, { ...markPaint(style, depthM), colour });

export const withEmphasis = (
	style: IsobathStyle,
	depthM: number,
	emphasised: boolean
): IsobathStyle =>
	withMarkPaint(style, depthM, { ...markPaint(style, depthM), plain: !emphasised });

/**
 * Refused past `MARK_LIMIT`, which is what a saved configuration can carry. A
 * ruler that takes a thirty-third mark and a blob that drops it on the way back
 * is the one failure here that loses work somebody did.
 */
export const withMark = (style: IsobathStyle, depthM: number): IsobathStyle =>
	style.emphasised.includes(depthM) || style.emphasised.length >= MARK_LIMIT
		? style
		: { ...style, emphasised: [...style.emphasised, depthM].sort(ascending) };

/**
 * The colour stays behind in the paint, so a depth put back is the colour it was
 * rather than the catalogue's. Nothing reads a colour whose depth is not marked.
 */
export const withoutMark = (style: IsobathStyle, depthM: number): IsobathStyle => ({
	...style,
	emphasised: style.emphasised.filter((depth) => depth !== depthM)
});

/** Moves a mark to another depth, carrying its colour and its weight with it. */
export const withMarkAt = (style: IsobathStyle, fromM: number, toM: number): IsobathStyle => {
	if (fromM === toM || style.emphasised.includes(toM)) return style;
	const moved = withMarkPaint(withoutMark(style, fromM), toM, markPaint(style, fromM));
	return { ...moved, emphasised: [...moved.emphasised, toM].sort(ascending) };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Read back what the ruler wrote, for `parseConfiguration` to fold into the rest
 * of the isobath settings. Absent, damaged or hand-edited past what the panel can
 * show, it reads as no paint at all, which is the map's original behaviour rather
 * than a colour nobody picked.
 */
export const parseIsobathPaint = (value: unknown): Pick<IsobathStyle, 'paint'> => {
	if (!isRecord(value)) return {};
	const method = value['method'];
	const marks: Record<number, MarkPaint> = {};
	const stored = value['marks'];
	if (isRecord(stored)) {
		for (const [depth, paint] of Object.entries(stored)) {
			if (Object.keys(marks).length >= MARK_LIMIT) break;
			const depthM = Number(depth);
			if (!Number.isInteger(depthM) || depthM < 0) continue;
			if (!isRecord(paint)) continue;
			const colour = paint['colour'];
			if (typeof colour !== 'string' || !HEX.test(colour)) continue;
			marks[depthM] = { colour, plain: paint['plain'] === true };
		}
	}
	return {
		paint: {
			method: method === 'upwards' ? 'upwards' : 'downwards',
			marks,
			edgeOwnColour: value['edgeOwnColour'] !== false
		}
	};
};
