import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ISOBATHS, DEFAULT_LAYERS } from '$lib/domain/card';
import { HABITATS, SUBSTRATES, substrateByCode } from '$lib/domain/habitat';
import { buildStyle } from '$lib/map/style';
import { type DiveFeature, parseDiveFeature } from '$lib/domain/osm';
import { LOCALES } from '$lib/i18n/locale';
import {
	type FeatureProperties,
	GROUND_PICK_LAYERS,
	KIND_LABEL,
	OSM_PICK_LAYERS,
	detailRowsOf,
	difficultyPips,
	difficultyText,
	heroDepthOf,
	pickFrom,
	refOf,
	seabedFrom,
	subtitleOf,
	tagsOf,
	texturePath
} from './feature-card.ts';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const raw: unknown = JSON.parse(
	readFileSync(new URL('../../../static/data/osm.geojson', import.meta.url), 'utf8')
);

const shippedProperties = (): readonly FeatureProperties[] => {
	if (!isRecord(raw)) throw new Error('osm.geojson is not an object');
	const features = raw['features'];
	if (!isArray(features)) throw new Error('osm.geojson carries no feature array');
	return features.map((entry) => {
		if (!isRecord(entry)) throw new Error('a shipped feature is not an object');
		const props = entry['properties'];
		if (!isRecord(props)) throw new Error('a shipped feature carries no properties');
		return props;
	});
};

const SHIPPED = shippedProperties();

const namedFeature = (name: string): FeatureProperties => {
	const found = SHIPPED.find((props) => props['name'] === name);
	if (found === undefined) throw new Error(`the shipped file has no feature named ${name}`);
	return found;
};

const parsedFrom = (props: FeatureProperties): DiveFeature => {
	const ref = refOf(props);
	if (ref === undefined) throw new Error('a shipped feature carries no usable OSM ref');
	const feature = parseDiveFeature(ref, tagsOf(props));
	if (feature === undefined) throw new Error('the parser ignored a shipped feature');
	return feature;
};

const diveSiteNamed = (name: string): Extract<DiveFeature, { kind: 'dive-site' }> => {
	const feature = parsedFrom(namedFeature(name));
	if (feature.kind !== 'dive-site') throw new Error(`${name} parsed as ${feature.kind}`);
	return feature;
};

const wreckNamed = (name: string): Extract<DiveFeature, { kind: 'wreck' }> => {
	const feature = parsedFrom(namedFeature(name));
	if (feature.kind !== 'wreck') throw new Error(`${name} parsed as ${feature.kind}`);
	return feature;
};

const SHIPPED_FEATURES: readonly DiveFeature[] = SHIPPED.flatMap((props) => {
	const ref = refOf(props);
	if (ref === undefined) return [];
	const feature = parseDiveFeature(ref, tagsOf(props));
	return feature === undefined ? [] : [feature];
});

const ZONE_NAME = 'Zona vedada del Cap Negre al Pa de Pessic (Ses Negres)';

describe('trusting what the map hands back', () => {
	it('turns a numeric id into a tag string and leaves out what is not a tag', () => {
		const tags = tagsOf({ t: 'node', id: 12132826555, name: 'Canons de Tamariu', alt_name: null });
		expect(tags['id']).toBe('12132826555');
		expect(tags['name']).toBe('Canons de Tamariu');
		expect('alt_name' in tags).toBe(false);
	});

	it('refuses a feature with no id and one whose id is not a number', () => {
		expect(refOf({ t: 'node', name: 'Canons de Tamariu' })).toBeUndefined();
		expect(refOf({ t: 'node', id: '12132826555' })).toBeUndefined();
		expect(refOf({ t: 'node', id: 12132826555 })).toEqual({ type: 'node', id: 12132826555 });
	});
});

describe('picking a feature off the map', () => {
	it('prefers the dive site over the zone it sits inside, whichever was hit first', () => {
		const site = namedFeature('Canons de Tamariu');
		const zone = namedFeature(ZONE_NAME);
		expect(pickFrom([zone], [])?.feature.kind).toBe('restricted-area');
		expect(pickFrom([zone, site], [])?.feature.name).toBe('Canons de Tamariu');
		expect(pickFrom([site, zone], [])?.feature.name).toBe('Canons de Tamariu');
	});

	it('picks nothing when no hit is a feature this map shows', () => {
		const hits = [
			{ kind: 'dive-site', name: 'no ref on this one' },
			{ t: 'node', id: 1, amenity: 'cafe' }
		];
		expect(pickFrom(hits, [])).toBeUndefined();
	});

	it('reads the seabed off ground hits that carry a code and skips the ones that do not', () => {
		const site = namedFeature('Canons de Tamariu');
		const ground = [{ code: '30512' }, { name: 'no code here' }, { code: '30402' }];
		expect(pickFrom([site], ground)?.seabed.map((c) => c.code)).toEqual(['30512', '30402']);
	});
});

