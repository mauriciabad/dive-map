import { asset } from '$app/paths';
import {
	type Ground,
	type SeabedClass,
	byProminence,
	seabedClassByCode
} from '$lib/domain/habitat';
import {
	type DiveEntry,
	type DiveFeature,
	type DiveFeatureKind,
	type OsmElementType,
	type OsmRef,
	type OsmTags,
	parseDiveFeature
} from '$lib/domain/osm';
import { GROUND_BY_LAYER } from '$lib/map/style';
import {
	HABITAT_POINT_SORT,
	type HabitatPointClass,
	habitatPointByCode
} from '$lib/map/habitat-points';
import { MARKERS } from '$lib/map/markers';
import type { Depth } from '$lib/domain/units';
import type { IconName } from './icons';
import { type Locale, localisedName } from '$lib/i18n/locale';
import { type MessageKey, t } from '$lib/i18n/messages';

/** A MapLibre feature's properties, before anything trusts them. */
export type FeatureProperties = Readonly<Record<string, unknown>>;

/**
 * What one catalogue says is under the tap.
 *
 * Both are on the card, because they answer different questions and a diver wants
 * both: the habitat is what lives there, the substrate is what the bottom is made
 * of. Which one the map happens to be painting is a display preference, and it was
 * deciding which half of that a diver got.
 */
export interface SeabedReading {
	readonly ground: Ground;
	/** Most diver-relevant first, capped at what the card has room for. */
	readonly classes: readonly SeabedClass[];
}

/**
 * One habitat survey record under the tap: the class the survey put there, and
 * the depth it wrote down for that point.
 *
 * The depth is the record's own and not `FeaturePick.depth`. They answer two
 * different questions. One is how deep the bottom is where the thumb landed, read
 * off the contours; the other is the depth the survey measured when it found this
 * gorgonian ground. The card labels each as what it is rather than picking one.
 */
export interface HabitatPointRecord {
	readonly habitat: HabitatPointClass;
	readonly depth: number | undefined;
}

export interface FeaturePick {
	/** Absent when the tap landed on open seabed with nothing mapped on it. */
	readonly feature: DiveFeature | undefined;
	/** The survey's point record under the tap, when a mark was drawn there. */
	readonly point: HabitatPointRecord | undefined;
	/** One reading per catalogue that had anything to say, habitats first. */
	readonly seabed: readonly SeabedReading[];
	readonly position: { readonly lng: number; readonly lat: number };
	/**
	 * How deep it is where the diver tapped, in metres.
	 *
	 * One number, off the contour nearest the point in the archives, so it does not
	 * move with the zoom. The habitat polygon carries a range and that is the range
	 * of the whole polygon, which is how a card about one spot came to say "the
	 * bottom here: 0 to 42 m". See `depthAt`.
	 */
	readonly depth: number | undefined;
}

/** A ground polygon under the tap, with the layer that says which catalogue it is in. */
export interface GroundHit {
	readonly layer: string;
	readonly props: FeatureProperties;
}

export const OSM_PICK_LAYERS = [
	'osm-marker-key',
	'osm-marker-minor',
	'osm-marker-plate',
	'osm-dive-site-label',
	'osm-harbour-label',
	'osm-site-area',
	'osm-restricted'
] as const;

/**
 * The habitat survey's point records, which are marks and answer a tap like one.
 *
 * A list of its own rather than a row in `OSM_PICK_LAYERS`, because the hits off
 * it are read as survey records and not as OSM elements: they carry a class code
 * and a depth, and `refOf` would drop every one of them.
 */
export const HABITAT_POINT_PICK_LAYERS = ['habitat-point'] as const;

export const GROUND_PICK_LAYERS: readonly string[] = Object.keys(GROUND_BY_LAYER);

/**
 * How far from a mark a tap still counts, in pixels either side of the point.
 *
 * Wet fingers need slack. It is one number because the hover cursor in
 * `cursor.ts` has to promise exactly what the tap will deliver: a pointer over a
 * mark that the click then misses is worse than no pointer at all. The seabed is
 * queried wider, in `+page.svelte`, because a site on a habitat boundary should
 * name both sides rather than whichever pixel was under the thumb.
 */
export const MARK_PICK_PX = 10;

export const SEABED_LIMIT = 3;

const isElementType = (value: unknown): value is OsmElementType =>
	value === 'node' || value === 'way' || value === 'relation';

export const tagsOf = (props: FeatureProperties): OsmTags =>
	Object.fromEntries(
		Object.entries(props).flatMap(([key, value]) =>
			typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
				? [[key, String(value)] as const]
				: []
		)
	);

export const refOf = (props: FeatureProperties): OsmRef | undefined => {
	const type = props['t'];
	const id = props['id'];
	if (!isElementType(type) || typeof id !== 'number') return undefined;
	return { type, id };
};

