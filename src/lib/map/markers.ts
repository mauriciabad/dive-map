import { DIVE_FEATURE_KINDS, type DiveFeatureKind } from '$lib/domain/osm';
import type { IconName } from '$lib/ui/icons';

/**
 * How each kind of OSM feature is drawn, in one table the map and the legend both
 * read. The two of them showing different colours for the same thing is the bug
 * this exists to make impossible.
 *
 * Colour is the family, the drawing is the kind. Five families across twelve kinds
 * beats twelve hues nobody can hold in their head, and it keeps the meaning intact
 * for a colour-blind reader, who still gets a buoy that is not a wreck. The
 * seabed textures follow the same rule.
 *
 * The families, in the words used on the boat:
 *
 *   the dive       cream     a dive site, a wreck: somewhere you are going
 *   the boat       amber     a mooring buoy: where the boat waits for you
 *   keep clear     red       a rock you hit, a zone you may not surface in
 *   navigate by    yellow    a light: a landmark, not a place
 *   in and out     teal      ladder, slipway, dive centre: the way to the water
 *
 * Keep clear splits its red in two on purpose. A rock is a thing that is there,
 * so it takes the warm hazard red already in the palette. A restricted area is a
 * rule rather than an object, so it takes magenta, which is what every nautical
 * chart reserves for regulation.
 *
 * A bathing zone is not in that family at all, which is the correction this table
 * carries. It is water people are in, so it goes with the ladder and the slipway
 * in teal, and the special marks strung around it go with the lights in yellow,
 * because a buoy is something you navigate by rather than something you avoid.
 *
 * A marine reserve takes the regulation magenta rather than the bathing zone's
 * teal. Ses Negres forbids diving, anchoring and fishing, so it belongs with the
 * rules and not with the water people swim in, which is the distinction the
 * swimmer on it used to destroy.
 */

export interface MarkerStyle {
	/** Absent for a kind the map names rather than draws. */
	readonly icon: IconName | undefined;
	/** The glyph's colour, or the colour of the name for a label-only kind. */
	readonly colour: string;
	/**
	 * A filled plate under the glyph. Only the dive site has one: it is the single
	 * thing on this map you are going to, and the plate is what makes it findable
	 * in a frame full of chart furniture. On everything else the plate added
	 * weight and said nothing, which is what made ten kinds look like one.
	 */
	readonly plate: boolean;
	/** Drawn on top and never dropped in a crowd: the dive, and what threatens it. */
	readonly key: boolean;
	/**
	 * The zoom this kind starts drawing at.
	 *
	 * Nothing used to hide as the map pulled back, so the opening view painted
	 * every mark on two hundred kilometres of coast into one screen: 384 mooring
	 * piles, 155 buoys and 141 lights, none of which anyone is reading from out
	 * there. The rule is when the mark first answers a question. A dive site and
	 * what threatens it draw from the start, because choosing a coast is the
	 * question the opening view is for. A bathing zone, a light and a dive centre
	 * arrive at 11, where you are choosing a bay. The furniture of the water's
	 * edge, moorings and buoys and slipways, arrives at 12, and the ladder at 13,
	 * because a ladder is something you look for once you are standing over it.
	 *
	 * MapLibre evaluates a zoom expression in a filter at integer zooms only, so
	 * these are integers and mean exactly what they say.
	 */
	readonly from: number;
}

/**
 * The zoom a key mark stops giving way and puts on its full dress.
 *
 * The `from` column above answers when a kind is worth drawing at all. This
 * answers a different question for the three kinds whose answer is always. Out
 * where the whole survey is on screen, every dive site on two hundred kilometres
 * of coast is inside one frame, which drew 47 plates on top of each other around
 * one headland and told a diver nothing. So out there a key mark is a bare glyph
 * that gives way to its neighbour, and what survives is spread across the coast:
 * where the diving is, rather than how much of it there is.
 *
 * From this zoom in, nothing is dropped again, and the plate, its shadow and the
 * site's name all arrive together.
 *
 * The same number has to govern all four of those layers, and that is a
 * constraint rather than a tidiness. The plate is a second symbol layer sitting
 * under the glyph at the same point, and two layers can never agree about which
 * of them collided: MapLibre places the upper one first, so the glyph would take
 * the pixels and then drop its own plate. The plate is therefore only allowed to
 * exist in the range where nothing collides at all.
 *
 * Ten is where a frame holds one stretch of coast rather than all of it, which
 * is the point a site stops being a dot on a region and starts being somewhere
 * you are reading the name of.
 */
export const MARKER_CLOSE = 10;

/**
 * Screen pixels of dark outline around a glyph. This is what makes a cream mark
 * survive a sunlit sand texture and a red one survive deep water, and it is also
 * the number that decides how far apart two strokes of one drawing have to sit:
 * anything closer than twice this merges into a single blob at marker size.
 *
 * A glyph on a plate needs almost none of it, and cannot afford it either: the
 * plate is only twenty pixels across at z14 and a full halo closed every gap in
 * the bubbles. Which is why the answer is only the answer from `MARKER_CLOSE`
 * in: out there the plate is gone and the dive site is a glyph on bare seabed
 * like every other kind, so it takes the full outline.
 */
