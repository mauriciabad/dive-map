import { destination } from './geodesy.ts';
import type { Fix } from './fix.ts';
import type { LngLat } from '$lib/domain/card';

/**
 * Synthetic tracks. Used by the unit tests and by the Playwright verification,
 * which feeds the same route through `context.setGeolocation`, so the numbers
 * the tests assert on and the numbers on the screenshots come from one source.
 */

export interface Leg {
	/** Degrees clockwise from north. Ignored when `speedMs` is 0. */
	readonly bearing: number;
	readonly speedMs: number;
	readonly seconds: number;
}

export const TAMARIU: LngLat = { lng: 3.2165, lat: 41.9275 };

/**
 * Out of the bay, a turn along the coast, a stop on the mooring, then away
 * again. The stop is the case the gradient has to get right.
 */
export const DIVE_RUN: readonly Leg[] = [
	{ bearing: 70, speedMs: 4, seconds: 180 },
	{ bearing: 130, speedMs: 4, seconds: 120 },
	{ bearing: 0, speedMs: 0, seconds: 240 },
	{ bearing: 250, speedMs: 3.5, seconds: 180 }
];

export const walk = (
	legs: readonly Leg[],
	options: { readonly from?: LngLat; readonly startAt?: number; readonly stepS?: number } = {}
): readonly Fix[] => {
	const step = options.stepS ?? 1;
	let at = options.startAt ?? 0;
	let here: LngLat = options.from ?? TAMARIU;
	const fixes: Fix[] = [{ ...here, at, accuracyM: 6, speedMs: 0 }];

	for (const leg of legs) {
		for (let elapsed = 0; elapsed < leg.seconds; elapsed += step) {
			at += step * 1000;
			here = leg.speedMs === 0 ? here : destination(here, leg.bearing, leg.speedMs * step);
			fixes.push({ ...here, at, accuracyM: 6, speedMs: leg.speedMs });
		}
	}
	return fixes;
};

/**
 * A boat swinging on its mooring. Real metres of path, no displacement, which is
 * what separates a course estimator that works from one that spins.
 */
export const swing = (count: number, radiusM = 6, startAt = 0): readonly Fix[] =>
	Array.from({ length: count }, (_, i) => {
		const here = destination(TAMARIU, (i * 137) % 360, radiusM);
		return { ...here, at: startAt + i * 1000, accuracyM: 9, speedMs: 0 };
	});
