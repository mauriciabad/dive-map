import { SvelteSet } from 'svelte/reactivity';
import { type LiveView, PrintState } from '$lib/print/print-state.svelte';
// Types only: these erase at compile time, so the state layer keeps no runtime
// dependency on the interface layer.
import type { PanelSection } from '$lib/ui/panel';
import type { FeaturePick } from '$lib/ui/feature-card';
import {
	DEFAULT_ISOBATHS,
	DEFAULT_LAYERS,
	type DiveCard,
	type IsobathStyle,
	type LayerId,
	type LngLat,
	newCard
} from '$lib/domain/card';
import { type Locale, negotiate } from '$lib/i18n/locale';
import { type Camera, type Configuration, shippedConfiguration } from './configuration.ts';

/**
 * Everything the side panel changes and the style reads. One object rather than
 * scattered stores, so the style rebuild has a single source to diff against.
 *
 * Layer visibility is a Set rather than a bag of booleans because the style
 * asks "is this one on", never "which of these seven flags disagree".
 */
export class MapState {
	readonly visible = new SvelteSet<LayerId>(DEFAULT_LAYERS);
	isobaths = $state<IsobathStyle>({ ...DEFAULT_ISOBATHS });
	groundLayer = $state<'habitats' | 'substrate'>('habitats');
	/** The survey is a 10m raster. Off shows it as measured, staircase and all. */
	smoothed = $state(true);

	readonly print = new PrintState();

	/** What the print path needs from the live map, and nothing more. */
	get live(): LiveView {
		return {
			centre: this.centre,
			bearing: this.bearing,
			layers: [...this.visible],
			isobaths: this.isobaths,
			groundLayer: this.groundLayer,
			smoothed: this.smoothed
		};
	}
	locale = $state<Locale>('ca');

	/**
	 * Which settings section is open, and which feature is selected. Both are
	 * sheets competing for the same screen on a phone, so they live together and
	 * opening either closes the other.
	 */
	panelOpen = $state<PanelSection | undefined>(undefined);
	selection = $state<FeaturePick | undefined>(undefined);

	/** Live camera, mirrored from the map so the crop overlay can size itself. */
	centre = $state<LngLat>({ lng: 3.2165, lat: 41.9275 });
	zoom = $state(13.4);
	bearing = $state(0);

	/** The sheet being framed. Its centre follows the map, so dragging frames it. */
	card = $state<DiveCard>(newCard({ lng: 3.2165, lat: 41.9275 }, 'Sense nom'));

	/** Set once the map has loaded its first tiles, so the shell can stop showing skeletons. */
	ready = $state(false);
	error = $state<string | undefined>(undefined);

	/** What this browser asked for, kept so `reset` knows what shipped means here. */
	readonly #negotiated: Locale;

	constructor(languages: readonly string[] = []) {
		this.#negotiated = negotiate(languages);
		this.locale = this.#negotiated;
	}

	/** Everything a saved configuration carries, read off the live map. */
	get configuration(): Configuration {
		return {
			layers: [...this.visible],
			ground: this.groundLayer,
			smoothed: this.smoothed,
			isobaths: this.isobaths,
			locale: this.locale
		};
	}

	/** Where this tab is pointed. Per tab, so it is never part of a saved configuration. */
	get camera(): Camera {
		return { centre: this.centre, zoom: this.zoom, bearing: this.bearing };
	}

	apply(configuration: Configuration): void {
		this.visible.clear();
		for (const id of configuration.layers) this.visible.add(id);
		this.groundLayer = configuration.ground;
		this.smoothed = configuration.smoothed;
		this.isobaths = configuration.isobaths;
		this.locale = configuration.locale;
	}

	/**
	 * Back to what the map ships with, leaving the camera and the language alone.
	 * Someone resetting their layers on a boat has not asked to be moved somewhere
	 * else, and has not asked to be spoken to in another language either: the
	 * language is its own panel and its own decision.
	 */
	reset(): void {
		this.apply({ ...shippedConfiguration(this.#negotiated), locale: this.locale });
	}

	openPanel(section: PanelSection | undefined): void {
		this.panelOpen = section;
		if (section !== undefined) this.selection = undefined;
	}

	select(feature: FeaturePick | undefined): void {
		this.selection = feature;
		if (feature !== undefined) this.panelOpen = undefined;
	}

	shows(id: LayerId): boolean {
		return this.visible.has(id);
	}

	toggle(id: LayerId): void {
		if (!this.visible.delete(id)) this.visible.add(id);
	}

	setInterval(metres: number): void {
		this.isobaths = { ...this.isobaths, intervalM: metres, autoInterval: false };
	}

	setAutoInterval(): void {
		this.isobaths = { ...this.isobaths, autoInterval: true };
	}

	setMaxDepth(metres: number): void {
		this.isobaths = { ...this.isobaths, maxDepthM: metres };
	}

	toggleEmphasis(depth: number): void {
		const on = this.isobaths.emphasised.includes(depth);
		this.isobaths = {
			...this.isobaths,
			emphasised: on
				? this.isobaths.emphasised.filter((d) => d !== depth)
				: [...this.isobaths.emphasised, depth].sort((a, b) => a - b)
		};
	}

	toggleLabels(): void {
		this.isobaths = { ...this.isobaths, labels: !this.isobaths.labels };
	}

	/** The card as it would print right now: the live camera plus the sheet settings. */
	get framedCard(): DiveCard {
		return {
			...this.card,
			centre: this.centre,
			bearing: this.bearing,
			layers: [...this.visible],
			isobaths: this.isobaths
		};
	}
}
