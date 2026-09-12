import { SvelteSet } from 'svelte/reactivity';
import { DEFAULT_ISOBATHS, DEFAULT_LAYERS, type IsobathStyle, type LayerId } from '$lib/domain/card';
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
	locale = $state<Locale>('ca');

	/** Print framing mode. The crop overlay only exists while this is on. */
	framing = $state(false);

	/** Set once the map has loaded its first tiles, so the shell can stop showing skeletons. */
	ready = $state(false);
	error = $state<string | undefined>(undefined);

	constructor(languages: readonly string[] = []) {
		this.locale = negotiate(languages);
	}

	shows(id: LayerId): boolean {
		return this.visible.has(id);
	}

	toggle(id: LayerId): void {
		if (!this.visible.delete(id)) this.visible.add(id);
	}

	setInterval(metres: number): void {
		this.isobaths = { ...this.isobaths, intervalM: metres };
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
}
