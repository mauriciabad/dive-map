/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { base, build, files, prerendered, version } from '$service-worker';
import { registerServiceWorker, type ServiceWorkerScope } from '$lib/offline/service-worker.ts';

// SvelteKit keeps this file out of the app tsconfig because it needs lib.webworker, so the logic
// lives in $lib/offline/service-worker.ts where `pnpm run check` and eslint can see it.
//
// `base` is not `paths.base`: SvelteKit works it out from `location.pathname`, so the same build
// answers correctly at the site root and under a project subpath. Every path in `build`, `files`
// and `prerendered` already carries it.
registerServiceWorker(self as unknown as ServiceWorkerScope, {
	base,
	build,
	files,
	prerendered,
	version
});