/**
 * A dive site sitting inside a recreation zone must win the tap, and MapLibre's
 * hit order is not a contract, so the choice is made here rather than taken from
 * the query.
 */
const KIND_PRIORITY: Record<DiveFeatureKind, number> = {
	'dive-site': 0,
	wreck: 1,
	rock: 2,
	mooring: 3,
	light: 4,
	ladder: 5,
	slipway: 6,
	'dive-centre': 7,
	harbour: 8,
	buoy: 9,
	// A reserve forbids the dive outright, so it outranks a zone that only asks
	// boats to keep their distance.
	'marine-reserve': 10,
	'swimming-area': 11,
	'restricted-area': 12
};

/** Habitats first: it is the layer the map opens on and the one a diver asks for. */
const GROUNDS: readonly Ground[] = ['habitats', 'substrate'];

/**
 * The record a tap resolves to when more than one mark is inside the box.
 *
 * The rarest class wins, which is the order the map placed the marks in.
 * `HABITAT_POINT_SORT` is what stops the 1,259 Paramuricea records burying the
 * two Caulerpa ones, and a tap that resolved the other way would hand back a
 * class whose mark is not the one on the glass.
 */
export const pointFrom = (hits: readonly FeatureProperties[]): HabitatPointRecord | undefined => {
	let best: HabitatPointRecord | undefined;
	let placed = Number.POSITIVE_INFINITY;
	for (const props of hits) {
		const code = props['code'];
		if (typeof code !== 'string') continue;
		const habitat = habitatPointByCode(code);
		if (habitat === undefined) continue;
		const order = HABITAT_POINT_SORT[code] ?? Number.POSITIVE_INFINITY;
		if (order >= placed) continue;
		placed = order;
		const depth = props['depth'];
		best = { habitat, depth: typeof depth === 'number' ? depth : undefined };
	}
	return best;
};

/**
 * A tap always answers.
 *
 * Open water is not nothing: there is a habitat class, a substrate, a depth and a
 * position under every point on this map, and that is most of what a diver wants
 * to know. Returning undefined there left the panel shut and the map feeling
 * broken.
 *
 * The depth arrives already read. It comes off the contours on screen at the
 * exact point, which only the map can do, and this stays a function of what was
 * hit rather than of a live map.
 *
 * The catalogue a code belongs to comes off the layer the hit arrived on rather
 * than off the switch in the panel. The style keeps a zero-opacity probe over the
 * ground nobody is looking at, so both layers answer every tap.
 *
 * The arguments are in the order they win the card. A chart mark is what a diver
 * is going to, a survey record is what is growing at one spot, and a ground
 * polygon is the sweep of seabed both of them stand on, so the more specific
 * thing heads the card and the rest stay on it as fields. It is the same reason
 * the style draws them in that order: the mark on top is the one you meant.
 */
export const pickFrom = (
	osmHits: readonly FeatureProperties[],
	pointHits: readonly FeatureProperties[],
	groundHits: readonly GroundHit[],
	position: { readonly lng: number; readonly lat: number },
	depth: number | undefined
): FeaturePick | undefined => {
	let best: DiveFeature | undefined;
	for (const props of osmHits) {
		const ref = refOf(props);
		if (ref === undefined) continue;
		const feature = parseDiveFeature(ref, tagsOf(props));
		if (feature === undefined) continue;
		if (best === undefined || KIND_PRIORITY[feature.kind] < KIND_PRIORITY[best.kind]) {
			best = feature;
		}
	}
	const point = pointFrom(pointHits);
	const codes: Record<Ground, Set<string>> = { habitats: new Set(), substrate: new Set() };
	for (const { layer, props } of groundHits) {
		const ground = GROUND_BY_LAYER[layer];
		const code = props['code'];
		if (ground !== undefined && typeof code === 'string') codes[ground].add(code);
	}
	const seabed = GROUNDS.flatMap((ground) => {
		const classes = seabedFrom(codes[ground], ground);
		return classes.length === 0 ? [] : [{ ground, classes }];
	});
	// A depth on its own is an answer. Out past the habitat survey there is no class
	// and no OSM feature under the tap, and the panel used to stay shut over water
	// whose depth the archives know perfectly well.
	if (best === undefined && point === undefined && seabed.length === 0 && depth === undefined) {
		return undefined;
	}

	return { feature: best, point, seabed, position, depth };
};

/**
 * What the card is about, once the tap is resolved.
 *
 * Which of the three things under a tap owns the title, and the glyph and the
 * subtitle that go with it. Here rather than in the template because this is the
 * precedence the issue is about and a `{#if}` chain in markup cannot be tested.
 */
