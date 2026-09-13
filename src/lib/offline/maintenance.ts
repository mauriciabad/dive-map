import { inClearScope, type ClearScope } from './cache-names.ts';

/**
 * The door a diver can open when the offline copy has gone wrong.
 *
 * Issue #46 was two caching bugs in a row, and both were invisible from inside the
 * app and unfixable from inside it. The only cure was a private window or clearing
 * site data through browser settings, which is not something to ask of anyone
 * standing on a boat with one hand on a rail.
 */

/**
 * Drops every cache the scope claims and says how many went.
 *
 * Runs to the same end state however many times it is called and wherever it was
 * interrupted, because a clear that the tab went away in the middle of has to be
 * fixable by pressing the button again.
 */
export async function clearCaches(scope: ClearScope): Promise<number> {
	const names = (await caches.keys()).filter((name) => inClearScope(scope, name));
	const dropped = await Promise.all(names.map((name) => caches.delete(name)));
	return dropped.filter((gone) => gone).length;
}

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;
const THIN = ' ';

/**
 * A number of bytes as a phone reports its own storage: decimal units, and at most
 * one decimal place, because the question this answers is whether something is
 * wrong rather than exactly how many bytes are where.
 */
export function formatBytes(bytes: number, locale: string): string {
	let value = Math.max(bytes, 0);
	let unit = 0;
	while (value >= 1000 && unit < UNITS.length - 1) {
		value /= 1000;
		unit += 1;
	}
	const digits = unit > 0 && value < 10 ? 1 : 0;
	const number = new Intl.NumberFormat(locale, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	}).format(value);
	return `${number}${THIN}${UNITS[unit]}`;
}
