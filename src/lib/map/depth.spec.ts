import { describe, expect, it } from 'vitest';
import { formatDepth } from './depth.ts';

describe('formatDepth', () => {
	it('reads a single contour as one number', () => {
		expect(formatDepth({ shallowestM: 18, deepestM: 18 })).toBe('18 m');
	});

	it('reads two contours as the bracket between them', () => {
		expect(formatDepth({ shallowestM: 33, deepestM: 35 })).toBe('33–35 m');
	});

	it('keeps the shallow end first, which is the one a dive plan turns on', () => {
		expect(formatDepth({ shallowestM: 0, deepestM: 5 })).toBe('0–5 m');
	});
});
