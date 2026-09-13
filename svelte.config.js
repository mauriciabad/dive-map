import adapter from '@sveltejs/adapter-static';
import { readFileSync } from 'node:fs';

/*
 * The address the site answers on, for the one thing that cannot be written
 * relatively: the share card in app.html. A crawler fetches og:image on its own,
 * with no page to resolve a relative path against, so those URLs have to be
 * absolute and have to be in the served file.
 *
 * It is read from static/CNAME rather than typed here, because that file is what
 * makes the domain true: GitHub Pages serves the site at whatever it says. Typing
 * it twice is how a card ends up pointing at an address the site moved off.
 *
 * SvelteKit substitutes %sveltekit.env.PUBLIC_SITE_ORIGIN% in app.html from the
 * public environment, and this config is read before that environment is, so
 * setting it here reaches the template. An override is honoured for a deploy that
 * is not this one.
 */
const origin = () => {
	const host = readFileSync('static/CNAME', 'utf8').trim();
	if (host === '') throw new Error('static/CNAME is empty, so the share card has no address');
	return `https://${host}`;
};
process.env.PUBLIC_SITE_ORIGIN ??= origin();

/** @type {import('@sveltejs/kit').Config} */
export default {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({ fallback: '404.html' }),
		/*
		 * divemap.mauri.app serves the site from its own root, so the base path is
		 * empty and that is what ships.
		 *
		 * It has to be settable for a deploy under a subpath, because one page in the
		 * build cannot be written relatively. Every prerendered page gets paths
		 * relative to itself, which is right wherever it is served from, but 404.html
		 * is the SPA fallback: it answers for a URL that is not its own, so SvelteKit
		 * writes its assets absolute and has to. Absolute is only right if it carries
		 * the subpath, and only `base` can put it there. Build the github.io project
		 * URL with BASE_PATH=/dive-map and the fallback finds the manifest, the icons
		 * and the bundle; build it without and every one of them 404s.
		 */
		paths: { base: process.env.BASE_PATH ?? '' },
		// Registered by hand in src/routes/+layout.svelte. SvelteKit's generated
		// snippet tests `'serviceWorker' in navigator` and then reads .register off
		// it, which throws wherever the property exists but the API does not, and it
		// resolves the worker against `paths.base` rather than the served directory.
		serviceWorker: { register: false },
		prerender: { handleHttpError: 'fail' }
	}
};
