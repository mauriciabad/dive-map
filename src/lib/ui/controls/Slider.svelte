<script lang="ts">
	import Range from './Range.svelte';

	/**
	 * A fraction between nothing and everything. Whole percent on the wire, so the
	 * readout is exact and 0 and 100 are reachable without a float landing at
	 * 0.9999.
	 */

	interface Props {
		readonly label: string;
		/** 0 to 1. */
		readonly value: number;
		readonly onchange: (next: number) => void;
	}

	const { label, value, onchange }: Props = $props();
</script>

<Range
	{label}
	value={Math.round(value * 100)}
	min={0}
	max={100}
	format={(percent) => `${percent}%`}
	onchange={(percent) => {
		onchange(percent / 100);
	}}
/>
