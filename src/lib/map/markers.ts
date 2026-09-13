import { DIVE_FEATURE_KINDS, type DiveFeatureKind } from '$lib/domain/osm';
import type { IconName } from '$lib/ui/icons';

/**
 * How each kind of OSM feature is drawn, in one table the map and the legend both
 * read. The two of them showing different colours for the same thing is the bug
 * this exists to make impossible.
 *
 * Colour is the family, the drawing is the kind. Five families across ten kinds
 * beats ten hues nobody can hold in their head, and it keeps the meaning intact
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
	readonly disc: boolean;
	/** Drawn on top and never dropped in a crowd: the dive, and what threatens it. */
	readonly key: boolean;
}

/**
 * Screen pixels of dark outline around a glyph. This is what makes a cream mark
 * survive a sunlit sand texture and a red one survive deep water, and it is also
 * the number that decides how far apart two strokes of one drawing have to sit:
 * anything closer than twice this merges into a single blob at marker size.
 *
 * A glyph on a plate needs almost none of it, and cannot afford it either: the
 * plate is only twenty pixels across at z14 and a full halo closed every gap in
 * the bubbles.
 */
export const markerHalo = (style: MarkerStyle): number => (style.disc ? 0.8 : 2.2);

/** The ink every marker is outlined in, and the plate the dive site sits on. */
export const MARKER_INK = '#14100c';

/** The plate's rim. Brass, so the plate still has an edge over deep water. */
export const MARKER_RIM = '#cfa25a';

const CREAM = '#efe4cf';
const AMBER = '#e8a92f';
const HAZARD = '#ef6f43';
const REGULATION = '#ec6faa';
const BEACON = '#f5dd93';
const SHORE = '#4ecfae';

export const MARKERS: Record<DiveFeatureKind, MarkerStyle> = {
	'dive-site': { icon: 'markerDiveSite', colour: CREAM, disc: true, key: true },
	wreck: { icon: 'markerWreck', colour: CREAM, disc: false, key: true },
	rock: { icon: 'markerRock', colour: HAZARD, disc: false, key: true },
	'restricted-area': { icon: 'markerRestricted', colour: REGULATION, disc: false, key: false },
	mooring: { icon: 'markerMooring', colour: AMBER, disc: false, key: false },
	light: { icon: 'markerLight', colour: BEACON, disc: false, key: false },
	'dive-centre': { icon: 'markerDiveCentre', colour: SHORE, disc: false, key: false },
	slipway: { icon: 'markerSlipway', colour: SHORE, disc: false, key: false },
	ladder: { icon: 'markerLadder', colour: SHORE, disc: false, key: false },
	/*
	 * A harbour is an area with a name on it, and the name is how anyone finds it:
	 * nobody looks for Port de l'Estartit by spotting a symbol. A pin would also
	 * land in the middle of the basin, which is the one part of a harbour with
	 * nothing in it.
	 */
	harbour: { icon: undefined, colour: CREAM, disc: false, key: false }
};

/** MapLibre image id for a kind's glyph. */
export const markerImageId = (kind: DiveFeatureKind): string => `marker-${kind}`;

/** MapLibre image id for the plate under a glyph. */
export const MARKER_DISC_IMAGE = 'marker-disc';

const kindsWhere = (pick: (style: MarkerStyle) => boolean): readonly DiveFeatureKind[] =>
	DIVE_FEATURE_KINDS.filter((kind) => pick(MARKERS[kind]));

const drawn = (style: MarkerStyle): boolean => style.icon !== undefined;

/** Kinds drawn on top, never dropped when markers crowd each other. */
export const KEY_KINDS = kindsWhere((style) => style.key && drawn(style));

/** Kinds drawn underneath, thinned out where they pile up. */
export const MINOR_KINDS = kindsWhere((style) => !style.key && drawn(style));

/** Kinds that take a plate under the glyph. */
export const DISC_KINDS = kindsWhere((style) => style.disc);

/** Kinds the map names rather than draws. */
export const LABEL_ONLY_KINDS = kindsWhere((style) => !drawn(style));

/** Every image the style asks for by name, plate first. */
export const MARKER_IMAGES: readonly { readonly id: string; readonly icon: IconName }[] = [
	{ id: MARKER_DISC_IMAGE, icon: 'markerDisc' },
	...DIVE_FEATURE_KINDS.flatMap((kind) => {
		const { icon } = MARKERS[kind];
		return icon === undefined ? [] : [{ id: markerImageId(kind), icon }];
	})
];
