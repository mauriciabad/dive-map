import type { LngLat } from '$lib/domain/card';

/**
 * One position report, already parsed out of the browser's GeolocationPosition.
 * `speedMs` and `headingDeg` arrive as `null` from the platform and are narrowed
 * to `undefined` at the boundary so the rest of the module has one absent value
 * rather than two.
 */
export interface Fix extends LngLat {
	/** Epoch milliseconds, clamped non-decreasing at the boundary. */
	readonly at: number;
	readonly accuracyM: number;
	readonly speedMs: number | undefined;
}

/**
 * A fix whose accuracy is worse than this is a cell-tower guess, not a GPS fix.
 * Feeding one into the trail draws a kilometre-long spike across the bay.
 */
export const MAX_USABLE_ACCURACY_M = 120;

const finiteOrUndefined = (value: number | null): number | undefined =>
	value !== null && Number.isFinite(value) ? value : undefined;

/**
 * The clamp is not defensive noise. Devices do hand back a timestamp older than
 * the previous one after a cold restart of the GPS chip, and every age
 * calculation downstream assumes the series only moves forward.
 */
export const toFix = (position: GeolocationPosition, floorAt: number): Fix | undefined => {
	const { coords } = position;
	if (!Number.isFinite(coords.longitude) || !Number.isFinite(coords.latitude)) return undefined;
	if (!Number.isFinite(coords.accuracy) || coords.accuracy > MAX_USABLE_ACCURACY_M)
		return undefined;
	return {
		lng: coords.longitude,
		lat: coords.latitude,
		at: Math.max(position.timestamp, floorAt),
		accuracyM: coords.accuracy,
		speedMs: finiteOrUndefined(coords.speed)
	};
};
