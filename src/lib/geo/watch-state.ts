import type { Fix } from './fix.ts';

/**
 * Why the three failures are three states and not one error string: on a boat
 * they call for three different things. Denied is the only one the user can fix,
 * and only by changing a browser setting. Unavailable means the antenna is under
 * a bimini or in a cave mouth, and it clears itself when the sky comes back.
 * Timeout means the watch is alive but slow, which under way is normal and worth
 * nothing more than a dimmer avatar.
 *
 * Collapsing them into `error` would put a "check your browser settings" prompt
 * in front of someone whose only problem is a steel roof.
 */
export type WatchState =
	| { readonly status: 'off' }
	| { readonly status: 'unsupported' }
	/** Watching, no fix yet. */
	| { readonly status: 'locating' }
	| { readonly status: 'tracking'; readonly fix: Fix }
	| { readonly status: 'denied' }
	| { readonly status: 'unavailable'; readonly last: Fix | undefined; readonly since: number }
	| { readonly status: 'timeout'; readonly last: Fix | undefined; readonly since: number };

export type WatchFailure = 'denied' | 'unavailable' | 'timeout';

export type WatchEvent =
	| { readonly type: 'start' }
	| { readonly type: 'stop' }
	| { readonly type: 'unsupported' }
	| { readonly type: 'fix'; readonly fix: Fix }
	| { readonly type: 'fail'; readonly failure: WatchFailure; readonly at: number };

export const OFF: WatchState = { status: 'off' };

/** The last position we had, whether or not it is still current. */
export const lastFix = (state: WatchState): Fix | undefined => {
	switch (state.status) {
		case 'tracking':
			return state.fix;
		case 'unavailable':
		case 'timeout':
			return state.last;
		case 'off':
		case 'unsupported':
		case 'locating':
		case 'denied':
			return undefined;
	}
};

/** True while the watch is registered, so a late callback is ours to act on. */
export const isWatching = (state: WatchState): boolean =>
	state.status === 'locating' || state.status === 'tracking' ||
	state.status === 'unavailable' || state.status === 'timeout';

/**
 * The recovery the boat needs is the `fix` case below: `unavailable` and
 * `timeout` both go straight back to `tracking`, and because the platform leaves
 * the watch registered after codes 2 and 3, that happens on its own the moment
 * the sky clears. Nobody has to press anything.
 */
export const reduceWatch = (state: WatchState, event: WatchEvent): WatchState => {
	switch (event.type) {
		case 'start':
			return state.status === 'unsupported' ? state : { status: 'locating' };
		case 'stop':
			return state.status === 'unsupported' ? state : OFF;
		case 'unsupported':
			return { status: 'unsupported' };
		case 'fix':
			// A callback that arrives after the user switched tracking off is a
			// straggler from a watch we already cleared. Dropping it stops the avatar
			// reappearing seconds after the button says off.
			return isWatching(state) ? { status: 'tracking', fix: event.fix } : state;
		case 'fail': {
			if (!isWatching(state)) return state;
			if (event.failure === 'denied') return { status: 'denied' };
			// Keep the original `since`, so "no fix for 4 minutes" counts from the
			// first failure rather than restarting on every repeat.
			const since = state.status === event.failure ? state.since : event.at;
			return { status: event.failure, last: lastFix(state), since };
		}
	}
};
