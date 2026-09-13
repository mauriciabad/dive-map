import { describe, expect, it } from 'vitest';
import { takeItNow } from './registration.ts';

describe('takeItNow', () => {
	it('takes a version that lands on a page nobody has touched, so one reload is enough', () => {
		expect(takeItNow({ hasBeenActive: false, isActive: false })).toBe(true);
	});

	it('asks first once there has been a tap, rather than reloading under a diver', () => {
		expect(takeItNow({ hasBeenActive: true, isActive: false })).toBe(false);
		expect(takeItNow({ hasBeenActive: true, isActive: true })).toBe(false);
	});

	it('takes it where the browser does not keep the answer, as the page always did', () => {
		expect(takeItNow(undefined)).toBe(true);
	});
});
