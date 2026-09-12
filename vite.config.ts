import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

// SvelteKit config lives in svelte.config.js, including the adapter and runes mode.
export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// Vite's dep pre-bundling rewrites maplibre-gl but not the worker it spawns, so
	// /node_modules/.vite/deps/maplibre-gl-worker.mjs 404s in dev. The worker does
	// all the tile decoding and reports nothing when it dies, so the map renders its
	// background and silently never loads a tile.
	optimizeDeps: { exclude: ['maplibre-gl'] },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
