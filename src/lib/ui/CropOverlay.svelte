<script lang="ts">
	import { cropFrame } from '$lib/domain/card';
	import type { LiveView, PrintState } from '$lib/print/print-state.svelte';

	interface Props {
		readonly print: PrintState;
		readonly live: LiveView;
		/** The live map's zoom, so the crop can be drawn at the size the sheet really covers. */
		readonly zoom: number;
	}

	const { print, live, zoom }: Props = $props();

	const viewport = $state({ width: 1440, height: 900 });
	const frame = $derived(cropFrame(print.plan(live), zoom, viewport));
</script>

<svelte:window bind:innerWidth={viewport.width} bind:innerHeight={viewport.height} />

<div class="stage" aria-hidden="true">
	<div class="crop" style:width="{frame.widthPx}px" style:height="{frame.heightPx}px">
		<span class="tick tl"></span>
		<span class="tick tr"></span>
		<span class="tick bl"></span>
		<span class="tick br"></span>
	</div>
</div>

<style>
	/*
	 * Above the map canvas and below everything else.
	 *
	 * MapLibre puts its corner containers at z-index 2 and the canvas at auto, and
	 * neither the map div nor its canvas opens a stacking context, so a fixed
	 * layer at 1 darkens the seabed and leaves the zoom buttons, the scale, the
	 * attribution, the control rail and the panel untouched.
	 */
	.stage {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		z-index: 1;
		pointer-events: none;
	}

	/* The crop sits still and the map moves under it, which is what framing a
	   sheet by hand actually feels like. It is deliberately not clamped to the
	   viewport: a box drawn smaller than the sheet would put the paper edge
	   somewhere it is not. */
	.crop {
		position: relative;
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
