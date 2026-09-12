<script lang="ts">
	import MapControls from './MapControls.svelte';
	import SettingsPanel from './SettingsPanel.svelte';
	import type { PanelState } from './panel';
	import { SvelteControl, whenMapReady } from '$lib/map/controls';
	import type { MapState } from '$lib/state/map-view.svelte';

	const { view }: { readonly view: MapState } = $props();

	const panel = $state<PanelState>({ open: undefined });
	const open = $derived(panel.open);

	$effect(() =>
		whenMapReady((map) => {
			const control = new SvelteControl(MapControls, {
				props: { view, panel },
				className: 'maplibregl-ctrl maplibregl-ctrl-group'
			});
			map.addControl(control, 'top-left');
			return () => {
				map.removeControl(control);
			};
		})
	);
</script>

<svelte:window
	onkeydown={(e: KeyboardEvent) => {
		if (e.key === 'Escape') panel.open = undefined;
	}}
/>

{#if open !== undefined}
	<SettingsPanel
		{view}
		section={open}
		onclose={() => {
			panel.open = undefined;
		}}
	/>
{/if}
