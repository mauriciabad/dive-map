<script lang="ts">
	import { ICONS, type Icon, type IconName } from './icons';

	interface Props {
		name: IconName;
		size?: number;
	}

	const { name, size = 24 }: Props = $props();
	const icon = $derived<Icon>(ICONS[name]);
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="2.2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#each icon.fill ?? [] as d (d)}
		<path {d} fill="currentColor" />
	{/each}
	{#each icon.d ?? [] as d (d)}
		<path {d} />
	{/each}
	{#each icon.dots ?? [] as [cx, cy, r] (`${cx},${cy}`)}
		<circle {cx} {cy} {r} fill="currentColor" stroke="none" />
	{/each}
</svg>
