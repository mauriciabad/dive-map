import type { IconName } from './icons';
import type { MessageKey } from '$lib/i18n/messages';
import type { MapState } from '$lib/state/map-view.svelte';

/**
 * The settings live in four sections. One table drives both the buttons in the
 * corner stack and the heading of the panel they open, so a section can never
 * have a button with no panel behind it.
 */

export type PanelSection = 'layers' | 'isobaths' | 'print' | 'language';

export interface SectionTab {
	readonly id: PanelSection;
	readonly icon: IconName;
	readonly key: MessageKey;
}

export const SECTIONS: readonly SectionTab[] = [
	{ id: 'layers', icon: 'layers', key: 'layers' },
	{ id: 'isobaths', icon: 'isobath', key: 'isobaths' },
	{ id: 'print', icon: 'print', key: 'print' },
	{ id: 'language', icon: 'language', key: 'language' }
];

/**
 * Which section is showing. The buttons are mounted into MapLibre's corner and
 * the panel is rendered in the page, so the two share this one object rather
 * than passing events across the boundary.
 */
export interface PanelState {
	open: PanelSection | undefined;
}

/** The buttons live in a different subtree from the panel, so aria-controls needs an id. */
export const PANEL_ID = 'dive-settings-panel';

export interface PanelProps {
	readonly view: MapState;
	readonly panel: PanelState;
}
