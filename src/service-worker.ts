/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';
import { registerServiceWorker, type ServiceWorkerScope } from '$lib/offline/service-worker.ts';

// SvelteKit keeps this file out of the app tsconfig because it needs lib.webworker, so the logic
// lives in $lib/offline/service-worker.ts where `pnpm run check` and eslint can see it.
registerServiceWorker(self as unknown as ServiceWorkerScope, {
	build,
	files,
	prerendered,
	version
});
