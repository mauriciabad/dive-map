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
 * The outline carried under every contour.
 *
 * Over the painted seabed the contours need nothing but a soft shadow: the
 * palette is a known quantity, bands at luminance 150 to 210 over ground around
 * 60. A photograph is not a known quantity. It puts the same lines over sunlit
 * sand, over weed, over deep water, and the two bands a recreational plan reads
 * most are the palest in the ramp, so those are the ones that disappear.
 *
 * The first answer was near-opaque black, which fixed the pale bands over bright
 * sand and lost the lines over everything dark. White at part opacity is the
 * owner's call and the better one: most of the water a diver is reading is dark,
 * and a white outline separates the line from the picture without turning the
 * contour into a black thread with a hint of colour in it.
 *
 * `on` draws it wherever the contours go, the chart included, and the base map
 * works the switch. A photograph raises it, and taking the photograph away puts
 * it back where the diver had it rather than where the photograph left it. See
 * `MapState`. Keeping `on` apart from `colour` and `opacity` means none of that
 * flicking costs them the colour and strength they had picked.
 */
export interface IsobathHalo {
	readonly on: boolean;
	/** `#rrggbb`. */
	readonly colour: string;
	/** 0 to 1. How much of the picture the outline covers. */
	readonly opacity: number;
}

/**
 * Off, because the map opens on the chart and the dropped shadow is all the
 * separation the chart palette needs. The first photograph a diver puts under
 * the contours turns it on for them.
 */
export const DEFAULT_HALO: IsobathHalo = { on: false, colour: '#ffffff', opacity: 0.2 };

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
	/** What the contours carry under them. */
	readonly halo: IsobathHalo;
}

