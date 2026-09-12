<script lang="ts">
	import Icon from '../Icon.svelte';
	import type { IconName } from '../icons';

	/**
	 * The button a panel exists to press. `primary` is the brass slab that runs
	 * the export; `quiet` is everything that changes a setting or leaves for
	 * somewhere else. Both keep the 44px floor, which is why neither is a link
	 * dressed as text.
	 */

	interface Props {
		readonly label: string;
		readonly tone?: 'primary' | 'quiet';
		readonly onclick?: () => void;
		/** Set instead of `onclick` to render an anchor that opens in a new tab. */
		readonly href?: string;
		readonly disabled?: boolean;
		readonly busy?: boolean;
		readonly icon?: IconName;
		readonly title?: string;
	}

	const { label, tone = 'quiet', onclick, href, disabled, busy, icon, title }: Props = $props();
</script>

{#if href === undefined}
	<button
		type="button"
		class="action"
		data-tone={tone}
		data-busy={busy ?? false}
		disabled={disabled ?? false}
		{title}
		{onclick}
	>
		<span>{label}</span>
		{#if icon !== undefined}
			<Icon name={icon} size={18} />
		{/if}
	</button>
{:else}
	<a class="action" data-tone={tone} {href} {title} target="_blank" rel="external noreferrer">
		<span>{label}</span>
		<Icon name={icon ?? 'chevron'} size={18} />
	</a>
{/if}

<style>
	.action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: var(--spacing-touch);
		padding: 0 0.9rem;
		border: 0;
		border-radius: var(--control-radius);
		font: inherit;
		font-size: var(--control-text);
		text-decoration: none;
		cursor: pointer;
		transition:
			background var(--control-ease),
			color var(--control-ease);
	}

	.action[data-tone='primary'] {
		background: var(--control-on);
		color: var(--control-on-ink);
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0.03em;
	}

	.action[data-tone='primary']:hover:not(:disabled) {
		background: var(--color-brass-400);
	}

	.action[data-tone='quiet'] {
		justify-content: space-between;
		background: transparent;
		color: var(--color-brass-300);
	}

	.action[data-tone='quiet']:hover:not(:disabled) {
		background: var(--control-hover);
	}

	.action:disabled {
		background: var(--color-table-600);
		color: var(--control-ink-dim);
		cursor: not-allowed;
	}

	.action[data-busy='true']:disabled {
		cursor: progress;
	}
</style>
