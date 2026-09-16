import { describe, expect, it } from 'vitest';
import { distanceM } from './geodesy.ts';
import { DIVE_RUN, TAMARIU, walk } from './track.ts';
import {
	MIN_STEP_M,
	type TrailPoint,
	type TrailWindow,
	appendFix,
	gradientStops,
	trimTrail
} from './trail.ts';

const TEN_MINUTES: TrailWindow = { kind: 'duration', seconds: 600 };

const build = (window: TrailWindow = TEN_MINUTES): readonly TrailPoint[] => {
	let points: readonly TrailPoint[] = [];
	for (const fix of walk(DIVE_RUN)) {
		points = trimTrail(appendFix(points, fix), window, fix.at);
	}
	return points;
};

describe('appendFix', () => {
	it('starts the distance count at zero', () => {
		const points = appendFix([], { ...TAMARIU, at: 0, accuracyM: 5, speedMs: 0 });
		expect(points).toEqual([{ ...TAMARIU, at: 0, cumM: 0 }]);
	});

	it('adds a vertex once the boat has actually moved', () => {
		const first = appendFix([], { ...TAMARIU, at: 0, accuracyM: 5, speedMs: 0 });
		const points = appendFix(first, {
			lng: TAMARIU.lng,
			lat: TAMARIU.lat + 0.001,
			at: 1000,
			accuracyM: 5,
			speedMs: 3
		});
		expect(points).toHaveLength(2);
		expect(points.at(-1)?.cumM).toBeGreaterThan(100);
	});

	it('keeps an hour on a mooring at one vertex, with the clock moved forward', () => {
		let points: readonly TrailPoint[] = [];
		for (let i = 0; i < 3600; i += 1) {
			points = appendFix(points, { ...TAMARIU, at: i * 1000, accuracyM: 8, speedMs: 0 });
		}
		expect(points).toHaveLength(1);
		expect(points.at(0)?.at).toBe(3_599_000);
	});

	it('never records a step below the noise floor', () => {
		const points = build();
		const steps = points.slice(1).map((p, i) => distanceM(points[i] ?? p, p));
		expect(Math.min(...steps)).toBeGreaterThanOrEqual(MIN_STEP_M);
	});

	it('drops a fix whose timestamp runs backwards', () => {
		const first = appendFix([], { ...TAMARIU, at: 5000, accuracyM: 5, speedMs: 0 });
		expect(appendFix(first, { lng: 3.3, lat: 42, at: 1000, accuracyM: 5, speedMs: 0 })).toBe(first);
	});
});

describe('trimTrail', () => {
	it('holds the ten-minute window the brief asked for', () => {
		const fixes = walk(DIVE_RUN);
		const newest = fixes.at(-1);
		expect(newest).toBeDefined();
		const points = build();
		const oldest = points.at(0);
		expect(oldest).toBeDefined();
		expect((newest?.at ?? 0) - (oldest?.at ?? 0)).toBeLessThanOrEqual(600_000);
	});

	it('never keeps a vertex beyond a distance window', () => {
		const points = build({ kind: 'distance', metres: 500 });
		const newest = points.at(-1);
		const oldest = points.at(0);
		expect((newest?.cumM ?? 0) - (oldest?.cumM ?? 0)).toBeLessThanOrEqual(500);
	});

	it('leaves a trail inside the window untouched', () => {
		const points = build();
		expect(trimTrail(points, TEN_MINUTES, points.at(-1)?.at ?? 0)).toBe(points);
	});
});

describe('gradientStops', () => {
	const points = build();
	const stops = gradientStops(points, TEN_MINUTES);

	it('rises strictly, which is the only form MapLibre accepts', () => {
		const progresses = stops.map(([p]) => p);
		const ascending = progresses.every((p, i) => i === 0 || p > (progresses[i - 1] ?? 0));
		expect(ascending).toBe(true);
	});

	it('runs the full length of the line', () => {
		expect(stops.at(0)?.[0]).toBe(0);
		expect(stops.at(-1)?.[0]).toBe(1);
	});

	it('fades towards the old end and never the other way', () => {
		const alphas = stops.map(([, a]) => a);
		expect(alphas.every((a, i) => i === 0 || a >= (alphas[i - 1] ?? 0))).toBe(true);
		expect(alphas.at(0)).toBeLessThan(alphas.at(-1) ?? 0);
	});

	it('stays a handful of stops however long the trail gets', () => {
		expect(stops.length).toBeLessThanOrEqual(13);
		expect(stops.length).toBeGreaterThan(2);
	});

	it('fades to nothing at the oldest end however short the trail is', () => {
		// The fade is how a diver reads which way they came, so it is drawn against
		// the trail they have rather than the window they are allowed to keep.
		expect(stops.at(0)?.[1]).toBeCloseTo(0, 6);
		const young = build({ kind: 'duration', seconds: 30 });
		expect(gradientStops(young, { kind: 'duration', seconds: 600 }).at(0)?.[1]).toBeCloseTo(0, 6);
	});

	it('puts the fade where the time went, not where the distance went', () => {
		// DIVE_RUN moors for four of its last ten minutes, and a mooring covers no
		// distance. So the ramp has to cross the even spatial one rather than track
		// it: dimmer than distance alone would give on the run in, brighter on the
		// run out, with the whole moorage spent as one step at the buoy.
		const drift = stops.map(([progress, alpha]) => alpha - progress * 0.92);
		expect(Math.min(...drift)).toBeLessThan(-0.1);
		expect(Math.max(...drift)).toBeGreaterThan(0.1);

		const jumps = stops.slice(1).map(([, a], i) => a - (stops[i]?.[1] ?? 0));
		expect(Math.max(...jumps)).toBeGreaterThan(0.4);
	});

	it('refuses to paint a trail too short to have a direction', () => {
		const short = build({ kind: 'distance', metres: 1 });
		expect(gradientStops(short, { kind: 'distance', metres: 1 })).toEqual([]);
	});
});
