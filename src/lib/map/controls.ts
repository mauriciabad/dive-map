import { type Component, mount, unmount } from 'svelte';
import type { IControl, Map as MapLibre } from 'maplibre-gl';
import { constrainToData } from './camera.ts';

/**
 * MapLibre owns the corners. Anything we position by hand ends up on top of the
 * zoom buttons or off the edge of a phone, so every piece of our chrome goes in
 * through `map.addControl` and takes the layout MapLibre already does: a corner
 * stack that clears, floats and stays inside the viewport.
 *
 * `onAdd` builds a plain element, mounts a Svelte component into it and hands it
 * back unattached. MapLibre puts it in the corner. `onRemove` unmounts.
 */

export interface SvelteControlOptions<Props extends Record<string, unknown>> {
	/**
	 * Passed straight to `mount`. Make it a `$state` object if the control has to
	 * react to anything: `mount` reads the reference once and never again.
	 */
	readonly props: Props;
	/** Classes for the container. `maplibregl-ctrl maplibregl-ctrl-group` buys MapLibre's button stack. */
	readonly className: string;
	readonly label?: string;
}

export class SvelteControl<Props extends Record<string, unknown>> implements IControl {
	readonly #component: Component<Props>;
	readonly #options: SvelteControlOptions<Props>;
	#container: HTMLElement | undefined;
	#instance: Record<string, unknown> | undefined;

	constructor(component: Component<Props>, options: SvelteControlOptions<Props>) {
		this.#component = component;
		this.#options = options;
	}

	onAdd(): HTMLElement {
		const container = document.createElement('div');
		container.className = this.#options.className;
		if (this.#options.label !== undefined) {
			container.setAttribute('aria-label', this.#options.label);
		}
		this.#instance = mount(this.#component, { target: container, props: this.#options.props });
		this.#container = container;
		return container;
	}

	onRemove(): void {
		if (this.#instance !== undefined) void unmount(this.#instance);
		this.#instance = undefined;
		this.#container?.remove();
		this.#container = undefined;
	}
}

/** Runs while the map is alive, and its teardown runs when the map goes away. */
export type MapAttachment = (map: MapLibre) => (() => void) | undefined;

let live: MapLibre | undefined;
const attachments = new Map<MapAttachment, (() => void) | undefined>();

const detach = (attachment: MapAttachment): void => {
	attachments.get(attachment)?.();
	attachments.set(attachment, undefined);
};

/**
 * MapView hands the live map over here once it exists. Controls are declared by
 * components that mount before the map does, so they wait rather than poll.
 */
export const publishMap = (map: MapLibre | undefined): void => {
	if (map === live) return;
	for (const attachment of attachments.keys()) detach(attachment);
	live = map;
	if (map === undefined) return;
	for (const attachment of attachments.keys()) attachments.set(attachment, attachment(map));
};

/** Returns the detach, which is what a Svelte `$effect` wants back. */
export const whenMapReady = (attachment: MapAttachment): (() => void) => {
	attachments.set(attachment, live === undefined ? undefined : attachment(live));
	return () => {
		detach(attachment);
		attachments.delete(attachment);
	};
};

// Keeping the view over the data is not optional chrome, so it registers itself
// here instead of waiting for a component to ask for it. It is the same
// attachment mechanism either way, and it comes and goes with the map.
whenMapReady(constrainToData);
