<script lang="ts">
	import type { Reading } from './types';

	/**
	 * Measured numbers with their names: coverage, pixels, scale, a position.
	 * Laid out as a definition list because that is what it is, and set in
	 * tabular figures so a column of them lines up while the boat moves.
	 */

	interface Props {
		readonly rows: readonly Reading[];
	}

	const { rows }: Props = $props();
</script>

<dl>
	{#each rows as row (row.label)}
		<div>
			<dt>{row.label}</dt>
			<dd>{row.value}</dd>
		</div>
	{/each}
</dl>

<style>
	dl {
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
</style>
