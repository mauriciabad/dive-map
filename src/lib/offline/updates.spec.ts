import { describe, expect, it } from 'vitest';
import { askForUpdate, updates, type UpdatableRegistration } from './updates.svelte.ts';

const WORKER = {};

class FakeRegistration implements UpdatableRegistration {
	installing: object | null = null;
	waiting: object | null = null;
	unregistered = false;
	listeners = 0;
	/** What `update()` does to the registration before it resolves. */
	onUpdate: (self: FakeRegistration) => void = () => undefined;
	/** A network the check cannot reach. */
	offline = false;

	readonly found: (() => void)[] = [];

	update(): Promise<unknown> {
		if (this.offline) return Promise.reject(new Error('network unavailable'));
		this.onUpdate(this);
		return Promise.resolve(undefined);
	}

	unregister(): Promise<boolean> {
		this.unregistered = true;
		return Promise.resolve(true);
	}

	addEventListener(_type: 'updatefound', listener: () => void): void {
		this.listeners += 1;
		this.found.push(listener);
	}

	removeEventListener(_type: 'updatefound', listener: () => void): void {
		this.listeners -= 1;
		const at = this.found.indexOf(listener);
		if (at !== -1) this.found.splice(at, 1);
	}

	fireFound(): void {
		for (const listener of [...this.found]) listener();
	}
}

describe('asking for an update by hand', () => {
	it('says the build is current when the server had nothing newer', async () => {
		const registration = new FakeRegistration();

		expect(await askForUpdate(registration)).toBe('current');
		expect(registration.listeners).toBe(0);
	});

	it('says one is coming while it is still installing', async () => {
		const registration = new FakeRegistration();
		registration.onUpdate = (self) => (self.installing = WORKER);

		expect(await askForUpdate(registration)).toBe('coming');
	});

	it('says one is coming when it is waiting to be taken', async () => {
		const registration = new FakeRegistration();
		registration.onUpdate = (self) => (self.waiting = WORKER);

		expect(await askForUpdate(registration)).toBe('coming');
	});

	/**
	 * The worker calls `skipWaiting` on install, so a small update can be installed,
	 * activated and gone from both properties before `update()` resolves. Without the
	 * event this reads as a build that is already current, which is the one answer
	 * that would send a diver away thinking there was nothing to get.
	 */
	it('says one is coming when it installed and activated inside the call', async () => {
		const registration = new FakeRegistration();
		registration.onUpdate = (self) => {
			self.fireFound();
		};

		expect(await askForUpdate(registration)).toBe('coming');
	});

	it('says it failed rather than current when it could not reach the server', async () => {
		const registration = new FakeRegistration();
		registration.offline = true;

		expect(await askForUpdate(registration)).toBe('failed');
		expect(registration.listeners).toBe(0);
	});
});

describe('the panel asking through the registration the layout made', () => {
	it('says unsupported where no worker was ever registered', async () => {
		expect(await updates.check()).toBe('unsupported');
	});

	it('asks the tracked registration', async () => {
		const registration = new FakeRegistration();
		updates.track(registration);

		expect(await updates.check()).toBe('current');
	});

	it('counts a version that landed before the check as one on its way', async () => {
		updates.track(new FakeRegistration());
		updates.ready();

		expect(await updates.check()).toBe('coming');
	});

	it('drops the worker so the next load installs one from scratch', async () => {
		const registration = new FakeRegistration();
		updates.track(registration);

		await updates.forget();

		expect(registration.unregistered).toBe(true);
		expect(await updates.check()).toBe('unsupported');
	});
});
