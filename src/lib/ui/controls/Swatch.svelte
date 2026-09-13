<script lang="ts">
	import type { TextureSample } from './types';

	/**
	 * A band of the real seabed at the size the map paints it. Not a thumbnail: the
	 * map's own texture file is tiled at its own repeat, so what you see beside a
	 * class name is the density you see under the boat. A whole tile shrunk into a
	 * box is a different pattern from the one on the map, which is why the repeat
	 * is fixed and the box is what changes shape.
	 *
	 * `column` is the legend's shape: a narrow strip that stretches to whatever
	 * height the names beside it need, so the classes that share a texture sit
	 * against one continuous run of it. A class on its own comes out a small
	 * square, six of them come out a tall rectangle, and both are the same pixels
	 * at the same density.
	 *
	 * CSS reports nothing when a background image fails, and an empty band would
	 * read as a texture that happens to be blank, which one of them nearly is. The
	 * hidden image is the load probe, and it stays in the DOM once it has decoded.
	 */

	interface Props {
		readonly sample: TextureSample | undefined;
		readonly missing: string;
		readonly shape?: 'band' | 'column';
	}

	const { sample, missing, shape = 'band' }: Props = $props();

	let loaded = $state(false);
	let failed = $state(false);
</script>

<div class="swatch" data-shape={shape}>
	{#if failed}
		<p class="missing" title={missing}><span>{missing}</span></p>
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
	 * The caller sets the width. Height follows the row, with the touch floor as a
	 * floor so a texture carrying one class is still a square you can see.
	 */
	.swatch[data-shape='column'] {
		height: 100%;
	}

	.swatch[data-shape='column'] .band,
	.swatch[data-shape='column'] .missing {
		height: 100%;
		min-height: var(--spacing-touch);
	}

	/* A strip this narrow cannot hold a sentence, so the words go to the tooltip. */
	.swatch[data-shape='column'] .missing span {
		display: none;
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
