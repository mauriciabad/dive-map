import type { PositionTracker } from '$lib/geo/position.svelte';
import type { MessageKey } from '$lib/i18n/messages';

/**
 * How a watch state looks, shared by the corner button and the panel so the two
 * never disagree about whether the boat is being followed.
 *
 * Off, locating and tracking are the three the brief asked for. The other three
 * exist because a boat loses its fix and the button is the only place a diver
 * looks: amber says the map is showing you where you were, not where you are.
 */

export type PositionLook = 'off' | 'locating' | 'tracking' | 'stale' | 'denied' | 'unsupported';

export const lookOf = (tracker: PositionTracker): PositionLook => {
	if (tracker.support !== 'ok') return 'unsupported';
	switch (tracker.watch.status) {
		case 'denied':
			return 'denied';
		case 'off':
		case 'unsupported':
			return 'off';
		case 'locating':
			return 'locating';
		case 'tracking':
		case 'unavailable':
		case 'timeout':
			return tracker.stale ? 'stale' : 'tracking';
	}
};

export const LOOK_LABEL: Readonly<Record<PositionLook, MessageKey>> = {
	off: 'myPosition',
	locating: 'locating',
	tracking: 'tracking',
	stale: 'geoUnavailable',
	denied: 'geoDenied',
	unsupported: 'geoUnsupported'
};
