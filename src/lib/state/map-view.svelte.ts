import { SvelteSet } from 'svelte/reactivity';
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
	locale = $state<Locale>('ca');

	/** Print framing mode. The crop overlay only exists while this is on. */
	framing = $state(false);

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

	constructor(languages: readonly string[] = []) {
		this.locale = negotiate(languages);
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
