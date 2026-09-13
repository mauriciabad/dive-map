import type { Map as MapLibre } from 'maplibre-gl';
import { codesOf } from './legend';
import { GROUND_FILL_LAYERS } from '$lib/map/style';

/** A pan settles, then the tiles it uncovered render, then the style may be rebuilt. */
const SETTLES = ['moveend', 'idle', 'styledata'] as const;

const same = (before: ReadonlySet<string> | undefined, after: ReadonlySet<string>): boolean => {
	if (before === undefined) return false;
	if (before.size !== after.size) return false;
	return [...after].every((code) => before.has(code));
};

/**
 * The codes the visible ground painted in the frame. A hidden layer answers
 * queryRenderedFeatures with nothing, so switching ground, turning it off or
 * flipping smoothed needs no case here: the set follows what is on screen.
 */
export class InFrameGround {
	/** Undefined until the map has been asked once, so "nothing here" is never said before it has. */
	codes = $state<ReadonlySet<string> | undefined>(undefined);

	/** Compared against instead of `codes`, so attaching inside an effect reads no state. */
	#last: ReadonlySet<string> | undefined;

	/** Returns the detach, shaped for `whenMapReady`. */
	attach(map: MapLibre, settleMs = 200): () => void {
		let timer: ReturnType<typeof setTimeout> | undefined;

		const read = (): void => {
			// queryRenderedFeatures throws on a layer id the style does not have, and
			// the style has none of them while setStyle is swapping one in. Skipping
			// the read holds the last good list on screen instead of flashing empty.
			const layers = GROUND_FILL_LAYERS.filter((id) => map.getLayer(id) !== undefined);
			if (layers.length === 0) return;
			const next = codesOf(map.queryRenderedFeatures({ layers }));
			if (same(this.#last, next)) return;
			this.#last = next;
			this.codes = next;
		};

		const soon = (): void => {
			clearTimeout(timer);
			timer = setTimeout(read, settleMs);
		};

		read();
		for (const event of SETTLES) map.on(event, soon);
		return () => {
			clearTimeout(timer);
			for (const event of SETTLES) map.off(event, soon);
		};
	}
}
