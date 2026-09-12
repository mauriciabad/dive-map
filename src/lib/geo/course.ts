import { bearingDeg, distanceM, smoothBearing } from './geodesy.ts';
import type { TrailPoint } from './trail.ts';

/**
 * Course over ground, from where the boat has actually been. Not
 * `deviceorientation`, and not `coords.heading` either: the spec calls heading
 * the direction of travel, but several Android builds fuse the magnetometer into
 * it, which is where the phone is pointing. On a boat those are different
 * numbers, and the one that matters is the one the hull is making good.
 */

export type Course =
	| { readonly kind: 'unknown' }
	/** Below the threshold. `heldDeg` is the last real course, kept so the avatar does not spin. */
	| { readonly kind: 'stationary'; readonly heldDeg: number | undefined }
	| { readonly kind: 'steaming'; readonly deg: number; readonly speedMs: number };

/**
 * Three times the wander of a decent fix at anchor. A shorter baseline turns GPS
 * noise into a course, and the avatar spends the surface interval spinning.
 */
const BASELINE_M = 18;
/** Older than this and the boat may have turned since; the bearing would be stale. */
const BASELINE_MS = 30_000;

/** Hysteresis. Roughly 2 knots to start believing it, 1 to stop. */
const GO_MS = 1.0;
const STOP_MS = 0.5;

/** Enough to damp a fix-to-fix wobble without lagging a real turn. */
const SMOOTHING = 0.35;

export const heldCourse = (course: Course): number | undefined => {
	switch (course.kind) {
		case 'steaming':
			return course.deg;
		case 'stationary':
			return course.heldDeg;
		case 'unknown':
			return undefined;
	}
};

/**
 * Walks back from the boat to the most recent vertex far enough away to carry a
 * bearing. Returns undefined when the whole recent trail fits inside the noise,
 * which is exactly the moored case.
 *
 * The test is straight-line displacement, not distance along the trail. A boat
 * swinging on a mooring lays down real metres of path while going nowhere, and
 * measuring the path would read that as four knots in a direction that changes
 * every second.
 */
const baseline = (points: readonly TrailPoint[]): TrailPoint | undefined => {
	const newest = points.at(-1);
	if (newest === undefined) return undefined;
	for (let i = points.length - 2; i >= 0; i -= 1) {
		const candidate = points[i];
		if (candidate === undefined) return undefined;
		if (newest.at - candidate.at > BASELINE_MS) return undefined;
		if (distanceM(candidate, newest) >= BASELINE_M) return candidate;
	}
	return undefined;
};

export const estimateCourse = (points: readonly TrailPoint[], previous: Course): Course => {
	const newest = points.at(-1);
	const base = baseline(points);
	if (newest === undefined || base === undefined) {
		return { kind: 'stationary', heldDeg: heldCourse(previous) };
	}

	const seconds = (newest.at - base.at) / 1000;
	// Speed made good, for the same reason: what matters is progress towards
	// somewhere, not how much water the hull crossed getting there.
	const speedMs = seconds > 0 ? distanceM(base, newest) / seconds : 0;
	const wasSteaming = previous.kind === 'steaming';
	if (speedMs < (wasSteaming ? STOP_MS : GO_MS)) {
		return { kind: 'stationary', heldDeg: heldCourse(previous) };
	}

	// Bearing over the whole baseline rather than the last pair: at 3 m/s a
	// one-second pair is 3 m of travel against 6 m of scatter, and the arrow
	// swings through 90 degrees while the boat runs dead straight.
	const measured = bearingDeg(base, newest);
	return {
		kind: 'steaming',
		deg: smoothBearing(wasSteaming ? previous.deg : undefined, measured, SMOOTHING),
		speedMs
	};
};

/**
 * How far ahead to draw the trajectory. A predictor in minutes is the nautical
 * convention and it scales itself: fast means a long arm, slow means a short
 * one, and there is no zoom in the calculation.
 */
const PREDICT_S = 180;
const MIN_ARM_M = 80;
const MAX_ARM_M = 2000;

export const predictionM = (speedMs: number): number =>
	Math.min(MAX_ARM_M, Math.max(MIN_ARM_M, speedMs * PREDICT_S));