describe('the seabed strip under the tap', () => {
	it('puts Posidonia ahead of bare sand', () => {
		expect(seabedFrom(new Set(['30402', '30512']))[0]?.code).toBe('30512');
	});

	it('resolves a substrate-only code the habitat legend cannot see', () => {
		const seabed = seabedFrom(new Set(['301']));
		expect(seabed[0]).toBe(substrateByCode.get('301'));
		expect(seabed[0]?.ca).toBe('Roca');
	});

	it('points a class at its swatch', () => {
		expect(texturePath('ch_grass_2')).toBe('/textures/swatch/ch_grass_2.jpg');
	});

	it('ships a swatch file for every texture in both catalogues', () => {
		const missing = [...HABITATS, ...SUBSTRATES]
			.map((c) => texturePath(c.texture))
			.filter((path) => !existsSync(new URL(`../../../static${path}`, import.meta.url)));
		expect(missing).toEqual([]);
	});
});

describe('what the panel shows', () => {
	it('reads depth, difficulty, entry and hazards off a boat dive site', () => {
		const site = diveSiteNamed('Canons de Tamariu');
		expect(site.maxDepth).toBe(40);
		expect(site.difficulty).toEqual([2]);
		expect(site.entry).toEqual(['boat']);
		expect(site.dangers).toEqual(['current']);
		expect(heroDepthOf(site)).toEqual({ label: 'maxDepth', metres: 40 });
	});

	it('prints a spread of difficulty levels as a range in each locale', () => {
		const site = diveSiteNamed('Barda de Fitor');
		expect(site.maxDepth).toBe(54);
		expect(site.difficulty).toEqual([2, 3]);
		expect(difficultyText('ca', [2, 3])).toBe('2 a 3');
		expect(difficultyText('en', [2, 3])).toBe('2 to 3');
	});

	it('shades the pips between the lowest and the highest level', () => {
		expect(difficultyPips([2, 3])).toEqual([false, true, true, false, false]);
	});

	it('draws no pips at all for a missing or off-scale difficulty', () => {
		expect(difficultyPips([])).toEqual([]);
		expect(difficultyPips([7])).toEqual([]);
	});

	it('takes a wreck depth off the depth tag and translates its civilisation', () => {
		const wreck = wreckNamed('Aiguablava V i VII');
		expect(heroDepthOf(wreck)).toEqual({ label: 'depth', metres: 7 });
		const catalan = detailRowsOf(wreck, 'ca');
		expect(catalan.find((row) => row.label === 'civilization')?.values).toEqual(['Romana']);
		expect(catalan.find((row) => row.label === 'description')?.values).toEqual(['Àmfores']);
		const english = detailRowsOf(wreck, 'en');
		expect(english.find((row) => row.label === 'civilization')?.values).toEqual(['Roman']);
	});

	it('leaves the depth blank rather than printing a zero a diver could act on', () => {
		const site = diveSiteNamed('la Pedrosa');
		const hero = heroDepthOf(site);
		expect(hero).toBeDefined();
		if (hero === undefined) throw new Error('a dive site always keeps its depth slot');
		expect(hero.label).toBe('maxDepth');
		expect(hero.metres).toBeUndefined();
		expect(detailRowsOf(site, 'ca').filter((row) => row.values.length === 0)).toEqual([]);
	});
});

describe('every feature the shipped file carries', () => {
	it('parses the whole file', () => {
		expect(SHIPPED).toHaveLength(954);
		expect(SHIPPED_FEATURES).toHaveLength(954);
	});

	it('labels every kind that survives the parse', () => {
		const labelled = new Set(Object.keys(KIND_LABEL));
		const unlabelled = SHIPPED_FEATURES.filter((f) => !labelled.has(f.kind)).map((f) => f.ref.id);
		expect(unlabelled).toEqual([]);
	});

	it('writes a subtitle in all three locales with nothing blank in it', () => {
		const blank = LOCALES.flatMap((locale) =>
			SHIPPED_FEATURES.flatMap((feature) => {
				const parts = subtitleOf(feature, locale);
				return parts.length > 0 && parts.every((part) => part.length > 0)
					? []
					: [`${locale} ${feature.ref.id}`];
			})
		);
		expect(blank).toEqual([]);
	});

	it('never prints a detail row with nothing in it', () => {
		const hollow = LOCALES.flatMap((locale) =>
			SHIPPED_FEATURES.flatMap((feature) =>
				detailRowsOf(feature, locale)
					.filter((row) => row.values.length === 0)
					.map((row) => `${locale} ${feature.ref.id} ${row.label}`)
			)
		);
		expect(hollow).toEqual([]);
	});
});

describe('the layers a tap is allowed to hit', () => {
	// A renamed layer in style.ts would leave the panel silently dead on the boat,
	// because queryRenderedFeatures answers an unknown id with nothing.
	it.each(['habitats', 'substrate'] as const)('all exist in the %s style', (groundLayer) => {
		const style = buildStyle({
			locale: 'ca',
			isobaths: DEFAULT_ISOBATHS,
			visible: [...DEFAULT_LAYERS],
			groundLayer
		});
		const ids = new Set(style.layers.map((layer) => layer.id));
		const missing = [...OSM_PICK_LAYERS, ...GROUND_PICK_LAYERS].filter((id) => !ids.has(id));
		expect(missing).toEqual([]);
	});
});
