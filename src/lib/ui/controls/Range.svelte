<script lang="ts">
	/**
	 * One number off a track, dragged rather than picked.
	 *
	 * The track is the full touch height, because the alternative on a boat is a
	 * 4px line and a steady hand. The readout is beside it rather than under the
	 * thumb: a value that moves with the thumb is unreadable while a thumb is on
	 * top of it.
	 *
	 * Whole steps under the hood, so the readout is exact and both ends are
	 * reachable without a float landing just short of them.
	 */

	interface Props {
		readonly label: string;
		readonly value: number;
		readonly min: number;
		readonly max: number;
		readonly step?: number;
		/** What the readout says, given the raw value. */
		readonly format: (value: number) => string;
		readonly onchange: (next: number) => void;
	}

	const { label, value, min, max, step = 1, format, onchange }: Props = $props();
</script>

<div class="range">
	<div class="track">
		<input
			type="range"
			{min}
			{max}
			{step}
			{value}
			aria-label={label}
			aria-valuetext={format(value)}
			oninput={(event) => {
				onchange(event.currentTarget.valueAsNumber);
			}}
		/>
	</div>
	<output>{format(value)}</output>
</div>

<style>
	.range {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.track {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	input {
		display: block;
		position: relative;
		width: 100%;
		height: var(--spacing-touch);
		margin: 0;
		background: transparent;
		accent-color: var(--control-on);
	}

	output {
		flex: none;
		min-width: 4.5ch;
		font-size: var(--control-text);
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--control-ink);
	}
</style>
