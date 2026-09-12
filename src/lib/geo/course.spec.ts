import { describe, expect, it } from 'vitest';
import { type Course, estimateCourse, predictionM } from './course.ts';
import { type Leg, swing, walk } from './track.ts';
import { type TrailPoint, appendFix } from './trail.ts';
import type { Fix } from './fix.ts';

const track = (fixes: readonly Fix[]): { points: readonly TrailPoint[]; course: Course } => {
	let points: readonly TrailPoint[] = [];
	let course: Course = { kind: 'unknown' };
	for (const fix of fixes) {
		points = appendFix(points, fix);
		course = estimateCourse(points, course);
	}
	return { points, course };
};

const leg = (bearing: number, speedMs: number, seconds: number): Leg => ({
	bearing,
	speedMs,
	seconds
});

describe('estimateCourse', () => {
	it('reads the course a straight run is making good', () => {
		const { course } = track(walk([leg(62, 4, 120)]));
		expect(course.kind).toBe('steaming');
		if (course.kind !== 'steaming') return;
		expect(course.deg).toBeCloseTo(62, 0);
		expect(course.speedMs).toBeGreaterThan(3.5);
	});

	it('refuses to invent a course for a boat swinging on its mooring', () => {
		const { course } = track(swing(600));
		expect(course.kind).toBe('stationary');
	});

	it('holds the last real course while stopped, so the avatar does not spin', () => {
		const { course } = track(walk([leg(90, 4, 120), leg(0, 0, 300)]));
		expect(course.kind).toBe('stationary');
		if (course.kind !== 'stationary') return;
		expect(course.heldDeg).toBeCloseTo(90, 0);
	});

	it('rides out a slow patch rather than flickering at the threshold', () => {
		const { course } = track(walk([leg(45, 4, 120), leg(45, 0.7, 60)]));
		expect(course.kind).toBe('steaming');
	});

	it('needs a real start before it believes a crawl', () => {
		const { course } = track(walk([leg(45, 0.7, 120)]));
		expect(course.kind).toBe('stationary');
	});

	it('follows the boat round a turn', () => {
		const { course } = track(walk([leg(0, 4, 120), leg(180, 4, 120)]));
		expect(course.kind).toBe('steaming');
		if (course.kind !== 'steaming') return;
		expect(course.deg).toBeCloseTo(180, 0);
	});

	it('has no course at all before the first fix', () => {
		expect(estimateCourse([], { kind: 'unknown' })).toEqual({
			kind: 'stationary',
			heldDeg: undefined
		});
	});
});

describe('predictionM', () => {
	it('scales the arm with the speed, within bounds a screen can hold', () => {
		expect(predictionM(0.1)).toBe(80);
		expect(predictionM(3)).toBe(540);
		expect(predictionM(40)).toBe(2000);
	});
});
