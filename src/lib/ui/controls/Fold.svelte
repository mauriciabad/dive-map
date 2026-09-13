<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
	import Icon from '../Icon.svelte';

	/**
	 * A `Field` that starts folded away, with what it is set to written on the
	 * head so folding it away costs nothing.
	 *
	 * Panels on this app are read on a phone held in one hand over a boat's rail,
	 * and a section a diver sets once and then scrolls past for the rest of the
	 * season is a section that should not be costing them a screen of scroll. The
	 * summary is what makes that safe: folded, the head still answers the only
	 * question anybody was going to ask of it, so the fold hides the controls
	 * rather than the setting.
	 *
	 * The controls are not in the document while it is folded, so a section whose
	 * contents are expensive to draw costs nothing until it is opened, and nothing
	 * inside it can be tabbed into by accident. That is also why it is a button
	 * and a region rather than `details`: `details` keeps its contents mounted,
	 * and the animation it allows is one engine's only.
	 *
	 * `open` binds, for a caller that wants to remember where the diver left it.
	 */

	interface Props {
		readonly label: string;
		/** What this section is set to, in a few words. Read while it is folded. */
		readonly summary?: string;
		readonly open?: boolean;
		readonly children: Snippet;
	}

	let { label, summary, open = $bindable(false), children }: Props = $props();

	const SLIDE_MS = 180;

	const unfold = (node: Element) =>
		slide(node, {
			duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : SLIDE_MS,
			easing: cubicOut
		});
</script>

<div class="fold">
	<button
		type="button"
		class="head"
		aria-expanded={open}
		onclick={() => {
			open = !open;
		}}
	>
		<span class="text">
			<span class="label">{label}</span>
			{#if !open && summary !== undefined}
				<span class="summary">{summary}</span>
			{/if}
		</span>
		<span class="go" data-open={open}><Icon name="chevron" size={16} /></span>
	</button>

	{#if open}
		<div class="body" transition:unfold>
			<div class="inner">{@render children()}</div>
		</div>
	{/if}
</div>

<style>
	.fold {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		min-height: var(--spacing-touch);
		padding: 0.2rem 0.4rem;
		margin: 0 -0.4rem;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--control-ease);
	}

	.head:hover {
		background: var(--control-hover);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
	}

	/* The same ink and weight a `Field` labels with, so a folded section reads as
	   one of the panel's sections and not as a control of its own. */
	.label {
		font-size: var(--control-label);
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--control-ink-dim);
	}

	/*
	 * One line, cut with an ellipsis. A summary that wrapped to three lines would
	 * cost the scroll the fold was opened to save.
	 */
	.summary {
		overflow: hidden;
		font-size: var(--control-text);
		line-height: 1.3;
		color: var(--control-ink);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.go {
		display: flex;
		flex: none;
		color: var(--control-ink-dim);
		transition: rotate var(--control-ease);
	}

	.head:hover .go {
		color: var(--color-brass-300);
	}

	.go[data-open='true'] {
		rotate: 90deg;
	}

	/* The slide animates this one's height, so the padding that keeps the controls
	   clear of the head goes on the child and travels with it. */
	.body {
		overflow: hidden;
	}

	.inner {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-top: 0.4rem;
	}
</style>
