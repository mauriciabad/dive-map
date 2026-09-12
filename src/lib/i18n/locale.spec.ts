import { describe, expect, it } from 'vitest';
import { isLocale, localisedName, negotiate } from './locale.ts';

describe('locale negotiation', () => {
	it('takes the first language we speak, ignoring the region', () => {
		expect(negotiate(['de-DE', 'es-ES', 'en'])).toBe('es');
		expect(negotiate(['ca-ES'])).toBe('ca');
	});

	it('falls back to Catalan for a browser that asks for nothing we speak', () => {
		expect(negotiate(['ja', 'ko'])).toBe('ca');
		expect(negotiate([])).toBe('ca');
	});

	it('rejects a locale we do not ship', () => {
		expect(isLocale('fr')).toBe(false);
		expect(isLocale('ca')).toBe(true);
	});
});

describe('place names', () => {
	it('prefers the tagged translation when a mapper supplied one', () => {
		const tags = { name: 'Canons de Tamariu', 'name:es': 'Cañones de Tamariu' };
		expect(localisedName(tags, 'es')).toBe('Cañones de Tamariu');
		expect(localisedName(tags, 'en')).toBe('Canons de Tamariu');
	});

	it('leaves an untranslated place name alone in every locale', () => {
		const tags = { name: 'Barda de Fitor' };
		expect(localisedName(tags, 'en')).toBe('Barda de Fitor');
		expect(localisedName(tags, 'ca')).toBe('Barda de Fitor');
	});

	it('falls back to alt_name when there is no name at all', () => {
		expect(localisedName({ alt_name: 'Furió Fitor' }, 'ca')).toBe('Furió Fitor');
	});
});
