import { describe, expect, it } from 'vitest';
import { onScreen, placeHint } from './first-run.ts';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const PLAQUE = { width: 240, height: 56 };

const numbers = (path: string): number[] =>
	path
		.split(/[^-\d.]+/)
		.filter((part) => part.length > 0)
		.map(Number);

const within = (at: { x: number; y: number }, plaque = PLAQUE, viewport = PHONE): boolean =>
	at.x >= 0 &&
	at.y >= 0 &&
	at.x + plaque.width <= viewport.width &&
	at.y + plaque.height <= viewport.height;

describe('placing a hint', () => {
	it('puts the plaque where it was asked for when there is room', () => {
		const { at } = placeHint({ x: 700, y: 400 }, PLAQUE, DESKTOP, { x: -200, y: 0 }, 20);
		expect(at).toEqual({ x: 700 - 200 - 120, y: 400 - 28 });
	});

	it('pulls a plaque that would hang off a phone back onto it', () => {
		const { at } = placeHint({ x: 360, y: 300 }, PLAQUE, PHONE, { x: 0, y: 120 }, 20);
		expect(within(at)).toBe(true);
	});

	it('keeps the plaque on screen even when the target is off it', () => {
		const { at } = placeHint({ x: -400, y: -90 }, PLAQUE, PHONE, { x: 0, y: 120 }, 20);
		expect(within(at)).toBe(true);
	});

	/** The tip is what the hint is for, so it has to land near the thing and not on it. */
	it('stops the arrow just short of what it points at', () => {
		const { leader } = placeHint({ x: 700, y: 400 }, PLAQUE, DESKTOP, { x: -260, y: 0 }, 0);
		const parts = numbers(leader);
		const tip = { x: parts[4] ?? 0, y: parts[5] ?? 0 };
		const gap = Math.hypot(tip.x - 700, tip.y - 400);
		expect(gap).toBeGreaterThan(8);
		expect(gap).toBeLessThan(22);
	});

	it('draws the arrowhead as an open pair of barbs meeting at the tip', () => {
		const { leader, head } = placeHint({ x: 700, y: 400 }, PLAQUE, DESKTOP, { x: -260, y: 0 }, 18);
		const tip = numbers(leader).slice(4);
		expect(numbers(head).slice(2, 4)).toEqual(tip);
	});

	it('reports the direction of travel, so the arrow knows which way to nudge', () => {
		const { heading } = placeHint({ x: 700, y: 400 }, PLAQUE, DESKTOP, { x: -260, y: 0 }, 0);
		expect(heading.x).toBeGreaterThan(0.9);
		expect(Math.hypot(heading.x, heading.y)).toBeCloseTo(1);
	});

	/** A leader between two things touching each other says nothing. */
	it('draws nothing when the target is against the plaque it belongs to', () => {
		const { leader, head } = placeHint({ x: 262, y: 400 }, PLAQUE, PHONE, { x: -130, y: 0 }, 20);
		expect(leader).toBe('');
		expect(head).toBe('');
	});
});

describe('keeping a target reachable', () => {
	it('leaves a point that is already on screen alone', () => {
		expect(onScreen({ x: 200, y: 300 }, PHONE, 56)).toEqual({ x: 200, y: 300 });
	});

	it('brings a point dragged off the edge back to it', () => {
		expect(onScreen({ x: 900, y: -120 }, PHONE, 56)).toEqual({ x: 334, y: 56 });
	});
});
