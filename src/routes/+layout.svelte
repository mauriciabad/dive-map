<script lang="ts">
	import './layout.css';
	import './theme.css';
	import { serviceWorkerContainer } from '$lib/offline/support';
	import { watchForUpdates } from '$lib/offline/registration';
	import type { Snippet } from 'svelte';

	const { children }: { children: Snippet } = $props();

	$effect(() => {
		const sw = serviceWorkerContainer(navigator);
		if (sw === undefined) return;
		return watchForUpdates(sw);
	});
</script>

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