export interface CardHead {
	readonly title: string;
	readonly subtitle: readonly string[];
	readonly icon: IconName | undefined;
	readonly tint: string | undefined;
	readonly plate: boolean;
}

export const headOf = (pick: FeaturePick, locale: Locale): CardHead => {
	const feature = pick.feature;
	if (feature !== undefined) {
		const mark = MARKERS[feature.kind];
		return {
			title: localisedName(feature.tags, locale) ?? t(locale, KIND_LABEL[feature.kind]),
			subtitle: subtitleOf(feature, locale),
			icon: mark.icon,
			tint: mark.colour,
			plate: mark.plate
		};
	}
	const point = pick.point;
	if (point !== undefined) {
		const { habitat } = point;
		return {
			title: habitat[locale],
			// What the record is, and the directive code it answers to where it has one.
			subtitle: [
				t(locale, 'habitatPoint'),
				...(habitat.hic === undefined ? [] : [t(locale, 'legendHic', { code: habitat.hic })])
			],
			icon: habitat.icon,
			tint: habitat.colour,
			plate: false
		};
	}
	return {
		title: t(locale, 'seabedHere'),
		subtitle: [],
		icon: undefined,
		tint: undefined,
		plate: false
	};
};

/**
 * The classes one catalogue has under the tap, most diver-relevant first and
 * capped at what the card has room for.
 */
export const seabedFrom = (
	codes: ReadonlySet<string>,
	ground: Ground,
	limit = SEABED_LIMIT
): readonly SeabedClass[] =>
	[...codes]
		.flatMap((code) => seabedClassByCode(code, ground) ?? [])
		// `seabedClassByCode` answers a code this catalogue does not publish out of
		// the other one, which is the right answer when only one layer is being read
		// and the wrong one here. The card reads both, so the other catalogue's row
		// belongs under the other heading, named as what it is rather than as a habitat.
		.filter((seabed) => seabed.ground === ground)
		.sort(byProminence)
		.slice(0, limit);

export const KIND_LABEL: Record<DiveFeatureKind, MessageKey> = {
	'dive-site': 'kindDiveSite',
	mooring: 'kindMooring',
	wreck: 'kindWreck',
	rock: 'kindRock',
	'restricted-area': 'kindRestrictedArea',
	'marine-reserve': 'kindMarineReserve',
	'swimming-area': 'kindSwimmingArea',
	buoy: 'kindBuoy',
	light: 'kindLight',
	harbour: 'kindHarbour',
	slipway: 'kindSlipway',
	ladder: 'kindLadder',
	'dive-centre': 'kindDiveCentre'
};

export interface HeroDepth {
	readonly label: MessageKey;
	readonly metres: Depth | undefined;
}

/**
 * An untagged depth still returns a HeroDepth, so the panel prints the label over
 * "no data". Absent has to read as absent; rendering it as 0 would be a number a
 * diver could act on.
 */
export const heroDepthOf = (feature: DiveFeature): HeroDepth | undefined => {
	switch (feature.kind) {
		case 'dive-site':
			return { label: 'maxDepth', metres: feature.maxDepth };
		case 'wreck':
			return { label: 'depth', metres: feature.wreckDepth };
		case 'mooring':
		case 'buoy':
		case 'rock':
		case 'restricted-area':
		case 'marine-reserve':
		case 'swimming-area':
		case 'light':
		case 'harbour':
		case 'slipway':
		case 'ladder':
		case 'dive-centre':
			return undefined;
	}
};

export const difficultyText = (locale: Locale, levels: readonly number[]): string | undefined => {
	if (levels.length === 0) return undefined;
	const min = Math.min(...levels);
	const max = Math.max(...levels);
	return min === max ? String(min) : t(locale, 'difficultyRange', { min, max });
};

export const difficultyPips = (levels: readonly number[]): readonly boolean[] => {
	if (levels.length === 0) return [];
	if (levels.some((n) => !Number.isInteger(n) || n < 1 || n > 5)) return [];
	const min = Math.min(...levels);
	const max = Math.max(...levels);
	return [1, 2, 3, 4, 5].map((level) => level >= min && level <= max);
};

const DANGER_LABEL: Record<string, MessageKey> = {
	current: 'dangerCurrent',
	waves: 'dangerWaves',
	boats: 'dangerBoats',
	fishing_nets: 'dangerFishingNets',
	jellyfish: 'dangerJellyfish'
};

const COLOUR_LABEL: Record<string, MessageKey> = {
	white: 'colourWhite',
	red: 'colourRed',
	green: 'colourGreen',
	yellow: 'colourYellow'
};

const CIVILIZATION_LABEL: Record<string, MessageKey> = { roman: 'civRoman' };

const WATER_LEVEL_LABEL: Record<string, MessageKey> = { submerged: 'levelSubmerged' };

