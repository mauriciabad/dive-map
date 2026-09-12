<script lang="ts" generics="Value">
	import Icon from '../Icon.svelte';
	import type { Choice } from './types';

	/**
	 * Pick one of a few. The options sit in a sunk well so the chosen one reads
	 * as pressed into the brass rather than painted on top of it, and they wrap
	 * onto a second line rather than shrinking below a thumb's width.
	 */

	interface Props {
		readonly options: readonly Choice<Value>[];
		readonly value: Value;
		readonly onselect: (value: Value) => void;
		/** Tabular figures, for options that are numbers rather than words. */
		readonly numeric?: boolean;
		readonly label?: string;
	}

	const { options, value, onselect, numeric = false, label }: Props = $props();
</script>

<div class={['segmented', { numeric }]} role="group" aria-label={label}>
	{#each options as option (option.label)}
		<button
			type="button"
			aria-pressed={option.value === value}
			disabled={option.disabled ?? false}
			title={option.title}
			onclick={() => {
				onselect(option.value);
			}}
		>
			{#if option.icon !== undefined}
				<Icon name={option.icon} size={18} />
			{/if}
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segmented {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 2px;
		background: var(--control-well);
		border-radius: 0.45rem;
		box-shadow: var(--sunk);
	}

	button {
		flex: 1 1 4rem;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-width: 0;
		min-height: var(--spacing-touch);
		padding: 0 0.4rem;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--control-ink-dim);
		font: inherit;
		font-size: var(--control-text);
		cursor: pointer;
		transition:
			background var(--control-ease),
			color var(--control-ease);
	}

	.numeric button {
		font-variant-numeric: tabular-nums;
	}

	button:hover:not(:disabled) {
		color: var(--control-ink);
	}

	button:disabled {
		color: var(--control-ink-off);
		cursor: not-allowed;
	}

	button[aria-pressed='true'] {
		background: var(--control-on);
		color: var(--control-on-ink);
		font-weight: 600;
	}
</style>
