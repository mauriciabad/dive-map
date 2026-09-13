import { asset } from '$app/paths';
import { type OsmElementType, type OsmRef } from '$lib/domain/osm';
import { type Camera, parseCamera } from './configuration.ts';

/**
 * What a link can point at, and how it is written.
 *
 * A diver texting "meet me here" needs the place in the message, not a
 * description of it. Two things are worth addressing: where the map is pointed,
 * and which feature is open. Both go in the fragment, in OSM's own shape:
 *
 *     #map=15.2/41.92751/3.21654
 *     #map=15.2/41.92751/3.21654/120
 *     #osm=node/1234567
 *     #map=16/41.9/3.2&osm=way/987
 *
 * The fragment rather than a query for one practical reason: this site answers
 * on its own root at divemap.mauri.app and under /dive-map/ on the project URL,
 * and it is prerendered static files either way. A fragment never reaches a
 * server, so a link works on both without anything being configured, and it is
 * the shape people already recognise from openstreetmap.org.
 *
 * `map=` is zoom, latitude, longitude, and a bearing only when the map is turned.
 * Five decimals is a little over a metre, which is finer than any fix a phone
 * hands over and short enough to paste into a message.
 *
 * Nothing here trusts what it is given. A hand-edited fragment is exactly as
 * hostile as a hand-edited stored blob, so the camera goes through the same
 * `parseCamera` the stored one does and picks up the same limits.
 */

export interface Address {
	/** Where the link points. Beats every remembered camera, for that navigation only. */
	readonly camera: Camera | undefined;
	/** The feature the link is about, whose card opens on arrival. */
	readonly osm: OsmRef | undefined;
}

export const NO_ADDRESS: Address = { camera: undefined, osm: undefined };

/** Enough to place a boat, and two characters shorter than the six a GPS claims. */
const PLACE_DECIMALS = 5;

const isElementType = (value: string): value is OsmElementType =>
	value === 'node' || value === 'way' || value === 'relation';

/** `zoom/lat/lng` with an optional bearing, or nothing at all. */
const readCamera = (value: string): Camera | undefined => {
	const parts = value.split('/');
	if (parts.length < 3 || parts.length > 4) return undefined;
	const [zoom, lat, lng, bearing] = parts.map((part) => Number(part));
	// Number('') is 0 and Number('  ') is 0, which would read an empty field as the
	// equator. Every field has to be a number somebody wrote.
	if (parts.some((part) => part.trim().length === 0)) return undefined;
	return parseCamera({
		centre: { lng, lat },
		zoom,
		...(bearing === undefined ? {} : { bearing })
	});
};

const readOsm = (value: string): OsmRef | undefined => {
	const [type, raw] = value.split('/');
	if (type === undefined || raw === undefined || !isElementType(type)) return undefined;
	const id = Number(raw);
	return Number.isSafeInteger(id) && id > 0 ? { type, id } : undefined;
};

/**
 * What the fragment of a URL points at. Anything it cannot read is dropped
 * rather than refused, so a link that picked up a stray character on its way
 * through a chat app still lands the diver somewhere.
 */
export const parseAddress = (hash: string): Address => {
	const fields = new URLSearchParams(hash.replace(/^#/, ''));
	const map = fields.get('map');
	const osm = fields.get('osm');
	return {
		camera: map === null ? undefined : readCamera(map),
		osm: osm === null ? undefined : readOsm(osm)
	};
};

/** Trailing zeros are noise in something meant to be pasted into a message. */
const trimmed = (value: number, decimals: number): string => String(Number(value.toFixed(decimals)));

/**
 * The fragment for what is on screen, `#` included, or the empty string when
 * there is nothing worth addressing.
 *
 * A bearing of zero is left out. Almost every share is of a north-up map, and
 * the field costs four characters to say so.
 */
export const formatAddress = ({ camera, osm }: Address): string => {
	const fields: string[] = [];
	if (camera !== undefined) {
		const place = [
			trimmed(camera.zoom, 2),
			trimmed(camera.centre.lat, PLACE_DECIMALS),
			trimmed(camera.centre.lng, PLACE_DECIMALS)
		];
		if (Math.round(camera.bearing) % 360 !== 0) place.push(trimmed(camera.bearing, 1));
		fields.push(`map=${place.join('/')}`);
	}
	if (osm !== undefined) fields.push(`osm=${osm.type}/${osm.id}`);
	return fields.length === 0 ? '' : `#${fields.join('&')}`;
};

/** Everything a feature covers, which is a single point for most of them. */
export interface Extent {
	readonly west: number;
	readonly south: number;
	readonly east: number;
	readonly north: number;
}

const isArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Grow the box by every position in a geometry, at whatever depth they are: a
 * point, a ring, a ring of rings. The recursion stops at the first pair of
 * numbers, which is what a position is at every level of GeoJSON.
 */
const grow = (box: { west: number; south: number; east: number; north: number }, coordinates: unknown): void => {
	if (!isArray(coordinates)) return;
	const [lng, lat] = coordinates;
	if (typeof lng === 'number' && typeof lat === 'number') {
		box.west = Math.min(box.west, lng);
		box.south = Math.min(box.south, lat);
		box.east = Math.max(box.east, lng);
		box.north = Math.max(box.north, lat);
		return;
	}
	for (const part of coordinates) grow(box, part);
};

/**
 * Where an OSM feature is, read out of the file the map ships.
 *
 * The baked collection rather than the live Overpass answer, because a link has
 * to work on a boat with no signal, and the service worker has that file
 * already. A feature Overpass knows about and this file does not is a link that
 * lands nowhere, which is the honest outcome for a map that cannot draw it
 * either.
 */
export const findExtent = async (ref: OsmRef): Promise<Extent | undefined> => {
	let collection: unknown;
	try {
		collection = await (await fetch(asset('/data/osm.geojson'))).json();
	} catch {
		return undefined;
	}
	if (!isRecord(collection) || !isArray(collection['features'])) return undefined;
	for (const feature of collection['features']) {
		if (!isRecord(feature)) continue;
		const properties = feature['properties'];
		if (!isRecord(properties)) continue;
		if (properties['t'] !== ref.type || properties['id'] !== ref.id) continue;
		const geometry = feature['geometry'];
		if (!isRecord(geometry)) return undefined;
		const box = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
		grow(box, geometry['coordinates']);
		return Number.isFinite(box.west) && Number.isFinite(box.south) ? box : undefined;
	}
	return undefined;
};
