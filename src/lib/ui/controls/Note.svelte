<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The line that explains what a control does or what just went wrong. It is
	 * always on screen: a hint that only appears once the thing it explains is
	 * switched on arrives after the reader needed it.
	 */

	interface Props {
		readonly tone?: 'quiet' | 'warn';
		readonly children: Snippet;
	}

	const { tone = 'quiet', children }: Props = $props();
</script>

<p class="note" data-tone={tone}>{@render children()}</p>

<style>
	.note {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		color: var(--control-ink-dim);
	}

	.note[data-tone='warn'] {
		color: var(--color-buoy);
	}
</style>
