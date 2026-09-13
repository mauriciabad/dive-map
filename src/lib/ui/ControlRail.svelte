<script lang="ts">
	import IsobathsPanel from './IsobathsPanel.svelte';
	import LanguagePanel from './LanguagePanel.svelte';
	import LayersPanel from './LayersPanel.svelte';
	import LegendPanel from './LegendPanel.svelte';
	import MapControls from './MapControls.svelte';
	import type { PanelState } from './panel';
	import PrintPanel from '$lib/print/PrintPanel.svelte';
	import { SvelteControl, whenMapReady } from '$lib/map/controls';
	import type { MapState } from '$lib/state/map-view.svelte';

	const { view }: { readonly view: MapState } = $props();

	// Backed by MapState so the feature card and this panel can close each other.
	const panel: PanelState = {
		get open() {
			return view.panelOpen;
		},
		set open(next) {
			view.openPanel(next);
		}
	};
	const open = $derived(view.panelOpen);

	const close = (): void => {
		panel.open = undefined;
	};

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

{#if open === 'layers'}
	<LayersPanel {view} onclose={close} />
{:else if open === 'legend'}
	<LegendPanel {view} onclose={close} />
{:else if open === 'isobaths'}
	<IsobathsPanel {view} onclose={close} />
{:else if open === 'print'}
	<PrintPanel {view} onclose={close} />
{:else if open === 'language'}
	<LanguagePanel {view} onclose={close} />
{/if}
