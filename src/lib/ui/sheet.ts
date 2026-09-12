/**
 * The maths behind dragging a bottom sheet, kept out of the component so the
 * thresholds can be tested without a browser.
 *
 * A sheet on a boat is dismissed two ways: a deliberate drag most of the way
 * down, or a flick. Distance alone would make a flick feel ignored; velocity
 * alone would close the sheet on a stray downward jab while reading.
 *
 * It rests short of the map centre because the print crop is drawn there and a
 * sheet over it cannot be framed. Dragging up raises it for reading, dragging
 * down puts it back, and a second drag down (or a flick from either) closes it.
 */

export type Detent = 'rest' | 'raised';

/** Past this fraction of its own height, releasing takes the sheet down a step. */
export const DISMISS_FRACTION = 0.28;

/** A downward flick this fast skips the intermediate step and closes. */
export const FLICK_PX_PER_MS = 0.55;

/** Under this, a release is a tap that wandered, not a drag. */
export const MIN_DRAG_PX = 12;

/** How far the sheet stretches when it is dragged the wrong way. */
export const RUBBER_CAP_PX = 28;

export interface DragRelease {
	/** Pointer travel from where the drag started. Positive is downward. */
	readonly offsetPx: number;
	readonly heightPx: number;
	/** Signed, from the last few milliseconds of movement. */
	readonly velocityPxPerMs: number;
}

export interface Settled {
	readonly detent: Detent;
	readonly dismissed: boolean;
}

export const dismissesSheet = ({ offsetPx, heightPx, velocityPxPerMs }: DragRelease): boolean => {
	if (offsetPx < MIN_DRAG_PX) return false;
	if (velocityPxPerMs >= FLICK_PX_PER_MS) return true;
	return heightPx > 0 && offsetPx >= heightPx * DISMISS_FRACTION;
};

export const settle = (detent: Detent, release: DragRelease): Settled => {
	if (release.offsetPx <= -MIN_DRAG_PX) return { detent: 'raised', dismissed: false };
	if (release.velocityPxPerMs >= FLICK_PX_PER_MS && release.offsetPx >= MIN_DRAG_PX) {
		return { detent, dismissed: true };
	}
	if (!dismissesSheet(release)) return { detent, dismissed: false };
	return detent === 'raised' ? { detent: 'rest', dismissed: false } : { detent, dismissed: true };
};

/**
 * Downward the sheet tracks the thumb exactly. Upward it resists instead of
 * stopping dead, because the sheet grows to the raised height on release rather
 * than lifting off the bottom edge.
 */
export const followPointer = (deltaPx: number): number =>
	deltaPx >= 0 ? deltaPx : -Math.min(RUBBER_CAP_PX, Math.sqrt(-deltaPx) * 3);

/** Pointer samples, newest last. Older ones are dropped by the caller. */
export interface DragSample {
	readonly y: number;
	readonly at: number;
}

export const velocityOf = (samples: readonly DragSample[]): number => {
	const last = samples.at(-1);
	const first = samples.at(0);
	if (last === undefined || first === undefined) return 0;
	const span = last.at - first.at;
	return span <= 0 ? 0 : (last.y - first.y) / span;
};
