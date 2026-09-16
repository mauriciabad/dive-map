import { DATA_EXTENT } from '$lib/map/data-extent';
import type { LngLat } from '$lib/domain/card';

/**
 * Whether a tab opens on the diver rather than on the water the last tab was
 * over, and how it finds that out without ever asking a question.
 *
 * `DATA_EXTENT` is a generated list of coordinates, not map code, and it is the
 * only description this app has of where it can show anything at all. Measuring
 * "near the coast" against it beats writing a second outline that would drift
 * from the first the next time the survey grows.
 */

/**
 * How far from the survey still counts as being at it.
 *
 * Twenty-five kilometres reaches Girona, Barcelona and Tarragona from the water
 * off them, so a diver loading the kit in the car park gets their own coast. It
 * stops a long way short of anyone planning a trip from another country, who
 * would be dropped on a blank inland square and left to work out why.
 */
export const NEAR_SURVEY_M = 25_000;

/**
 * How close the map gets when it is taking somebody to where they are. Close
 * enough to read the seabed under the boat, and the floor rather than the answer:
 * a tab already deeper than this stays where it is.
 */
export const POSITION_ZOOM = 15;

/** Metres in a degree of latitude. Flat enough over one coast to need no ellipsoid. */
const METRES_PER_DEGREE = 111_320;

const RADIANS = Math.PI / 180;

/** Ray casting east, the same test the camera guard runs in its own projection. */
const inside = (lng: number, lat: number): boolean => {
	let hit = false;
	for (let i = 0, j = DATA_EXTENT.length - 1; i < DATA_EXTENT.length; j = i++) {
		const a = DATA_EXTENT[i];
		const b = DATA_EXTENT[j];
		if (a === undefined || b === undefined) continue;
		if (a[1] > lat !== b[1] > lat && lng < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) {
			hit = !hit;
		}
	}
	return hit;
};

const toSegment = (
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number
): number => {
	const span = (bx - ax) ** 2 + (by - ay) ** 2;
	const along =
		span === 0
			? 0
			: Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / span));
	return Math.hypot(px - (ax + along * (bx - ax)), py - (ay + along * (by - ay)));
};

/**
 * Metres from the survey footprint, and zero anywhere inside it.
 *
 * Degrees are converted to metres around the point being asked about, so the
 * longitude squeeze is right where the answer matters. Over a few hundred
 * kilometres of one coast that is accurate to well under the tolerance of a
 * question whose answer is a yes or a no.
 */
export const metresFromSurvey = (at: LngLat): number => {
	if (inside(at.lng, at.lat)) return 0;
	const east = METRES_PER_DEGREE * Math.cos(at.lat * RADIANS);
	const px = at.lng * east;
	const py = at.lat * METRES_PER_DEGREE;
	let best = Infinity;
	for (let i = 0, j = DATA_EXTENT.length - 1; i < DATA_EXTENT.length; j = i++) {
		const a = DATA_EXTENT[i];
		const b = DATA_EXTENT[j];
		if (a === undefined || b === undefined) continue;
		best = Math.min(
			best,
			toSegment(
				px,
				py,
				a[0] * east,
				a[1] * METRES_PER_DEGREE,
				b[0] * east,
				b[1] * METRES_PER_DEGREE
			)
		);
	}
	return best;
};

export const nearSurvey = (at: LngLat): boolean => metresFromSurvey(at) <= NEAR_SURVEY_M;

/** The middle of the survey's bounding box, which is what fitting the whole of it centres on. */
export const SURVEY_CENTRE: LngLat = ((): LngLat => {
	let west = Infinity;
	let south = Infinity;
	let east = -Infinity;
	let north = -Infinity;
	for (const [lng, lat] of DATA_EXTENT) {
		west = Math.min(west, lng);
		south = Math.min(south, lat);
		east = Math.max(east, lng);
		north = Math.max(north, lat);
	}
	return { lng: (west + east) / 2, lat: (south + north) / 2 };
})();

/**
 * `navigator.permissions`, or undefined where there is none.
 *
 * `lib.dom` declares it on every Navigator and it is genuinely missing in some
 * embedded webviews, which is the same lie `serviceWorkerContainer` guards in
 * `$lib/offline/support.ts`. Asking for the `geolocation` name is refused
 * outright by some browsers too, and that arrives as a rejected promise rather
 * than as a missing API, so both have to be caught.
 */
const permissionsOf = (target: Navigator): Permissions | undefined =>
	(target as Partial<Pick<Navigator, 'permissions'>>).permissions;

const geolocationOf = (target: Navigator): Geolocation | undefined =>
	(target as Partial<Pick<Navigator, 'geolocation'>>).geolocation;

export const geolocationGranted = async (target: Navigator): Promise<boolean> => {
	const api = permissionsOf(target);
	if (api === undefined) return false;
	try {
		return (await api.query({ name: 'geolocation' })).state === 'granted';
	} catch {
		return false;
	}
};

/**
 * Long enough for a device that already has a fix to hand one over, short enough
 * that a device that cannot get one does not hold the opening hints back.
 */
const FIX_TIMEOUT_MS = 3000;

/** A fix from two minutes ago is a fine thing to open a map with. */
const FIX_AGE_MS = 120_000;

/**
 * Where the diver is, when the browser already knows and has already been given
 * permission to say. Undefined every other time.
 *
 * `getCurrentPosition` is the call that prompts, so the permission is read first
 * and the call only happens once the answer is known to be yes. Someone opening
 * this map for the first time is never asked anything.
 */
export const grantedFix = async (target: Navigator): Promise<LngLat | undefined> => {
	const geolocation = geolocationOf(target);
	if (geolocation === undefined || !(await geolocationGranted(target))) return undefined;
	return new Promise<LngLat | undefined>((resolve) => {
		geolocation.getCurrentPosition(
			({ coords }) => {
				resolve({ lng: coords.longitude, lat: coords.latitude });
			},
			() => {
				resolve(undefined);
			},
			{ enableHighAccuracy: false, timeout: FIX_TIMEOUT_MS, maximumAge: FIX_AGE_MS }
		);
	});
};
