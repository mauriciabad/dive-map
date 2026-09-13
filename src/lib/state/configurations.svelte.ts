import {
	type Configuration,
	LIBRARY_KEY,
	LIBRARY_LIMIT,
	type Library,
	NAME_LIMIT,
	type SavedConfiguration,
	type Working,
	readLibrary,
	readWorking,
	shippedConfiguration,
	writeLibrary,
	writeWorking
} from './configuration.ts';
import { type KeyValueStore, webStorage } from './storage.ts';
import type { Locale } from '$lib/i18n/locale';

/**
 * The two stores a diver actually has, and the rules between them.
 *
 * `sessionStorage` holds this tab's working configuration, camera included, so a
 * reload comes back to what was on screen and a second tab is genuinely a second
 * tab. `localStorage` holds the configurations saved by hand, shared across
 * tabs and sessions, and never written to unless the diver asks for it.
 *
 * Nothing here autosaves into the library. The one rule the issue is explicit
 * about is that saving is a thing you do, not a thing that happens to you.
 */

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

	constructor(
		locale: Locale,
		local: KeyValueStore = webStorage('local'),
		session: KeyValueStore = webStorage('session')
	) {
		this.#locale = locale;
		this.#local = local;
		this.#session = session;
		this.refresh();
	}

	/** Nothing may be written while the device holds a library from a later version. */
	get locked(): boolean {
		return this.problem === 'newer';
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
	 */
	opening(): Working {
		const working = readWorking(this.#session, this.#locale);
		if (working !== undefined) {
			this.from = working.from;
			return working;
		}
		const chosen = this.openWith === undefined ? undefined : this.configurationNamed(this.openWith);
		this.from = chosen === undefined ? undefined : this.openWith;
		return {
			configuration: chosen ?? shippedConfiguration(this.#locale),
			camera: undefined,
			from: this.from
		};
	}

	/** Per tab and unprompted: the working configuration is the one thing that saves itself. */
	remember(working: Working): void {
		writeWorking(this.#session, working);
	}
}
