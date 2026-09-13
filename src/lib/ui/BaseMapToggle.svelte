<script lang="ts">
	import BaseMapButton from './BaseMapButton.svelte';
	import { SvelteControl, whenMapReady } from '$lib/map/controls';
	import type { MapState } from '$lib/state/map-view.svelte';

	/**
	 * Puts the base map toggle in the corner, under the locate button.
	 *
	 * Under it because that is where the diver was asked for it, and the way to
	 * get it there is to be mounted after `LocationControl`: MapLibre stacks a
	 * corner in the order controls are added, so the page renders this one second
	 * and the effect below runs second. Nothing here positions anything by hand.
	 */

	interface Props {
		readonly view: MapState;
	}

	const { view }: Props = $props();

	$effect(() =>
		whenMapReady((map) => {
			const control = new SvelteControl(BaseMapButton, {
				props: { view },
				className: 'maplibregl-ctrl maplibregl-ctrl-group'
			});
			map.addControl(control, 'top-right');
			return () => {
				map.removeControl(control);
			};
		})
	);
</script>
