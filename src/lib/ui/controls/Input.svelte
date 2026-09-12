<script lang="ts">
	/**
	 * A typed value: the sheet's name, a width in millimetres. Full width and
	 * never under the touch floor, because the alternative on a boat is a 24px
	 * field and a stylus nobody has.
	 *
	 * A name commits as it is typed; a number commits on blur, so a half-typed
	 * `3` on the way to `300` never resizes the sheet.
	 */

	interface Props {
		readonly label: string;
		readonly value: string | number;
		readonly kind?: 'text' | 'number';
		readonly placeholder?: string;
		readonly oncommit: (raw: string) => void;
	}

	const { label, value, kind = 'text', placeholder, oncommit }: Props = $props();
</script>

<label class="field">
	<span class="label">{label}</span>
	{#if kind === 'number'}
		<input
			type="number"
			inputmode="numeric"
			{value}
			{placeholder}
			onchange={(event) => {
				oncommit(event.currentTarget.value);
			}}
		/>
	{:else}
		<input
			type="text"
			{value}
			{placeholder}
			oninput={(event) => {
				oncommit(event.currentTarget.value);
			}}
		/>
	{/if}
</label>

<style>
	.field {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.label {
		font-size: var(--control-label);
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--control-ink-dim);
	}

	input {
		width: 100%;
		min-width: 0;
		min-height: var(--spacing-touch);
		padding: 0 0.65rem;
		border: 1px solid var(--control-rim);
		border-radius: var(--control-radius);
		background: var(--control-well);
		color: var(--control-ink);
		font: inherit;
		font-variant-numeric: tabular-nums;
		box-shadow: var(--sunk);
	}

	input::placeholder {
		color: var(--control-ink-dim);
	}
</style>