const MOORING_LABEL: Record<string, MessageKey> = { buoy: 'mooringBuoy', pile: 'mooringPile' };

const ZONE_LABEL: Record<string, MessageKey> = {
	swimming: 'zoneSwimming',
	recreation_zone: 'zoneRecreation',
	speed_limit: 'zoneSpeedLimit'
};

/** The special marks this coast actually carries, out of the IALA list. */
const BUOY_LABEL: Record<string, MessageKey> = {
	recreation_zone: 'zoneRecreation',
	speed_limit: 'zoneSpeedLimit',
	odas: 'buoyOdas',
	lanby: 'buoyLanby'
};

const labelled = (
	table: Record<string, MessageKey>,
	locale: Locale,
	token: string | undefined
): string | undefined => {
	if (token === undefined) return undefined;
	const key = table[token];
	return key === undefined ? undefined : t(locale, key);
};

/** An unlabelled hazard still has to reach the diver, so this one never drops a token. */
const dangerText = (locale: Locale, token: string): string =>
	labelled(DANGER_LABEL, locale, token) ?? token.replaceAll('_', ' ');

export interface DetailRow {
	readonly label: MessageKey;
	readonly values: readonly string[];
}

const ENTRY_ORDER: readonly DiveEntry[] = ['shore', 'boat'];

export const detailRowsOf = (feature: DiveFeature, locale: Locale): readonly DetailRow[] => {
	switch (feature.kind) {
		case 'dive-site': {
			const rows: DetailRow[] = [];
			// Hazards outrank the entry method: one changes whether you dive at all.
			if (feature.dangers.length > 0) {
				rows.push({ label: 'dangers', values: feature.dangers.map((d) => dangerText(locale, d)) });
			}
			const entries = ENTRY_ORDER.filter((e) => feature.entry.includes(e)).map((e) =>
				t(locale, e === 'shore' ? 'entryShore' : 'entryBoat')
			);
			if (entries.length > 0) rows.push({ label: 'entry', values: entries });
			return rows;
		}
		case 'wreck': {
			const rows: DetailRow[] = [];
			const civilization = labelled(CIVILIZATION_LABEL, locale, feature.civilization);
			if (civilization !== undefined) rows.push({ label: 'civilization', values: [civilization] });
			const description = feature.description;
			if (description !== undefined && description.length > 0) {
				rows.push({ label: 'description', values: [description] });
			}
			return rows;
		}
		case 'light': {
			const parts = [
				feature.character,
				labelled(COLOUR_LABEL, locale, feature.colour),
				feature.period === undefined ? undefined : `${feature.period} s`,
				feature.range === undefined ? undefined : `${feature.range} M`
			].filter((part) => part !== undefined);
			return parts.length === 0 ? [] : [{ label: 'lightSignal', values: [parts.join(' ')] }];
		}
		case 'rock': {
			const level = labelled(WATER_LEVEL_LABEL, locale, feature.waterLevel);
			return level === undefined ? [] : [{ label: 'waterLevel', values: [level] }];
		}
		case 'mooring':
		case 'buoy':
		case 'restricted-area':
		case 'marine-reserve':
		case 'swimming-area':
		case 'harbour':
		case 'slipway':
		case 'ladder':
		case 'dive-centre':
			return [];
	}
};

const categoryText = (feature: DiveFeature, locale: Locale): string | undefined => {
	switch (feature.kind) {
		case 'mooring':
			return labelled(MOORING_LABEL, locale, feature.category);
		case 'restricted-area':
		case 'swimming-area':
			return labelled(ZONE_LABEL, locale, feature.category);
		case 'buoy':
			return labelled(BUOY_LABEL, locale, feature.category);
		case 'dive-site':
		case 'marine-reserve':
		case 'wreck':
		case 'rock':
		case 'light':
		case 'harbour':
		case 'slipway':
		case 'ladder':
		case 'dive-centre':
			return undefined;
	}
};

/** The boat crew says the Catalan name, so it stays on screen in every locale. */
export const subtitleOf = (feature: DiveFeature, locale: Locale): readonly string[] => {
	const heading = localisedName(feature.tags, locale);
	const parts: string[] = [];
	for (const name of [feature.tags['name:ca'] ?? feature.tags['name'], feature.tags['alt_name']]) {
		if (name === undefined || name.length === 0) continue;
		if (name === heading || parts.includes(name)) continue;
		parts.push(name);
	}
	parts.push(t(locale, KIND_LABEL[feature.kind]));
	const category = categoryText(feature, locale);
	if (category !== undefined) parts.push(category);
	return parts;
};

/** The 160 px swatch, not the 256 px map tile: a legend chip needs 7 kB, not 240 kB. */
export const texturePath = (texture: string): string => asset(`/textures/swatch/${texture}.jpg`);
