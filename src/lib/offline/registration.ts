import { updates } from './updates.svelte.ts';

/**
 * `lib.dom` promises this and several browsers do not have it. The same hole
 * `serviceWorkerContainer` covers, and the same answer.
 */
const userActivation = (target: Navigator): UserActivation | undefined =>
	(target as Partial<Pick<Navigator, 'userActivation'>>).userActivation;

/**
 * Whether a new version can be taken without asking first.
 *
 * A new worker takes over as soon as it has installed, so by the time this is asked
 * the page is already being answered by the new build while running the old one. The
 * only question left is when to reload onto it, and a reload is cheap here: every
 * module the page will ever need is loaded by the time it boots, and where the map is
 * looking is in the query string, so it comes back where it was.
 *
 * Whether the page has been touched, rather than how long ago it opened. A clock was
 * tried first and it answers the wrong question: what it has to outlast is the
 * install, which is two hundred and thirty-six requests and takes as long as the
 * connection takes, so on a boat it gives up exactly where the reload matters most.
 *
 * Untouched means somebody has just asked for this page, and a reload is how they ask
 * for the new build, so give it to them. Once there has been a tap the map is in use
 * and the moment belongs to the diver, because one that reloads itself while somebody
 * is reading a dive plan off it is worse than one that is a version behind. Where the
 * browser does not keep this the answer is yes, which is what the page did in every
 * case before there was a notice to fall back to.
 */
export const takeItNow = (activation: UserActivation | undefined): boolean =>
	activation?.hasBeenActive !== true;

/**
 * The least time between two asks of the server for a newer worker.
 *
 * A page that is already open is never told a deploy happened. The browser looks for
 * a new worker when a navigation happens and then roughly daily, so without this a
 * map left open on a boat would sit on one version until somebody reloaded it, and
 * the notice would have nothing to announce.
 *
 * The ask is one conditional request for the worker script, and it is made when the
 * tab is looked at again rather than on a timer, so a phone in a pocket spends
 * nothing.
 */
export const RECHECK_MS = 15 * 60 * 1000;

/**
 * Registers the worker, then decides what to do each time a new one takes over.
 *
 * Registered here rather than by SvelteKit, whose generated snippet makes an
 * unguarded read of navigator.serviceWorker and resolves the worker against
 * `paths.base`. Both URLs come off document.baseURI instead, so the worker registers
 * at the site root on divemap.mauri.app and under /dive-map/ on the github.io project
 * URL without either one being hardcoded.
 */
export function watchForUpdates(container: ServiceWorkerContainer): () => void {
	const listeners = new AbortController();
	const { signal } = listeners;

	/*
	 * A first install is not an update. The worker claims its clients on activate, so
	 * controllerchange fires on a first visit too, with nothing stale to escape.
	 * Reloading there makes every cold load bounce, and with the reload racing the
	 * next install it can bounce forever.
	 */
	const firstInstall = container.controller === null;

	let reloading = false;
	container.addEventListener(
		'controllerchange',
		() => {
			if (firstInstall || reloading) return;
			if (!takeItNow(userActivation(navigator))) {
				updates.ready();
				return;
			}
			reloading = true;
			location.reload();
		},
		{ signal }
	);

	const watch = (registration: ServiceWorkerRegistration): void => {
		// The settings panel asks this same registration for a check on demand.
		updates.track(registration);
		let askedAt = Date.now();
		document.addEventListener(
			'visibilitychange',
			() => {
				if (document.visibilityState !== 'visible') return;
				if (Date.now() - askedAt < RECHECK_MS) return;
				askedAt = Date.now();
				void registration.update().catch(() => undefined);
			},
			{ signal }
		);
	};

	const register = (): void => {
		void container
			.register(new URL('service-worker.js', document.baseURI), {
				scope: new URL('.', document.baseURI).href
			})
			.then(watch)
			.catch(() => undefined);
	};
	if (document.readyState === 'complete') register();
	else window.addEventListener('load', register, { once: true, signal });

	return () => {
		listeners.abort();
		updates.track(undefined);
	};
}
