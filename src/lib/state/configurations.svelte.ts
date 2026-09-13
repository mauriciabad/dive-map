import {
	type Configuration,
	LIBRARY_KEY,
	LIBRARY_LIMIT,
	type Library,
	NAME_LIMIT,
	NOTHING_RECENT,
	type Recent,
	type SavedConfiguration,
	type Start,
	type Working,
	readLibrary,
	readRecent,
	readWorking,
	shippedConfiguration,
	writeLibrary,
	writeRecent,
	writeWorking
} from './configuration.ts';
import { type KeyValueStore, webStorage } from './storage.ts';
import type { Locale } from '$lib/i18n/locale';

/**
 * The three memories a diver has, and the rules between them.
 *
 * `sessionStorage` holds this tab's working configuration, camera included, so a
 * reload comes back to what was on screen and a second tab is genuinely a second
 * tab. `localStorage` holds two separate things: the configurations saved by
 * hand, shared across tabs and sessions and never written to unless the diver
 * asks for it, and beside them the camera the last tab to move wrote, which is
 * where a brand new tab looks when it has none of its own.
 *
 * Nothing here autosaves into the library. The one rule the issue is explicit
 * about is that saving is a thing you do, not a thing that happens to you. The
 * recent camera is the opposite and says so in its own key: it is written every
 * time the map settles and means nothing more than "this is where we were".
 */

/** What a tab opens with: the settings, where they came from, and where to point. */
export interface Opening {
	readonly configuration: Configuration;
	/** The saved configuration these settings came from, when they came from one. */
	readonly from: string | undefined;
	readonly start: Start;
}

/** Why a change to the library did not happen, so the panel can say so. */
export type Refusal = 'no-name' | 'name-taken' | 'full' | 'locked' | 'refused';

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly why: Refusal };

const DONE: Outcome = { ok: true };
const no = (why: Refusal): Outcome => ({ ok: false, why });

export class Configurations {
	readonly #local: KeyValueStore;
	readonly #session: KeyValueStore;
	/** Fallback for a stored configuration that names no language of its own. */
	readonly #locale: Locale;

	saved = $state<readonly SavedConfiguration[]>([]);
	/** Name of the configuration a new tab opens with. */
	openWith = $state<string | undefined>(undefined);
	/**
	 * Set when the saved configurations cannot be read. `newer` means a later
	 * version of the map wrote them, and this one refuses to touch them rather
	 * than overwrite work it does not understand.
	 */
	problem = $state<'damaged' | 'newer' | undefined>(undefined);
	/** The name this tab's settings came from, when they came from a saved one. */
	from = $state<string | undefined>(undefined);

	/** Read once on construction and written through `#keep`, never straight out of storage. */
	#recent: Recent = NOTHING_RECENT;

	constructor(
		locale: Locale,
		local: KeyValueStore = webStorage('local'),
		session: KeyValueStore = webStorage('session')
	) {
		this.#locale = locale;
		this.#local = local;
		this.#session = session;
		this.#recent = readRecent(local);
		this.refresh();
	}

	/** Nothing may be written while the device holds a library from a later version. */
	get locked(): boolean {
		return this.problem === 'newer';
	}

	/** Whether this browser has already been shown the opening hints and got rid of them. */
	get introSeen(): boolean {
		return this.#recent.introSeen;
	}

	get full(): boolean {
		return this.saved.length >= LIBRARY_LIMIT;
	}

	has(name: string): boolean {
		return this.saved.some((entry) => entry.name === name);
	}

