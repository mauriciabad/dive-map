<script lang="ts">
	import type { CropFrame } from '$lib/domain/card';
	import { t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';

	interface CropReadoutProps {
		readonly view: MapState;
		readonly frame: CropFrame;
		readonly busy: boolean;
		readonly onexport: () => void;
	}

	const { view, frame, busy, onexport }: CropReadoutProps = $props();
</script>

<p class="hint">{t(view.locale, 'framingHint')}</p>

<dl>
	<div>
		<dt>{t(view.locale, 'scale')}</dt>
		<dd>1:{view.framedCard.scale}</dd>
	</div>
	<div>
		<dt>{t(view.locale, 'paper')}</dt>
		<dd>
			{view.framedCard.sheet.paper} · {Math.round(frame.groundWidthM)}×{Math.round(
				frame.groundHeightM
			)} m
		</dd>
	</div>
	<div>
		<dt>px</dt>
		<dd>{frame.exportWidthPx}×{frame.exportHeightPx}</dd>
	</div>
</dl>

{#if frame.overflowsViewport}
	<p class="warn">{t(view.locale, 'cropOffScreen')}</p>
{/if}

<button type="button" class="export" onclick={onexport} disabled={busy}>
	{busy ? t(view.locale, 'exporting') : t(view.locale, 'exportPdf')}
</button>

<style>
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
		text-align: right;
	}

	.warn {
		margin: 0;
		font-size: 0.74rem;
		line-height: 1.4;
		color: var(--color-buoy);
	}

	.export {
		min-height: var(--spacing-touch);
		padding: 0 0.9rem;
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

	.export:hover:not(:disabled) {
		background: var(--color-brass-400);
	}

	.export:disabled {
		background: var(--color-table-600);
		color: var(--color-paper-dim);
		cursor: progress;
	}
</style>
