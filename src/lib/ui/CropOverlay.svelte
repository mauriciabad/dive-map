<script lang="ts">
	import { cropFrame } from '$lib/domain/card';
	import { t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';

	interface Props {
		view: MapState;
		onexport: () => void;
		busy: boolean;
	}

	const { view, onexport, busy }: Props = $props();

	let viewport = $state({ width: 1440, height: 900 });

	const frame = $derived(cropFrame(view.framedCard, view.zoom, viewport));
	const tooBig = $derived(frame.overflowsViewport);
</script>

<svelte:window
	bind:innerWidth={viewport.width}
	bind:innerHeight={viewport.height}
	onkeydown={(e: KeyboardEvent) => {
		if (e.key === 'Escape') view.framing = false;
	}}
/>

<div class="stage" aria-hidden="true">
	<div class="crop" style:width="{frame.widthPx}px" style:height="{frame.heightPx}px">
		<span class="tick tl"></span>
		<span class="tick tr"></span>
		<span class="tick bl"></span>
		<span class="tick br"></span>
	</div>
</div>

<section class="readout" aria-label={t(view.locale, 'framing')}>
	<p class="hint">{t(view.locale, 'framingHint')}</p>
	<dl>
		<div><dt>{t(view.locale, 'scale')}</dt><dd>1:{view.framedCard.scale}</dd></div>
		<div>
			<dt>{t(view.locale, 'paper')}</dt>
			<dd>{view.framedCard.sheet.paper} · {Math.round(frame.groundWidthM)}×{Math.round(frame.groundHeightM)} m</dd>
		</div>
		<div><dt>px</dt><dd>{frame.exportWidthPx}×{frame.exportHeightPx}</dd></div>
	</dl>
	{#if tooBig}
		<p class="warn">{t(view.locale, 'cropOffScreen')}</p>
	{/if}
	<button type="button" onclick={onexport} disabled={busy}>
		{busy ? t(view.locale, 'exporting') : t(view.locale, 'exportPdf')}
	</button>
</section>

<style>
	.stage {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		z-index: 15;
		pointer-events: none;
	}

	/* The crop sits still and the map moves under it, which is what framing a
	   sheet by hand actually feels like. */
	.crop {
		position: relative;
		max-width: calc(100vw - 1rem);
		max-height: calc(100svh - 1rem);
		border: 1px solid var(--color-brass-400);
		box-shadow:
			0 0 0 9999px rgb(10 8 6 / 0.52),
			inset 0 0 0 1px rgb(239 228 207 / 0.25);
	}

	.tick {
		position: absolute;
		width: 1.1rem;
		height: 1.1rem;
		border: 2px solid var(--color-brass-300);
	}

	.tick.tl { top: -2px; left: -2px; border-right: 0; border-bottom: 0; }
	.tick.tr { top: -2px; right: -2px; border-left: 0; border-bottom: 0; }
	.tick.bl { bottom: -2px; left: -2px; border-right: 0; border-top: 0; }
	.tick.br { bottom: -2px; right: -2px; border-left: 0; border-top: 0; }

	.readout {
		position: fixed;
		z-index: 21;
		inset: max(0.75rem, env(safe-area-inset-top)) 0.75rem auto auto;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		width: min(17rem, calc(100vw - 1.5rem));
		padding: 0.8rem 0.9rem;
		background: var(--color-table-800);
		border: 1px solid rgb(184 137 63 / 0.32);
		border-radius: var(--radius-rail);
		box-shadow: var(--rail-shadow);
	}

	@media (min-width: 48rem) {
		.readout {
			inset: 0.85rem 3.4rem auto auto;
		}
	}

	.hint {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		color: var(--color-paper-dim);
	}

	dl {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0;
	}

	dl div {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		font-size: 0.78rem;
	}

	dt {
		color: var(--color-paper-dim);
	}

	dd {
		margin: 0;
		color: var(--color-paper);
		font-variant-numeric: tabular-nums;
	}

	.warn {
		margin: 0;
		font-size: 0.74rem;
		color: var(--color-buoy);
	}

	button {
		min-height: var(--spacing-touch);
		border: 0;
		border-radius: 0.35rem;
		background: var(--color-brass-500);
		color: var(--color-table-900);
		font: inherit;
		font-weight: 700;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: background 150ms ease-out;
	}

	button:hover:not(:disabled) {
		background: var(--color-brass-400);
	}

	button:disabled {
		background: var(--color-table-600);
		color: var(--color-paper-dim);
		cursor: progress;
	}
</style>
