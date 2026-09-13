import {
	DEFAULT_ISOBATHS,
	DEFAULT_LAYERS,
	type IsobathStyle,
	type LayerId,
	type LngLat,
	type MarkerLayerId,
	markerLayerId
} from '$lib/domain/card';
import type { Ground } from '$lib/domain/habitat';
import { DIVE_FEATURE_KINDS } from '$lib/domain/osm';
import { type Locale, isLocale } from '$lib/i18n/locale';
import type { KeyValueStore } from './storage.ts';

/**
 * What a diver can save, and what they cannot.
 *
 * A configuration is how the map is read: what is drawn, how the isobaths are
 * cut, which marks are on, which language. It is deliberately not where the map
 * is pointed. Loading "night dive" while the boat is tied up at Tamariu must not
 * throw the screen back to wherever that setup happened to be saved, and on a
 * boat being moved somewhere else is the worst thing a control can do. Places
 * are already on the map; a configuration is a way of looking at them.
 *
 * The camera is per tab instead, which is what `Working` below carries.
 *
 * Two more things land in `Configuration` later and the shape is built to take
 * them as plain fields: the print sheet settings, once the print path exposes a
 * serialisable shape of its own, and the per-seabed-class texture choice from
 * issue #3. Neither needs a change to the stored format or a version bump for
 * anyone who never set one.
 */
export interface Configuration {
	readonly layers: readonly LayerId[];
	readonly ground: Ground;
	/** The survey is a 10 m raster. Off shows it as measured, staircase and all. */
	readonly smoothed: boolean;
	readonly isobaths: IsobathStyle;
	readonly locale: Locale;
}

/** Where one tab is pointed. Per tab, never named, never shared. */
export interface Camera {
	readonly centre: LngLat;
	readonly zoom: number;
	readonly bearing: number;
}

/** A named configuration, as saved by hand. The name is its identity. */
export interface SavedConfiguration {
	readonly name: string;
	readonly configuration: Configuration;
}

/** Everything kept in `localStorage`: the saved configurations and which one a new tab opens with. */
export interface Library {
	readonly saved: readonly SavedConfiguration[];
	/** Name of the configuration a new tab starts from. Always one that exists. */
	readonly openWith: string | undefined;
}

/** Everything kept in `sessionStorage`: what this tab is doing right now. */
export interface Working {
	readonly configuration: Configuration;
	readonly camera: Camera | undefined;
	/** The saved configuration this tab was working from, when it came from one. */
	readonly from: string | undefined;
}

export const EMPTY_LIBRARY: Library = { saved: [], openWith: undefined };

export const shippedConfiguration = (locale: Locale): Configuration => ({
	layers: DEFAULT_LAYERS,
	ground: 'habitats',
	smoothed: true,
	isobaths: DEFAULT_ISOBATHS,
	locale
});

/**
 * How long a name may be. Long enough for "Medes, north wall, low visibility"
 * and short enough that the list stays a list.
 */
export const NAME_LIMIT = 60;

/** How many configurations one browser keeps. A quota failure on a boat is not recoverable. */
export const LIBRARY_LIMIT = 50;

/**
 * The stored format's version, in the blob rather than in the key.
 *
 * A version in the key would let a newer app write beside an older one and have
 * each silently ignore the other's work, which is the wrong answer for something
 * a diver saved on purpose. In the blob, an older app can see that a newer one
 * wrote there, and say so instead of guessing or overwriting.
 *
 * When this shape changes, raise the number and migrate `1` forward in
 * `readLibrary`. Never drop what cannot be migrated: refuse it with a reason and
 * leave it on the device. A saved setup a diver cannot load is a nuisance; one
 * the map quietly deleted is the end of trusting it.
 */
export const STORAGE_VERSION = 1;

export const LIBRARY_KEY = 'dive-map:configurations';
export const WORKING_KEY = 'dive-map:working';

/**
 * What came back from storage. `damaged` is a blob this version cannot read at
 * all; `newer` is one a later version of the map wrote. Both are kept, shown,
 * and never written over on their own.
 */
