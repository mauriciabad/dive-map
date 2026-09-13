import { afterEach, describe, expect, it } from 'vitest';
import { memoryStore, webStorage } from './storage.ts';

/**
 * Pinned because the types say none of this can happen. `lib.dom` declares
 * `window.localStorage` as a `Storage` that is always there, so every one of
 * these cases typechecks as impossible and reads as dead code to anyone tidying
 * up. They are the browsers a diver opening a link on a boat actually lands in.
 */

const fakeWindow = (localStorage: unknown): void => {
	Reflect.set(globalThis, 'window', { localStorage, sessionStorage: localStorage });
};

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'window');
});

describe('memoryStore', () => {
	it('keeps what it is given and forgets what is erased', () => {
		const store = memoryStore();
		expect(store.write('a', '1')).toBe(true);
		expect(store.read('a')).toBe('1');
		store.erase('a');
		expect(store.read('a')).toBeUndefined();
	});
});

describe('webStorage', () => {
	it('falls back to memory where there is no window at all', () => {
		const store = webStorage('local');
		expect(store.read('anything')).toBeUndefined();
		expect(store.write('anything', 'value')).toBe(true);
	});

	it('falls back to memory where reading the property throws', () => {
		Reflect.defineProperty(globalThis, 'window', {
			configurable: true,
			get: () => {
				throw new DOMException('The operation is insecure.', 'SecurityError');
			}
		});
		expect(webStorage('session').read('a')).toBeUndefined();
	});

	it('says a write failed rather than throwing when the quota is full', () => {
		fakeWindow({
			getItem: () => null,
			setItem: () => {
				throw new DOMException('quota', 'QuotaExceededError');
			},
			removeItem: () => undefined
		});
		expect(webStorage('local').write('a', '1')).toBe(false);
	});

	/**
	 * A full quota still serves everything already saved. Falling back to memory
	 * on a failed write would show a diver an empty list of configurations that
	 * are in fact still on the device.
	 */
	it('keeps reading a store that refuses every write', () => {
		fakeWindow({
			getItem: (key: string) => (key === 'kept' ? 'yes' : null),
			setItem: () => {
				throw new DOMException('quota', 'QuotaExceededError');
			},
			removeItem: () => undefined
		});
		const store = webStorage('local');
		expect(store.read('kept')).toBe('yes');
		expect(store.write('kept', 'no')).toBe(false);
	});
});
