import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../i18n/messages.ts';

/**
 * The manifest is a static file because a webmanifest has to be served as bytes,
 * and it can only carry one language, which is Catalan for the same reason
 * messages.ts is written in Catalan first. That leaves it free to drift away
 * from the catalogue the rest of the interface reads, so the drift is a failing
 * test rather than a label nobody notices is stale.
 *
 * The path assertions are the other half. `start_url` and `scope` resolve
 * against the manifest's own URL, so "." is the directory it was served from and
 * the same file installs correctly at divemap.mauri.app and under /dive-map/ on
 * the github.io project URL. A leading slash on any of these silently breaks the
 * second one, and nothing else in the build would notice.
 */
const STATIC = join(dirname(fileURLToPath(import.meta.url)), '../../../static');

interface ManifestIcon {
	readonly src: string;
	readonly sizes: string;
	readonly type: string;
	readonly purpose?: string;
}

interface Manifest {
	readonly id: string;
	readonly name: string;
	readonly short_name: string;
	readonly description: string;
	readonly lang: string;
	readonly start_url: string;
	readonly scope: string;
	readonly display: string;
	readonly background_color: string;
	readonly theme_color: string;
	readonly icons: readonly ManifestIcon[];
}

const manifest = JSON.parse(readFileSync(join(STATIC, 'manifest.webmanifest'), 'utf8')) as Manifest;

const pngs = manifest.icons.filter((icon) => icon.type === 'image/png');

describe('manifest.webmanifest', () => {
	it('says what the interface says, in the interface’s first language', () => {
		expect(manifest.lang).toBe('ca');
		expect(manifest.name).toBe(t('ca', 'appFullName'));
		expect(manifest.short_name).toBe(t('ca', 'appShortName'));
		expect(manifest.description).toBe(t('ca', 'appDescription'));
	});

	it('keeps short_name short enough for a home screen', () => {
		expect(manifest.short_name.length).toBeLessThanOrEqual(12);
	});

	it('resolves against the manifest, not against a hardcoded root', () => {
		expect(manifest.id).toBe('.');
		expect(manifest.start_url).toBe('.');
		expect(manifest.scope).toBe('.');
		for (const icon of manifest.icons) {
			expect(icon.src.startsWith('/')).toBe(false);
			expect(/^[a-z]+:/.test(icon.src)).toBe(false);
		}
	});

	it('asks to be installed as an app in the colour of the app’s own chrome', () => {
		expect(manifest.display).toBe('standalone');
		expect(manifest.theme_color).toBe('#14100c');
		expect(manifest.background_color).toBe(manifest.theme_color);
	});

	it('offers both purposes at both sizes, each declared', () => {
		for (const icon of pngs) expect(icon.purpose).toBeDefined();
		for (const purpose of ['any', 'maskable']) {
			const sizes = pngs.filter((i) => i.purpose === purpose).map((i) => i.sizes);
			expect(sizes).toContain('192x192');
			expect(sizes).toContain('512x512');
		}
	});

	it('names only files the icon build actually wrote', () => {
		for (const icon of manifest.icons) {
			expect(existsSync(join(STATIC, icon.src)), icon.src).toBe(true);
		}
		expect(existsSync(join(STATIC, 'favicon.ico'))).toBe(true);
		expect(existsSync(join(STATIC, 'apple-touch-icon.png'))).toBe(true);
	});
});