export const DEFAULT_PAINT: IsobathPaint = {
	method: 'upwards',
	marks: {},
	halo: DEFAULT_HALO
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

/** The colour of the band a depth falls in, at full strength. */
export const defaultColour = (depthM: number): string =>
	DEPTH_BANDS.find((b) => depthM >= b.from && depthM <= b.to)?.dark ?? rampColour(depthM);

/**
 * A depth with its unit, set tight. The thin space is written as an escape so no
 * invisible character lands in the source, and the unit never wraps off its
 * number in a ruler one column wide.
 */
export const metresLabel = (depthM: number): string => `${depthM}\u2009m`;

export const paintOf = (style: IsobathStyle): IsobathPaint => style.paint ?? DEFAULT_PAINT;

export const haloOf = (style: IsobathStyle): IsobathHalo => paintOf(style).halo;

/**
 * What a marked depth is painted in before anybody paints it.
 *
 * The band a mark governs is the one above it going upwards and the one below it
 * going downwards, so one mark has two answers and both of them are the depth
 * ramp the map has always drawn. That is what lets the method be switched on a
 * ruler nobody has painted and leave the map exactly as it was.
 */
export const defaultColourFor = (method: PaintMethod, depthM: number): string =>
	defaultColour(method === 'upwards' ? Math.max(0, depthM - 1) : depthM);

export const markPaint = (style: IsobathStyle, depthM: number): MarkPaint =>
	paintOf(style).marks[depthM] ?? {
		colour: defaultColourFor(paintOf(style).method, depthM),
		plain: false
	};

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

	// A line no band reaches follows the band beside it. The 0 m contour painting
	// upwards is the case that matters: it is the coastline, and a colour of its
	// own there is the special line the owner asked twice to be rid of.
	const colourOf = (mark: DepthMark, index: number): string | undefined =>
		mark.noBand ? beside(index) : mark.colour;

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
 * Five metres at a dive site and coarser when the whole coast is on screen,
 * where even five is a solid mat of ink. One table, read here for the ruler and
 * compiled into a `step` expression for the map, so the panel can never draw an
 * interval the map is not using.
 *
 * It stops at five because the survey does. Every contour in both archives is a
 * multiple of five, fifty of them from 5 m to 250 m with no gaps, above and
 * below the 80 m the deep set takes over at. The table used to go to two metres
 * at z15 and one at z16, which drew the map no extra line, since a filter of
 * `depth % 1` and one of `depth % 5` select the same contours out of a set that
 * is all fives. What it did do was fill the ruler with a row per metre, most of
 * them offering a depth the data cannot draw: 250 rows where 50 exist. That is
 * the "many unnecessary lines" in issue #51.
 *
 * A diver who wants a mark between the fives can still place one, by dragging a
 * grip or nudging it with the arrow keys, which move by one metre. This governs
 * what the ruler offers unasked, not what it allows.
 */
export const AUTO_INTERVAL: readonly { readonly fromZoom: number; readonly intervalM: number }[] = [
	{ fromZoom: 0, intervalM: 20 },
	{ fromZoom: 12, intervalM: 10 },
	{ fromZoom: 14, intervalM: 5 }
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
	// The shoreline is the 0 m contour, so it ships marked and draws in the contour
	// ink. A diver who takes it off the ruler takes it out of here too, which is the
	// rule the map's own filter follows.
	if (!style.emphasised.includes(0)) drawn.delete(0);
	return [...drawn].sort(ascending);
};

const withPaint = (style: IsobathStyle, paint: IsobathPaint): IsobathStyle => ({ ...style, paint });

/** The mark that governs `depthM` right now, which is the one holding its colour. */
const governorOf = (style: IsobathStyle, depthM: number): number | undefined => {
	const depths = [...style.emphasised].sort(ascending);
	return paintOf(style).method === 'upwards'
		? depths.find((mark) => mark >= depthM)
		: depths.findLast((mark) => mark <= depthM);
};

/**
 * Switching the method marks the end of the ruler the new method can paint from
 * and hands every colour to the mark that now governs the water it was on.
 *
 * Painting downwards a band runs from its own line to the next one down, so the
 * shallowest water is named by a mark on the surface and nothing names the water
 * under the deepest mark; painting upwards it is the other way round. So the
 * surface is marked going down and the maximum depth going up.
 *
 * Only the deepest mark is ever given up, and only on the way to downwards where
 * it would name a band of one line and nothing else. 0 m is not given up either
 * way. It is the coastline, a diver asked for it to stay drawn whichever way the
 * paint runs, and painting upwards it is exactly the line `noBand` is for.
 *
 * Between them every colour lands on the mark that now names the water it was
 * already on, so the map does not move and the swatches do. A mark the switch
 * adds arrives thin: it is there to carry a colour, and a heavy line along the
 * whole coast is not what somebody asked for by choosing which way the paint
 * runs.
 *
 * Weight stays where it is. A tick belongs to a line, not to a band.
 */
export const withMethod = (style: IsobathStyle, method: PaintMethod): IsobathStyle => {
	const current = paintOf(style);
	if (current.method === method) return style;

	const named = method === 'upwards' ? style.maxDepthM : 0;
	const spent = method === 'upwards' ? undefined : style.maxDepthM;
	const kept = style.emphasised.filter((depthM) => depthM !== spent);
	const depths = [...new Set(kept.length < MARK_LIMIT ? [...kept, named] : kept)].sort(ascending);

	// Starts with the colours of depths that are not marked, which are remembered
	// against a depth being put back, and takes back only what the switch can say
	// something about.
	const marks: Record<number, MarkPaint> = {};
	for (const [depth, paint] of Object.entries(current.marks)) {
		const remembered = Number(depth);
		if (!depths.includes(remembered)) marks[remembered] = paint;
	}

	depths.forEach((depthM, index) => {
		// The middle of the band this mark is about to govern, which is water whose
		// colour the old method has already decided.
		const band =
			method === 'upwards'
				? { from: (depths[index - 1] ?? -1) + 1, to: depthM }
				: { from: depthM, to: (depths[index + 1] ?? style.maxDepthM + 1) - 1 };
		const source = governorOf(style, Math.round((band.from + band.to) / 2));
		const carried = source === undefined ? undefined : current.marks[source]?.colour;
		const plain = current.marks[depthM]?.plain ?? depthM === named;
		// Nothing explicit to carry and no weight to remember reads as the catalogue's
		// own colour, which is what the two defaults already agree on band for band.
		if (carried !== undefined || plain) {
			marks[depthM] = { colour: carried ?? defaultColourFor(method, depthM), plain };
		}
	});

	return { ...style, emphasised: depths, paint: { ...current, method, marks } };
};

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
/**
 * A halo field this version cannot honour is dropped and that field keeps the
 * default, the same line `parseIsobathPaint` takes with a mark whose colour it
 * cannot paint. A blob hand-edited to `opacity: 4` gets the default strength
 * rather than a line four times as opaque as the picture under it.
 */
const parseHalo = (value: unknown): IsobathHalo => {
	if (!isRecord(value)) return DEFAULT_HALO;
	const colour = value['colour'];
	const opacity = value['opacity'];
	return {
		on: value['on'] === true,
		colour: typeof colour === 'string' && HEX.test(colour) ? colour : DEFAULT_HALO.colour,
		opacity:
			typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1
				? opacity
				: DEFAULT_HALO.opacity
	};
};

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
			halo: parseHalo(value['halo'])
		}
	};
};
