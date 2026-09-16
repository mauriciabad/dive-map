import { describe, expect, it } from 'vitest';
import { type Fix } from './fix.ts';
import { OFF, type WatchState, lastFix, reduceWatch } from './watch-state.ts';

const fix = (at: number): Fix => ({
	lng: 3.2165,
	lat: 41.9275,
	at,
	accuracyM: 8,
	speedMs: undefined
});

const run = (...events: Parameters<typeof reduceWatch>[1][]): WatchState =>
	events.reduce(reduceWatch, OFF);

describe('reduceWatch', () => {
	it('separates the three failures instead of collapsing them', () => {
		const codes = ['denied', 'unavailable', 'timeout'] as const;
		const statuses = codes.map(
			(failure) => run({ type: 'start' }, { type: 'fail', failure, at: 10 }).status
		);
		expect(statuses).toEqual(['denied', 'unavailable', 'timeout']);
	});

	it('goes back to tracking on its own when the fix returns', () => {
		const state = run(
			{ type: 'start' },
			{ type: 'fix', fix: fix(1) },
			{ type: 'fail', failure: 'unavailable', at: 2 },
			{ type: 'fix', fix: fix(3) }
		);
		expect(state).toEqual({ status: 'tracking', fix: fix(3) });
	});

	it('keeps the last position through a loss of signal', () => {
		const state = run(
			{ type: 'start' },
			{ type: 'fix', fix: fix(1) },
			{ type: 'fail', failure: 'unavailable', at: 5 }
		);
		expect(lastFix(state)).toEqual(fix(1));
	});

	it('counts the outage from the first failure, not the latest repeat', () => {
		const state = run(
			{ type: 'start' },
			{ type: 'fail', failure: 'unavailable', at: 100 },
			{ type: 'fail', failure: 'unavailable', at: 900 }
		);
		expect(state).toEqual({ status: 'unavailable', last: undefined, since: 100 });
	});

	it('restarts the clock when one failure replaces another', () => {
		const state = run(
			{ type: 'start' },
			{ type: 'fail', failure: 'timeout', at: 100 },
			{ type: 'fail', failure: 'unavailable', at: 900 }
		);
		expect(state).toEqual({ status: 'unavailable', last: undefined, since: 900 });
	});

	it('ignores a straggler callback that lands after the user switched off', () => {
		const state = run(
			{ type: 'start' },
			{ type: 'fix', fix: fix(1) },
			{ type: 'stop' },
			{ type: 'fix', fix: fix(2) }
		);
		expect(state).toEqual(OFF);
	});

	it('will not start on a browser that cannot answer', () => {
		const state = run({ type: 'unsupported' }, { type: 'start' });
		expect(state).toEqual({ status: 'unsupported' });
	});

	it('lets the user try again after a denial', () => {
		const state = run(
			{ type: 'start' },
			{ type: 'fail', failure: 'denied', at: 1 },
			{ type: 'start' }
		);
		expect(state).toEqual({ status: 'locating' });
	});
});
