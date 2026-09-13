<script lang="ts">
	/**
	 * A band of the real seabed, the map's own texture file tiled whole.
	 *
	 * One repeat spans the band's width, so the pattern is shown as a pattern and
	 * the band is several courses of it. Tiling at the map's own 256 px repeat
	 * instead meant a 44 px strip never held a whole one: what a class name sat
	 * beside was one arbitrary crop, and the flatter seabeds came out as a smear of
	 * colour that read as an image stretched to fill the row. These textures are
	 * drawn to tile, and tiling is what says which one it is.
	 *
	 * `column` is the legend's shape: a narrow strip as tall as the names beside
	 * it need, so the classes that share a texture sit against one continuous run
	 * of it. A class on its own comes out one tile square, six of them come out a
	 * column six tiles deep.
	 *
	 * CSS reports nothing when a background image fails, and an empty band would
	 * read as a texture that happens to be blank, which one of them nearly is. The
	 * hidden image is the load probe, and it stays in the DOM once it has decoded.
	 */

	interface Props {
		/** The texture file to tile, or nothing while the format is still unknown. */
		readonly url: string | undefined;
		readonly missing: string;
		readonly shape?: 'band' | 'column';
	}

	const { url, missing, shape = 'band' }: Props = $props();

	let loaded = $state(false);
	let failed = $state(false);
</script>

<div class="swatch" data-shape={shape}>
	{#if failed}
		<p class="missing" title={missing}><span>{missing}</span></p>
	{:else}
		<div
			class="band"
			style:background-image={loaded && url !== undefined ? `url("${url}")` : undefined}
		></div>
	{/if}

	{#if url !== undefined}
		<img
			class="probe"
			src={url}
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
		background-position: top left;
		/* The tile is square, so `auto` height is the band's width again. */
		background-size: 100% auto;
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