export type Stored<T> =
	| { readonly kind: 'ok'; readonly value: T }
	| { readonly kind: 'empty' }
	| { readonly kind: 'unreadable'; readonly why: 'damaged' | 'newer' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const numberWithin = (value: unknown, low: number, high: number): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
		? value
		: undefined;

const booleanOr = (value: unknown, fallback: boolean): boolean =>
	typeof value === 'boolean' ? value : fallback;

/**
 * Every layer id this version will accept. Written as a record of the fixed ones
 * so that adding a `LayerId` fails the build here rather than being dropped from
 * a diver's saved configuration at load time; the marker ids are derived from the
 * OSM kinds for the same reason.
 */
const FIXED_LAYERS: Record<Exclude<LayerId, MarkerLayerId>, true> = {
	'zero-isobath': true,
	hillshade: true,
	'depth-tint': true,
	isobaths: true,
	habitats: true,
	substrate: true,
	coastline: true,
	osm: true,
	annotations: true
};

const MARKER_LAYERS: ReadonlySet<string> = new Set<string>(
	DIVE_FEATURE_KINDS.map((kind) => markerLayerId(kind))
);

const isLayerId = (value: string): value is LayerId =>
	Object.hasOwn(FIXED_LAYERS, value) || MARKER_LAYERS.has(value);

/**
 * A layer id this version does not know is left out of the running map, because
 * there is nothing to switch on. It is not erased: the stored blob is only ever
 * rewritten when the diver saves over it on purpose.
 */
const parseLayers = (value: unknown): readonly LayerId[] | undefined => {
	if (!Array.isArray(value)) return undefined;
	const ids = new Set<LayerId>();
	for (const entry of value) if (typeof entry === 'string' && isLayerId(entry)) ids.add(entry);
	return [...ids];
};

/** Deepest the survey goes, with room for a hand-edited number that still draws. */
const DEPTH_LIMIT = 200;

const parseIsobaths = (value: unknown): IsobathStyle => {
	if (!isRecord(value)) return DEFAULT_ISOBATHS;
	const emphasised = Array.isArray(value['emphasised'])
		? [
				...new Set(
					value['emphasised'].flatMap((depth: unknown) => {
						const metres = numberWithin(depth, 0, DEPTH_LIMIT);
						return metres === undefined ? [] : [metres];
					})
				)
			]
				.sort((a, b) => a - b)
				.slice(0, 32)
		: DEFAULT_ISOBATHS.emphasised;
	return {
		intervalM: numberWithin(value['intervalM'], 1, 100) ?? DEFAULT_ISOBATHS.intervalM,
		autoInterval: booleanOr(value['autoInterval'], DEFAULT_ISOBATHS.autoInterval),
		emphasised,
		maxDepthM: numberWithin(value['maxDepthM'], 5, DEPTH_LIMIT) ?? DEFAULT_ISOBATHS.maxDepthM,
		labels: booleanOr(value['labels'], DEFAULT_ISOBATHS.labels)
	};
};

/**
 * A field this version cannot make sense of falls back to what the map ships
 * with, rather than failing the whole configuration. A diver who saved eight
 * settings and finds seven of them restored is better served than one who is
 * told the whole thing is broken because a single number was edited by hand.
 */
export const parseConfiguration = (value: unknown, locale: Locale): Configuration | undefined => {
	if (!isRecord(value)) return undefined;
	const ground = value['ground'];
	const stored = value['locale'];
	return {
		layers: parseLayers(value['layers']) ?? DEFAULT_LAYERS,
		ground: ground === 'substrate' || ground === 'habitats' ? ground : 'habitats',
		smoothed: booleanOr(value['smoothed'], true),
		isobaths: parseIsobaths(value['isobaths']),
		locale: typeof stored === 'string' && isLocale(stored) ? stored : locale
	};
};

/** Web Mercator stops here, and so does MapLibre. */
const LATITUDE_LIMIT = 85.051_128_78;

/**
 * A camera that would put the map somewhere it has nothing to draw is not
 * rejected here: `constrainToData` in `$lib/map/camera.ts` pulls the centre back
 * to the survey the moment the map mounts, and it is the one place that knows
 * the viewport size the answer depends on. What this rejects is a camera no map
 * can accept at all, which is what a hand-edited blob produces.
 */
export const parseCamera = (value: unknown): Camera | undefined => {
	if (!isRecord(value)) return undefined;
	const centre = value['centre'];
	if (!isRecord(centre)) return undefined;
	const lng = numberWithin(centre['lng'], -180, 180);
	const lat = numberWithin(centre['lat'], -LATITUDE_LIMIT, LATITUDE_LIMIT);
	const zoom = numberWithin(value['zoom'], 0, 24);
	if (lng === undefined || lat === undefined || zoom === undefined) return undefined;
	const bearing = numberWithin(value['bearing'], -3600, 3600) ?? 0;
	return { centre: { lng, lat }, zoom, bearing: ((bearing % 360) + 360) % 360 };
};

const parseName = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined;
	const name = value.trim();
	return name.length === 0 || name.length > NAME_LIMIT ? undefined : name;
};

