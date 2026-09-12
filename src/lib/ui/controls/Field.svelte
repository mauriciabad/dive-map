<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A label over a group of controls or a readout. The label is the only thing
	 * standing between a diver and a row of switches with nothing to say what
	 * they do, so it is not optional.
	 */

	interface Props {
		readonly label: string;
		readonly children: Snippet;
	}

	const { label, children }: Props = $props();
</script>

<div class="field">
	<span class="label">{label}</span>
	{@render children()}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	.label {
		font-size: var(--control-label);
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--control-ink-dim);
	}
</style>
