<script lang="ts">
	import Icon from './Icon.svelte';
	import { PANEL_ID, SECTIONS, type PanelSection } from './panel';
	import type { IconName } from './icons';
	import type { MapState } from '$lib/state/map-view.svelte';
	import { LOCALES, LOCALE_NAMES } from '$lib/i18n/locale';
	import { type MessageKey, t } from '$lib/i18n/messages';
	import type { LayerId } from '$lib/domain/card';

	type Props = {
		readonly view: MapState;
		readonly section: PanelSection;
		readonly onclose: () => void;
	};

	const { view, section, onclose }: Props = $props();

	const title = $derived(SECTIONS.find((s) => s.id === section)?.key ?? 'layers');

	interface LayerRow {
		readonly id: LayerId;
		readonly icon: IconName;
		readonly key: MessageKey;
	}

	const LAYER_ROWS: readonly LayerRow[] = [
		{ id: 'hillshade', icon: 'relief', key: 'relief' },
		{ id: 'depth-tint', icon: 'depth', key: 'depthTint' },
		{ id: 'coastline', icon: 'frame', key: 'coastline' },
		{ id: 'osm', icon: 'buoy', key: 'osmFeatures' },
		{ id: 'annotations', icon: 'annotate', key: 'annotations' }
	];

	const INTERVALS = [1, 2, 5, 10, 20] as const;
	const EMPHASIS_CHOICES = [5, 10, 18, 20, 30, 40, 50, 60] as const;
	const MAX_DEPTHS = [30, 40, 50, 60, 80] as const;
</script>

