<script lang="ts">
	import { cropFrame } from '$lib/domain/card';
	import {
		CARD_SCALES,
		DPI_CHOICES,
		LEGAL_FURNITURE,
		STOCK_IDS,
		type FurnitureId,
		type Sheet,
		exceedsCanvasCap
	} from '$lib/domain/print';
	import type { Locale } from '$lib/i18n/locale';
	import { t } from '$lib/i18n/messages';
	import { exportSheet } from './export';
	import { type PrintMessageKey, pt } from './messages';
	import type { LiveView, PrintState } from './print-state.svelte';

	interface Props {
		readonly print: PrintState;
		readonly live: LiveView;
		/** The live map's zoom, so the panel can say when the sheet runs off the screen. */
		readonly zoom: number;
		readonly locale: Locale;
	}

	const { print, live, zoom, locale }: Props = $props();

	const plan = $derived(print.plan(live));
	const viewport = $state({ width: 1440, height: 900 });
	const frame = $derived(cropFrame(plan, zoom, viewport));
	const sheet = $derived<Sheet>(print.sheet);
	const framedZoom = $derived(print.framing.by === 'zoom' ? print.framing.zoom : plan.zoom);

	const ROWS: readonly { readonly id: FurnitureId; readonly key: PrintMessageKey }[] = [
		{ id: 'title', key: 'printTitleRow' },
		{ id: 'depth', key: 'printDepthRow' },
		{ id: 'legend', key: 'printLegendRow' },
		{ id: 'scaleBar', key: 'printScaleBarRow' },
		{ id: 'northArrow', key: 'printNorthRow' },
		{ id: 'disclaimer', key: 'printDisclaimerRow' },
		{ id: 'attribution', key: 'printAttributionRow' }
	];

	const STOCK_LABELS: Record<(typeof STOCK_IDS)[number], string> = {
		A2: 'A2',
		A3: 'A3',
		A4: 'A4',
		A5: 'A5',
		letter: 'Letter',
		legal: 'Legal'
	};

	/** An empty or half-typed number field must not throw the sheet away. */
	const entered = (value: number, fallback: number): number =>
		Number.isFinite(value) ? value : fallback;

	const withDpi = (dpi: number): Sheet => (sheet.kind === 'pixels' ? sheet : { ...sheet, dpi });

	const run = async (): Promise<void> => {
		print.busy = true;
		print.error = undefined;
		try {
			await exportSheet({
				card: print.card(live),
				style: {
					locale,
					isobaths: live.isobaths,
					visible: live.layers,
					groundLayer: live.groundLayer
				},
				locale,
				format: print.format
			});
		} catch (e) {
			print.error = e instanceof Error ? e.message : String(e);
		} finally {
			print.busy = false;
		}
	};
</script>

<svelte:window bind:innerWidth={viewport.width} bind:innerHeight={viewport.height} />

