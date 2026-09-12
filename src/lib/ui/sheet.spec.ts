import { describe, expect, it } from 'vitest';
import {
	DISMISS_FRACTION,
	FLICK_PX_PER_MS,
	MIN_DRAG_PX,
	RUBBER_CAP_PX,
	dismissesSheet,
	followPointer,
	settle,
	velocityOf
} from './sheet';

const release = (offsetPx: number, velocityPxPerMs = 0, heightPx = 400) => ({
	offsetPx,
	heightPx,
	velocityPxPerMs
});

describe('dismissesSheet', () => {
	it('keeps the sheet when the thumb barely moved', () => {
		expect(dismissesSheet(release(MIN_DRAG_PX - 1, 2))).toBe(false);
	});

	it('keeps the sheet on a slow drag that stops short', () => {
		expect(dismissesSheet(release(400 * DISMISS_FRACTION - 1))).toBe(false);
	});

	it('dismisses on a slow drag past the fraction', () => {
		expect(dismissesSheet(release(400 * DISMISS_FRACTION + 1))).toBe(true);
	});

	it('dismisses on a short flick', () => {
		expect(dismissesSheet(release(MIN_DRAG_PX + 1, FLICK_PX_PER_MS))).toBe(true);
	});

	it('ignores an upward flick', () => {
		expect(dismissesSheet(release(-120, -3))).toBe(false);
	});

	it('scales with the sheet, so a tall sheet needs a longer drag', () => {
		expect(dismissesSheet(release(120, 0, 300))).toBe(true);
		expect(dismissesSheet(release(120, 0, 800))).toBe(false);
	});
});

describe('settle', () => {
	it('raises a resting sheet on an upward drag', () => {
		expect(settle('rest', release(-40))).toEqual({ detent: 'raised', dismissed: false });
	});

	it('leaves a raised sheet raised when dragged further up', () => {
		expect(settle('raised', release(-90))).toEqual({ detent: 'raised', dismissed: false });
	});

	it('does nothing when the drag is too small to read', () => {
		expect(settle('rest', release(4))).toEqual({ detent: 'rest', dismissed: false });
		expect(settle('raised', release(-4))).toEqual({ detent: 'raised', dismissed: false });
	});

	it('closes a resting sheet dragged down', () => {
		expect(settle('rest', release(200))).toEqual({ detent: 'rest', dismissed: true });
	});

	it('lowers a raised sheet rather than closing it', () => {
		expect(settle('raised', release(200))).toEqual({ detent: 'rest', dismissed: false });
	});

	it('closes a raised sheet outright on a flick', () => {
		expect(settle('raised', release(40, FLICK_PX_PER_MS))).toEqual({
			detent: 'raised',
			dismissed: true
		});
	});
});

describe('followPointer', () => {
	it('tracks the thumb exactly on the way down', () => {
		expect(followPointer(0)).toBe(0);
		expect(followPointer(137)).toBe(137);
	});

	it('resists upward and never passes the cap', () => {
		expect(followPointer(-4)).toBeCloseTo(-6, 5);
		expect(followPointer(-10_000)).toBe(-RUBBER_CAP_PX);
	});
});

describe('velocityOf', () => {
	it('is zero without two samples in different milliseconds', () => {
		expect(velocityOf([])).toBe(0);
		expect(velocityOf([{ y: 10, at: 5 }])).toBe(0);
		expect(
			velocityOf([
				{ y: 0, at: 5 },
				{ y: 90, at: 5 }
			])
		).toBe(0);
	});

	it('measures pixels per millisecond across the window', () => {
		expect(
			velocityOf([
				{ y: 100, at: 1000 },
				{ y: 160, at: 1050 },
				{ y: 220, at: 1100 }
			])
		).toBeCloseTo(1.2, 5);
	});
});
