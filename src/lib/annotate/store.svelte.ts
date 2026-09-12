import {
	type Annotation,
	type AnnotationGeometry,
	type AnnotationKind,
	fingerprint,
	parseCollection,
	toCollection
} from './annotation.ts';
import { type Conflict, type ConflictChoice, merge, resolve } from './merge.ts';
import { type AnnotateKey, at } from './messages.ts';
import { type KeyValueStore, browserStore, loadSession, saveSession } from './storage.ts';
import type { Locale } from '$lib/i18n/locale';

/**
 * The browser copy of the drawing, and the one place that knows how it stands
 * against the committed file.
 *
 * That standing is a state machine rather than a pair of booleans, because the
 * pending committed set only means anything while conflicts are unanswered. Put
 * them in one value and "conflicts with nothing to apply them to" stops being a
 * state the code can reach.
 */

type Reconciliation =
	| { readonly status: 'idle' | 'loading' | 'ready' | 'offline' }
	| {
			readonly status: 'conflicted';
			readonly conflicts: readonly Conflict[];
			/** Becomes `base` the moment the user answers. */
			readonly committed: readonly Annotation[];
	  };

export type ReconcileStatus = Reconciliation['status'];

export const KIND_KEYS: Readonly<Record<AnnotationKind, AnnotateKey>> = {
	entry: 'kindEntry',
	route: 'kindRoute',
	hazard: 'kindHazard',
	feature: 'kindFeature'
};

/** Deep enough to walk back an afternoon's mistakes, short enough to stay free. */
const HISTORY_CAP = 50;

const NO_CONFLICTS: readonly Conflict[] = [];

export class AnnotationStore {
	/**
	 * Raw throughout. Every value here is replaced whole rather than mutated, and a
	 * deep proxy would wrap every coordinate pair on its way to the map source.
	 */
	working = $state.raw<readonly Annotation[]>([]);

	arrived = $state(0);
	withdrawn = $state(0);
	durable = $state(true);
	selectedId = $state<string | undefined>(undefined);
	kind = $state<AnnotationKind>('entry');
	announcement = $state('');

	/** The committed file as it stood when this browser last agreed with it. */
	base: readonly Annotation[] = [];

	#reconciliation = $state.raw<Reconciliation>({ status: 'idle' });
	#history = $state.raw<readonly (readonly Annotation[])[]>([]);
	readonly #store: KeyValueStore;
	readonly #locale: () => Locale;

	constructor(store: KeyValueStore = browserStore(), locale: () => Locale = () => 'ca') {
		this.#store = store;
		this.#locale = locale;
	}

	readonly count = $derived(this.working.length);
	readonly selected = $derived(this.working.find((a) => a.id === this.selectedId));
	readonly canUndo = $derived(this.#history.length > 0);

	get status(): ReconcileStatus {
		return this.#reconciliation.status;
	}

	/** Non-empty means the user has a question to answer before anything is agreed. */
	get conflicts(): readonly Conflict[] {
		const current = this.#reconciliation;
		return current.status === 'conflicted' ? current.conflicts : NO_CONFLICTS;
	}

	/**
	 * A failed fetch leaves the stored session exactly as it was. The committed file
	 * is a nicety; an afternoon of drawing is not.
	 */
	async load(fetchCommitted: () => Promise<unknown>): Promise<void> {
		const session = loadSession(this.#store) ?? { base: [], working: [] };
		this.base = session.base;
		this.working = session.working;
		this.#history = [];
		this.#reconciliation = { status: 'loading' };

		let committed: readonly Annotation[];
		try {
			committed = parseCollection(await fetchCommitted());
		} catch {
			this.#reconciliation = { status: 'offline' };
			return;
		}

		const result = merge(session.base, session.working, committed);
		this.working = result.working;
		this.arrived = result.arrived;
		this.withdrawn = result.withdrawn;

		if (result.conflicts.length === 0) {
			this.base = committed;
			this.#reconciliation = { status: 'ready' };
		} else {
			this.#reconciliation = { status: 'conflicted', conflicts: result.conflicts, committed };
		}
		this.#persist();
	}

	resolveConflicts(choice: ConflictChoice): void {
		const current = this.#reconciliation;
		if (current.status !== 'conflicted') return;
		this.#push();
		this.working = resolve(this.working, current.conflicts, choice);
		this.base = current.committed;
		this.#reconciliation = { status: 'ready' };
		this.#persist();
	}

	add(annotation: Annotation): void {
		this.#apply([...this.working, annotation]);
		this.selectedId = annotation.id;
		this.#say('addedAnnotation', {
			kind: at(this.#locale(), KIND_KEYS[annotation.kind]),
			n: this.count
		});
	}

	replaceGeometry(id: string, geometry: AnnotationGeometry): void {
		const current = this.working.find((a) => a.id === id);
		if (current === undefined) return;
		const next: Annotation = { ...current, geometry };
		if (fingerprint(next) === fingerprint(current)) return;
		this.#apply(this.working.map((a) => (a.id === id ? next : a)));
		this.#say('movedAnnotation');
	}

	setLabel(id: string, label: string): void {
		const current = this.working.find((a) => a.id === id);
		if (current === undefined) return;
		const trimmed = label.trim();
		const next: Annotation = { ...current, label: trimmed === '' ? undefined : trimmed };
		if (next.label === current.label) return;
		this.#apply(this.working.map((a) => (a.id === id ? next : a)));
	}

	remove(id: string): void {
		if (!this.working.some((a) => a.id === id)) return;
		this.#apply(this.working.filter((a) => a.id !== id));
		if (this.selectedId === id) this.selectedId = undefined;
		this.#say('deletedAnnotation', { n: this.count });
	}

	undo(): void {
		const previous = this.#history.at(-1);
		if (previous === undefined) return;
		this.#history = this.#history.slice(0, -1);
		this.working = previous;
		if (!previous.some((a) => a.id === this.selectedId)) this.selectedId = undefined;
		this.#persist();
		this.#say('undoneAnnotation', { n: this.count });
	}

	select(id: string | undefined): void {
		this.selectedId = id;
	}

	dismissNotice(): void {
		this.arrived = 0;
		this.withdrawn = 0;
	}

	/** Tab-indented with a trailing newline, so the committed file diffs one line per change. */
	toJson(): string {
		return `${JSON.stringify(toCollection(this.working), null, '\t')}\n`;
	}

	exportBlob(): Blob {
		return new Blob([this.toJson()], { type: 'application/geo+json' });
	}

	#push(): void {
		this.#history = [...this.#history, this.working].slice(-HISTORY_CAP);
	}

	#persist(): void {
		this.durable = saveSession(this.#store, { base: this.base, working: this.working });
	}

	#apply(next: readonly Annotation[]): void {
		this.#push();
		this.working = next;
		this.#persist();
	}

	#say(key: AnnotateKey, values?: Record<string, number | string>): void {
		this.announcement = at(this.#locale(), key, values);
	}
}
