/**
 * `localStorage` and `sessionStorage`, or a stand-in where the browser has
 * neither.
 *
 * Both are declared on every window and `lib.dom` types both as always present,
 * so `'localStorage' in window` and a null check on the value both pass in the
 * browsers where the next call throws: Safari private browsing, an embedded
 * webview with site data switched off, a quota that is already full.
 * `serviceWorkerContainer` in `$lib/offline/support.ts` guards
 * `navigator.serviceWorker` against the same lie, for the same reason.
 *
 * A map that will not open because storage is full has failed worse than one
 * that forgets a preference, so nothing here throws. A store that cannot be
 * reached reads empty and writes nowhere, and the app runs on the shipped
 * defaults.
 */

export interface KeyValueStore {
	read(key: string): string | undefined;
	/** False means the browser refused to keep it, which the diver has to be told. */
	write(key: string, value: string): boolean;
	erase(key: string): void;
}

export const memoryStore = (): KeyValueStore => {
	const kept = new Map<string, string>();
	return {
		read: (key) => kept.get(key),
		write: (key, value) => {
			kept.set(key, value);
			return true;
		},
		erase: (key) => {
			kept.delete(key);
		}
	};
};

const guard = (storage: Storage): KeyValueStore => ({
	read: (key) => {
		try {
			return storage.getItem(key) ?? undefined;
		} catch {
			return undefined;
		}
	},
	write: (key, value) => {
		try {
			storage.setItem(key, value);
			return true;
		} catch {
			return false;
		}
	},
	erase: (key) => {
		try {
			storage.removeItem(key);
		} catch {
			// A browser that refuses to forget is not something a diver can act on.
		}
	}
});

export type StorageKind = 'local' | 'session';

/**
 * A read is the probe, not a write. A full quota still serves everything already
 * saved, and falling back to memory there would show a diver an empty list of
 * configurations that are in fact still on the device. Writes report their own
 * failure instead.
 */
export const webStorage = (kind: StorageKind): KeyValueStore => {
	try {
		const storage = kind === 'local' ? window.localStorage : window.sessionStorage;
		storage.getItem('dive-map:probe');
		return guard(storage);
	} catch {
		return memoryStore();
	}
};
