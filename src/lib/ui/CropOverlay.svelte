<script lang="ts">
	import CropReadout from './CropReadout.svelte';
	import { cropFrame } from '$lib/domain/card';
	import { SvelteControl, whenMapReady } from '$lib/map/controls';
	import type { MapState } from '$lib/state/map-view.svelte';

	type Props = {
		readonly view: MapState;
		readonly onexport: () => void;
		readonly busy: boolean;
	};

	const { view, onexport, busy }: Props = $props();

	const viewport = $state({ width: 1440, height: 900 });
	const frame = $derived(cropFrame(view.framedCard, view.zoom, viewport));

	/*
	 * The readout is a MapLibre control so it stacks under the zoom buttons in the
	 * top-right corner instead of landing on top of them. Props reach it through
	 * getters because `mount` reads the object once and never again.
	 */
	$effect(() =>
		whenMapReady((map) => {
			const control = new SvelteControl(CropReadout, {
				props: {
					view,
					get frame() {
						return frame;
					},
					get busy() {
						return busy;
					},
					get onexport() {
						return onexport;
					}
				},
				className: 'maplibregl-ctrl dive-ctrl-panel'
			});
			map.addControl(control, 'top-right');
			return () => {
				map.removeControl(control);
			};
		})
	);
</script>

<svelte:window
	bind:innerWidth={viewport.width}
	bind:innerHeight={viewport.height}
	onkeydown={(e: KeyboardEvent) => {
		if (e.key === 'Escape') view.framing = false;
	}}
/>

<div class="stage" aria-hidden="true">
	<div class="crop" style:width="{frame.widthPx}px" style:height="{frame.heightPx}px">
		<span class="tick tl"></span>
		<span class="tick tr"></span>
		<span class="tick bl"></span>
		<span class="tick br"></span>
	</div>
</div>

<style>
	.stage {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		z-index: 15;
		pointer-events: none;
	}

	/* The crop sits still and the map moves under it, which is what framing a
	   sheet by hand actually feels like. */
	.crop {
		position: relative;
		max-width: calc(100vw - 1rem);
		max-height: calc(100svh - 1rem);
		border: 1px solid var(--color-brass-400);
		box-shadow:
			0 0 0 9999px rgb(10 8 6 / 0.52),
			inset 0 0 0 1px rgb(239 228 207 / 0.25);
	}

	.tick {
		position: absolute;
		width: 1.1rem;
		height: 1.1rem;
		border: 2px solid var(--color-brass-300);
	}

	.tick.tl {
		top: -2px;
		left: -2px;
		border-right: 0;
		border-bottom: 0;
	}

	.tick.tr {
		top: -2px;
		right: -2px;
		border-left: 0;
		border-bottom: 0;
	}

	.tick.bl {
		bottom: -2px;
		left: -2px;
		border-right: 0;
		border-top: 0;
	}

	.tick.br {
		bottom: -2px;
		right: -2px;
		border-left: 0;
		border-top: 0;
	}
</style>
