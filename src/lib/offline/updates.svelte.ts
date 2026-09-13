export type UpdateStatus = 'idle' | 'ready' | 'taking';

/** What asking the server for a newer worker came back with. */
export type UpdateCheck = 'current' | 'coming' | 'failed' | 'unsupported';

/**
 * The half of a `ServiceWorkerRegistration` these two touch, declared structurally
 * for the same reason the worker's own globals are in service-worker.ts: a test can
 * answer four members without standing in for a whole registration.
 */
export interface UpdatableRegistration {
	/** A worker part-way through installing, or none. Only which of the two matters. */
	readonly installing: object | null;
	readonly waiting: object | null;
	update(): Promise<unknown>;
	unregister(): Promise<boolean>;
	addEventListener(type: 'updatefound', listener: () => void): void;
	removeEventListener(type: 'updatefound', listener: () => void): void;
}

/**
 * Ask the server for a newer worker and report what came back.
 *
 * `update()` resolves whether or not it found one, so the answer is in what it left
 * behind: a worker installing, or one waiting. The `updatefound` event is watched as
 * well as those two, because this worker calls `skipWaiting` during install, so one
 * that installs quickly has already cleared both by the time the call returns.
 */
export async function askForUpdate(registration: UpdatableRegistration): Promise<UpdateCheck> {
	// A field rather than a local, because a local the compiler last saw assigned
	// `false` reads as never set again, however the listener writes to it.
	const heard = { found: false };
	const note = (): void => {
		heard.found = true;
	};
	registration.addEventListener('updatefound', note);
	try {
		await registration.update();
	} catch {
		return 'failed';
	} finally {
		registration.removeEventListener('updatefound', note);
	}
	return heard.found || registration.installing !== null || registration.waiting !== null
		? 'coming'
		: 'current';
}

/**
 * Whether a new version has landed under a map somebody is using, and is waiting
 * for them to say when.
 *
 * A module singleton because the worker is registered in the root layout and the
 * notice is drawn in the map's own chrome, where the chosen language is. Threading a
 * flag from one to the other would be the only thing either of them gained from
 * knowing the other existed.
 */
class Updates {
	status = $state<UpdateStatus>('idle');

	/**
	 * The registration the layout made, kept so the settings panel can ask for a
	 * check without opening a second path to the worker. Undefined in a browser
	 * with no service worker, and until the first registration resolves.
	 */
	#registration: UpdatableRegistration | undefined;

	track(registration: UpdatableRegistration | undefined): void {
		this.#registration = registration;
	}

	ready(): void {
		if (this.status === 'idle') this.status = 'ready';
	}

	/** Asks now, rather than waiting for the next navigation or the daily check. */
	async check(): Promise<UpdateCheck> {
		if (this.#registration === undefined) return 'unsupported';
		const answer = await askForUpdate(this.#registration);
		// One that landed before the check was pressed is still one on its way.
		return answer === 'current' && this.status !== 'idle' ? 'coming' : answer;
	}

	/**
	 * Drops the worker, so the load that follows installs one from scratch and
	 * precaches the whole shell again. Without this a cleared shell cache refills a
	 * file at a time as the page asks for them, and whatever nobody asked for that
	 * visit is simply missing the next time there is no signal.
	 */
	async forget(): Promise<void> {
		const registration = this.#registration;
		this.#registration = undefined;
		if (registration === undefined) return;
		await registration.unregister().catch(() => false);
	}

	/**
	 * The new worker is already the one answering, so this is the whole of taking the
	 * update: ask for the page again and it comes back built from the new shell.
	 */
	take(): void {
		if (this.status !== 'ready') return;
		this.status = 'taking';
		location.reload();
	}
}

export const updates = new Updates();
