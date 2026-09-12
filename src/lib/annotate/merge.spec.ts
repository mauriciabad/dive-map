import { describe, expect, it } from 'vitest';
import type { Annotation } from './annotation.ts';
import { type Conflict, merge, resolve } from './merge.ts';

const at = (id: string, lng: number, label?: string): Annotation => ({
	id,
	kind: 'hazard',
	label,
	geometry: { type: 'Point', coordinates: [lng, 41] }
});

const lng = (a: Annotation): number =>
	a.geometry.type === 'Point' ? a.geometry.coordinates[0] : Number.NaN;

const ids = (annotations: readonly Annotation[]): string =>
	annotations
		.map((a) => `${a.id}@${lng(a)}`)
		.sort()
		.join(',');

const BASE = [at('a', 1), at('b', 2)];

describe('merge', () => {
	it('leaves everything alone when nobody moved', () => {
		const result = merge(BASE, BASE, BASE);
		expect(ids(result.working)).toBe('a@1,b@2');
		expect(result.conflicts).toEqual([]);
	});

	it('takes the committed version when only the file moved', () => {
		const result = merge(BASE, BASE, [at('a', 9), at('b', 2)]);
		expect(ids(result.working)).toBe('a@9,b@2');
		expect(result.arrived).toBe(1);
		expect(result.conflicts).toEqual([]);
	});

	it('keeps the local version when only the browser moved', () => {
		const result = merge(BASE, [at('a', 5), at('b', 2)], BASE);
		expect(ids(result.working)).toBe('a@5,b@2');
		expect(result.conflicts).toEqual([]);
	});

	it('has nothing to decide when both moved to the same place', () => {
		const both = [at('a', 7), at('b', 2)];
		const result = merge(BASE, both, both);
		expect(ids(result.working)).toBe('a@7,b@2');
		expect(result.conflicts).toEqual([]);
	});

	it('reports a conflict when both moved differently, keeping the local one on screen', () => {
		const result = merge(BASE, [at('a', 5), at('b', 2)], [at('a', 9), at('b', 2)]);
		expect(result.conflicts.map((c) => c.id)).toEqual(['a']);
		expect(ids(result.working)).toBe('a@5,b@2');
	});

	it('treats a label change as a change', () => {
		const result = merge(BASE, [at('a', 1, 'meva'), at('b', 2)], [at('a', 1, 'seva'), at('b', 2)]);
		expect(result.conflicts.map((c) => c.id)).toEqual(['a']);
		expect(result.working.find((a) => a.id === 'a')?.label).toBe('meva');
	});

	it('honours a local delete the file did not touch', () => {
		const result = merge(BASE, [at('b', 2)], BASE);
		expect(ids(result.working)).toBe('b@2');
		expect(result.conflicts).toEqual([]);
	});

	it('honours a committed delete the browser did not touch', () => {
		const result = merge(BASE, BASE, [at('b', 2)]);
		expect(ids(result.working)).toBe('b@2');
		expect(result.withdrawn).toBe(1);
	});

	it('conflicts when the file deleted what the browser edited', () => {
		const result = merge(BASE, [at('a', 5), at('b', 2)], [at('b', 2)]);
		expect(result.conflicts).toEqual([{ id: 'a', mine: at('a', 5), theirs: undefined }]);
		expect(ids(result.working)).toBe('a@5,b@2');
	});

	it('agrees silently when both sides deleted the same thing', () => {
		const result = merge(BASE, [at('b', 2)], [at('b', 2)]);
		expect(ids(result.working)).toBe('b@2');
		expect(result.conflicts).toEqual([]);
	});

	it('keeps a brand-new local annotation when the committed file is empty', () => {
		const result = merge([], [at('z', 3)], []);
		expect(ids(result.working)).toBe('z@3');
		expect(result.conflicts).toEqual([]);
	});

	it('adopts an annotation the browser has never seen', () => {
		const result = merge(BASE, BASE, [...BASE, at('c', 4)]);
		expect(ids(result.working)).toBe('a@1,b@2,c@4');
		expect(result.arrived).toBe(1);
	});
});

describe('resolve', () => {
	const conflicted = merge(BASE, [at('a', 5), at('b', 2)], [at('a', 9), at('b', 2)]);

	it('changes nothing when the user keeps their own drawing', () => {
		expect(ids(resolve(conflicted.working, conflicted.conflicts, 'mine'))).toBe('a@5,b@2');
	});

	it('takes the committed geometry when the user defers to the file', () => {
		expect(ids(resolve(conflicted.working, conflicted.conflicts, 'theirs'))).toBe('a@9,b@2');
	});

	it('drops a feature the file deleted when the user defers to it', () => {
		const deleted: readonly Conflict[] = [{ id: 'a', mine: at('a', 5), theirs: undefined }];
		expect(ids(resolve([at('a', 5), at('b', 2)], deleted, 'theirs'))).toBe('b@2');
	});
});
