import { describe, expect, it } from 'vitest';
import { serviceWorkerContainer } from './support.ts';

/**
 * Pinned because the types say this cannot happen. Anyone reading
 * `serviceWorkerContainer` against lib.dom will see a function that can only
 * return a value and be tempted to inline it back to `navigator.serviceWorker`,
 * which is the read that threw on the live site.
 */
const navigatorWithout = (): Navigator => ({}) as Navigator;
const navigatorWith = (container: ServiceWorkerContainer): Navigator =>
	({ serviceWorker: container }) as Navigator;

describe('serviceWorkerContainer', () => {
	it('is undefined where the API is declared but absent', () => {
		expect(serviceWorkerContainer(navigatorWithout())).toBeUndefined();
	});

	it('is the container where there is one', () => {
		const container = {} as ServiceWorkerContainer;
		expect(serviceWorkerContainer(navigatorWith(container))).toBe(container);
	});
});
