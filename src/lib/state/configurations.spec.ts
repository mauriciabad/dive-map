import { describe, expect, it } from 'vitest';
import {
	LIBRARY_KEY,
	LIBRARY_LIMIT,
	STORAGE_VERSION,
	shippedConfiguration
} from './configuration.ts';
import { Configurations } from './configurations.svelte.ts';
import { type KeyValueStore, memoryStore } from './storage.ts';

const ca = shippedConfiguration('ca');
const substrate = { ...ca, ground: 'substrate' } as const;

const open = (local: KeyValueStore = memoryStore(), session: KeyValueStore = memoryStore()) =>
	new Configurations('ca', local, session);

describe('saving by hand', () => {
	it('lists what was saved and hands it back', () => {
		const configs = open();
		expect(configs.save('Nit', substrate).ok).toBe(true);
		expect(configs.saved.map((entry) => entry.name)).toEqual(['Nit']);
		expect(configs.configurationNamed('Nit')).toEqual(substrate);
	});

	it('saves over a name in place, because that is what saving over means', () => {
		const configs = open();
		configs.save('Nit', ca);
		configs.save('Nit', substrate);
		expect(configs.saved).toHaveLength(1);
		expect(configs.configurationNamed('Nit')?.ground).toBe('substrate');
	});

	it('refuses a name that is only spaces', () => {
		expect(open().save('   ', ca)).toEqual({ ok: false, why: 'no-name' });
	});

	it('says so when the browser refuses to keep it', () => {
		const full: KeyValueStore = {
			read: () => undefined,
			write: () => false,
			erase: () => undefined
		};
		expect(open(full).save('Nit', ca)).toEqual({ ok: false, why: 'refused' });
	});
});

describe('the limit on how many one browser keeps', () => {
	it('refuses a new one rather than pushing an old one out', () => {
		const configs = open();
		for (let i = 0; i < LIBRARY_LIMIT; i += 1) configs.save(`Setup ${i}`, ca);
		expect(configs.save('One too many', ca)).toEqual({ ok: false, why: 'full' });
		expect(configs.saved).toHaveLength(LIBRARY_LIMIT);
	});

	it('still lets a name already in the list be saved over', () => {
		const configs = open();
		for (let i = 0; i < LIBRARY_LIMIT; i += 1) configs.save(`Setup ${i}`, ca);
		expect(configs.save('Setup 0', substrate).ok).toBe(true);
		expect(configs.configurationNamed('Setup 0')?.ground).toBe('substrate');
	});
});

describe('renaming and deleting', () => {
	it('renames in place and carries the default across with it', () => {
		const configs = open();
		configs.save('Nit', ca);
		configs.setOpenWith('Nit');
		expect(configs.rename('Nit', 'Nit a Tamariu').ok).toBe(true);
		expect(configs.saved.map((entry) => entry.name)).toEqual(['Nit a Tamariu']);
		expect(configs.openWith).toBe('Nit a Tamariu');
	});

	it('refuses a rename onto a name already taken', () => {
		const configs = open();
		configs.save('Nit', ca);
		configs.save('Medes', substrate);
		expect(configs.rename('Nit', 'Medes')).toEqual({ ok: false, why: 'name-taken' });
		expect(configs.configurationNamed('Medes')).toEqual(substrate);
	});

	it('clears the default when the configuration it named is deleted', () => {
		const configs = open();
		configs.save('Nit', ca);
		configs.setOpenWith('Nit');
		configs.remove('Nit');
		expect(configs.saved).toEqual([]);
		expect(configs.openWith).toBeUndefined();
	});
});

