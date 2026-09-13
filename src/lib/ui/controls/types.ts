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
	/**
	 * A picture beside the label, as a URL, for an option whose mark is an image
	 * rather than a drawing. The flags on the language panel are the case: a flag
	 * is its colours, and the authored set is one ink.
	 */
	readonly image?: string;
	readonly disabled?: boolean;
	readonly title?: string;
}

/** One measured number and its name, in a `Readout`. */
export interface Reading {
	readonly label: string;
	readonly value: string;
}
