import adapter from '@sveltejs/adapter-static';

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
