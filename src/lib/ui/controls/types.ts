import type { IconName } from '../icons';

/**
 * Shapes the control vocabulary passes around. They live here rather than in the
 * components because a Svelte component cannot export a type.
 */

/** One option in a `Segmented`. */
export interface Choice<T> {
	readonly value: T;
	readonly label: string;
	readonly icon?: IconName;
	readonly disabled?: boolean;
	readonly title?: string;
}

/** One measured number and its name, in a `Readout`. */
export interface Reading {
	readonly label: string;
	readonly value: string;
}