export const MARKER_HALO = 2.2;

export const markerHalo = (style: MarkerStyle): number => (style.plate ? 0.8 : MARKER_HALO);

/** The ink every marker is outlined in, and the plate the dive site sits on. */
export const MARKER_INK = '#14100c';

/** The plate's rim. Brass, so the plate still has an edge over deep water. */
export const MARKER_RIM = '#cfa25a';

/**
 * The plate itself, under the dive site alone. Diver-down red, because the plate
 * is that flag's field: a rectangle of this, with the stripe drawn over it in
 * cream, so the mark is the flag rather than a picture of one. Every boat on this
 * coast reads it already.
 */
export const MARKER_PLATE = '#c2352f';

const CREAM = '#efe4cf';
const AMBER = '#e8a92f';
const HAZARD = '#ef6f43';
const REGULATION = '#ec6faa';
const BEACON = '#f5dd93';
const SHORE = '#4ecfae';

export const MARKERS: Record<DiveFeatureKind, MarkerStyle> = {
	'dive-site': { icon: 'markerDiveSite', colour: CREAM, plate: true, key: true, from: 0 },
	wreck: { icon: 'markerWreck', colour: CREAM, plate: false, key: true, from: 0 },
	rock: { icon: 'markerRock', colour: HAZARD, plate: false, key: true, from: 0 },
	'restricted-area': {
		icon: 'markerRestricted',
		colour: REGULATION,
		plate: false,
		key: false,
		from: 11
	},
	'marine-reserve': {
		icon: 'markerReserve',
		colour: REGULATION,
		plate: false,
		/*
		 * Drawn from the start and never dropped, because it is the one mark that can
		 * call the dive off. Choosing a coast is the question the opening view is for,
		 * and where you may not dive is part of that answer.
		 */
		key: true,
		from: 0
	},
	'swimming-area': { icon: 'markerSwimmer', colour: SHORE, plate: false, key: false, from: 11 },
	mooring: { icon: 'markerMooring', colour: AMBER, plate: false, key: false, from: 12 },
	buoy: { icon: 'markerBuoy', colour: BEACON, plate: false, key: false, from: 12 },
	light: { icon: 'markerLight', colour: BEACON, plate: false, key: false, from: 11 },
	'dive-centre': { icon: 'markerDiveCentre', colour: SHORE, plate: false, key: false, from: 11 },
	slipway: { icon: 'markerSlipway', colour: SHORE, plate: false, key: false, from: 12 },
	ladder: { icon: 'markerLadder', colour: SHORE, plate: false, key: false, from: 13 },
	/*
	 * A harbour is an area with a name on it, and the name is how anyone finds it:
	 * nobody looks for Port de l'Estartit by spotting a symbol. A pin would also
	 * land in the middle of the basin, which is the one part of a harbour with
	 * nothing in it.
	 */
	harbour: { icon: undefined, colour: CREAM, plate: false, key: false, from: 11 }
};

/** MapLibre image id for a kind's glyph. */
export const markerImageId = (kind: DiveFeatureKind): string => `marker-${kind}`;

/** MapLibre image id for the plate under a glyph. */
export const MARKER_PLATE_IMAGE = 'marker-plate';

const kindsWhere = (pick: (style: MarkerStyle) => boolean): readonly DiveFeatureKind[] =>
	DIVE_FEATURE_KINDS.filter((kind) => pick(MARKERS[kind]));

const drawn = (style: MarkerStyle): boolean => style.icon !== undefined;

/** Kinds drawn on top, never dropped when markers crowd each other. */
export const KEY_KINDS = kindsWhere((style) => style.key && drawn(style));

/** Kinds drawn underneath, thinned out where they pile up. */
export const MINOR_KINDS = kindsWhere((style) => !style.key && drawn(style));

/** Kinds that take a plate under the glyph. */
export const PLATE_KINDS = kindsWhere((style) => style.plate);

/** Kinds the map names rather than draws. */
export const LABEL_ONLY_KINDS = kindsWhere((style) => !drawn(style));

/**
 * The zoom each kind starts drawing at, as one lookup the style reads inside a
 * filter. Same shape as the colour and halo lookups for the same reason: one
 * literal rather than a tuple TypeScript cannot prove, and still valid when a
 * group has been switched off down to nothing.
 */
export const markerFrom = (kinds: readonly DiveFeatureKind[]): Record<string, number> => {
	const lookup: Record<string, number> = {};
	for (const kind of kinds) lookup[kind] = MARKERS[kind].from;
	return lookup;
};

/** Every image the style asks for by name, plate first. */
export const MARKER_IMAGES: readonly { readonly id: string; readonly icon: IconName }[] = [
	{ id: MARKER_PLATE_IMAGE, icon: 'markerPlate' },
	...DIVE_FEATURE_KINDS.flatMap((kind) => {
		const { icon } = MARKERS[kind];
		return icon === undefined ? [] : [{ id: markerImageId(kind), icon }];
	})
];
