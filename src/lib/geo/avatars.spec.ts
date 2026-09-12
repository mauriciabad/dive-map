import { describe, expect, it } from 'vitest';
import built from '../../../static/avatars/index.json' with { type: 'json' };
import { AVATARS, DEFAULT_AVATAR, isAvatarId } from './avatars.ts';
import { LOCALES } from '$lib/i18n/locale';
import { t } from '$lib/i18n/messages';

const manifest: { readonly ids: readonly string[] } = built;

/**
 * The drawings live in a build script and the labels live in TypeScript. Without
 * this the two drift silently and the cost is a blank sprite on a boat, so the
 * drift is a failing test instead.
 */
describe('avatar catalogue', () => {
	it('lists exactly what the build script rasterised', () => {
		expect(AVATARS.map((a) => a.id)).toEqual(manifest.ids);
	});

	it('defaults to the pirate boat', () => {
		expect(DEFAULT_AVATAR).toBe('pirate-boat');
		expect(isAvatarId(DEFAULT_AVATAR)).toBe(true);
	});

	it('names every figure in all three languages', () => {
		const missing = LOCALES.flatMap((locale) =>
			AVATARS.filter((a) => t(locale, a.key).length === 0).map((a) => `${locale}/${a.id}`)
		);
		expect(missing).toEqual([]);
	});

	it('rejects an id that is not in the set', () => {
		expect(isAvatarId('speedboat')).toBe(false);
	});
});
