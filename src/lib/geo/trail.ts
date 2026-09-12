import { distanceM } from './geodesy.ts';
import type { Fix } from './fix.ts';
import type { LngLat } from '$lib/domain/card';

/**
 * The trail is one LineString, because `line-gradient` fades along a single
 * feature's `line-progress` and a chain of short segments would restart the ramp
 * at every one. So the cost question is how a feature that grows once a second
 * and loses its tail stays cheap.
 *
 * Two things do it. `cumM` is measured from a fixed origin and never rebased, so
 * dropping the tail is a slice rather than a recount. And a fix that lands within
 * `MIN_STEP_M` of the last vertex moves that vertex's clock forward instead of
 * adding one, which is what keeps an hour on a mooring buoy at one vertex instead
 * of 3,600 of them.
 */

export interface TrailPoint extends LngLat {
	readonly at: number;
	/** Metres along the path from the first vertex ever recorded. Never rebased. */
	readonly cumM: number;
}

export type TrailWindow =
	| { readonly kind: 'duration'; readonly seconds: number }
	| { readonly kind: 'distance'; readonly metres: number };

export const DEFAULT_WINDOW: TrailWindow = { kind: 'duration', seconds: 600 };

/** What the panel offers. Ten minutes is the default the brief asked for. */
export const WINDOW_CHOICES: readonly TrailWindow[] = [
	{ kind: 'duration', seconds: 300 },
	{ kind: 'duration', seconds: 600 },
	{ kind: 'duration', seconds: 1800 },
	{ kind: 'duration', seconds: 3600 },
	{ kind: 'distance', metres: 250 },
	{ kind: 'distance', metres: 500 },
	{ kind: 'distance', metres: 1000 },
	{ kind: 'distance', metres: 5000 }
];

export const sameWindow = (a: TrailWindow, b: TrailWindow): boolean =>
	a.kind === 'duration' && b.kind === 'duration'
		? a.seconds === b.seconds
		: a.kind === 'distance' && b.kind === 'distance' && a.metres === b.metres;

/**
 * Roughly twice a 60-minute window of hard steaming. The cap exists so a tab
 * left open overnight on a bad GPS cannot grow the array without bound; the
 * step gate below means normal use never approaches it.
 */
export const MAX_VERTICES = 4000;

/** Below this a new fix is GPS noise at anchor, not travel. */
export const MIN_STEP_M = 2.5;

export const appendFix = (points: readonly TrailPoint[], fix: Fix): readonly TrailPoint[] => {
	const last = points.at(-1);
	if (last === undefined) return [{ lng: fix.lng, lat: fix.lat, at: fix.at, cumM: 0 }];
	if (fix.at < last.at) return points;

	const step = distanceM(last, fix);
	if (step < MIN_STEP_M) {
		// Same place, later clock. The mooring stays on the trail for a full window
		// after the boat leaves it, which is the honest answer to "where was I".
		return [...points.slice(0, -1), { ...last, at: fix.at }];
	}

	const grown = [...points, { lng: fix.lng, lat: fix.lat, at: fix.at, cumM: last.cumM + step }];
	return grown.length > MAX_VERTICES ? grown.slice(grown.length - MAX_VERTICES) : grown;
};

/**
 * Drops from the old end only, and never keeps a vertex outside the window, so
 * the trail is at most the length or age the user asked for rather than one
 * vertex more.
 */
export const trimTrail = (
	points: readonly TrailPoint[],
	window: TrailWindow,
	nowMs: number
): readonly TrailPoint[] => {
	const newest = points.at(-1);
	if (newest === undefined) return points;
	const outside = (p: TrailPoint): boolean =>
		window.kind === 'duration'
			? nowMs - p.at > window.seconds * 1000
			: newest.cumM - p.cumM > window.metres;

	let first = 0;
	for (const point of points) {
		if (!outside(point)) break;
		first += 1;
	}
	return first === 0 ? points : points.slice(first);
};

/**
 * How far back along the trail a vertex is: 0 at the boat, 1 at the oldest end.
 *
 * Normalised against the trail the boat actually has, not against the window it
 * is allowed to keep. Window-relative was the first cut and it was wrong on the
 * water: four minutes into a ten-minute window every vertex sat above 0.6 alpha
 * and the trail was a flat cyan stripe with no direction in it. The fade is how
 * you read which end you came from, so it has to be there from the second fix.
 *
 * The window still decides what is on the trail at all. It just no longer
 * decides how the trail is painted.
 */
export const staleness = (
	point: TrailPoint,
	oldest: TrailPoint,
	newest: TrailPoint,
	window: TrailWindow
): number => {
	const span =
		window.kind === 'duration' ? newest.at - oldest.at : newest.cumM - oldest.cumM;
	if (span <= 0) return 0;
	const back = window.kind === 'duration' ? newest.at - point.at : newest.cumM - point.cumM;
	return Math.min(1, Math.max(0, back / span));
};

export const MIN_TRAIL_M = 6;

export type TrailStop = readonly [progress: number, alpha: number];

const MAX_ALPHA = 0.92;
const EPSILON = 1e-4;

/**
 * Stops for `line-gradient`, as [line-progress, alpha] pairs.
 *
 * `line-progress` is cumulative distance, but the default window is time, and
 * the two come apart the moment the boat stops. Six minutes on a mooring then
 * four under way is ten minutes of trail, of which the mooring is the older
 * six; a ramp spread evenly over distance would paint that mooring as the
 * freshest thing on the map, because it occupies no distance at all. So the
 * ramp is built from age and then mapped onto progress, which puts the fade
 * where the time went. Under a distance window age is distance and this reduces
 * to an even spatial ramp on its own, with no second code path.
 *
 * This is why the stops are rebuilt on every update rather than baked into the
 * style: the mapping from age to distance changes as the boat moves.
 *
 * Stops are emitted where the alpha moves rather than at every vertex, which
 * keeps a 600-vertex trail at a dozen stops.
 */
export const gradientStops = (
	points: readonly TrailPoint[],
	window: TrailWindow,
	maxStops = 12
): readonly TrailStop[] => {
	const oldest = points.at(0);
	const newest = points.at(-1);
	if (oldest === undefined || newest === undefined || points.length < 2) return [];
	const spanM = newest.cumM - oldest.cumM;
	if (spanM < MIN_TRAIL_M) return [];

	const alphaOf = (p: TrailPoint): number =>
		MAX_ALPHA * (1 - staleness(p, oldest, newest, window));
	const step = 1 / Math.max(1, maxStops - 1);

	const stops: TrailStop[] = [];
	let lastProgress = -1;
	let lastAlpha = Number.NaN;
	const push = (progress: number, alpha: number): void => {
		// MapLibre rejects the whole paint property if the stops are not strictly
		// ascending, and rejecting it takes the trail with it. A moored cluster maps
		// many ages onto one distance, so ties here are normal, not defensive noise.
		if (progress <= lastProgress + EPSILON) return;
		stops.push([progress, alpha]);
		lastProgress = progress;
		lastAlpha = alpha;
	};

	for (const [index, point] of points.entries()) {
		const alpha = alphaOf(point);
		const isEnd = index === 0 || index === points.length - 1;
		if (isEnd || Math.abs(alpha - lastAlpha) >= step) {
			push((point.cumM - oldest.cumM) / spanM, alpha);
		}
	}

	const head = stops.at(-1);
	if (head === undefined) return [];
	if (head[0] < 1 - EPSILON) stops.push([1, alphaOf(newest)]);
	else stops[stops.length - 1] = [1, head[1]];
	return stops;
};
