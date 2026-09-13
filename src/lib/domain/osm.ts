import { type Depth, depth } from './units.ts';

/**
 * OSM tags arrive as free-form strings from a source anybody can edit. Everything
 * below the parse boundary works on the union, so a missing or malformed tag is
 * handled once here rather than defended against at every call site.
 */
export type OsmTags = Readonly<Record<string, string>>;

export type OsmElementType = 'node' | 'way' | 'relation';

export interface OsmRef {
	readonly type: OsmElementType;
	readonly id: number;
}

export const osmUrl = (ref: OsmRef): string =>
	`https://www.openstreetmap.org/${ref.type}/${ref.id}`;

export type DiveEntry = 'shore' | 'boat';

/** Depths a card can label. Anything deeper than this is beyond recreational limits. */
export const DEEPEST_LABELLED = depth(120);

interface Base {
	readonly ref: OsmRef;
	readonly name: string | undefined;
	readonly tags: OsmTags;
}

export type DiveFeature =
	| (Base & {
			readonly kind: 'dive-site';
			readonly altName: string | undefined;
			readonly maxDepth: Depth | undefined;
			readonly difficulty: readonly number[];
			readonly entry: readonly DiveEntry[];
			readonly dangers: readonly string[];
			readonly submerged: boolean;
	  })
	| (Base & { readonly kind: 'mooring'; readonly category: string | undefined })
	| (Base & {
			readonly kind: 'wreck';
			readonly wreckDepth: Depth | undefined;
			readonly civilization: string | undefined;
			readonly description: string | undefined;
	  })
	| (Base & { readonly kind: 'rock'; readonly waterLevel: string | undefined })
	| (Base & { readonly kind: 'restricted-area'; readonly category: string | undefined })
	| (Base & { readonly kind: 'swimming-area'; readonly category: string | undefined })
	| (Base & { readonly kind: 'buoy'; readonly category: string | undefined })
	| (Base & {
			readonly kind: 'light';
			readonly character: string | undefined;
			readonly colour: string | undefined;
			readonly period: string | undefined;
			readonly range: string | undefined;
	  })
	| (Base & { readonly kind: 'harbour'; readonly category: string | undefined })
	| (Base & { readonly kind: 'slipway' })
	| (Base & { readonly kind: 'ladder' })
	| (Base & { readonly kind: 'dive-centre' });

export type DiveFeatureKind = DiveFeature['kind'];

/**
 * Every kind, in the order a diver reads them: what the dive is, what threatens
 * it, then the furniture of getting in and out of the water. The legend, the
 * layer switches and the style's own grouping all walk this list rather than
 * writing the kinds out again, and `markers.spec.ts` fails if it ever falls
 * behind the union above.
 */
export const DIVE_FEATURE_KINDS = [
	'dive-site',
	'wreck',
	'rock',
	'restricted-area',
	'swimming-area',
	'mooring',
	'buoy',
	'light',
	'dive-centre',
	'slipway',
	'ladder',
	'harbour'
] as const satisfies readonly DiveFeatureKind[];

const semicolonList = (raw: string | undefined): readonly string[] =>
	raw === undefined
		? []
		: raw
				.split(';')
				.map((s) => s.trim())
				.filter((s) => s.length > 0);

const numberList = (raw: string | undefined): readonly number[] =>
	semicolonList(raw)
		.map(Number)
		.filter((n) => Number.isFinite(n));

const parseDepth = (raw: string | undefined): Depth | undefined => {
	if (raw === undefined) return undefined;
	const n = Number.parseFloat(raw);
	return Number.isFinite(n) && n >= 0 ? depth(n) : undefined;
};

const entries = (raw: string | undefined): readonly DiveEntry[] =>
	semicolonList(raw).filter((v): v is DiveEntry => v === 'shore' || v === 'boat');

/**
 * Categories of restricted area that mark water people are meant to be in.
 *
 * A bathing zone carries the same `seamark:type=restricted_area` as a live firing
 * range, and drawing both with a no-entry sign told a diver the wrong thing about
 * the twenty-eight recreation zones on this coast. The rule the zone carries is
 * about boats, not about swimmers, so these become their own kind and take the
 * swimmer.
 */
const SWIMMING_ZONES: ReadonlySet<string> = new Set(['swimming', 'recreation_zone']);

/** Prefix on the per-site hazard flags, one tag per danger. */
export const DANGER_TAG_PREFIX = 'scuba_diving:dangers:';

/**
 * Every tag key `parseDiveFeature` reads by name, so a fetched element can be cut
 * down to what this map uses before it is cached or handed to the style.
 *
 * An Overpass answer for this coast is about a megabyte, and nine tenths of it is
 * tags nothing here looks at. `osm.spec.ts` fails if the parser starts reading a
 * key that is not on this list, which is the same guard `osm_to_geojson.py`
 * applies to the build-time copy.
 */
export const DIVE_TAG_KEYS = [
	'alt_name',
	'amenity',
	'depth',
	'description',
	'highway',
	'historic:civilization',
	'location',
	'name',
	'name:ca',
	'name:en',
	'name:es',
	'natural',
	'scuba_diving:difficulty',
	'scuba_diving:divespot',
	'scuba_diving:entry',
	'scuba_diving:maxdepth',
	'seamark:buoy_special_purpose:category',
	'seamark:harbour:category',
	'seamark:light:character',
	'seamark:light:colour',
	'seamark:light:period',
	'seamark:light:range',
	'seamark:mooring:category',
	'seamark:restricted_area:category',
	'seamark:rock:water_level',
	'seamark:type',
	'seamark:wreck:water_level',
	'shop',
	'sport',
	'waterway'
] as const satisfies readonly string[];

