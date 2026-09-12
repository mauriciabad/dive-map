import { describe, expect, it } from 'vitest';
import type { Annotation } from './annotation.ts';
import { STORAGE_KEY, type KeyValueStore, loadSession, memoryStore, saveSession } from './storage.ts';

const one: Annotation = {
	id: 'a',
	kind: 'hazard',
	label: 'Xarxa',
	geometry: { type: 'LineString', coordinates: [[3, 41], [3.1, 41.1]] }
};

const two: Annotation = {
	id: 'b',
	kind: 'entry',
	label: undefined,
	geometry: { type: 'Point', coordinates: [3.2, 41.2] }
};

describe('saveSession and loadSession', () => {
	it('round-trips the base and the working set separately', () => {
		const store = memoryStore();
		expect(saveSession(store, { base: [one], working: [one, two] })).toBe(true);
		const back = loadSession(store);
		expect(back?.base.map((a) => a.id)).toEqual(['a']);
		expect(back?.working.map((a) => a.id).sort()).toEqual(['a', 'b']);
	});

	it('keeps an absent label absent rather than turning it into an empty string', () => {
		const store = memoryStore();
		saveSession(store, { base: [], working: [two] });
		expect(loadSession(store)?.working[0]?.label).toBeUndefined();
	});

	it('reports nothing stored rather than inventing a session', () => {
		expect(loadSession(memoryStore())).toBeUndefined();
	});

	it('treats a corrupt blob as nothing stored instead of throwing', () => {
		const store = memoryStore();
		store.setItem(STORAGE_KEY, '{ not json');
		expect(loadSession(store)).toBeUndefined();
	});

	it('survives a stored shape it does not recognise', () => {
		const store = memoryStore();
		store.setItem(STORAGE_KEY, JSON.stringify({ base: 7, working: 'nope' }));
		expect(loadSession(store)).toEqual({ base: [], working: [] });
	});

	it('says so when the browser refuses to store anything', () => {
		const full: KeyValueStore = {
			getItem: () => null,
			setItem: () => {
				throw new DOMException('quota', 'QuotaExceededError');
			},
			removeItem: () => undefined
		};
		expect(saveSession(full, { base: [], working: [one] })).toBe(false);
	});

	it('reads nothing rather than throwing when the browser refuses to be read', () => {
		const blocked: KeyValueStore = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => undefined,
			removeItem: () => undefined
		};
		expect(loadSession(blocked)).toBeUndefined();
	});
});
