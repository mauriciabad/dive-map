import type { Locale } from '$lib/i18n/locale';

export type UpdateStatus = 'idle' | 'ready' | 'taking';

/**
 * These belong in src/lib/i18n/messages.ts and are here only so that adding them
 * does not collide with the other edits in flight against that file.
 */
export const UPDATE_MESSAGES: Record<Locale, { readonly ready: string; readonly take: string }> = {
	ca: { ready: 'Hi ha una versió nova del mapa', take: 'Actualitzar' },
	es: { ready: 'Hay una versión nueva del mapa', take: 'Actualizar' },
	en: { ready: 'A new version of the map is ready', take: 'Update' }
};

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