<section id={PANEL_ID} class="panel" aria-label={t(view.locale, title)}>
	<header>
		<h2>{t(view.locale, title)}</h2>
		<button type="button" class="close" onclick={onclose}>
			<Icon name="close" size={22} />
			<span class="visually-hidden">{t(view.locale, 'close')}</span>
		</button>
	</header>

	<div class="body">
		{#if section === 'layers'}
			<fieldset>
				<legend>{t(view.locale, 'ground')}</legend>
				<div class="segmented">
					{#each ['habitats', 'substrate'] as const as ground (ground)}
						<button
							type="button"
							class="seg"
							aria-pressed={view.groundLayer === ground}
							onclick={() => {
								view.groundLayer = ground;
								if (!view.shows(ground)) view.toggle(ground);
							}}
						>
							<Icon name={ground === 'habitats' ? 'habitat' : 'substrate'} size={18} />
							{t(view.locale, ground)}
						</button>
					{/each}
				</div>
				<p class="note">{t(view.locale, 'accuracyNote')}</p>
			</fieldset>

			<ul class="rows">
				{#each LAYER_ROWS as row (row.id)}
					<li>
						<button
							type="button"
							class="row"
							aria-pressed={view.shows(row.id)}
							onclick={() => {
								view.toggle(row.id);
							}}
						>
							<Icon name={row.icon} size={20} />
							<span class="label">{t(view.locale, row.key)}</span>
							<span class="pip" aria-hidden="true"></span>
						</button>
					</li>
				{/each}
			</ul>
		{:else if section === 'isobaths'}
			<fieldset>
				<legend>{t(view.locale, 'interval')}</legend>
				<div class="segmented">
					{#each INTERVALS as metres (metres)}
						<button
							type="button"
							class="seg num"
							aria-pressed={view.isobaths.intervalM === metres}
							onclick={() => {
								view.setInterval(metres);
							}}>{metres}&thinsp;m</button
						>
					{/each}
				</div>
			</fieldset>

			<fieldset>
				<legend>{t(view.locale, 'emphasised')}</legend>
				<div class="chips">
					{#each EMPHASIS_CHOICES as depth (depth)}
						<button
							type="button"
							class="chip"
							aria-pressed={view.isobaths.emphasised.includes(depth)}
							onclick={() => {
								view.toggleEmphasis(depth);
							}}>{depth}&thinsp;m</button
						>
					{/each}
				</div>
			</fieldset>

			<fieldset>
				<legend>{t(view.locale, 'maxDepth')}</legend>
				<div class="segmented">
					{#each MAX_DEPTHS as metres (metres)}
						<button
							type="button"
							class="seg num"
							aria-pressed={view.isobaths.maxDepthM === metres}
							onclick={() => {
								view.setMaxDepth(metres);
							}}>{metres}&thinsp;m</button
						>
					{/each}
				</div>
			</fieldset>

			<button
				type="button"
				class="row"
				aria-pressed={view.isobaths.labels}
				onclick={() => {
					view.toggleLabels();
				}}
			>
				<Icon name="depth" size={20} />
				<span class="label">{t(view.locale, 'showLabels')}</span>
				<span class="pip" aria-hidden="true"></span>
			</button>
		{:else if section === 'print'}
			<button
				type="button"
				class="row"
				aria-pressed={view.framing}
				onclick={() => (view.framing = !view.framing)}
			>
				<Icon name="frame" size={20} />
				<span class="label">{t(view.locale, 'framing')}</span>
				<span class="pip" aria-hidden="true"></span>
			</button>
			<p class="note">{t(view.locale, 'framingHint')}</p>
		{:else}
			<ul class="rows">
				{#each LOCALES as locale (locale)}
					<li>
						<button
							type="button"
							class="row"
							aria-pressed={view.locale === locale}
							onclick={() => (view.locale = locale)}
						>
							<span class="label">{LOCALE_NAMES[locale]}</span>
							<span class="pip" aria-hidden="true"></span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<p class="disclaimer">{t(view.locale, 'disclaimer')}</p>
</section>

<style>
	/*
	 * A phone gets a bottom sheet that stops short of the map centre, because the
	 * crop overlay lives there. Anything wider, and anything too short for a sheet
	 * (a phone on its side), gets a column beside the control stack instead. Both
	 * scroll inside themselves, so the panel can never run off the screen.
	 */
	.panel {
		position: fixed;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		inset: auto 0 0 0;
		max-height: 45svh;
		padding-block: 0.7rem;
		padding-inline: max(1rem, env(safe-area-inset-left)) max(1rem, env(safe-area-inset-right));
		padding-bottom: calc(0.7rem + env(safe-area-inset-bottom));
		background: var(--color-table-800);
		border: 1px solid var(--ctrl-edge);
		border-bottom: 0;
		border-radius: var(--radius-rail) var(--radius-rail) 0 0;
		box-shadow: var(--rail-shadow);
	}

	@media (min-width: 48rem), (max-height: 30rem) {
		.panel {
			inset: var(--ctrl-inset-top) auto auto var(--ctrl-inset-left);
			width: min(21rem, calc(50vw - var(--ctrl-inset-left) - 1rem));
			max-height: calc(100svh - var(--ctrl-inset-top) - var(--ctrl-gap) - env(safe-area-inset-bottom));
			padding-inline: 1rem;
			padding-bottom: 0.7rem;
			border: 1px solid var(--ctrl-edge);
			border-radius: var(--radius-rail);
		}
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	h2 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-brass-300);
	}

	.close {
		display: grid;
		place-items: center;
		flex: none;
		width: var(--spacing-touch);
		height: var(--spacing-touch);
		margin-right: -0.55rem;
		border: 0;
		border-radius: 0.35rem;
		background: transparent;
		color: var(--color-paper-dim);
		cursor: pointer;
	}

	.close:hover {
		background: rgb(239 228 207 / 0.08);
		color: var(--color-paper);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 1.05rem;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding-block: 0.15rem;
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	legend {
		padding: 0;
		font-size: 0.72rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
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
		min-height: calc(var(--spacing-touch) - 4px);
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

	.seg:hover {
		color: var(--color-paper);
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

	.note {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.45;
		color: var(--color-paper-dim);
	}

	.disclaimer {
		flex: none;
		margin: 0;
		padding-top: 0.5rem;
		border-top: 1px solid rgb(184 137 63 / 0.18);
		font-size: 0.7rem;
		color: var(--color-paper-dim);
	}
</style>
