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
import { GROUND_DEPTH_LAYER, GROUND_FILL_LAYERS } from '$lib/map/style';
import type { Depth } from '$lib/domain/units';
import { type Locale, localisedName } from '$lib/i18n/locale';
import { type MessageKey, t } from '$lib/i18n/messages';

/** A MapLibre feature's properties, before anything trusts them. */
export type FeatureProperties = Readonly<Record<string, unknown>>;

export interface FeaturePick {
	/** Absent when the tap landed on open seabed with nothing mapped on it. */
	readonly feature: DiveFeature | undefined;
	/** Seabed classes under the tapped point, most diver-relevant first. */
	readonly seabed: readonly SeabedClass[];
	readonly position: { readonly lng: number; readonly lat: number };
	/** Surveyed depth range of the habitat polygon under the point, in metres. */
	readonly depth: { readonly min: number; readonly max: number } | undefined;
}

export const OSM_PICK_LAYERS = [
	'osm-marker-key',
	'osm-marker-minor',
	'osm-marker-disc',
	'osm-dive-site-label',
	'osm-harbour-label',
	'osm-site-area',
	'osm-restricted'
] as const;

export const GROUND_PICK_LAYERS = [...GROUND_FILL_LAYERS, GROUND_DEPTH_LAYER] as const;

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
	'swimming-area': 10,
	'restricted-area': 11
};

/**
 * A tap always answers.
 *
 * Open water is not nothing: there is a habitat class, a substrate, a surveyed
 * depth range and a position under every point on this map, and that is most of
 * what a diver wants to know. Returning undefined there left the panel shut and
 * the map feeling broken.
 */
export const pickFrom = (
	osmHits: readonly FeatureProperties[],
	groundHits: readonly FeatureProperties[],
	position: { readonly lng: number; readonly lat: number },
	ground: Ground
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
	const codes = new Set<string>();
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const props of groundHits) {
		const code = props['code'];
		if (typeof code === 'string') codes.add(code);
		const lo: unknown = props['dmin'];
		const hi: unknown = props['dmax'];
		if (typeof lo === 'number') min = Math.min(min, lo);
		if (typeof hi === 'number') max = Math.max(max, hi);
	}
	const seabed = seabedFrom(codes, ground);
	if (best === undefined && seabed.length === 0) return undefined;

	return {
		feature: best,
		seabed,
		position,
		depth: Number.isFinite(min) && Number.isFinite(max) ? { min, max } : undefined
	};
};

/**
 * The classes under the tap, most diver-relevant first and capped at what the
 * card has room for. The codes come off the one ground layer that is drawn, so
 * they resolve against that layer's catalogue and fall through to the other.
 */
export const seabedFrom = (
	codes: ReadonlySet<string>,
	ground: Ground,
	limit = SEABED_LIMIT
): readonly SeabedClass[] =>
	[...codes]
		.flatMap((code) => seabedClassByCode(code, ground) ?? [])
		.sort(byProminence)
		.slice(0, limit);

export const KIND_LABEL: Record<DiveFeatureKind, MessageKey> = {
	'dive-site': 'kindDiveSite',
	mooring: 'kindMooring',
	wreck: 'kindWreck',
	rock: 'kindRock',
	'restricted-area': 'kindRestrictedArea',
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
