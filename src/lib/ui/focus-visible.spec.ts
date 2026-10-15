import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue #74. A phone focuses whatever a finger taps, so a style on `:focus` or
 * `:focus-within` shows up on every tap as though the diver had tabbed there, and
 * on a button that just opened a panel it fought the pressed-in look and won.
 * Focus rings are for a keyboard and belong on `:focus-visible`; a box that lights
 * up while something inside it has keyboard focus is `:has(:focus-visible)`.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..');

const sources = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.(css|svelte)$/.test(entry.name) ? [path] : [];
	});

/** Comments say `:focus` when they explain why it is not used. */
const withoutComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

const BARE_FOCUS = /:focus(?!-visible)\b/;

describe('focus styles', () => {
	it('are only ever drawn for a keyboard', () => {
		const found = sources(SRC).flatMap((path) =>
			withoutComments(readFileSync(path, 'utf8'))
				.split('\n')
				.filter((line) => BARE_FOCUS.test(line))
				.map((line) => `${relative(SRC, path)}: ${line.trim()}`)
		);
		expect(found).toEqual([]);
	});
});