<div class="print">
	<label class="field">
		<span class="legend">{pt(locale, 'printName')}</span>
		<input type="text" bind:value={print.title} placeholder={t(locale, 'cardTitle')} />
	</label>

	<fieldset>
		<legend>{pt(locale, 'printSize')}</legend>
		<div class="segmented">
			<button
				type="button"
				class="seg"
				aria-pressed={sheet.kind === 'stock'}
				onclick={() => {
					print.useStock(live.centre.lat);
				}}>{pt(locale, 'printStock')}</button
			>
			<button
				type="button"
				class="seg"
				aria-pressed={sheet.kind === 'millimetres'}
				onclick={() => {
					print.useMillimetres(live.centre.lat);
				}}>{pt(locale, 'printCustomMm')}</button
			>
			<button
				type="button"
				class="seg"
				aria-pressed={sheet.kind === 'pixels'}
				onclick={() => {
					print.usePixels(live.centre.lat);
				}}>{pt(locale, 'printCustomPx')}</button
			>
		</div>

		{#if sheet.kind === 'stock'}
			<div class="chips">
				{#each STOCK_IDS as id (id)}
					<button
						type="button"
						class="chip"
						aria-pressed={sheet.stock === id}
						onclick={() => {
							print.setStock(id);
						}}>{STOCK_LABELS[id]}</button
					>
				{/each}
			</div>
			<div class="segmented">
				{#each ['portrait', 'landscape'] as const as option (option)}
					<button
						type="button"
						class="seg"
						aria-pressed={sheet.orientation === option}
						onclick={() => {
							print.setOrientation(option);
						}}>{t(locale, option)}</button
					>
				{/each}
			</div>
		{:else}
			<div class="pair">
				<label class="field">
					<span class="legend">{pt(locale, 'printWidth')}</span>
					<input
						type="number"
						inputmode="numeric"
						value={sheet.kind === 'pixels' ? sheet.widthPx : sheet.widthMm}
						onchange={(e) => {
							if (sheet.kind === 'pixels') {
								print.setPixels(
									entered(e.currentTarget.valueAsNumber, sheet.widthPx),
									sheet.heightPx
								);
							} else if (sheet.kind === 'millimetres') {
								print.setMillimetres(
									entered(e.currentTarget.valueAsNumber, sheet.widthMm),
									sheet.heightMm
								);
							}
						}}
					/>
				</label>
				<label class="field">
					<span class="legend">{pt(locale, 'printHeight')}</span>
					<input
						type="number"
						inputmode="numeric"
						value={sheet.kind === 'pixels' ? sheet.heightPx : sheet.heightMm}
						onchange={(e) => {
							if (sheet.kind === 'pixels') {
								print.setPixels(
									sheet.widthPx,
									entered(e.currentTarget.valueAsNumber, sheet.heightPx)
								);
							} else if (sheet.kind === 'millimetres') {
								print.setMillimetres(
									sheet.widthMm,
									entered(e.currentTarget.valueAsNumber, sheet.heightMm)
								);
							}
						}}
					/>
				</label>
				<span class="unit">{sheet.kind === 'pixels' ? 'px' : 'mm'}</span>
			</div>
		{/if}

		{#if sheet.kind !== 'stock'}
			<button
				type="button"
				class="chip wide"
				onclick={() => {
					print.swapSides();
				}}>{pt(locale, 'printSwap')}</button
			>
		{/if}

		{#if sheet.kind !== 'pixels'}
			<span class="legend">{pt(locale, 'printDensity')}</span>
			<div class="segmented">
				{#each DPI_CHOICES as dpi (dpi)}
					<button
						type="button"
						class="seg num"
						aria-pressed={sheet.dpi === dpi}
						disabled={exceedsCanvasCap(withDpi(dpi))}
						onclick={() => {
							print.setDpi(dpi);
						}}>{dpi}</button
					>
				{/each}
			</div>
		{/if}
	</fieldset>

	<fieldset>
		<legend>{pt(locale, 'printFrameBy')}</legend>
		{#if print.framesByScale}
			<div class="segmented">
				<button
					type="button"
					class="seg"
					aria-pressed={print.framing.by === 'scale'}
					onclick={() => {
						print.frameByScale(CARD_SCALES, live);
					}}>{pt(locale, 'printByScale')}</button
				>
				<button
					type="button"
					class="seg"
					aria-pressed={print.framing.by === 'zoom'}
					onclick={() => {
						print.frameByZoom(live);
					}}>{pt(locale, 'printByZoom')}</button
				>
			</div>
		{:else}
			<p class="note">{pt(locale, 'printPixelsHaveNoScale')}</p>
		{/if}

		{#if print.framing.by === 'scale'}
			<div class="chips">
				{#each CARD_SCALES as denominator (denominator)}
					<button
						type="button"
						class="chip"
						aria-pressed={print.framing.by === 'scale' && print.framing.scale === denominator}
						onclick={() => {
							print.setScale(denominator);
						}}>1:{denominator}</button
					>
				{/each}
			</div>
		{:else}
			<div class="slider">
				<input
					type="range"
					min="6"
					max="22"
					step="0.1"
					value={framedZoom}
					oninput={(e) => {
						print.setZoom(e.currentTarget.valueAsNumber);
					}}
					aria-label={pt(locale, 'printZoom')}
				/>
				<output>{framedZoom.toFixed(1)}</output>
			</div>
		{/if}

		<dl>
			<div>
				<dt>{pt(locale, 'printCoverage')}</dt>
				<dd>{Math.round(plan.groundWidthM)}×{Math.round(plan.groundHeightM)} m</dd>
			</div>
			<div>
				<dt>px</dt>
				<dd>{plan.widthPx}×{plan.heightPx}</dd>
			</div>
			{#if plan.paper !== undefined}
				<div>
					<dt>{t(locale, 'scale')}</dt>
					<dd>1:{Math.round(plan.paper.scale)}</dd>
				</div>
			{/if}
		</dl>
	</fieldset>

	<fieldset>
		<legend>{pt(locale, 'printElements')}</legend>
		<div class="segmented">
			<button
				type="button"
				class="seg"
				onclick={() => {
					print.showAllFurniture();
				}}>{pt(locale, 'printAll')}</button
			>
			<button
				type="button"
				class="seg"
				onclick={() => {
					print.hideAllFurniture();
				}}>{pt(locale, 'printNone')}</button
			>
		</div>
		<ul class="rows">
			{#each ROWS as row (row.id)}
				<li>
					<button
						type="button"
						class="row"
						aria-pressed={print.shows(row.id)}
						onclick={() => {
							print.toggleFurniture(row.id);
						}}
					>
						<span class="label">{pt(locale, row.key)}</span>
						<span class="pip" aria-hidden="true"></span>
					</button>
				</li>
			{/each}
		</ul>
		{#if LEGAL_FURNITURE.some((id) => !print.shows(id))}
			<p class="warn">{pt(locale, 'printLegalNote')}</p>
		{/if}
	</fieldset>

	{#if frame.overflowsViewport}
		<p class="warn">{t(locale, 'cropOffScreen')}</p>
	{/if}
	{#if plan.oversized}
		<p class="warn">{pt(locale, 'printTooLarge')}</p>
	{/if}
	{#if print.error !== undefined}
		<p class="warn">{print.error}</p>
	{/if}

	<div class="segmented">
		<button
			type="button"
			class="seg"
			aria-pressed={print.format === 'pdf'}
			disabled={!print.exportsPdf}
			title={print.exportsPdf ? undefined : pt(locale, 'printPdfNeedsPaper')}
			onclick={() => {
				print.format = 'pdf';
			}}>PDF</button
		>
		<button
			type="button"
			class="seg"
			aria-pressed={print.format === 'png'}
			onclick={() => {
				print.format = 'png';
			}}>PNG</button
		>
	</div>

	<button
		type="button"
		class="export"
		disabled={print.busy || plan.oversized}
		onclick={() => {
			void run();
		}}
	>
		{#if print.busy}
			{t(locale, 'exporting')}
		{:else if print.format === 'pdf'}
			{t(locale, 'exportPdf')}
		{:else}
			{pt(locale, 'printExportPng')}
		{/if}
	</button>
</div>

<style>
	.print {
		display: flex;
		flex-direction: column;
		gap: 1.05rem;
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	legend,
	.legend {
		padding: 0;
		font-size: 0.72rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--color-paper-dim);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
		flex: 1;
	}

	input[type='text'],
	input[type='number'] {
		min-height: var(--spacing-touch);
		width: 100%;
		min-width: 0;
		padding: 0 0.65rem;
		border: 1px solid var(--color-table-500);
		border-radius: 0.35rem;
		background: var(--color-table-900);
		color: var(--color-paper);
		font: inherit;
		font-variant-numeric: tabular-nums;
		box-shadow: var(--sunk);
	}

	.pair {
		display: flex;
		align-items: flex-end;
		gap: 0.45rem;
	}

	.unit {
		padding-bottom: 0.8rem;
		font-size: 0.78rem;
		color: var(--color-paper-dim);
	}

	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		min-height: var(--spacing-touch);
		padding: 0 0.6rem;
		border: 0;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--color-paper);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 150ms ease-out;
	}

	.row:hover {
		background: rgb(239 228 207 / 0.07);
	}

	.label {
		flex: 1;
	}

	.pip {
		flex: none;
		width: 2.3rem;
		height: 1.25rem;
		border-radius: 999px;
		background: var(--color-table-600);
		box-shadow: var(--sunk);
		position: relative;
		transition: background 160ms ease-out;
	}

	.pip::after {
		content: '';
		position: absolute;
		inset: 2px auto 2px 2px;
		width: 1.05rem;
		border-radius: 999px;
		background: var(--color-paper-dim);
		transition:
			translate 160ms cubic-bezier(0.2, 0.9, 0.3, 1),
			background 160ms ease-out;
	}

	.row[aria-pressed='true'] .pip {
		background: var(--color-brass-500);
	}

	.row[aria-pressed='true'] .pip::after {
		translate: 1.05rem 0;
		background: var(--color-table-900);
	}

	.segmented {
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--color-table-900);
		border-radius: 0.45rem;
		box-shadow: var(--sunk);
	}

	.seg {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-width: 0;
		min-height: var(--spacing-touch);
		padding: 0 0.4rem;
		border: 0;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--color-paper-dim);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		transition:
			background 150ms ease-out,
			color 150ms ease-out;
	}

	.seg.num {
		font-variant-numeric: tabular-nums;
	}

	.seg:hover:not(:disabled) {
		color: var(--color-paper);
	}

	.seg:disabled {
		color: var(--color-table-500);
		cursor: not-allowed;
	}

	.seg[aria-pressed='true'] {
		background: var(--color-brass-500);
		color: var(--color-table-900);
		font-weight: 600;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		min-height: var(--spacing-touch);
		padding: 0 0.85rem;
		border: 1px solid var(--color-table-500);
		border-radius: 999px;
		background: transparent;
		color: var(--color-paper-dim);
		font: inherit;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition:
			border-color 150ms ease-out,
			color 150ms ease-out,
			background 150ms ease-out;
	}

	.chip.wide {
		width: 100%;
	}

	.chip:hover {
		border-color: var(--color-brass-500);
		color: var(--color-paper);
	}

	.chip[aria-pressed='true'] {
		background: var(--color-brass-500);
		border-color: var(--color-brass-400);
		color: var(--color-table-900);
		font-weight: 700;
	}

	.slider {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.slider input {
		flex: 1;
		min-width: 0;
		accent-color: var(--color-brass-500);
		height: var(--spacing-touch);
	}

	output {
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
		color: var(--color-paper);
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

	.note {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		color: var(--color-paper-dim);
	}

	.warn {
		margin: 0;
		font-size: 0.76rem;
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
