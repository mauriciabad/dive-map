import { type Annotation, isRecord, parseCollection, toCollection } from './annotation.ts';

/**
 * The browser copy exists because the committed file cannot be written from a
 * static site, so between drawing something and committing it there is a window
 * where the only copy of a guide's afternoon is in this tab. Losing it to a
 * reload would be the whole feature failing.
 *
 * `base` is stored next to `working` and not derived, because a three-way merge
 * without the base is a guess. Both are held as GeoJSON rather than as the
 * internal shape, so the stored blob is the same thing the export writes and can
 * be pasted straight into the repository if someone ever needs to recover by hand.
 */

export interface KeyValueStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface Session {
	/** The committed file as it stood when this browser last agreed with it. */
	readonly base: readonly Annotation[];
	readonly working: readonly Annotation[];
}

export const STORAGE_KEY = 'dive-map:annotations:1';

export const loadSession = (store: KeyValueStore): Session | undefined => {
	let raw: string | null;
	try {
		raw = store.getItem(STORAGE_KEY);
	} catch {
		return undefined;
	}
	if (raw === null) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;

	return {
		base: parseCollection(parsed['base']),
		working: parseCollection(parsed['working'])
	};
};

/** False means the edits are on screen but not durable, which the user has to be told. */
export const saveSession = (store: KeyValueStore, session: Session): boolean => {
	try {
		store.setItem(
			STORAGE_KEY,
			JSON.stringify({
				base: toCollection(session.base),
				working: toCollection(session.working)
			})
		);
		return true;
	} catch {
		return false;
	}
};

export const clearSession = (store: KeyValueStore): void => {
	try {
		store.removeItem(STORAGE_KEY);
	} catch {
		// A browser that refuses to forget is not a failure the user can act on.
	}
};

/** An in-memory stand-in, so a private window with storage disabled still draws. */
export const memoryStore = (): KeyValueStore => {
	const map = new Map<string, string>();
	return {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value);
		},
		removeItem: (key) => {
			map.delete(key);
		}
	};
};

export const browserStore = (): KeyValueStore => {
	try {
		const probe = `${STORAGE_KEY}:probe`;
		localStorage.setItem(probe, '1');
		localStorage.removeItem(probe);
		return localStorage;
	} catch {
		return memoryStore();
	}
};