describe('a library written by a later version', () => {
	const newer = (): KeyValueStore => {
		const store = memoryStore();
		store.write(LIBRARY_KEY, JSON.stringify({ version: STORAGE_VERSION + 1, saved: [] }));
		return store;
	};

	it('refuses every write rather than overwriting work it cannot read', () => {
		const store = newer();
		const before = store.read(LIBRARY_KEY);
		const configs = open(store);
		expect(configs.problem).toBe('newer');
		expect(configs.save('Nit', ca)).toEqual({ ok: false, why: 'locked' });
		expect(configs.remove('Nit')).toEqual({ ok: false, why: 'locked' });
		expect(configs.setOpenWith(undefined)).toEqual({ ok: false, why: 'locked' });
		expect(store.read(LIBRARY_KEY)).toBe(before);
	});

	it('is only cleared by someone who asks for it', () => {
		const configs = open(newer());
		configs.discard();
		expect(configs.problem).toBeUndefined();
		expect(configs.save('Nit', ca).ok).toBe(true);
	});
});

/**
 * Two tabs share one key. The list this tab has had on screen since the panel
 * opened is not what it may write back.
 */
describe('another tab writing the same library', () => {
	it('keeps the other tab save instead of overwriting it', () => {
		const store = memoryStore();
		const here = open(store);
		const elsewhere = open(store);
		elsewhere.save('Medes', substrate);
		here.save('Nit', ca);
		expect(here.saved.map((entry) => entry.name).sort()).toEqual(['Medes', 'Nit']);
	});
});

describe('what a tab opens with', () => {
	it('takes its own working configuration over the saved default', () => {
		const local = memoryStore();
		const session = memoryStore();
		const configs = open(local, session);
		configs.save('Medes', substrate);
		configs.setOpenWith('Medes');
		configs.remember({
			configuration: ca,
			camera: { centre: { lng: 3, lat: 41 }, zoom: 12, bearing: 0 },
			from: undefined
		});
		const opening = open(local, session).opening();
		expect(opening.configuration).toEqual(ca);
		expect(opening.start).toEqual({
			kind: 'tab',
			camera: { centre: { lng: 3, lat: 41 }, zoom: 12, bearing: 0 }
		});
	});

	it('takes the saved default when the tab is a new one', () => {
		const local = memoryStore();
		const configs = open(local);
		configs.save('Medes', substrate);
		configs.setOpenWith('Medes');
		const opening = open(local, memoryStore()).opening();
		expect(opening.configuration).toEqual(substrate);
		expect(opening.from).toBe('Medes');
	});

	/** A saved configuration still has no camera, whatever else a new tab inherits. */
	it('opens on the whole survey when no tab has ever moved', () => {
		const local = memoryStore();
		const configs = open(local);
		configs.save('Medes', substrate);
		configs.setOpenWith('Medes');
		expect(open(local, memoryStore()).opening().start).toEqual({ kind: 'survey' });
	});

	it('opens a new tab on the last camera any tab wrote', () => {
		const local = memoryStore();
		const camera = { centre: { lng: 2.4, lat: 41.2 }, zoom: 16, bearing: 30 };
		open(local).remember({ configuration: ca, camera, from: undefined });
		expect(open(local, memoryStore()).opening().start).toEqual({ kind: 'shared', camera });
	});

	it('falls back to what the map ships with', () => {
		expect(open().opening()).toEqual({
			configuration: ca,
			from: undefined,
			start: { kind: 'survey' }
		});
	});
});

describe('the opening hints', () => {
	it('start out never having been shown', () => {
		expect(open().introSeen).toBe(false);
	});

	it('stay dismissed in every other tab and in the next session', () => {
		const local = memoryStore();
		open(local).markIntroSeen();
		expect(open(local, memoryStore()).introSeen).toBe(true);
	});

	/** A camera lands in the same blob every time the map settles. */
	it('are not put back by the next camera a tab writes', () => {
		const local = memoryStore();
		const configs = open(local);
		configs.markIntroSeen();
		configs.remember({
			configuration: ca,
			camera: { centre: { lng: 3, lat: 41 }, zoom: 12, bearing: 0 },
			from: undefined
		});
		expect(open(local, memoryStore()).introSeen).toBe(true);
	});
});
