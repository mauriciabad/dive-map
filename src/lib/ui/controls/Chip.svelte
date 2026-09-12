<script lang="ts">
	/**
	 * One value in a set. With `onclick` it is a control you press; without one
	 * it is a tag the map is telling you about, drawn the same so the two never
	 * look like different vocabularies.
	 */

	interface Props {
		readonly label: string;
		readonly pressed?: boolean;
		readonly onclick?: () => void;
	}

	const { label, pressed, onclick }: Props = $props();
</script>

{#if onclick === undefined}
	<span class="chip">{label}</span>
{:else}
	<button type="button" class="chip" aria-pressed={pressed ?? false} {onclick}>{label}</button>
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: var(--spacing-touch);
		padding: 0 0.8rem;
		border: 1px solid var(--control-rim);
		border-radius: 999px;
		background: transparent;
		color: var(--control-ink-dim);
		font: inherit;
		font-size: var(--control-text);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	span.chip {
		min-height: calc(var(--spacing-touch) - 0.65rem);
	}

	button.chip {
		cursor: pointer;
		transition:
			border-color var(--control-ease),
			color var(--control-ease),
			background var(--control-ease);
	}

	button.chip:hover {
		border-color: var(--control-on);
		color: var(--control-ink);
	}

	button.chip[aria-pressed='true'] {
		background: var(--control-on);
		border-color: var(--control-on-rim);
		color: var(--control-on-ink);
		font-weight: 700;
	}
</style>
