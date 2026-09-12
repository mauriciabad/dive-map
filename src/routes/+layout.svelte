<script lang="ts">
	import './layout.css';
	import './theme.css';
	import favicon from '$lib/assets/favicon.svg';
	import type { Snippet } from 'svelte';

	const { children }: { children: Snippet } = $props();

	/*
	 * A new worker taking over means the archives on the server have moved. The
	 * running page is still holding modules and tiles from the old deploy, so it
	 * reloads once rather than mixing the two, which is what produced the ETag
	 * mismatch that needed site data cleared by hand.
	 */
	$effect(() => {
		if (!('serviceWorker' in navigator)) return;
		/*
		 * Only a genuine update, never the first install.
		 *
		 * The worker calls skipWaiting and claims its clients, so controllerchange
		 * fires on a first visit too, with nothing stale to escape. Reloading there
		 * makes every cold load bounce, and with the reload racing the next install
		 * it can bounce forever.
		 */
		if (navigator.serviceWorker.controller === null) return;
		let reloading = false;
		const onchange = () => {
			if (reloading) return;
			reloading = true;
			location.reload();
		};
		navigator.serviceWorker.addEventListener('controllerchange', onchange);
		return () => {
			navigator.serviceWorker.removeEventListener('controllerchange', onchange);
		};
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<!--
THESIS: The seabed as a hand-painted tabletop battlemap. Refuses the nautical-chart
arrangement of thin lines on white with soundings as numerals; a chart says where not to
go, this says what you will see when you get there.
OWN-WORLD: Crosshead Dungeondraft. Painted terrain fills at real texture scale, one
ground per habitat. Depth is a water-column veil over the texture, clear at the surface
and near-opaque at 80m. Low raking hillshade, soft shadowed terrain edges, objects with
their own cast shadow. Chrome is dark weathered wood and aged brass around the table.
STORY: A diver arrives not knowing the site, reads the shape of the bottom in seconds,
sees where the Posidonia and the coralligenous wall are, frames a sheet and prints it.
FIRST VIEWPORT: Map edge to edge, no letterbox. Site name in Alegreya top-left over the
water. Layer controls as a single brass rail, bottom on a phone, left on a desktop. The
not-for-navigation line sits in the bottom margin where a chart puts its notes.
FORM: Brief-pinned world, candidate 5 superseded by the user's pin; seed key 7cd3d296.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->
{@render children()}