	/**
	 * Re-read from the device. Called before every write as well as on the
	 * `storage` event, because two tabs share one key and an in-memory list that
	 * went stale while the panel sat open would overwrite the other tab's save.
	 */
	refresh(): void {
		const stored = readLibrary(this.#local, this.#locale);
		switch (stored.kind) {
			case 'ok':
				this.saved = stored.value.saved;
				this.openWith = stored.value.openWith;
				this.problem = undefined;
				return;
			case 'empty':
				this.saved = [];
				this.openWith = undefined;
				this.problem = undefined;
				return;
			case 'unreadable':
				this.saved = [];
				this.openWith = undefined;
				this.problem = stored.why;
				return;
		}
	}

	/** Live across tabs while the panel is open, which is when it is looked at. */
	attach(): () => void {
		const onstorage = (event: StorageEvent): void => {
			if (event.key === null || event.key === LIBRARY_KEY) this.refresh();
		};
		window.addEventListener('storage', onstorage);
		return () => {
			window.removeEventListener('storage', onstorage);
		};
	}

	#commit(library: Library): Outcome {
		if (!writeLibrary(this.#local, library)) return no('refused');
		this.saved = library.saved;
		this.openWith = library.openWith;
		this.problem = undefined;
		return DONE;
	}

	/** Saving over a name is what a diver means by it, so it replaces in place. */
	save(rawName: string, configuration: Configuration): Outcome {
		const name = rawName.trim().slice(0, NAME_LIMIT);
		if (name.length === 0) return no('no-name');
		this.refresh();
		if (this.locked) return no('locked');
		const existing = this.saved.findIndex((entry) => entry.name === name);
		if (existing === -1 && this.full) return no('full');
		const entry: SavedConfiguration = { name, configuration };
		const saved =
			existing === -1
				? [...this.saved, entry]
				: this.saved.map((old, index) => (index === existing ? entry : old));
		const outcome = this.#commit({ saved, openWith: this.openWith });
		if (outcome.ok) this.from = name;
		return outcome;
	}

	rename(from: string, rawName: string): Outcome {
		const name = rawName.trim().slice(0, NAME_LIMIT);
		if (name.length === 0) return no('no-name');
		this.refresh();
		if (this.locked) return no('locked');
		if (name !== from && this.has(name)) return no('name-taken');
		const outcome = this.#commit({
			saved: this.saved.map((entry) => (entry.name === from ? { ...entry, name } : entry)),
			openWith: this.openWith === from ? name : this.openWith
		});
		if (outcome.ok && this.from === from) this.from = name;
		return outcome;
	}

	remove(name: string): Outcome {
		this.refresh();
		if (this.locked) return no('locked');
		const outcome = this.#commit({
			saved: this.saved.filter((entry) => entry.name !== name),
			openWith: this.openWith === name ? undefined : this.openWith
		});
		if (outcome.ok && this.from === name) this.from = undefined;
		return outcome;
	}

	/** Undefined means a new tab opens on the shipped defaults again. */
	setOpenWith(name: string | undefined): Outcome {
		this.refresh();
		if (this.locked) return no('locked');
		return this.#commit({
			saved: this.saved,
			openWith: name !== undefined && this.has(name) ? name : undefined
		});
	}

	/**
	 * The way out of a library this version cannot read. Only ever from a button
	 * the diver presses knowing what it does, and never as a repair the map
	 * performs on its own.
	 */
	discard(): void {
		this.#local.erase(LIBRARY_KEY);
		this.refresh();
	}

	configurationNamed(name: string): Configuration | undefined {
		return this.saved.find((entry) => entry.name === name)?.configuration;
	}

	/**
	 * What this tab opens with: its own working configuration if it has one, else
	 * the saved configuration chosen as the default, else what the map ships with.
	 *
	 * The camera is a separate question with a separate answer. A reload gets its
	 * own tab's camera back. Anything else falls to the last camera any tab wrote,
	 * and only a browser that has never been pointed anywhere opens on the survey.
	 */
	opening(): Opening {
		const working = readWorking(this.#session, this.#locale);
		if (working !== undefined) {
			this.from = working.from;
			return {
				configuration: working.configuration,
				from: working.from,
				start:
					working.camera === undefined ? this.#lastSeen() : { kind: 'tab', camera: working.camera }
			};
		}
		const chosen = this.openWith === undefined ? undefined : this.configurationNamed(this.openWith);
		this.from = chosen === undefined ? undefined : this.openWith;
		return {
			configuration: chosen ?? shippedConfiguration(this.#locale),
			from: this.from,
			start: this.#lastSeen()
		};
	}

	#lastSeen(): Start {
		const camera = this.#recent.camera;
		return camera === undefined ? { kind: 'survey' } : { kind: 'shared', camera };
	}

	/**
	 * Per tab and unprompted: the working configuration is the one thing that saves
	 * itself. The camera goes to the shared memory as well, which is what makes the
	 * next new tab open over the water this one was looking at.
	 */
	remember(working: Working): void {
		writeWorking(this.#session, working);
		if (working.camera === undefined) return;
		this.#keep({ camera: working.camera });
	}

	/** Called once the opening hints have done their job. They never come back. */
	markIntroSeen(): void {
		this.#keep({ introSeen: true });
	}

	/**
	 * Re-read before every write. Two tabs share this key, and a copy that went
	 * stale while one of them sat open would put the other's dismissed hints back.
	 */
	#keep(change: Partial<Recent>): void {
		this.#recent = { ...readRecent(this.#local), ...change };
		writeRecent(this.#local, this.#recent);
	}
}
