import {
	HABITATS,
	SUBSTRATES,
	type SeabedClass,
	legendFor,
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
import type { Depth } from '$lib/domain/units';
import { type Locale, localisedName } from '$lib/i18n/locale';
import { type MessageKey, t } from '$lib/i18n/messages';

/** A MapLibre feature's properties, before anything trusts them. */
export type FeatureProperties = Readonly<Record<string, unknown>>;

export interface FeaturePick {
	readonly feature: DiveFeature;
	/** Seabed classes under the tapped point, most diver-relevant first. */
	readonly seabed: readonly SeabedClass[];
}

export const OSM_PICK_LAYERS = [
	'osm-dive-site',
	'osm-dive-site-label',
	'osm-wreck',
	'osm-mooring',
	'osm-site-area',
	'osm-restricted',
	'osm-minor'
] as const;

export const GROUND_PICK_LAYERS = ['ground-fill'] as const;

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
	'restricted-area': 9
};

export const pickFrom = (
	osmHits: readonly FeatureProperties[],
	groundHits: readonly FeatureProperties[]
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
	if (best === undefined) return undefined;

	const codes = new Set<string>();
	for (const props of groundHits) {
		const code = props['code'];
		if (typeof code === 'string') codes.add(code);
	}
	return { feature: best, seabed: seabedFrom(codes) };
};

const CATALOGUE: readonly SeabedClass[] = [...SUBSTRATES, ...HABITATS];

/**
 * The ground layer can be the substrate layer, whose codes ('301' Roca and the
 * rest) are SubstrateClass and invisible to legendFor. Take legendFor's ordering
 * and cap first, then fill from the catalogues for whatever it could not see.
 */
export const seabedFrom = (
	codes: ReadonlySet<string>,
	limit = SEABED_LIMIT
): readonly SeabedClass[] => {
	const chosen: SeabedClass[] = [...legendFor(codes, limit)];
	const covered = new Set(chosen.map((c) => c.code));
	for (const entry of CATALOGUE) {
		if (entry.code === undefined || covered.has(entry.code) || !codes.has(entry.code)) continue;
		const resolved = seabedClassByCode(entry.code);
		if (resolved === undefined) continue;
		covered.add(entry.code);
		chosen.push(resolved);
	}
	return chosen.slice(0, limit);
};

export const KIND_LABEL: Record<DiveFeatureKind, MessageKey> = {
	'dive-site': 'kindDiveSite',
	mooring: 'kindMooring',
	wreck: 'kindWreck',
	rock: 'kindRock',
	'restricted-area': 'kindRestrictedArea',
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
		case 'rock':
		case 'restricted-area':
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
		case 'restricted-area':
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
			return labelled(ZONE_LABEL, locale, feature.category);
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
export const texturePath = (texture: string): string => `/textures/swatch/${texture}.jpg`;
