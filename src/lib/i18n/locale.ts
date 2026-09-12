/**
 * Three locales, one catalogue shape. Catalan is the source of truth because it
 * is the language of the place names and of the survey data; the other two are
 * required to match its keys exactly, so a missing translation is a compile
 * error rather than a blank label on a boat.
 */

export const LOCALES = ['ca', 'es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
	ca: 'Català',
	es: 'Español',
	en: 'English'
};

export const isLocale = (value: string): value is Locale =>
	(LOCALES as readonly string[]).includes(value);

/** First locale the browser asks for that we actually speak. */
export const negotiate = (accepted: readonly string[]): Locale => {
	for (const tag of accepted) {
		const base = tag.split('-')[0]?.toLowerCase() ?? '';
		if (isLocale(base)) return base;
	}
	return 'ca';
};

/**
 * Picks the best name from OSM's name tags. A dive site tagged only `name` gets
 * that name in every locale, which is correct: place names are not translated
 * unless a mapper has said otherwise.
 */
export const localisedName = (
	tags: Readonly<Record<string, string>>,
	locale: Locale
): string | undefined => tags[`name:${locale}`] ?? tags['name'] ?? tags['alt_name'];
