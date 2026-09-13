<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';
	import { MARKER_PLATE } from '$lib/map/markers';

	/**
	 * A map mark, drawn off the map: the glyph in the colour its family takes, and
	 * under a dive site the diver-down flag it is painted on.
	 *
	 * Two layers here because the map draws two, from the same two paths. The
	 * legend and the card used to paint the plate themselves, as a dark disc with a
	 * brass ring, which is neither the shape nor the colour of the thing on the
	 * map: a dive site came out a cream slash on a dark circle, and the one mark a
	 * diver is looking for read as a no-entry sign. Reading the plate's colour off
	 * the same table the style reads is what stops that happening again.
	 */

	interface Props {
		readonly icon: IconName;
		readonly tint: string;
		/** The diver-down flag's red field, under the stripe that crosses it. */
		readonly plate?: boolean;
		readonly size?: number;
	}

	const { icon, tint, plate = false, size = 24 }: Props = $props();
</script>

<span class="mark">
	{#if plate}
		<span class="layer" style:color={MARKER_PLATE}><Icon name="markerPlate" {size} /></span>
	{/if}
	<span class="layer" style:color={tint}><Icon name={icon} {size} /></span>
</span>

<style>
	.mark {
		display: grid;
		place-items: center;
	}

	/* Stacked in one cell, so the stripe lands on the field wherever the box is. */
	.layer {
		display: grid;
		grid-area: 1 / 1;
		place-items: center;
	}
</style>
