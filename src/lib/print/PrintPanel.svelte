<script lang="ts">
	import { exportSheet } from './export';
	import { cropFrame } from '$lib/domain/card';
	import {
		CARD_SCALES,
		DPI_CHOICES,
		LEGAL_FURNITURE,
		STOCK_IDS,
		type FurnitureId,
		type Orientation,
		type Sheet,
		type StockId,
		exceedsCanvasCap
	} from '$lib/domain/print';
	import Panel from '$lib/ui/Panel.svelte';
	import Action from '$lib/ui/controls/Action.svelte';
	import Chip from '$lib/ui/controls/Chip.svelte';
	import ChipGroup from '$lib/ui/controls/ChipGroup.svelte';
	import Field from '$lib/ui/controls/Field.svelte';
	import Input from '$lib/ui/controls/Input.svelte';
	import Note from '$lib/ui/controls/Note.svelte';
	import Readout from '$lib/ui/controls/Readout.svelte';
	import Segmented from '$lib/ui/controls/Segmented.svelte';
	import Toggle from '$lib/ui/controls/Toggle.svelte';
	import type { Choice, Reading } from '$lib/ui/controls/types';
	import { PANEL_ID } from '$lib/ui/panel';
	import { type MessageKey, t } from '$lib/i18n/messages';
	import type { MapState } from '$lib/state/map-view.svelte';
	import type { SheetFormat } from './export';

	/**
	 * Framing a sheet and exporting it. Every control the sheet has lives inside
	 * the panel, and the one that actually makes the file is pinned under the
	 * scroll so it never falls below the fold on a phone.
	 */

	interface Props {
		readonly view: MapState;
		readonly onclose: () => void;
	}

	const { view, onclose }: Props = $props();

	const print = $derived(view.print);
	const locale = $derived(view.locale);
	const plan = $derived(print.plan(view.live));
	const viewport = $state({ width: 1440, height: 900 });
	const frame = $derived(cropFrame(plan, view.zoom, viewport));
	const sheet = $derived<Sheet>(print.sheet);
	const framedZoom = $derived(print.framing.by === 'zoom' ? print.framing.zoom : plan.zoom);

	type SizeKind = Sheet['kind'];

	const FURNITURE: readonly { readonly id: FurnitureId; readonly key: MessageKey }[] = [
		{ id: 'title', key: 'printTitleRow' },
		{ id: 'depth', key: 'printDepthRow' },
		{ id: 'legend', key: 'printLegendRow' },
		{ id: 'scaleBar', key: 'printScaleBarRow' },
		{ id: 'northArrow', key: 'printNorthRow' },
		{ id: 'disclaimer', key: 'printDisclaimerRow' },
		{ id: 'attribution', key: 'printAttributionRow' }
	];

	const STOCK_LABELS: Record<StockId, string> = {
		A2: 'A2',
		A3: 'A3',
		A4: 'A4',
		A5: 'A5',
		letter: 'Letter',
		legal: 'Legal'
	};

	const kinds = $derived<readonly Choice<SizeKind>[]>([
		{ value: 'stock', label: t(locale, 'printStock') },
		{ value: 'millimetres', label: t(locale, 'printCustomMm') },
		{ value: 'pixels', label: t(locale, 'printCustomPx') }
	]);

	const orientations = $derived<readonly Choice<Orientation>[]>([
		{ value: 'portrait', label: t(locale, 'portrait') },
		{ value: 'landscape', label: t(locale, 'landscape') }
	]);

	const densities = $derived<readonly Choice<number>[]>(
		DPI_CHOICES.map((dpi) => ({
			value: dpi,
			label: String(dpi),
			disabled: exceedsCanvasCap(sheet.kind === 'pixels' ? sheet : { ...sheet, dpi })
		}))
	);

	const framings = $derived<readonly Choice<'scale' | 'zoom'>[]>([
		{ value: 'scale', label: t(locale, 'printByScale') },
		{ value: 'zoom', label: t(locale, 'printByZoom') }
	]);

	const formats = $derived<readonly Choice<SheetFormat>[]>([
		{
			value: 'pdf',
			label: 'PDF',
			disabled: !print.exportsPdf,
			title: t(locale, 'printPdfNeedsPaper')
		},
		{ value: 'png', label: 'PNG' }
	]);

	const readings = $derived<readonly Reading[]>([
		{
			label: t(locale, 'printCoverage'),
			value: `${Math.round(plan.groundWidthM)}×${Math.round(plan.groundHeightM)} m`
		},
		{ label: 'px', value: `${plan.widthPx}×${plan.heightPx}` },
		...(plan.paper === undefined
			? []
			: [{ label: t(locale, 'scale'), value: `1:${Math.round(plan.paper.scale)}` }])
	]);

	/** An empty or half-typed field must not throw the sheet away. */
	const entered = (raw: string, fallback: number): number => {
		const value = Number.parseFloat(raw);
		return Number.isFinite(value) ? value : fallback;
	};

	const chooseKind = (kind: SizeKind): void => {
		const lat = view.live.centre.lat;
		if (kind === 'stock') print.useStock(lat);
		else if (kind === 'millimetres') print.useMillimetres(lat);
		else print.usePixels(lat);
	};

	const run = async (): Promise<void> => {
		print.busy = true;
		print.error = undefined;
		try {
			await exportSheet({
				card: print.card(view.live),
				style: {
					locale,
					isobaths: view.live.isobaths,
					visible: view.live.layers,
					groundLayer: view.live.groundLayer,
					smoothed: view.live.smoothed
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

<Panel id={PANEL_ID} title={t(locale, 'print')} {locale} anchor="top-left" {onclose}>
	<Input
		label={t(locale, 'printName')}
		value={print.title}
		placeholder={t(locale, 'cardTitle')}
		oncommit={(raw: string) => {
			print.title = raw;
		}}
	/>

	<Field label={t(locale, 'printSize')}>
		<Segmented options={kinds} value={sheet.kind} onselect={chooseKind} />

		{#if sheet.kind === 'stock'}
			<ChipGroup columns={3}>
				{#each STOCK_IDS as id (id)}
					<Chip
						label={STOCK_LABELS[id]}
						pressed={sheet.stock === id}
						onclick={() => {
							print.setStock(id);
						}}
					/>
				{/each}
			</ChipGroup>
			<Segmented
				options={orientations}
				value={sheet.orientation}
				onselect={(next: Orientation) => {
					print.setOrientation(next);
				}}
			/>
		{:else}
			<div class="pair">
				<Input
					kind="number"
					label={t(locale, 'printWidth')}
					value={sheet.kind === 'pixels' ? sheet.widthPx : sheet.widthMm}
					oncommit={(raw: string) => {
						if (sheet.kind === 'pixels') {
							print.setPixels(entered(raw, sheet.widthPx), sheet.heightPx);
						} else if (sheet.kind === 'millimetres') {
							print.setMillimetres(entered(raw, sheet.widthMm), sheet.heightMm);
						}
					}}
				/>
				<Input
					kind="number"
					label={t(locale, 'printHeight')}
					value={sheet.kind === 'pixels' ? sheet.heightPx : sheet.heightMm}
					oncommit={(raw: string) => {
						if (sheet.kind === 'pixels') {
							print.setPixels(sheet.widthPx, entered(raw, sheet.heightPx));
						} else if (sheet.kind === 'millimetres') {
							print.setMillimetres(sheet.widthMm, entered(raw, sheet.heightMm));
						}
					}}
				/>
				<span class="unit">{sheet.kind === 'pixels' ? 'px' : 'mm'}</span>
			</div>
			<Action
				label={t(locale, 'printSwap')}
				onclick={() => {
					print.swapSides();
				}}
			/>
		{/if}

		{#if sheet.kind !== 'pixels'}
			<span class="sublabel">{t(locale, 'printDensity')}</span>
			<Segmented
				options={densities}
				value={sheet.dpi}
				numeric
				label={t(locale, 'printDensity')}
				onselect={(dpi: number) => {
					print.setDpi(dpi);
				}}
			/>
		{/if}
	</Field>

	<Field label={t(locale, 'printFrameBy')}>
		{#if print.framesByScale}
			<Segmented
				options={framings}
				value={print.framing.by}
				onselect={(by: 'scale' | 'zoom') => {
					if (by === 'scale') print.frameByScale(CARD_SCALES, view.live);
					else print.frameByZoom(view.live);
				}}
			/>
		{:else}
			<Note>{t(locale, 'printPixelsHaveNoScale')}</Note>
		{/if}

		{#if print.framing.by === 'scale'}
			{@const chosen = print.framing.scale}
			<ChipGroup columns={4}>
				{#each CARD_SCALES as denominator (denominator)}
					<Chip
						label="1:{denominator}"
						pressed={chosen === denominator}
						onclick={() => {
							print.setScale(denominator);
						}}
					/>
				{/each}
			</ChipGroup>
		{:else}
			<div class="slider">
				<input
					type="range"
					min="6"
					max="22"
					step="0.1"
					value={framedZoom}
					oninput={(event) => {
						print.setZoom(event.currentTarget.valueAsNumber);
					}}
					aria-label={t(locale, 'printZoom')}
				/>
				<output>{framedZoom.toFixed(1)}</output>
			</div>
		{/if}

		<Readout rows={readings} />
	</Field>

	<Field label={t(locale, 'printElements')}>
		<div class="bulk">
			<Action
				label={t(locale, 'printAll')}
				onclick={() => {
					print.showAllFurniture();
				}}
			/>
			<Action
				label={t(locale, 'printNone')}
				onclick={() => {
					print.hideAllFurniture();
				}}
			/>
		</div>
		<div class="rows">
			{#each FURNITURE as row (row.id)}
				<Toggle
					label={t(locale, row.key)}
					pressed={print.shows(row.id)}
					onchange={() => {
						print.toggleFurniture(row.id);
					}}
				/>
			{/each}
		</div>
		{#if LEGAL_FURNITURE.some((id) => !print.shows(id))}
			<Note tone="warn">{t(locale, 'printLegalNote')}</Note>
		{/if}
	</Field>

	{#snippet footer()}
		{#if frame.overflowsViewport}
			<Note tone="warn">{t(locale, 'cropOffScreen')}</Note>
		{/if}
		{#if plan.oversized}
			<Note tone="warn">{t(locale, 'printTooLarge')}</Note>
		{/if}
		{#if print.error !== undefined}
			<Note tone="warn">{print.error}</Note>
		{/if}
		<Segmented
			options={formats}
			value={print.format}
			label={t(locale, 'exportPdf')}
			onselect={(next: SheetFormat) => {
				print.format = next;
			}}
		/>
		<Action
			tone="primary"
			busy={print.busy}
			disabled={print.busy || plan.oversized}
			label={print.busy
				? t(locale, 'exporting')
				: print.format === 'pdf'
					? t(locale, 'exportPdf')
					: t(locale, 'printExportPng')}
			onclick={() => {
				void run();
			}}
		/>
	{/snippet}
</Panel>

<style>
	.pair {
		display: flex;
		align-items: flex-end;
		gap: 0.45rem;
	}

	.unit {
		padding-bottom: 0.8rem;
		font-size: 0.78rem;
		color: var(--control-ink-dim);
	}

	.sublabel {
		font-size: var(--control-label);
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--control-ink-dim);
	}

	.bulk {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.slider {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.slider input {
		flex: 1;
		min-width: 0;
		height: var(--spacing-touch);
		accent-color: var(--control-on);
	}

	output {
		font-size: var(--control-text);
		font-variant-numeric: tabular-nums;
		color: var(--control-ink);
	}
</style>
