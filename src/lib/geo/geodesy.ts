import type { LngLat } from '$lib/domain/card';

/**
 * Great-circle maths on the WGS84 mean radius. Over a dive boat's few hundred
 * metres the sphere and the ellipsoid disagree by millimetres, so the simple
 * formulae are not an approximation worth improving.
 */

const R_M = 6_371_008.8;

const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const deg = (radians: number): number => (radians * 180) / Math.PI;

export const distanceM = (a: LngLat, b: LngLat): number => {
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const latA = rad(a.lat);
	const latB = rad(b.lat);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
	return 2 * R_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Initial bearing, degrees clockwise from true north, 0 to 360. */
export const bearingDeg = (from: LngLat, to: LngLat): number => {
	const latA = rad(from.lat);
	const latB = rad(to.lat);
	const dLng = rad(to.lng - from.lng);
	const y = Math.sin(dLng) * Math.cos(latB);
	const x = Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(dLng);
	return (deg(Math.atan2(y, x)) + 360) % 360;
};

/** Shortest signed turn from one bearing to another, in (-180, 180]. */
export const turnDeg = (from: number, to: number): number => ((to - from + 540) % 360) - 180;

/**
 * Exponential smoothing that goes the short way round. Averaging 359 and 1
 * arithmetically gives 180, which points the boat backwards.
 */
export const smoothBearing = (previous: number | undefined, next: number, alpha: number): number =>
	previous === undefined ? next : (previous + alpha * turnDeg(previous, next) + 360) % 360;

export const destination = (from: LngLat, bearing: number, metres: number): LngLat => {
	const angular = metres / R_M;
	const lat = rad(from.lat);
	const brg = rad(bearing);
	const lat2 = Math.asin(
		Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(brg)
	);
	const lng2 =
		rad(from.lng) +
		Math.atan2(
			Math.sin(brg) * Math.sin(angular) * Math.cos(lat),
			Math.cos(angular) - Math.sin(lat) * Math.sin(lat2)
		);
	return { lng: ((deg(lng2) + 540) % 360) - 180, lat: deg(lat2) };
};
