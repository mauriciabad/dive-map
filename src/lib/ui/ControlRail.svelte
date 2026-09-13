<script lang="ts">
	import ConfigsPanel from './ConfigsPanel.svelte';
	import IsobathsPanel from './IsobathsPanel.svelte';
	import LanguagePanel from './LanguagePanel.svelte';
	import LayersPanel from './LayersPanel.svelte';
	import LegendPanel from './LegendPanel.svelte';
	import MapControls from './MapControls.svelte';
	import ShareButton from './ShareButton.svelte';
	import type { PanelState } from './panel';
	import PrintPanel from '$lib/print/PrintPanel.svelte';
	import { SvelteControl, whenMapReady } from '$lib/map/controls';
	import type { Configurations } from '$lib/state/configurations.svelte';
	import type { MapState } from '$lib/state/map-view.svelte';

	interface Props {
		readonly view: MapState;
		readonly configurations: Configurations;
	}

	const { view, configurations }: Props = $props();

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
			// Added after the rail so MapLibre stacks it underneath, which puts the
			// one button that leaves the app at the bottom of the corner.
			const share = new SvelteControl(ShareButton, {
				props: { view },
				className: 'maplibregl-ctrl maplibregl-ctrl-group dive-share'
			});
			map.addControl(control, 'top-left');
			map.addControl(share, 'top-left');
			return () => {
				map.removeControl(control);
				map.removeControl(share);
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
{:else if open === 'configs'}
	<ConfigsPanel {view} {configurations} onclose={close} />
{/if}