const KEPT_TAGS: ReadonlySet<string> = new Set<string>(DIVE_TAG_KEYS);

/** The tags of one element, cut to what this map reads. */
export function keepDiveTags(tags: OsmTags): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const [key, value] of Object.entries(tags)) {
		if (KEPT_TAGS.has(key) || key.startsWith(DANGER_TAG_PREFIX)) kept[key] = value;
	}
	return kept;
}

const dangerTags = (tags: OsmTags): readonly string[] =>
	Object.entries(tags)
		.filter(([k, v]) => k.startsWith(DANGER_TAG_PREFIX) && v === 'yes')
		.map(([k]) => k.slice(DANGER_TAG_PREFIX.length));

/**
 * Returns undefined for elements this map has no use for, which is most of a
 * seamark bbox. Callers filter on that rather than on tag names.
 */
export function parseDiveFeature(ref: OsmRef, tags: OsmTags): DiveFeature | undefined {
	const base: Base = { ref, name: tags['name'], tags };
	const seamark = tags['seamark:type'];

	if (tags['scuba_diving:divespot'] === 'yes' || tags['sport'] === 'scuba_diving') {
		if (tags['amenity'] === 'dive_centre' || tags['shop'] === 'scuba_diving') {
			return { ...base, kind: 'dive-centre' };
		}
		return {
			...base,
			kind: 'dive-site',
			altName: tags['alt_name'],
			maxDepth: parseDepth(tags['scuba_diving:maxdepth']),
			difficulty: numberList(tags['scuba_diving:difficulty']),
			entry: entries(tags['scuba_diving:entry']),
			dangers: dangerTags(tags),
			submerged: tags['location'] === 'underwater'
		};
	}

	if (tags['amenity'] === 'dive_centre' || tags['shop'] === 'scuba_diving') {
		return { ...base, kind: 'dive-centre' };
	}

	switch (seamark) {
		case 'mooring':
			return { ...base, kind: 'mooring', category: tags['seamark:mooring:category'] };
		case 'wreck':
			return {
				...base,
				kind: 'wreck',
				wreckDepth: parseDepth(tags['depth'] ?? tags['seamark:wreck:water_level']),
				civilization: tags['historic:civilization'],
				description: tags['description']
			};
		case 'rock':
			return { ...base, kind: 'rock', waterLevel: tags['seamark:rock:water_level'] };
		case 'restricted_area': {
			const category = tags['seamark:restricted_area:category'];
			return category !== undefined && SWIMMING_ZONES.has(category)
				? { ...base, kind: 'swimming-area', category }
				: { ...base, kind: 'restricted-area', category };
		}
		case 'buoy_special_purpose':
			return { ...base, kind: 'buoy', category: tags['seamark:buoy_special_purpose:category'] };
		case 'light_minor':
		case 'light_major':
		case 'beacon_lateral':
			return {
				...base,
				kind: 'light',
				character: tags['seamark:light:character'],
				colour: tags['seamark:light:colour'],
				period: tags['seamark:light:period'],
				range: tags['seamark:light:range']
			};
		case 'harbour':
		case 'small_craft_facility':
			return { ...base, kind: 'harbour', category: tags['seamark:harbour:category'] };
		case undefined:
		default:
			break;
	}

	if (tags['waterway'] === 'slipway') return { ...base, kind: 'slipway' };
	if (tags['highway'] === 'ladder') return { ...base, kind: 'ladder' };
	if (tags['natural'] === 'rock' && tags['location'] === 'underwater') {
		return { ...base, kind: 'rock', waterLevel: 'submerged' };
	}
	return undefined;
}

/**
 * The property names the reductions derive rather than copy from a tag. `style.ts`
 * may read one of these or a key on `DIVE_TAG_KEYS`, and nothing else: reading
 * anything else is how `osm-dive-site-depth` came to draw nothing for its whole
 * life, which `style.spec.ts` now fails on.
 */
export const DIVE_NUMBER_KEYS = ['maxDepth'] as const satisfies readonly string[];

/**
 * The properties a style expression does arithmetic on, as opposed to the tags it
 * only ever compares.
 *
 * `scuba_diving:maxdepth` is free text a mapper types, so it arrives as "18" on
 * one site and could arrive as "40 m" on the next. A label wants a number and
 * `symbol-sort-key` wants one it can subtract, and `parseDiveFeature` already
 * does that parse. Both reductions emit what it returned rather than restating
 * the rule: `overpass.ts` calls this directly, and `osm_to_geojson.py` reaches it
 * through the same node bridge it runs the parser with. That is what keeps the
 * baked file and the live Overpass answer agreeing, which they must, because one
 * replaces the other at runtime.
 */
export function diveNumbers(feature: DiveFeature): Record<string, number> {
	if (feature.kind === 'dive-site' && feature.maxDepth !== undefined) {
		return { maxDepth: feature.maxDepth };
	}
	return {};
}