const readBlob = (raw: string | undefined): Stored<Record<string, unknown>> => {
	if (raw === undefined) return { kind: 'empty' };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { kind: 'unreadable', why: 'damaged' };
	}
	if (!isRecord(parsed)) return { kind: 'unreadable', why: 'damaged' };
	const version = parsed['version'];
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		return { kind: 'unreadable', why: 'damaged' };
	}
	if (version > STORAGE_VERSION) return { kind: 'unreadable', why: 'newer' };
	return { kind: 'ok', value: parsed };
};

/**
 * Names are the identity, so a duplicate can only come from a hand-edited blob.
 * The first one wins, which is the repair that surprises least: the list keeps
 * the order it was written in and the name still means one thing.
 */
export const readLibrary = (store: KeyValueStore, locale: Locale): Stored<Library> => {
	const blob = readBlob(store.read(LIBRARY_KEY));
	if (blob.kind !== 'ok') return blob;
	const entries = blob.value['saved'];
	if (!Array.isArray(entries)) return { kind: 'unreadable', why: 'damaged' };

	const saved: SavedConfiguration[] = [];
	const taken = new Set<string>();
	for (const entry of entries) {
		if (!isRecord(entry)) continue;
		const name = parseName(entry['name']);
		if (name === undefined || taken.has(name)) continue;
		const configuration = parseConfiguration(entry['configuration'], locale);
		if (configuration === undefined) continue;
		taken.add(name);
		saved.push({ name, configuration });
		if (saved.length === LIBRARY_LIMIT) break;
	}

	const openWith = parseName(blob.value['openWith']);
	return {
		kind: 'ok',
		value: { saved, openWith: openWith !== undefined && taken.has(openWith) ? openWith : undefined }
	};
};

export const writeLibrary = (store: KeyValueStore, library: Library): boolean =>
	store.write(
		LIBRARY_KEY,
		JSON.stringify({
			version: STORAGE_VERSION,
			openWith: library.openWith,
			saved: library.saved
		})
	);

/**
 * A working configuration is what this tab was doing a moment ago, so a blob it
 * cannot read is worth nothing and is replaced by the next write. The library is
 * the opposite: somebody typed a name and meant it.
 */
export const readWorking = (store: KeyValueStore, locale: Locale): Working | undefined => {
	const blob = readBlob(store.read(WORKING_KEY));
	if (blob.kind !== 'ok') return undefined;
	const configuration = parseConfiguration(blob.value['configuration'], locale);
	if (configuration === undefined) return undefined;
	return {
		configuration,
		camera: parseCamera(blob.value['camera']),
		from: parseName(blob.value['from'])
	};
};

export const writeWorking = (store: KeyValueStore, working: Working): boolean =>
	store.write(WORKING_KEY, JSON.stringify({ version: STORAGE_VERSION, ...working }));
