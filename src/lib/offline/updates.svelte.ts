
export type UpdateStatus = 'idle' | 'ready' | 'taking';

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

	ready(): void {
		if (this.status === 'idle') this.status = 'ready';
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
