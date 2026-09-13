import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
export default {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({ fallback: '404.html' }),
		// divemap.mauri.app serves the site from its own root, so the base path is empty.
		// It would be '/dive-map' only on the github.io project-page URL.
		paths: { base: '' },
		// Registered by hand in src/routes/+layout.svelte. SvelteKit's generated
		// snippet tests `'serviceWorker' in navigator` and then reads .register off
		// it, which throws wherever the property exists but the API does not, and it
		// resolves the worker against `paths.base` rather than the served directory.
		serviceWorker: { register: false },
		prerender: { handleHttpError: 'fail' }
	}
};
