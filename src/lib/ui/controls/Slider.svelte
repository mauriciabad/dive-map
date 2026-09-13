<script lang="ts">
	/**
	 * A fraction between nothing and everything, dragged rather than picked.
	 *
	 * Whole percent under the hood, so the readout is exact and 0 and 100 are
	 * reachable without a float landing at 0.9999. The track is the full touch
	 * height, because the alternative on a boat is a 4px line and a steady hand.
	 */

	interface Props {
		readonly label: string;
		/** 0 to 1. */
		readonly value: number;
		readonly onchange: (next: number) => void;
	}

	const { label, value, onchange }: Props = $props();

	const percent = $derived(Math.round(value * 100));
</script>

<div class="slider">
	<input
		type="range"
		min="0"
		max="100"
		step="1"
		value={percent}
		aria-label={label}
		oninput={(event) => {
			onchange(event.currentTarget.valueAsNumber / 100);
		}}
	/>
	<output>{percent}%</output>
</div>

<style>
	.slider {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	input {
		flex: 1;
		min-width: 0;
		height: var(--spacing-touch);
		accent-color: var(--control-on);
	}

	output {
		flex: none;
		min-width: 3ch;
		font-size: var(--control-text);
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--control-ink);
	}
</style>
