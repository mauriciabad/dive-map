<script lang="ts">
	import Icon from '../Icon.svelte';
	import type { IconName } from '../icons';

	/**
	 * On or off, as one full-width row with the switch at the end. Not a
	 * checkbox: a checkbox is a 16px target that a wet finger on a moving boat
	 * misses, and this row is the whole panel wide and never under 44px tall.
	 */

	interface Props {
		readonly label: string;
		readonly pressed: boolean;
		readonly onchange: () => void;
		readonly icon?: IconName;
	}

	const { label, pressed, onchange, icon }: Props = $props();
</script>

<button type="button" class="toggle" aria-pressed={pressed} onclick={onchange}>
	{#if icon !== undefined}
		<Icon name={icon} size={20} />
	{/if}
	<span class="label">{label}</span>
	<span class="pip" aria-hidden="true"></span>
</button>

<style>
	.toggle {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		min-height: var(--spacing-touch);
		padding: 0.35rem 0.6rem;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--control-ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--control-ease);
	}

	.toggle:hover {
		background: var(--control-hover);
	}

	.label {
		flex: 1;
		min-width: 0;
	}

	.pip {
		flex: none;
		position: relative;
		width: 2.3rem;
		height: 1.25rem;
		border-radius: 999px;
		background: var(--color-table-600);
		box-shadow: var(--sunk);
		transition: background 160ms ease-out;
	}

	.pip::after {
		content: '';
		position: absolute;
		inset: 2px auto 2px 2px;
		width: 1.05rem;
		border-radius: 999px;
		background: var(--control-ink-dim);
		transition:
			translate 160ms cubic-bezier(0.2, 0.9, 0.3, 1),
			background 160ms ease-out;
	}

	.toggle[aria-pressed='true'] .pip {
		background: var(--control-on);
	}

	.toggle[aria-pressed='true'] .pip::after {
		translate: 1.05rem 0;
		background: var(--control-on-ink);
	}
</style>
