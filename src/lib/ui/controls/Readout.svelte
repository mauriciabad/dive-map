<script lang="ts">
	import type { Reading } from './types';

	/**
	 * Measured numbers with their names: coverage, pixels, scale, a fix. Set in
	 * tabular figures so a column of them stays still while the boat moves.
	 *
	 * Given a column count the pairs become a grid of instrument cells, which is
	 * how eight readings fit in two rows instead of eight lines that each repeat
	 * the same leading word. Without one they stack as a list.
	 */

	interface Props {
		readonly rows: readonly Reading[];
		readonly columns?: number;
	}

	const { rows, columns }: Props = $props();
</script>

<dl class={['readout', { grid: columns !== undefined }]} style:--columns={columns}>
	{#each rows as row (row.label)}
		<div>
			<dt>{row.label}</dt>
			<dd>{row.value}</dd>
		</div>
	{/each}
</dl>

<style>
	.readout {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0;
	}

	div {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		font-size: 0.78rem;
	}

	dt {
		color: var(--control-ink-dim);
	}

	dd {
		margin: 0;
		color: var(--control-ink);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.readout.grid {
		display: grid;
		grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
		gap: 0.3rem;
	}

	/*
	 * Fixed height with the value pushed to the bottom, so a two-line name does
	 * not drop its number half a row below the three beside it.
	 */
	.readout.grid div {
		flex-direction: column;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.25rem;
		min-width: 0;
		min-height: 3.4rem;
		padding: 0.4rem 0.45rem;
		background: var(--control-well);
		border-radius: var(--control-radius);
		box-shadow: var(--sunk);
	}

	/* The name of the quantity. Its number and unit go together in the value. */
	.readout.grid dt {
		font-size: 0.66rem;
		line-height: 1.15;
		letter-spacing: 0.04em;
		overflow-wrap: anywhere;
	}

	.readout.grid dd {
		font-size: 0.95rem;
		text-align: left;
		overflow-wrap: anywhere;
	}
</style>
