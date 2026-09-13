<script lang="ts">
	import type { TextureSample } from './types';

	/**
	 * A band of the real seabed at the size the map paints it. Not a thumbnail: the
	 * map's own texture file is tiled at its own repeat inside a window 6rem tall,
	 * so what you see beside a class name is the density you see under the boat. A
	 * whole tile shrunk into a box is a different pattern from the one on the map.
	 *
	 * CSS reports nothing when a background image fails, and an empty band would
	 * read as a texture that happens to be blank, which one of them nearly is. The
	 * hidden image is the load probe, and it stays in the DOM once it has decoded.
	 */

	interface Props {
		readonly sample: TextureSample | undefined;
		readonly missing: string;
	}

	const { sample, missing }: Props = $props();

	let loaded = $state(false);
	let failed = $state(false);
</script>

<div class="swatch">
	{#if failed}
		<p class="missing">{missing}</p>
	{:else}
		<div
			class="band"
			style:--repeat={sample === undefined ? undefined : `${sample.repeatCssPx}px`}
			style:background-image={loaded && sample !== undefined ? `url("${sample.url}")` : undefined}
		></div>
	{/if}

	{#if sample !== undefined}
		<img
			class="probe"
			src={sample.url}
			alt=""
			aria-hidden="true"
			onload={() => {
				loaded = true;
			}}
			onerror={() => {
				failed = true;
			}}
		/>
	{/if}
</div>

<style>
	.swatch {
		position: relative;
	}

	.band {
		width: 100%;
		height: 6rem;
		overflow: hidden;
		border: 1px solid var(--ctrl-edge);
		border-radius: var(--control-radius);
		background-color: var(--control-well);
		background-repeat: repeat;
		background-position: center;
		background-size: var(--repeat) var(--repeat);
		box-shadow: var(--sunk);
	}

	/*
	 * Hidden but still fetched and decoded, so it can report the failure and so a
	 * screenshot check can read the decoded pixels. `display: none` would load
	 * nothing and report nothing.
	 */
	.probe {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	.missing {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 6rem;
		margin: 0;
		border: 1px solid var(--ctrl-edge);
		border-radius: var(--control-radius);
		background: var(--control-well);
		color: var(--control-ink-dim);
		font-size: var(--control-text);
		text-align: center;
		box-shadow: var(--sunk);
	}
</style>
