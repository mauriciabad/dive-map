import { describe, expect, it } from 'vitest';
import { bearingDeg, destination, distanceM, smoothBearing, turnDeg } from './geodesy.ts';

const TAMARIU = { lng: 3.2165, lat: 41.9275 };

describe('distanceM', () => {
	it('measures a degree of latitude as about 111 km', () => {
		const d = distanceM({ lng: 0, lat: 0 }, { lng: 0, lat: 1 });
		expect(d).toBeGreaterThan(111_100);
		expect(d).toBeLessThan(111_400);
	});

	it('is zero for the same point', () => {
		expect(distanceM(TAMARIU, TAMARIU)).toBe(0);
	});
});

describe('bearingDeg', () => {
	it.each([
		[{ lng: 0, lat: 1 }, 0],
		[{ lng: 1, lat: 0 }, 90],
		[{ lng: 0, lat: -1 }, 180],
		[{ lng: -1, lat: 0 }, 270]
	])('reads %o as %i degrees', (to, expected) => {
		expect(bearingDeg({ lng: 0, lat: 0 }, to)).toBeCloseTo(expected, 5);
	});
});

describe('turnDeg', () => {
	it('goes the short way across north', () => {
		expect(turnDeg(359, 1)).toBeCloseTo(2, 9);
		expect(turnDeg(1, 359)).toBeCloseTo(-2, 9);
	});
});

describe('smoothBearing', () => {
	it('takes the first reading whole', () => {
		expect(smoothBearing(undefined, 137, 0.35)).toBe(137);
	});

	it('crosses north without swinging through south', () => {
		expect(smoothBearing(359, 1, 0.5)).toBeCloseTo(0, 6);
	});

	it('moves part of the way towards the new reading', () => {
		expect(smoothBearing(100, 200, 0.25)).toBeCloseTo(125, 6);
	});
});

describe('destination', () => {
	it('round-trips against the bearing and distance that made it', () => {
		const ahead = destination(TAMARIU, 62, 450);
		expect(distanceM(TAMARIU, ahead)).toBeCloseTo(450, 3);
		expect(bearingDeg(TAMARIU, ahead)).toBeCloseTo(62, 3);
	});
});
