import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * The dev server, with the file watcher switched off.
 *
 * Every verify script in here needs `window.diveMap`, which only exists under
 * `import.meta.env.DEV`, so none of them can run against a production preview. On
 * a tree two agents are editing, a plain `vite dev` reloads the page under the
 * browser the moment either of them saves, and each reload throws away the map
 * handle, the seeded storage and whatever the script was halfway through
 * measuring. It reads as a flaky test and it is not one.
 *
 * With nothing watched, the server serves what it read on the first request and
 * keeps serving it. Restart it to pick up a change.
 *
 *     pnpm exec vite dev --config pipeline/config/vite-frozen.js --port 5211
 */
export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// Same reason as the main config: Vite's dep pre-bundling rewrites maplibre-gl
	// but not the worker it spawns, and a dead worker paints a background and
	// reports nothing.
	optimizeDeps: { exclude: ['maplibre-gl'] },
	server: {
		hmr: false,
		watch: { ignored: ['**/*'] }
	}
});
