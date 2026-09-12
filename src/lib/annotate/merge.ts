import { type Annotation, fingerprint } from './annotation.ts';

/**
 * The committed file is a shared branch and the browser is a working copy, so the
 * reconciliation is git's, not a last-writer-wins guess.
 *
 * Three inputs. `base` is the committed file as it stood when this browser last
 * agreed with it. `mine` is what the user has since drawn. `theirs` is the file
 * as it stands now, which is a different file whenever somebody merged a pull
 * request or the user pulled on another machine.
 *
 * A side that did not move yields to the side that did. When both moved to the
 * same place there is nothing to decide. Only when both moved differently is
 * there a conflict, and that is the one case the code refuses to settle: it keeps
 * the user's drawing on screen, says so, and makes them choose.
 */

export interface Conflict {
	readonly id: string;
	/** Undefined means this side deleted it. */
	readonly mine: Annotation | undefined;
	readonly theirs: Annotation | undefined;
}

export interface MergeResult {
	readonly working: readonly Annotation[];
	readonly conflicts: readonly Conflict[];
	/** Annotations the committed file contributed that this browser had not seen. */
	readonly arrived: number;
	/** Annotations the committed file dropped that the user had not touched. */
	readonly withdrawn: number;
}

export type ConflictChoice = 'mine' | 'theirs';

const byId = (annotations: readonly Annotation[]): ReadonlyMap<string, Annotation> =>
	new Map(annotations.map((a) => [a.id, a]));

const same = (a: Annotation | undefined, b: Annotation | undefined): boolean => {
	if (a === undefined || b === undefined) return a === b;
	return fingerprint(a) === fingerprint(b);
};

export const merge = (
	base: readonly Annotation[],
	mine: readonly Annotation[],
	theirs: readonly Annotation[]
): MergeResult => {
	const b = byId(base);
	const m = byId(mine);
	const t = byId(theirs);

	const working: Annotation[] = [];
	const conflicts: Conflict[] = [];
	let arrived = 0;
	let withdrawn = 0;

	for (const id of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
		const wasBase = b.get(id);
		const isMine = m.get(id);
		const isTheirs = t.get(id);

		if (same(isMine, wasBase)) {
			if (isTheirs !== undefined) {
				working.push(isTheirs);
				if (!same(isTheirs, wasBase)) arrived += 1;
			} else if (wasBase !== undefined) {
				withdrawn += 1;
			}
			continue;
		}

		if (same(isTheirs, wasBase) || same(isTheirs, isMine)) {
			if (isMine !== undefined) working.push(isMine);
			continue;
		}

		conflicts.push({ id, mine: isMine, theirs: isTheirs });
		if (isMine !== undefined) working.push(isMine);
	}

	return { working, conflicts, arrived, withdrawn };
};

/**
 * Applies one answer to every conflict at once. A guide standing on a deck is not
 * going to adjudicate seven hazard lines one at a time, and the two answers they
 * actually have are "my drawing is the newer truth" and "the repository is".
 */
export const resolve = (
	working: readonly Annotation[],
	conflicts: readonly Conflict[],
	choice: ConflictChoice
): readonly Annotation[] => {
	if (choice === 'mine') return working;

	const taken = new Map(working.map((a) => [a.id, a]));
	for (const conflict of conflicts) {
		if (conflict.theirs === undefined) taken.delete(conflict.id);
		else taken.set(conflict.id, conflict.theirs);
	}
	return [...taken.values()];
};
