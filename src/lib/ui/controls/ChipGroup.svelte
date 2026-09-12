<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Holds chips. Given a column count it lays them out on a fixed grid, which
	 * is how a set of eight reads as two rows of four instead of a ragged list;
	 * without one they wrap.
	 */

	interface Props {
		readonly columns?: number;
		readonly children: Snippet;
	}

	const { columns, children }: Props = $props();
</script>

<div class={['chips', { grid: columns !== undefined }]} style:--columns={columns}>
	{@render children()}
</div>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chips.grid {
		display: grid;
		grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
	}
</style>
